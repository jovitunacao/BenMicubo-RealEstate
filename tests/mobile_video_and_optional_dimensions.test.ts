import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectMobilePlaybackEnvironment,
  parsePropertyVideoUrl,
  resolveVideoRenderMode,
} from '../src/utils/video';
import {
  computePricePerSqm,
  formatFrontageLength,
  hasVisibleFrontageLength,
} from '../src/utils/format';
import {buildPropertyDossierModel} from '../src/utils/dossierLayout';
import {
  createPropertyService,
  normalizeProperty,
  type SupabaseClientLike,
} from '../src/services/propertyService';
import {DEMO_PROPERTIES} from '../src/data/demoProperties';
import type {Property, PropertyInput} from '../src/types/property';

const ROOT_DIR = process.cwd();

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
}

// LocalStorage shim for Node test runner
const memStore = new Map<string, string>();
if (!globalThis.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => memStore.get(k) ?? null,
      setItem: (k: string, v: string) => {
        memStore.set(k, String(v));
      },
      removeItem: (k: string) => {
        memStore.delete(k);
      },
      clear: () => memStore.clear(),
    },
    configurable: true,
  });
}

function makeSampleProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-frontage-1',
    lotId: 'LOT-888',
    title: 'Irregular Triangular Creekfront Parcel',
    barangay: 'Brgy. Luksuhin',
    city: 'Alfonso',
    province: 'Cavite',
    region: 'CALABARZON (Region IV-A)',
    completeLocation: 'Brgy. Luksuhin, Alfonso, Cavite',
    lotAreaSqm: 1250,
    frontageLengthM: 32.5,
    dimensions: '32m × 40m', // Legacy stored column — must NEVER render publicly
    boundaryDescription: 'Multi-segment polygon along barangay road and creek easement',
    pricePerSqm: 12000,
    priceTotalPhp: 15000000,
    showSellingPrice: true,
    showPricePerSqm: true,
    isPriceManualOverride: false,
    isNegotiable: false,
    classification: 'Residential',
    status: 'Available',
    visibility: 'Published',
    isFeatured: false,
    isArchived: false,
    roadAccess: '10m concrete road',
    utilities: 'Power & water line ready',
    terrain: 'Gentle slope',
    nearbyLandmarks: '5 mins to highway',
    titleStatus: 'Clean TCT',
    taxDeclarationStatus: 'Updated RPT',
    additionalRemarks: '',
    description: 'Verified triangular parcel with direct concrete road frontage.',
    highlights: ['Clean TCT', 'Creek easement setback'],
    photos: [
      'https://cdn.example.com/storage/v1/object/public/property-media-public/LOT-888/cover.webp',
    ],
    images: [
      {
        id: 'img-888-1',
        url: 'https://cdn.example.com/storage/v1/object/public/property-media-public/LOT-888/cover.webp',
        caption: 'Frontage view',
        isCover: true,
        sortOrder: 0,
        isApprovedPublic: true,
        storageBucket: 'property-media-public',
        storagePath: 'LOT-888/cover.webp',
      },
    ],
    youtubeUrl: 'https://drive.google.com/file/d/1DriveVideoId123456/view',
    videos: [
      {
        id: 'vid-888-1',
        sourceType: 'google_drive',
        url: 'https://drive.google.com/file/d/1DriveVideoId123456/view',
        title: 'Site Walkthrough Video',
        description: 'Mobile & desktop walkthrough',
        sortOrder: 0,
      },
    ],
    documents: [],
    presentations: [],
    latitude: 14.135,
    longitude: 120.855,
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=14.135,120.855',
    agentName: 'Ben Micubo Realty',
    agentPhone: '+63 917 555 8899',
    agentWhatsapp: '639175558899',
    agentMessenger: 'benmicuborealty',
    updatedAt: '2026-11-20T01:00:00.000Z',
    ...overrides,
  };
}

// ============================================================================
// VIDEO PLAYBACK — IN-PAGE GOOGLE DRIVE & YOUTUBE ON MOBILE & DESKTOP
// ============================================================================

