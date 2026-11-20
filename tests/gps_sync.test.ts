import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleMapsEmbedUrl,
  buildGoogleMapsPinUrl,
  buildOpenStreetMapEmbedUrl,
  formatLatLngDisplay,
  parseGoogleMapsCoordinates,
  sanitizeGoogleMapsHref,
  validateCoordinates,
  validateCoordinateStrings,
} from '../src/utils/googleMaps';
import {
  createPropertyService,
  normalizeProperty,
  propertyService,
  validatePropertyForPublish,
  type SupabaseClientLike,
} from '../src/services/propertyService';
import {DEMO_PROPERTIES} from '../src/data/demoProperties';
import type {PropertyInput} from '../src/types/property';

// Minimal in-memory localStorage shim for Node test runner
const memoryStorage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, val: string) => {
      memoryStorage.set(key, String(val));
    },
    removeItem: (key: string) => {
      memoryStorage.delete(key);
    },
    clear: () => {
      memoryStorage.clear();
    },
  },
  configurable: true,
});

function createGpsMockSupabase() {
  const tables: Record<string, Array<Record<string, unknown>>> = {
    properties: [],
    property_images: [],
    property_videos: [],
    property_documents: [],
  };
  let seq = 1;

  class QueryBuilder {
    private filters: Array<(row: Record<string, unknown>) => boolean> = [];
    private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: unknown = null;
    private wantSingle = false;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push((row) => row[col] === val);
      return this;
    }
    in(col: string, vals: unknown[]) {
      const set = new Set(vals);
      this.filters.push((row) => set.has(row[col]));
      return this;
    }
    order() {
      return this;
    }
    insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
      this.mode = 'insert';
      this.payload = Array.isArray(rows) ? rows : [rows];
      return this;
    }
    update(patch: Record<string, unknown>) {
      this.mode = 'update';
      this.payload = patch;
      return this;
    }
    delete() {
      this.mode = 'delete';
      return this;
    }
    single() {
      this.wantSingle = true;
      return this.execute();
    }
    maybeSingle() {
      this.wantSingle = true;
      return this.execute();
    }
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: {data: unknown; error: {message: string} | null}) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return this.execute().then(onfulfilled, onrejected);
    }

    private async execute() {
      if (this.mode === 'insert') {
        const rows = this.payload as Array<Record<string, unknown>>;
        const inserted: Array<Record<string, unknown>> = [];
        for (const raw of rows) {
          const row = {
            ...raw,
            id: raw.id || `${this.table}-${seq++}`,
            created_at: raw.created_at || '2026-11-20T00:00:00.000Z',
            updated_at: raw.updated_at || `2026-11-20T00:00:0${seq}.000Z`,
          };
          tables[this.table].push(row);
          inserted.push({...row});
        }
        return {data: this.wantSingle ? inserted[0] : inserted, error: null};
      }

      if (this.mode === 'update') {
        const patch = this.payload as Record<string, unknown>;
        const matched: Array<Record<string, unknown>> = [];
        for (const row of tables[this.table]) {
          if (this.filters.every((fn) => fn(row))) {
            Object.assign(row, patch);
            matched.push({...row});
          }
        }
        return {data: this.wantSingle ? matched[0] || null : matched, error: null};
      }

      if (this.mode === 'delete') {
        tables[this.table] = tables[this.table].filter(
          (row) => !this.filters.every((fn) => fn(row))
        );
        return {data: null, error: null};
      }

      const rows = tables[this.table]
        .filter((row) => this.filters.every((fn) => fn(row)))
        .map((row) => {
          if (this.table !== 'properties') return {...row};
          return {
            ...row,
            property_images: [],
            property_videos: [],
            property_documents: [],
          };
        });
      return {data: this.wantSingle ? rows[0] || null : rows, error: null};
    }
  }

  const client = {
    from(table: string) {
      return new QueryBuilder(table);
    },
    storage: {
      from() {
        return {
          async remove() {
            return {data: [], error: null};
          },
          async createSignedUrl(path: string) {
            return {data: {signedUrl: `https://signed.example.invalid/${path}`}, error: null};
          },
          getPublicUrl(path: string) {
            return {data: {publicUrl: `https://cdn.example.invalid/${path}`}};
          },
        };
      },
    },
  } as unknown as SupabaseClientLike;

  return {client, tables};
}

