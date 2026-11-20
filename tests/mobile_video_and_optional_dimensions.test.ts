import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectMobilePlaybackEnvironment,
  parsePropertyVideoUrl,
  resolveVideoRenderMode,
} from '../src/utils/video';
import {computePricePerSqm, shouldDisplayLotDimensions} from '../src/utils/format';
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
    id: 'prop-dim-1',
    lotId: 'LOT-888',
    title: 'Irregular Triangular Creekfront Parcel',
    barangay: 'Brgy. Luksuhin',
    city: 'Alfonso',
    province: 'Cavite',
    region: 'CALABARZON (Region IV-A)',
    completeLocation: 'Brgy. Luksuhin, Alfonso, Cavite',
    lotAreaSqm: 1250,
    dimensions: '32m frontage × 45m west × 58m rear',
    showLotDimensions: true,
    boundaryDescription: 'Multi-segment polygon along barangay road and creek easement',
    pricePerSqm: 12000,
    priceTotalPhp: 15000000,
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
    photos: ['https://cdn.example.com/storage/v1/object/public/property-media-public/LOT-888/cover.webp'],
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
// TASK 1 TESTS — MOBILE GOOGLE DRIVE VIDEO PLAYER FIX
// ============================================================================

test('Task 1: Reliable mobile detection identifies iPhone Safari, Android Chrome, and iPadOS without screen width alone', () => {
  // iPhone Safari (portrait or landscape)
  assert.equal(
    detectMobilePlaybackEnvironment({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
      coarsePointer: true,
    }),
    true
  );

  // Android Chrome (portrait or landscape)
  assert.equal(
    detectMobilePlaybackEnvironment({
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
      coarsePointer: true,
      userAgentDataMobile: true,
    }),
    true
  );

  // iPadOS Safari reporting desktop Macintosh UA + touch points
  assert.equal(
    detectMobilePlaybackEnvironment({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5,
      coarsePointer: true,
    }),
    true
  );

  // Desktop macOS / Windows Chrome & Safari -> desktop mode
  assert.equal(
    detectMobilePlaybackEnvironment({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      platform: 'MacIntel',
      maxTouchPoints: 0,
      coarsePointer: false,
      userAgentDataMobile: false,
    }),
    false
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
});

test('Task 1: Mobile Google Drive uses external preview card without mounting an iframe, while desktop Drive and all YouTube preserve embeds', () => {
  const driveParsed = parsePropertyVideoUrl(
    'https://drive.google.com/file/d/1DriveVideoId123456/view?usp=sharing'
  );
  assert.ok(driveParsed);
  assert.equal(
    driveParsed.canonicalUrl,
    'https://drive.google.com/file/d/1DriveVideoId123456/view'
  );

  const ytParsed = parsePropertyVideoUrl('https://www.youtube.com/watch?v=LXb3EKWsInQ');
  assert.ok(ytParsed);

  // Render strategies
  assert.equal(resolveVideoRenderMode('google_drive', true), 'mobile_external_card');
  assert.equal(resolveVideoRenderMode('google_drive', false), 'inline_embed');
  assert.equal(resolveVideoRenderMode('youtube', true), 'inline_embed');
  assert.equal(resolveVideoRenderMode('youtube', false), 'inline_embed');

  // Verify PropertyVideoPlayer mounts mobile_external_card strictly BEFORE any <iframe> branch
  const playerSrc = readFile('src/components/PropertyVideoPlayer.tsx');
  const mobileBranchIdx = playerSrc.indexOf("if (renderMode === 'mobile_external_card')");
  const iframeIdx = playerSrc.indexOf('<iframe');
  assert.ok(mobileBranchIdx > -1, 'Mobile external card branch exists');
  assert.ok(iframeIdx > mobileBranchIdx, 'Mobile branch returns BEFORE any <iframe> can mount');

  const mobileBranchCode = playerSrc.slice(mobileBranchIdx, iframeIdx);
  assert.equal(mobileBranchCode.includes('<iframe'), false);
  assert.ok(mobileBranchCode.includes('Watch Property Video'));
  assert.ok(mobileBranchCode.includes('posterSrc'));
  assert.ok(mobileBranchCode.includes('parsed.canonicalUrl'));
  assert.ok(mobileBranchCode.includes('target="_blank"'));
  assert.ok(mobileBranchCode.includes('rel="noopener noreferrer"'));
  assert.ok(mobileBranchCode.includes('aspect-video'));
  assert.equal(playerSrc.includes('window.open'), false);

  // Verify PropertyDetailPage passes cover photo as posterFallback
  const detailSrc = readFile('src/pages/PropertyDetailPage.tsx');
  assert.ok(detailSrc.includes('posterFallback={galleryImages[0]?.url || currentPhoto}'));
});

// ============================================================================
// TASK 2 TESTS — OPTIONAL LOT DIMENSIONS DISPLAY & REFLOW
// ============================================================================

test('Task 2: Lot dimensions display when enabled, omit completely when disabled, and keep area & price/sqm intact', () => {
  const enabledProp = makeSampleProperty({
    showLotDimensions: true,
    dimensions: '32m frontage × 45m west × 58m rear',
    lotAreaSqm: 1250,
    priceTotalPhp: 15000000,
  });

  assert.equal(shouldDisplayLotDimensions(enabledProp), true);
  const enabledDossier = buildPropertyDossierModel(enabledProp, {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
  });
  assert.equal(enabledDossier.accessible, true);
  if (enabledDossier.accessible) {
    assert.equal(enabledDossier.dimensionsLabel, '32m frontage × 45m west × 58m rear');
    assert.ok(enabledDossier.executiveMetrics.some((m) => m.label === 'Dimensions'));
    assert.ok(enabledDossier.specificationLedger.some((s) => s.label === 'Lot Dimensions'));
    assert.equal(enabledDossier.executiveMetrics.length, 4);
  }

  // Now disable Show Lot Dimensions while keeping the saved dimensions string preserved
  const disabledProp = makeSampleProperty({
    showLotDimensions: false,
    dimensions: '32m frontage × 45m west × 58m rear',
    lotAreaSqm: 1250,
    priceTotalPhp: 15000000,
  });
  assert.equal(shouldDisplayLotDimensions(disabledProp), false);
  // Underlying dimensions string is NOT deleted
  assert.equal(disabledProp.dimensions, '32m frontage × 45m west × 58m rear');

  const disabledDossier = buildPropertyDossierModel(disabledProp, {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
  });
  assert.equal(disabledDossier.accessible, true);
  if (disabledDossier.accessible) {
    assert.equal(disabledDossier.dimensionsLabel, '');
    assert.equal(
      disabledDossier.executiveMetrics.some((m) => m.label === 'Dimensions'),
      false
    );
    assert.equal(
      disabledDossier.specificationLedger.some((s) => s.label === 'Lot Dimensions'),
      false
    );
    // Reflow: 3 executive metrics, no blank placeholder text anywhere
    assert.equal(disabledDossier.executiveMetrics.length, 3);
    assert.equal(disabledDossier.lotAreaLabel, '1,250 sqm');
    assert.equal(disabledDossier.priceTotalLabel, '₱15,000,000');
    assert.equal(
      disabledDossier.pricePerSqmLabel,
      `₱${computePricePerSqm(15000000, 1250).toLocaleString('en-PH')} / sqm`
    );

    // Page 3 spec ledger reflow: half-width cells must be even so zero orphan blank box renders
    const halfWidthCount = disabledDossier.specificationLedger.filter((s) => !s.fullWidth).length;
    assert.equal(halfWidthCount % 2, 0, '2-column dossier specification grid has zero blank slot');
    const lotAreaSpec = disabledDossier.specificationLedger.find((s) => s.label === 'Lot Area');
    assert.ok(lotAreaSpec);
    assert.equal(lotAreaSpec.value, '1,250 sqm');
    assert.equal(lotAreaSpec.fullWidth, true);

    // No "N/A", "Hidden", "Not available", or "Survey pending" placeholders
    const allSpecText = disabledDossier.specificationLedger
      .map((s) => `${s.label}:${s.value}`)
      .join('|');
    assert.equal(/N\/A|Hidden|Not available|Survey pending|Upon survey review/i.test(allSpecText), false);
  }
});

test('Task 2: Existing properties retain display behavior by default and toggle persists across save/refresh without data loss', async () => {
  // Existing demo properties default to showing dimensions
  for (const demo of DEMO_PROPERTIES) {
    assert.equal(demo.showLotDimensions, true);
    assert.equal(shouldDisplayLotDimensions(demo), true);
  }

  // Records omitting showLotDimensions default cleanly to true
  const legacyNormalized = normalizeProperty(makeSampleProperty({showLotDimensions: undefined}));
  assert.equal(legacyNormalized.showLotDimensions, true);

  // Persist toggle false -> save -> reload -> toggle true -> verify saved dimensions preserved!
  memStore.clear();
  const svc = createPropertyService(() => null);
  const {id: _id, updatedAt: _u, ...baseFields} = makeSampleProperty({
    lotId: 'LOT-IRR-01',
    dimensions: 'Irregular trapezoidal 18m × 42m × 29m',
    showLotDimensions: false,
  });
  const created = await svc.createProperty(baseFields as PropertyInput);
  assert.equal(created.showLotDimensions, false);
  assert.equal(created.dimensions, 'Irregular trapezoidal 18m × 42m × 29m');

  const reloadedAfterCreate = (await svc.listProperties(true)).find(
    (p) => p.lotId === 'LOT-IRR-01'
  );
  assert.ok(reloadedAfterCreate);
  assert.equal(reloadedAfterCreate.showLotDimensions, false);
  assert.equal(reloadedAfterCreate.dimensions, 'Irregular trapezoidal 18m × 42m × 29m');
  assert.equal(shouldDisplayLotDimensions(reloadedAfterCreate), false);

  // Re-enable without retyping dimensions -> original saved value returns intact
  const {id: _id2, updatedAt: currUpdated, ...reEnableFields} = reloadedAfterCreate;
  const updated = await svc.updateProperty(reloadedAfterCreate.id, {
    ...(reEnableFields as PropertyInput),
    showLotDimensions: true,
    expectedUpdatedAt: currUpdated,
  });
  assert.equal(updated.showLotDimensions, true);
  assert.equal(updated.dimensions, 'Irregular trapezoidal 18m × 42m × 29m');
  assert.equal(shouldDisplayLotDimensions(updated), true);

  // Also test Supabase row roundtrip mapping
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
    dimensions: '15m × 40m × 30m',
    show_lot_dimensions: false,
    boundary_description: '',
    price_per_sqm: 10000,
    price_total_php: 9000000,
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
    photos: ['https://cdn.example.com/storage/v1/object/public/property-media-public/LOT-SUPA-1/p1.webp'],
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
      if (this.table === 'properties' && this.mode === 'select') {
        return {data: single ? mockRow : [mockRow], error: null};
      }
      if (this.table === 'properties' && this.mode === 'update' && this.payload) {
        const merged = {...mockRow, ...this.payload};
        return {data: merged, error: null};
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
  assert.equal(fetched[0].showLotDimensions, false);
  assert.equal(fetched[0].dimensions, '15m × 40m × 30m');

  const {id: _sid, updatedAt: sUpdated, ...supaFields} = fetched[0];
  await supaSvc.updateProperty(fetched[0].id, {
    ...(supaFields as PropertyInput),
    showLotDimensions: false,
    expectedUpdatedAt: sUpdated,
  });
  assert.ok(
    capturedUpdates.some((u) => u.show_lot_dimensions === false),
    'Supabase update writes show_lot_dimensions column explicitly'
  );
});

test('Task 2: Admin UI, public templates, and non-destructive SQL migration meet all requirements', () => {
  const editorSrc = readFile('src/components/AdminPropertyEditor.tsx');
  assert.ok(editorSrc.includes('Show Lot Dimensions on Public Listing'));
  assert.ok(
    editorSrc.includes(
      'Disable for irregularly shaped lots or properties where simple length × width measurements are not applicable.'
    )
  );
  // Must not pre-populate fake '20m × 25m' or 'Standard parcel' when creating new properties
  assert.equal(editorSrc.includes('Standard parcel'), false);
  assert.equal(editorSrc.includes("'20m × 25m'"), false);

  const detailSrc = readFile('src/pages/PropertyDetailPage.tsx');
  assert.ok(detailSrc.includes('shouldDisplayLotDimensions(property)'));
  assert.ok(detailSrc.includes('coreSpecs.length % 2 === 1'));

  const dossierComponentSrc = readFile('src/components/PropertyDossierA4.tsx');
  assert.ok(dossierComponentSrc.includes('dossier.executiveMetrics.length === 3'));

  const cardSrc = readFile('src/components/PropertyCard.tsx');
  assert.ok(cardSrc.includes('shouldDisplayLotDimensions(property)'));

  const signageSrc = readFile('src/pages/SignagePrintPage.tsx');
  assert.ok(signageSrc.includes('shouldDisplayLotDimensions(property)'));

  const migrationSql = readFile('supabase/migrations/20261120_optional_lot_dimensions.sql');
  assert.match(
    migrationSql,
    /alter table public\.properties\s+add column if not exists show_lot_dimensions boolean not null default true;/i
  );
  assert.equal(/\b(drop|delete|truncate)\b/i.test(migrationSql), false);
});