test('Video Detection & In-Page Embed: Google Drive and YouTube both render inline on mobile and desktop', () => {
  assert.equal(
    detectMobilePlaybackEnvironment({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
      coarsePointer: true,
    }),
    true
  );

  assert.equal(
    detectMobilePlaybackEnvironment({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0,
      coarsePointer: false,
    }),
    false
  );

  const driveParsed = parsePropertyVideoUrl(
    'https://drive.google.com/file/d/1DriveVideoId123456/view?usp=sharing'
  );
  assert.ok(driveParsed);
  assert.equal(
    driveParsed.canonicalUrl,
    'https://drive.google.com/file/d/1DriveVideoId123456/view'
  );
  assert.equal(
    driveParsed.embedUrl,
    'https://drive.google.com/file/d/1DriveVideoId123456/preview'
  );

  // Task 4: both mobile and desktop stay in-page (never auto-redirect externally)
  assert.equal(resolveVideoRenderMode('google_drive', true), 'inline_embed');
  assert.equal(resolveVideoRenderMode('google_drive', false), 'inline_embed');
  assert.equal(resolveVideoRenderMode('youtube', true), 'inline_embed');
  assert.equal(resolveVideoRenderMode('youtube', false), 'inline_embed');

  const playerSrc = readFile('src/components/PropertyVideoPlayer.tsx');
  assert.ok(playerSrc.includes('<iframe'));
  assert.ok(playerSrc.includes('parsed.embedUrl'));
  assert.ok(playerSrc.includes('Tap to Play'));
  assert.ok(playerSrc.includes('aspect-video'));
  assert.equal(playerSrc.includes('mobile_external_card'), false);
  assert.equal(playerSrc.includes('window.open'), false);
});

// ============================================================================
// LAND SPECIFICATIONS — LOT DIMENSIONS REMOVED, OPTIONAL FRONTAGE LENGTH
// ============================================================================

test('Frontage Length renders when positive numeric value is present, omits cleanly when blank, and never displays legacy dimensions', () => {
  const withFrontage = makeSampleProperty({
    frontageLengthM: 32.5,
    dimensions: '32m × 40m',
    lotAreaSqm: 1250,
    priceTotalPhp: 15000000,
  });

  assert.equal(hasVisibleFrontageLength(withFrontage), true);
  assert.equal(formatFrontageLength(32.5), '32.5 m');

  const dossierWithFrontage = buildPropertyDossierModel(withFrontage, {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
  });
  assert.equal(dossierWithFrontage.accessible, true);
  if (dossierWithFrontage.accessible) {
    assert.equal(dossierWithFrontage.frontageLengthLabel, '32.5 m');
    assert.ok(
      dossierWithFrontage.executiveMetrics.some(
        (m) => m.label === 'Frontage Length' && m.value === '32.5 m'
      )
    );
    assert.ok(
      dossierWithFrontage.specificationLedger.some(
        (s) => s.label === 'Frontage Length' && s.value === '32.5 m'
      )
    );
    assert.equal(
      dossierWithFrontage.executiveMetrics.some((m) => m.label === 'Dimensions'),
      false
    );
    assert.equal(
      dossierWithFrontage.specificationLedger.some((s) => s.label === 'Lot Dimensions'),
      false
    );
    assert.equal(dossierWithFrontage.executiveMetrics.length, 4);
  }

  // Blank / null frontage omits row & rebalances grids cleanly without placeholders
  const withoutFrontage = makeSampleProperty({
    frontageLengthM: null,
    dimensions: '99m × 99m', // Even if populated in legacy DB row, must never appear
    lotAreaSqm: 1250,
    priceTotalPhp: 15000000,
  });

  assert.equal(hasVisibleFrontageLength(withoutFrontage), false);
  assert.equal(formatFrontageLength(null), '');

  const dossierWithoutFrontage = buildPropertyDossierModel(withoutFrontage, {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
  });
  assert.equal(dossierWithoutFrontage.accessible, true);
  if (dossierWithoutFrontage.accessible) {
    assert.equal(dossierWithoutFrontage.frontageLengthLabel, '');
    assert.equal(
      dossierWithoutFrontage.executiveMetrics.some((m) => m.label === 'Frontage Length'),
      false
    );
    assert.equal(
      dossierWithoutFrontage.specificationLedger.some((s) => s.label === 'Frontage Length'),
      false
    );
    assert.equal(dossierWithoutFrontage.executiveMetrics.length, 3);
    assert.equal(dossierWithoutFrontage.lotAreaLabel, '1,250 sqm');
    assert.equal(dossierWithoutFrontage.priceTotalLabel, '₱15,000,000');
    assert.equal(
      dossierWithoutFrontage.pricePerSqmLabel,
      `₱${computePricePerSqm(15000000, 1250).toLocaleString('en-PH')} / sqm`
    );

    const halfWidthCount = dossierWithoutFrontage.specificationLedger.filter(
      (s) => !s.fullWidth
    ).length;
    assert.equal(halfWidthCount % 2, 0, '2-column specification ledger has zero orphan cells');

    const allSpecText = dossierWithoutFrontage.specificationLedger
      .map((s) => `${s.label}:${s.value}`)
      .join('|');
    assert.equal(
      /99m|Dimensions|N\/A|Unknown|Survey pending/i.test(allSpecText),
      false
    );
  }
});