function makeBasePropertyInput(overrides: Partial<PropertyInput> = {}): PropertyInput {
  const base = DEMO_PROPERTIES[0];
  const {id: _id, updatedAt: _u, ...rest} = base;
  return {
    ...rest,
    lotId: 'LOT-GPS-001',
    visibility: 'Draft',
    isArchived: false,
    images: [],
    photos: [],
    documents: [],
    agentName: 'Ben Micubo',
    agentPhone: '+63 917 888 1234',
    agentWhatsapp: '639178881234',
    agentMessenger: 'benmicubo.ph',
    ...overrides,
  };
}

test('GPS 1: Extracts coordinates from @lat,lng,zoom URLs (including negative and high precision)', () => {
  const res = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/@14.1228456,120.9856321,17z'
  );
  assert.equal(res.ok, true);
  assert.equal(res.status, 'parsed');
  assert.equal(res.source, 'viewport_at');
  assert.equal(res.isViewportOnly, true);
  assert.equal(res.latitude, 14.1228456);
  assert.equal(res.longitude, 120.9856321);

  const southern = parseGoogleMapsCoordinates(
    'www.google.com/maps/@-33.8688,151.2093,15z'
  );
  assert.equal(southern.ok, true);
  assert.equal(southern.latitude, -33.8688);
  assert.equal(southern.longitude, 151.2093);
});

test('GPS 2: Extracts destination coordinates from /place/.../@lat,lng and !3d...!4d... URLs', () => {
  const placeAtOnly = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/place/Sungay+West+Tagaytay/@14.1228,120.9856,16z'
  );
  assert.equal(placeAtOnly.ok, true);
  assert.equal(placeAtOnly.latitude, 14.1228);
  assert.equal(placeAtOnly.longitude, 120.9856);

  const placeWithPinData = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/place/Alfonso+Corner+Lot/@14.5995,120.9842,12z/data=!3m1!4b1!4m6!3m5!1s0x33bd77:0x99!8m2!3d14.136512!4d120.856234!16s%2Fg%2F123'
  );
  assert.equal(placeWithPinData.ok, true);
  assert.equal(placeWithPinData.source, 'place_data_pin');
  assert.equal(placeWithPinData.isViewportOnly, false);
  assert.equal(placeWithPinData.latitude, 14.136512);
  assert.equal(placeWithPinData.longitude, 120.856234);
});

test('GPS 3: Extracts coordinates from ?q=lat,lng, ?q=loc:lat,lng, and ?ll=lat,lng URLs', () => {
  const qRes = parseGoogleMapsCoordinates(
    'https://maps.google.com/?q=10.3652,123.8721'
  );
  assert.equal(qRes.ok, true);
  assert.equal(qRes.source, 'query_param');
  assert.equal(qRes.latitude, 10.3652);
  assert.equal(qRes.longitude, 123.8721);

  const locRes = parseGoogleMapsCoordinates(
    'https://www.google.com/maps?q=loc:9.8054,126.1618'
  );
  assert.equal(locRes.ok, true);
  assert.equal(locRes.latitude, 9.8054);
  assert.equal(locRes.longitude, 126.1618);

  const llRes = parseGoogleMapsCoordinates(
    'https://maps.google.com/maps?ll=10.5268,119.2544&z=15'
  );
  assert.equal(llRes.ok, true);
  assert.equal(llRes.latitude, 10.5268);
  assert.equal(llRes.longitude, 119.2544);
});

test('GPS 4: Extracts coordinates from /maps/search/?api=1&query=lat%2Clng URLs', () => {
  const searchRes = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/search/?api=1&query=14.1782%2C120.6124'
  );
  assert.equal(searchRes.ok, true);
  assert.equal(searchRes.source, 'query_param');
  assert.equal(searchRes.latitude, 14.1782);
  assert.equal(searchRes.longitude, 120.6124);
  assert.equal(
    searchRes.canonicalUrl,
    'https://www.google.com/maps/search/?api=1&query=14.1782,120.6124'
  );
});

test('GPS 5: Handles shortened Google Maps URLs with explicit manual-entry guidance and no fabricated coords', () => {
  const shortenedLinks = [
    'https://maps.app.goo.gl/AbCdEf123456',
    'https://goo.gl/maps/xyz789',
    'maps.app.goo.gl/ShortDemo',
    'https://g.co/maps/abc123',
  ];

  for (const url of shortenedLinks) {
    const res = parseGoogleMapsCoordinates(url);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'shortened');
    assert.equal(res.latitude, undefined);
    assert.equal(res.longitude, undefined);
    assert.equal(
      res.message,
      'This shortened Google Maps link cannot be resolved automatically. Please paste a full Google Maps URL or enter the coordinates manually.'
    );
  }
});

test('GPS 6: Rejects invalid links, non-Maps domains, and unsafe schemes without fabricating coordinates', () => {
  const invalidLinks = [
    'not-a-valid-url',
    'javascript:alert(1)',
    'https://evil.example.com/maps/@14.1228,120.9856,17z',
    'https://www.youtube.com/watch?v=LXb3EKWsInQ',
    'https://www.google.com/search?q=14.1228,120.9856',
  ];

  for (const url of invalidLinks) {
    const res = parseGoogleMapsCoordinates(url);
    assert.equal(res.ok, false, `Expected failure for ${url}`);
    assert.equal(res.status, 'invalid_url');
    assert.equal(res.latitude, undefined);
    assert.equal(res.longitude, undefined);
    assert.match(res.message, /Unable to identify GPS coordinates/);
  }
});

test('GPS 7: Handles empty and whitespace-only Google Maps input cleanly', () => {
  for (const blank of ['', '   \t\n  ']) {
    const res = parseGoogleMapsCoordinates(blank);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'empty');
    assert.equal(res.message, 'Please paste a Google Maps link first.');
  }
});

test('GPS 8: Handles Google Maps URLs missing any numeric coordinates', () => {
  const missingCoordUrls = [
    'https://www.google.com/maps',
    'https://www.google.com/maps/search/?api=1&query=Tagaytay+Ridge+Cavite',
    'https://www.google.com/maps/place/Alfonso+Cavite',
  ];

  for (const url of missingCoordUrls) {
    const res = parseGoogleMapsCoordinates(url);
    assert.equal(res.ok, false);
    assert.equal(res.status, 'missing_coordinates');
    assert.equal(res.latitude, undefined);
    assert.equal(res.longitude, undefined);
    assert.match(res.message, /Unable to identify GPS coordinates/);
  }
});

test('GPS 9: Rejects out-of-range latitude (< -90 or > 90) in both URL parser and manual validator', () => {
  const highLatUrl = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/@95.1234,120.9856,15z'
  );
  assert.equal(highLatUrl.ok, false);
  assert.equal(highLatUrl.status, 'invalid_range');
  assert.match(highLatUrl.message, /-90 and 90/);

  const lowLatUrl = parseGoogleMapsCoordinates(
    'https://maps.google.com/?q=-91.0,120.9856'
  );
  assert.equal(lowLatUrl.ok, false);
  assert.equal(lowLatUrl.status, 'invalid_range');

  assert.equal(validateCoordinates(90.0001, 120).valid, false);
  assert.equal(validateCoordinates(-90.0001, 120).valid, false);
  assert.equal(validateCoordinateStrings('95', '120.98').valid, false);
  assert.equal(validateCoordinates(90, 120).valid, true);
  assert.equal(validateCoordinates(-90, 120).valid, true);
});

test('GPS 10: Rejects out-of-range longitude (< -180 or > 180) in both URL parser and manual validator', () => {
  const highLngUrl = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/@14.1228,181.5,15z'
  );
  assert.equal(highLngUrl.ok, false);
  assert.equal(highLngUrl.status, 'invalid_range');
  assert.match(highLngUrl.message, /-180 and 180/);

  const lowLngUrl = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/search/?api=1&query=14.1228,-180.5'
  );
  assert.equal(lowLngUrl.ok, false);
  assert.equal(lowLngUrl.status, 'invalid_range');

  assert.equal(validateCoordinates(14.12, 180.001).valid, false);
  assert.equal(validateCoordinates(14.12, -180.001).valid, false);
  assert.equal(validateCoordinateStrings('14.12', 'abc').valid, false);
  assert.equal(validateCoordinates(0, 0).valid, true);
  assert.equal(validateCoordinates(14.12, 180).valid, true);
  assert.equal(validateCoordinates(14.12, -180).valid, true);
});