test('Frontage Length persists across save/reload, never computes lot area, and demo listings have valid structure', async () => {
  for (const demo of DEMO_PROPERTIES) {
    assert.equal(typeof demo.showSellingPrice, 'boolean');
    assert.equal(typeof demo.showPricePerSqm, 'boolean');
    assert.ok(Array.isArray(demo.presentations));
  }

  memStore.clear();
  const svc = createPropertyService(() => null);
  const {id: _id, updatedAt: _u, ...baseFields} = makeSampleProperty({
    lotId: 'LOT-FR-01',
    lotAreaSqm: 1850,
    frontageLengthM: 28.75,
  });
  const created = await svc.createProperty(baseFields as PropertyInput);
  assert.equal(created.frontageLengthM, 28.75);
  assert.equal(created.lotAreaSqm, 1850); // Frontage never modifies or computes area

  const reloaded = (await svc.listProperties(true)).find((p) => p.lotId === 'LOT-FR-01');
  assert.ok(reloaded);
  assert.equal(reloaded.frontageLengthM, 28.75);
  assert.equal(reloaded.lotAreaSqm, 1850);

  // Supabase row roundtrip via public_properties projection
  const capturedUpdates: Array<Record<string, unknown>> = [];
  const mockRow = {
    id: 'supa-prop-1',
    lot_id: 'LOT-SUPA-1',
    title: 'Irregular Ridge Lot',
    barangay: 'Brgy. West',
    city: 'Tagaytay City',
    province: 'Cavite',
    region: 'CALABARZON',
    complete_location: 'Tagaytay City, Cavite',
    lot_area_sqm: 900,
    frontage_length_m: 22.5,
    dimensions: '15m × 40m',
    boundary_description: '',
    price_per_sqm: 10000,
    price_total_php: 9000000,
    show_selling_price: true,
    show_price_per_sqm: true,
    is_price_manual_override: false,
    is_negotiable: false,
    classification: 'Residential',
    status: 'Available',
    visibility: 'Published',
    is_archived: false,
    is_featured: false,
    road_access: 'Paved road',
    utilities: 'Power & water',
    terrain: 'Flat',
    nearby_landmarks: '',
    title_status: 'Clean TCT',
    tax_declaration_status: 'Updated',
    additional_remarks: '',
    description: 'Verified triangular ridge parcel with paved frontage.',
    highlights: [],
    photos: [
      'https://cdn.example.com/storage/v1/object/public/property-media-public/LOT-SUPA-1/p1.webp',
    ],
    youtube_url: null,
    latitude: 14.12,
    longitude: 120.98,
    google_maps_url: 'https://www.google.com/maps/search/?api=1&query=14.12,120.98',
    agent_name: 'Ben Micubo Realty',
    agent_phone: '+63 917 555 8899',
    agent_whatsapp: '639175558899',
    agent_messenger: 'benmicubo',
    updated_at: '2026-11-20T02:00:00.000Z',
    property_images: [
      {
        id: 'img-s1',
        property_id: 'supa-prop-1',
        storage_bucket: 'property-media-public',
        storage_path: 'LOT-SUPA-1/p1.webp',
        public_url:
          'https://cdn.example.com/storage/v1/object/public/property-media-public/LOT-SUPA-1/p1.webp',
        caption: 'Cover',
        is_cover: true,
        is_approved_public: true,
        sort_order: 0,
      },
    ],
    property_videos: [],
    property_documents: [],
    property_presentations: [],
  };

  class MockQuery {
    private mode = 'select';
    private payload: Record<string, unknown> | null = null;
    constructor(private readonly table: string) {}
    select() {
      return this;
    }
    order() {
      return this;
    }
    eq() {
      return this;
    }
    in() {
      return this;
    }
    insert(rows: Record<string, unknown> | Array<Record<string, unknown>>) {
      this.mode = 'insert';
      this.payload = Array.isArray(rows) ? rows[0] : rows;
      return this;
    }
    update(patch: Record<string, unknown>) {
      this.mode = 'update';
      this.payload = patch;
      if (this.table === 'properties') capturedUpdates.push(patch);
      return this;
    }
    delete() {
      this.mode = 'delete';
      return this;
    }
    single() {
      return this.execute(true);
    }
    maybeSingle() {
      return this.execute(true);
    }
    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((v: {data: unknown; error: null}) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((r: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return this.execute(false).then(onfulfilled, onrejected);
    }
    private async execute(single: boolean) {
      if ((this.table === 'properties' || this.table === 'public_properties') && this.mode === 'select') {
        const row =
          this.table === 'public_properties' ? {...mockRow, dimensions: undefined} : mockRow;
        return {data: single ? row : [row], error: null};
      }
      if (this.table === 'property_images' && this.mode === 'select') {
        return {data: mockRow.property_images, error: null};
      }
      if (this.table === 'properties' && this.mode === 'update' && this.payload) {
        return {data: {...mockRow, ...this.payload}, error: null};
      }
      return {data: single ? {} : [], error: null};
    }
  }

  const fakeClient = {
    from: (t: string) => new MockQuery(t),
    storage: {
      from: () => ({
        createSignedUrl: async (p: string) => ({data: {signedUrl: p}, error: null}),
        getPublicUrl: (p: string) => ({data: {publicUrl: p}}),
        download: async () => ({data: new Blob(['ok']), error: null}),
        upload: async () => ({error: null}),
        remove: async () => ({error: null}),
      }),
    },
  } as unknown as SupabaseClientLike;

  const supaSvc = createPropertyService(() => fakeClient);
  const fetched = await supaSvc.listProperties(false);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].frontageLengthM, 22.5);
  assert.equal(fetched[0].dimensions, ''); // Redacted on public read

  const {id: _sid, updatedAt: sUpdated, ...supaFields} = fetched[0];
  await supaSvc.updateProperty(fetched[0].id, {
    ...(supaFields as PropertyInput),
    frontageLengthM: 25.4,
    expectedUpdatedAt: sUpdated,
  });
  assert.ok(
    capturedUpdates.some((u) => u.frontage_length_m === 25.4),
    'Supabase update writes frontage_length_m column explicitly'
  );
  // Normalize preserves valid frontage
  assert.equal(normalizeProperty({id: 'n1', lotId: 'LOT-N1', frontageLengthM: 18.2}).frontageLengthM, 18.2);
});