test('GPS 11: Prioritizes destination pin over viewport coordinates when multiple pairs exist and preserves lat,lng order', () => {
  // Exact !3d...!4d... pin overrides @viewport
  const pinOverViewport = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/place/Lot+7/@14.5995,120.9842,11z/data=!4m6!3m5!1s0x1:0x2!8m2!3d9.805412!4d126.161834'
  );
  assert.equal(pinOverViewport.ok, true);
  assert.equal(pinOverViewport.latitude, 9.805412);
  assert.equal(pinOverViewport.longitude, 126.161834);

  // Explicit /place/lat,lng overrides @viewport
  const pathOverViewport = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/place/10.3652,123.8721/@14.5995,120.9842,10z'
  );
  assert.equal(pathOverViewport.ok, true);
  assert.equal(pathOverViewport.latitude, 10.3652);
  assert.equal(pathOverViewport.longitude, 123.8721);

  // /dir/origin/destination/@viewport chooses destination over viewport
  const dirDest = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/dir/14.5995,120.9842/14.1228,120.9856/@14.35,120.99,11z'
  );
  assert.equal(dirDest.ok, true);
  assert.equal(dirDest.latitude, 14.1228);
  assert.equal(dirDest.longitude, 120.9856);
});

test('GPS 12: Synchronizes map marker URLs, embed preview URLs, and hemisphere display formatting', () => {
  const pinUrl = buildGoogleMapsPinUrl(14.122812, 120.985634);
  assert.equal(
    pinUrl,
    'https://www.google.com/maps/search/?api=1&query=14.122812,120.985634'
  );

  const googleEmbed = buildGoogleMapsEmbedUrl(14.122812, 120.985634);
  assert.equal(
    googleEmbed,
    'https://maps.google.com/maps?q=14.122812,120.985634&z=16&output=embed'
  );

  const osmEmbed = buildOpenStreetMapEmbedUrl(14.122812, 120.985634);
  assert.match(osmEmbed, /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=/);
  assert.match(osmEmbed, /marker=14\.122812,120\.985634$/);

  assert.equal(
    formatLatLngDisplay(-8.65, -115.2167, 4),
    '8.6500° S, 115.2167° W'
  );
  assert.equal(
    sanitizeGoogleMapsHref('javascript:alert(1)', 14.1228, 120.9856),
    'https://www.google.com/maps/search/?api=1&query=14.1228,120.9856'
  );
});

test('GPS 13 & 14: Persists synced coordinates (including 0,0) across create/update and preserves them after simulated reload', async () => {
  const mock = createGpsMockSupabase();
  const svc = createPropertyService(() => mock.client);

  // Rejects invalid/missing coordinates instead of fabricating Manila 14.5995, 120.9842
  await assert.rejects(
    () => svc.createProperty(makeBasePropertyInput({latitude: Number.NaN, longitude: Number.NaN})),
    /valid decimal numbers/i
  );
  await assert.rejects(
    () => svc.createProperty(makeBasePropertyInput({latitude: 95, longitude: 120.98})),
    /between -90 and 90/
  );

  // Valid coordinates parsed from pasted Google Maps URL persist & reload identically
  const parsed = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/place/Cove/@14.5995,120.9842,10z/data=!3m1!4b1!8m2!3d14.178245!4d120.612489'
  );
  assert.equal(parsed.ok, true);

  const created = await svc.createProperty(
    makeBasePropertyInput({
      latitude: parsed.latitude!,
      longitude: parsed.longitude!,
      googleMapsUrl: parsed.canonicalUrl!,
    })
  );
  assert.equal(created.latitude, 14.178245);
  assert.equal(created.longitude, 120.612489);

  // Simulated page reload from database
  const reloadedAll = await svc.listProperties(true);
  assert.equal(reloadedAll.length, 1);
  assert.equal(reloadedAll[0].latitude, 14.178245);
  assert.equal(reloadedAll[0].longitude, 120.612489);
  assert.equal(
    reloadedAll[0].googleMapsUrl,
    'https://www.google.com/maps/search/?api=1&query=14.178245,120.612489'
  );

  // Update coordinates (including valid 0 latitude/longitude) and confirm no falsy fallback overwrites 0
  const updated = await svc.updateProperty(created.id, {
    ...created,
    latitude: 0,
    longitude: 0,
    googleMapsUrl: '',
  });
  assert.equal(updated.latitude, 0);
  assert.equal(updated.longitude, 0);
  assert.equal(updated.googleMapsUrl, 'https://www.google.com/maps/search/?api=1&query=0,0');

  // normalizeProperty also preserves 0 without replacing with Manila coords
  const normZero = normalizeProperty({id: 'z1', lotId: 'LOT-Z', latitude: 0, longitude: 0});
  assert.equal(normZero.latitude, 0);
  assert.equal(normZero.longitude, 0);

  // LocalStorage fallback reload persistence
  propertyService.resetDemoData();
  const demoList = await propertyService.listProperties(true);
  const firstDemo = demoList[0];
  const savedLocal = await propertyService.updateProperty(firstDemo.id, {
    ...firstDemo,
    latitude: 11.967412,
    longitude: 121.924831,
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=11.967412,121.924831',
  });
  assert.equal(savedLocal.latitude, 11.967412);
  const reloadedLocal = (await propertyService.listProperties(true)).find(
    (p) => p.id === firstDemo.id
  );
  assert.equal(reloadedLocal?.latitude, 11.967412);
  assert.equal(reloadedLocal?.longitude, 121.924831);
});

test('GPS 15: All existing saved demo properties retain valid coordinates and safe Google Maps links', () => {
  for (const prop of DEMO_PROPERTIES) {
    const check = validateCoordinates(prop.latitude, prop.longitude);
    assert.equal(check.valid, true, `Invalid coordinates on ${prop.lotId}`);
    const safeHref = sanitizeGoogleMapsHref(prop.googleMapsUrl, prop.latitude, prop.longitude);
    assert.match(safeHref, /^https:\/\/www\.google\.com\/maps\//);
  }
});

test('GPS 16 & Concurrency: Failed publish coordinate validation surfaces clear errors, and serialized updates maintain integrity', async () => {
  const invalidPublishInput = makeBasePropertyInput({
    visibility: 'Published',
    latitude: 99,
    longitude: 120.98,
  });
  const errors = validatePropertyForPublish(invalidPublishInput);
  assert.ok(errors.some((e) => /-90 and 90/.test(e)));

  // Concurrent updateProperty calls on same id execute serialized via per-property lock
  const mock = createGpsMockSupabase();
  const svc = createPropertyService(() => mock.client);
  const created = await svc.createProperty(makeBasePropertyInput());

  const [u1, u2] = await Promise.all([
    svc.updateProperty(created.id, {...created, latitude: 14.1111, longitude: 120.8111}),
    svc.updateProperty(created.id, {...created, latitude: 14.2222, longitude: 120.9222}),
  ]);
  assert.equal(u1.latitude, 14.1111);
  assert.equal(u2.latitude, 14.2222);
  const finalProp = (await svc.listProperties(true))[0];
  assert.equal(finalProp.latitude, 14.2222);
  assert.equal(finalProp.longitude, 120.9222);

  // Optimistic concurrency conflict if another client mutates updated_at mid-flight
  const conflictBase = createGpsMockSupabase();
  let armed = false;
  const racingClient = {
    from(table: string) {
      const qb = (conflictBase.client as unknown as {from: (t: string) => Record<string, unknown>}).from(table);
      if (table === 'properties') {
        const origUpdate = (qb as {update: (p: unknown) => unknown}).update.bind(qb);
        (qb as {update: (p: unknown) => unknown}).update = (patch: unknown) => {
          if (armed && conflictBase.tables.properties[0]) {
            armed = false;
            conflictBase.tables.properties[0].updated_at = '2099-01-01T00:00:00.000Z';
          }
          return origUpdate(patch);
        };
      }
      return qb;
    },
    storage: (conflictBase.client as unknown as {storage: unknown}).storage,
  } as unknown as SupabaseClientLike;

  const racingSvc = createPropertyService(() => racingClient);
  const seeded = await racingSvc.createProperty(makeBasePropertyInput());
  armed = true;
  await assert.rejects(
    () => racingSvc.updateProperty(seeded.id, {...seeded, latitude: 14.5, longitude: 121.0}),
    /Concurrent update detected/
  );
});