test('UI components, public views, and additive SQL migration enforce frontage & remove lot dimensions', () => {
  const editorSrc = readFile('src/components/AdminPropertyEditor.tsx');
  assert.ok(editorSrc.includes('Frontage Length (meters)'));
  assert.ok(
    editorSrc.includes(
      'Enter the verified frontage length in meters. Leave blank if unknown or not applicable.'
    )
  );
  assert.equal(editorSrc.includes('Show Lot Dimensions'), false);

  const detailSrc = readFile('src/pages/PropertyDetailPage.tsx');
  assert.ok(detailSrc.includes('frontageLabel'));
  assert.ok(detailSrc.includes('Frontage Length'));
  assert.equal(detailSrc.includes('Lot Dimensions'), false);

  const cardSrc = readFile('src/components/PropertyCard.tsx');
  assert.ok(cardSrc.includes('frontageLabel'));
  assert.equal(cardSrc.includes('property.dimensions'), false);

  const signageSrc = readFile('src/pages/SignagePrintPage.tsx');
  assert.ok(signageSrc.includes('Frontage'));
  assert.equal(signageSrc.includes('property.dimensions'), false);

  const migrationSql = readFile(
    'supabase/migrations/20261124_presentations_frontage_price_visibility.sql'
  );
  assert.match(migrationSql, /add column if not exists frontage_length_m numeric/i);
  const executableMigrationSql = migrationSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  // Existing dimensions column is preserved non-destructively (not dropped or truncated)
  assert.equal(/\b(drop table|drop column|truncate)\b/i.test(executableMigrationSql), false);
});
