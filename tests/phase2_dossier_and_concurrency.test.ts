import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createPropertyService, type SupabaseClientLike} from '../src/services/propertyService';
import {PRIVATE_MEDIA_BUCKET, PUBLIC_MEDIA_BUCKET} from '../src/services/storageService';
import {
  buildPropertyDossierModel,
  DOSSIER_PAGE_TITLES,
  DOSSIER_PALETTE,
  formatEditorialParagraphs,
} from '../src/utils/dossierLayout';
import type {
  Property,
  PropertyDocumentItem,
  PropertyImageItem,
  PropertyInput,
} from '../src/types/property';

function createConcurrentRaceMockSupabase(hooks?: {
  onBeforeImagesInsert?: (tables: Record<string, Array<Record<string, unknown>>>) => void;
  failImagesInsertOnce?: string;
  onBeforeFinalPhotosUpdate?: (tables: Record<string, Array<Record<string, unknown>>>) => void;
}) {
  const buckets = {
    [PUBLIC_MEDIA_BUCKET]: new Map<string, {bytes: string; contentType: string}>(),
    [PRIVATE_MEDIA_BUCKET]: new Map<string, {bytes: string; contentType: string}>(),
  };

  const tables: Record<string, Array<Record<string, unknown>>> = {
    properties: [],
    property_images: [],
    property_videos: [],
    property_documents: [],
    admin_users: [],
    inquiries: [],
    site_settings: [],
  };

  let failImagesMsg = hooks?.failImagesInsertOnce;
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

    private async execute(): Promise<{data: unknown; error: {message: string} | null}> {
      if (this.mode === 'insert') {
        if (this.table === 'property_images') {
          hooks?.onBeforeImagesInsert?.(tables);
          if (failImagesMsg) {
            const msg = failImagesMsg;
            failImagesMsg = undefined;
            return {data: null, error: {message: msg}};
          }
        }
        const rows = this.payload as Array<Record<string, unknown>>;
        const inserted: Array<Record<string, unknown>> = [];
        for (const raw of rows) {
          const row = {
            ...raw,
            id: raw.id || `${this.table}-${seq++}`,
            created_at: raw.created_at || new Date().toISOString(),
            updated_at: raw.updated_at || new Date().toISOString(),
          };
          tables[this.table].push(row);
          inserted.push({...row});
        }
        return {data: this.wantSingle ? inserted[0] : inserted, error: null};
      }

      if (this.mode === 'update') {
        const patch = this.payload as Record<string, unknown>;
        if (
          this.table === 'properties' &&
          Object.prototype.hasOwnProperty.call(patch, 'photos') &&
          !Object.prototype.hasOwnProperty.call(patch, 'title')
        ) {
          hooks?.onBeforeFinalPhotosUpdate?.(tables);
        }
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
            property_images: tables.property_images.filter((i) => i.property_id === row.id),
            property_videos: tables.property_videos.filter((v) => v.property_id === row.id),
            property_documents: tables.property_documents.filter((d) => d.property_id === row.id),
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
      from(bucket: keyof typeof buckets) {
        const store = buckets[bucket];
        return {
          async upload(path: string, blob: Blob) {
            store.set(path, {
              bytes: await blob.text().catch(() => 'binary'),
              contentType: blob.type || 'application/octet-stream',
            });
            return {data: {path}, error: null};
          },
          async download(path: string) {
            const entry = store.get(path);
            if (!entry) return {data: null, error: {message: 'Object not found'}};
            return {data: new Blob([entry.bytes], {type: entry.contentType}), error: null};
          },
          async createSignedUrl(path: string) {
            if (!store.has(path)) return {data: null, error: {message: 'Object not found'}};
            return {
              data: {signedUrl: `https://example.supabase.co/storage/v1/object/sign/${bucket}/${path}`},
              error: null,
            };
          },
          getPublicUrl(path: string) {
            return {
              data: {publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}`},
            };
          },
          async remove(paths: string[]) {
            for (const p of paths) store.delete(p);
            return {data: paths, error: null};
          },
        };
      },
    },
  };

  return {client: client as unknown as SupabaseClientLike, tables, buckets};
}

function makeBaseProperty(overrides: Partial<Property> = {}): Property {
  const images: PropertyImageItem[] = [
    {
      id: 'img-cover',
      url: 'https://example.supabase.co/storage/v1/object/public/property-media-public/LOT-200/cover.webp',
      caption: 'Tagaytay Ridge Panorama Cover',
      isCover: true,
      sortOrder: 0,
      isApprovedPublic: true,
      storageBucket: PUBLIC_MEDIA_BUCKET,
      storagePath: 'LOT-200/cover.webp',
    },
    {
      id: 'img-2',
      url: 'https://example.supabase.co/storage/v1/object/public/property-media-public/LOT-200/frontage.webp',
      caption: '10m Concrete Barangay Road Frontage',
      isCover: false,
      sortOrder: 1,
      isApprovedPublic: true,
      storageBucket: PUBLIC_MEDIA_BUCKET,
      storagePath: 'LOT-200/frontage.webp',
    },
    {
      id: 'img-unapproved',
      url: 'https://example.supabase.co/storage/v1/object/sign/property-media-private/LOT-200/draft.webp',
      caption: 'Internal Private Boundary Photo',
      isCover: false,
      sortOrder: 2,
      isApprovedPublic: false,
      storageBucket: PRIVATE_MEDIA_BUCKET,
      storagePath: 'LOT-200/draft.webp',
    },
  ];

  const documents: PropertyDocumentItem[] = [
    {
      id: 'doc-pub',
      title: 'Approved Lot Vicinity Map',
      category: 'Vicinity Map',
      visibility: 'Public',
      storageBucket: PUBLIC_MEDIA_BUCKET,
      storagePath: 'LOT-200/docs/vicinity.pdf',
      fileName: 'vicinity.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 245760,
      publicUrl: 'https://example.supabase.co/storage/v1/object/public/property-media-public/LOT-200/docs/vicinity.pdf',
      uploadedAt: '2026-11-20T00:00:00.000Z',
    },
    {
      id: 'doc-priv',
      title: 'Confidential Transfer Certificate of Title',
      category: 'Title Document',
      visibility: 'Private',
      storageBucket: PRIVATE_MEDIA_BUCKET,
      storagePath: 'LOT-200/docs/tct-private.pdf',
      fileName: 'tct-private.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 512000,
      uploadedAt: '2026-11-20T00:00:00.000Z',
    },
  ];

  return {
    id: 'prop-200',
    lotId: 'LOT-200',
    title: 'Alfonso Heritage Ridge Estate Parcel',
    barangay: 'Luksuhin',
    city: 'Alfonso',
    province: 'Cavite',
    region: 'CALABARZON (Region IV-A)',
    completeLocation: 'Brgy. Luksuhin, Alfonso, Cavite',
    lotAreaSqm: 1200,
    dimensions: '30m × 40m',
    boundaryDescription: 'North: 10m Concrete Road; South: Bamboo Ridge; East: Lot 14; West: Lot 12',
    pricePerSqm: 12500,
    priceTotalPhp: 15000000,
    isPriceManualOverride: false,
    isNegotiable: true,
    classification: 'Residential',
    status: 'Available',
    visibility: 'Published',
    isArchived: false,
    isFeatured: true,
    roadAccess: '10m concrete barangay road',
    utilities: '3-phase power and municipal water main',
    terrain: 'Gently sloping ridge',
    nearbyLandmarks: 'Twin Lakes, Splendido Taal, Tagaytay Nasugbu Highway',
    titleStatus: 'Clean individual TCT',
    taxDeclarationStatus: '2026 Real Property Tax Paid',
    additionalRemarks: 'Standard capital gains tax borne by seller; documentary stamps by buyer.',
    description:
      'Elevated cool-climate ridge parcel offering unobstructed views over Cavite farmland.\n\nIdeal for a private family compound or boutique bed-and-breakfast retreat with immediate frontage along an all-weather barangay road.',
    highlights: ['Clean individual TCT', '30m paved road frontage', 'Cool ridge elevation'],
    photos: images.filter((i) => i.isApprovedPublic).map((i) => i.url),
    images,
    youtubeUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    videos: [
      {
        id: 'vid-1',
        sourceType: 'youtube',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Aerial Drone Panorama',
        description: '4K aerial survey of road frontage and Taal ridge orientation.',
        sortOrder: 0,
      },
    ],
    documents,
    latitude: 14.132541,
    longitude: 120.854912,
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=14.132541,120.854912',
    agentName: 'Ben Micubo',
    agentPhone: '+63 917 555 8291',
    agentWhatsapp: '639175558291',
    agentMessenger: 'benmicubo.official',
    publishedAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-20T08:00:00.000Z',
    ...overrides,
  };
}

function makeBaseInput(overrides: Partial<PropertyInput> = {}): PropertyInput {
  const {id: _id, updatedAt: _u, ...rest} = makeBaseProperty();
  return {
    ...rest,
    visibility: 'Draft',
    isArchived: false,
    images: [
      {
        id: 'img-1',
        url: 'https://example.supabase.co/storage/v1/object/sign/property-media-private/LOT-200/initial.webp',
        caption: 'Initial Staged Cover',
        isCover: true,
        sortOrder: 0,
        isApprovedPublic: false,
        storageBucket: PRIVATE_MEDIA_BUCKET,
        storagePath: 'LOT-200/initial.webp',
      },
    ],
    documents: [],
    ...overrides,
  };
}

test('Concurrency: failed rollback in updateProperty NEVER overwrites another administrator committed changes', async () => {
  let injectAdminBCommit = false;
  const mock = createConcurrentRaceMockSupabase({
    onBeforeImagesInsert: (tables) => {
      if (!injectAdminBCommit) return;
      injectAdminBCommit = false;
      // Simulate Admin B reading T_A and committing a newer update (T_B) BEFORE Admin A finishes Step 5
      tables.properties[0].title = 'Admin B Committed Title';
      tables.properties[0].updated_at = '2099-01-01T00:00:05.000Z';
      tables.property_images = [
        {
          id: 'img-admin-b',
          property_id: tables.properties[0].id,
          storage_bucket: PRIVATE_MEDIA_BUCKET,
          storage_path: 'LOT-200/admin-b.webp',
          public_url: 'https://example.supabase.co/storage/v1/object/sign/property-media-private/LOT-200/admin-b.webp',
          caption: 'Admin B Photo',
          is_cover: true,
          is_approved_public: false,
          sort_order: 0,
        },
      ];
    },
  });

  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-200/initial.webp', {
    bytes: 'img',
    contentType: 'image/webp',
  });
  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-200/admin-a.webp', {
    bytes: 'imgA',
    contentType: 'image/webp',
  });

  const service = createPropertyService(() => mock.client);
  const created = await service.createProperty(makeBaseInput());

  // Arm race condition: fail Admin A's Step 5 image insert AFTER Admin B commits concurrently
  injectAdminBCommit = true;
  const mockWithFailure = createConcurrentRaceMockSupabase({
    failImagesInsertOnce: 'Simulated Step 5 DB failure after Admin B committed',
    onBeforeImagesInsert: (tables) => {
      if (!injectAdminBCommit) return;
      injectAdminBCommit = false;
      tables.properties[0].title = 'Admin B Committed Title';
      tables.properties[0].updated_at = '2099-01-01T00:00:05.000Z';
      tables.property_images = [
        {
          id: 'img-admin-b',
          property_id: tables.properties[0].id,
          storage_bucket: PRIVATE_MEDIA_BUCKET,
          storage_path: 'LOT-200/admin-b.webp',
          public_url: 'https://example.supabase.co/storage/v1/object/sign/property-media-private/LOT-200/admin-b.webp',
          caption: 'Admin B Photo',
          is_cover: true,
          is_approved_public: false,
          sort_order: 0,
        },
      ];
    },
  });
  // Copy created row and relations into the race mock
  mockWithFailure.tables.properties = [...mock.tables.properties.map((r) => ({...r}))];
  mockWithFailure.tables.property_images = [...mock.tables.property_images.map((r) => ({...r}))];
  mockWithFailure.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-200/initial.webp', {
    bytes: 'img',
    contentType: 'image/webp',
  });
  mockWithFailure.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-200/admin-a.webp', {
    bytes: 'imgA',
    contentType: 'image/webp',
  });

  const raceService = createPropertyService(() => mockWithFailure.client);
  await assert.rejects(
    () =>
      raceService.updateProperty(
        created.id,
        makeBaseInput({
          title: 'Admin A Attempted Title',
          images: [
            {
              id: 'img-a',
              url: 'https://example.supabase.co/storage/v1/object/sign/property-media-private/LOT-200/admin-a.webp',
              caption: 'Admin A Photo',
              isCover: true,
              sortOrder: 0,
              isApprovedPublic: false,
              storageBucket: PRIVATE_MEDIA_BUCKET,
              storagePath: 'LOT-200/admin-a.webp',
            },
          ],
        })
      ),
    /Concurrent changes from another administrator were detected and preserved/i
  );

  // Admin B's committed property row AND relations must be completely preserved!
  assert.equal(mockWithFailure.tables.properties[0].title, 'Admin B Committed Title');
  assert.equal(mockWithFailure.tables.properties[0].updated_at, '2099-01-01T00:00:05.000Z');
  assert.equal(mockWithFailure.tables.property_images.length, 1);
  assert.equal(mockWithFailure.tables.property_images[0].caption, 'Admin B Photo');
});

test('Concurrency: stale expectedUpdatedAt from second open editor rejects before any DB/Storage mutation', async () => {
  const mock = createConcurrentRaceMockSupabase();
  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-200/initial.webp', {
    bytes: 'img',
    contentType: 'image/webp',
  });

  const service = createPropertyService(() => mock.client);
  const created = await service.createProperty(makeBaseInput());

  // Tab B saves newer changes
  const savedByB = await service.updateProperty(
    created.id,
    makeBaseInput({
      title: 'Saved by Tab B',
      expectedUpdatedAt: created.updatedAt,
    })
  );
  assert.equal(savedByB.title, 'Saved by Tab B');

  // Stale Tab A attempts to save using old created.updatedAt
  await assert.rejects(
    () =>
      service.updateProperty(
        created.id,
        makeBaseInput({
          title: 'Stale Tab A Overwrite',
          expectedUpdatedAt: created.updatedAt,
        })
      ),
    /Concurrent update detected/i
  );

  assert.equal(mock.tables.properties[0].title, 'Saved by Tab B');
});

test('Concurrency: setVisibility Publish rollback preserves newer concurrent administrator commit', async () => {
  let injectConcurrentUpdate = false;
  const mock = createConcurrentRaceMockSupabase({
    onBeforeFinalPhotosUpdate: (tables) => {
      if (!injectConcurrentUpdate) return;
      injectConcurrentUpdate = false;
      // Admin B updates the property right before Admin A's Step 5b final photos update
      tables.properties[0].title = 'Concurrent Admin Winner';
      tables.properties[0].visibility = 'Draft';
      tables.properties[0].updated_at = '2099-02-01T00:00:00.000Z';
      tables.property_images[0].storage_bucket = PRIVATE_MEDIA_BUCKET;
      tables.property_images[0].is_approved_public = false;
    },
  });
  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-200/initial.webp', {
    bytes: 'img',
    contentType: 'image/webp',
  });

  const service = createPropertyService(() => mock.client);
  const created = await service.createProperty(
    makeBaseInput({
      images: [
        {
          id: 'img-approved',
          url: 'https://example.supabase.co/storage/v1/object/sign/property-media-private/LOT-200/initial.webp',
          caption: 'Ready Cover',
          isCover: true,
          sortOrder: 0,
          isApprovedPublic: true,
          storageBucket: PRIVATE_MEDIA_BUCKET,
          storagePath: 'LOT-200/initial.webp',
        },
      ],
    })
  );
  // Mark image approved in DB so setVisibility('Published') proceeds through promotion
  mock.tables.property_images[0].is_approved_public = true;

  injectConcurrentUpdate = true;
  await assert.rejects(
    () => service.setVisibility(created.id, 'Published'),
    /Concurrent changes from another administrator were detected and preserved/i
  );

  // Admin B's concurrent row & image state must NOT be rolled back to stale snapshot
  assert.equal(mock.tables.properties[0].title, 'Concurrent Admin Winner');
  assert.equal(mock.tables.properties[0].visibility, 'Draft');
  assert.equal(mock.tables.property_images[0].storage_bucket, PRIVATE_MEDIA_BUCKET);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-200/initial.webp'), false);
});

test('Phase 2 Dossier Security: Draft/Archived blocked for public, unapproved photos and Private docs strictly omitted', () => {
  const draftProp = makeBaseProperty({visibility: 'Draft', isArchived: false});
  const blocked = buildPropertyDossierModel(draftProp, {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
  });
  assert.equal(blocked.accessible, false);

  const adminPreview = buildPropertyDossierModel(draftProp, {
    isPreviewAllowed: true,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
  });
  assert.equal(adminPreview.accessible, true);
  if (adminPreview.accessible) {
    assert.equal(adminPreview.isPreviewMode, true);
    // Private documents MUST NEVER appear in buyer printable dossier documents list
    assert.equal(adminPreview.publicDocuments.length, 1);
    assert.equal(adminPreview.publicDocuments[0].title, 'Approved Lot Vicinity Map');
  }

  const publishedProp = makeBaseProperty({visibility: 'Published', isArchived: false});
  const publicDossier = buildPropertyDossierModel(publishedProp, {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
  });
  assert.equal(publicDossier.accessible, true);
  if (publicDossier.accessible) {
    assert.equal(publicDossier.portfolio.totalApprovedPhotos, 2);
    assert.ok(
      publicDossier.portfolio.secondaryPhotos.every(
        (img) => !img.url.includes('draft.webp')
      )
    );
    assert.equal(publicDossier.publicDocuments.length, 1);
    assert.ok(
      publicDossier.publicDocuments.every((d) => d.rawDocument.visibility === 'Public')
    );
  }
});

test('Phase 2 Dossier Edge Case: handles long 3,200+ char single-block and multi-paragraph descriptions cleanly', () => {
  const sentence =
    'Situated along an elevated ridge overlooking rolling farmland and cool pine corridors, this titled parcel supports a bespoke residence with reliable road frontage and utility connections. ';
  const massiveSingleBlock = sentence.repeat(18); // ~3,330 chars
  assert.ok(massiveSingleBlock.length > 3000);

  const paragraphs = formatEditorialParagraphs(massiveSingleBlock);
  assert.ok(paragraphs.length >= 4, 'Giant single-block essay splits cleanly into readable paragraphs');
  const rejoinedWords = paragraphs.join(' ').split(/\s+/).length;
  const originalWords = massiveSingleBlock.trim().split(/\s+/).length;
  assert.equal(rejoinedWords, originalWords, 'Long description splitting preserves 100% of words');

  const dossier = buildPropertyDossierModel(
    makeBaseProperty({description: massiveSingleBlock}),
    {
      isPreviewAllowed: false,
      effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
    }
  );
  assert.equal(dossier.accessible, true);
  if (dossier.accessible) {
    assert.equal(dossier.useCompactTwoColumnNarrative, true);
    assert.ok(dossier.descriptionParagraphs.length >= 4);
  }
});

test('Phase 2 Dossier Edge Case: handles missing optional fields cleanly without fabricating data', () => {
  const sparse = makeBaseProperty({
    barangay: '',
    region: '',
    dimensions: '',
    boundaryDescription: '',
    utilities: '',
    nearbyLandmarks: '',
    taxDeclarationStatus: '',
    additionalRemarks: '',
    highlights: [],
    videos: [],
    youtubeUrl: '',
    documents: [],
    agentPhone: '',
    agentWhatsapp: '',
    agentMessenger: '',
  });

  const dossier = buildPropertyDossierModel(sparse, {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
  });
  assert.equal(dossier.accessible, true);
  if (dossier.accessible) {
    assert.equal(dossier.advisor.hasDirectContact, false);
    assert.equal(dossier.advisor.phone, '');
    assert.equal(dossier.advisor.whatsappUrl, '');
    assert.equal(dossier.videos.length, 0);
    assert.equal(dossier.publicDocuments.length, 0);
    assert.equal(dossier.highlights.length, 0);
    assert.equal(dossier.additionalRemarks, '');
    // Boundary & Nearby landmarks should be omitted when blank rather than rendered as empty boxes
    assert.ok(!dossier.specificationLedger.some((s) => s.label === 'Perimeter & Boundary Notes'));
    assert.ok(!dossier.specificationLedger.some((s) => s.label === 'Vicinity & Key Landmarks'));
  }
});

test('Phase 2 Dossier Photo Portfolio adapts across 0, 1, 2, 3, and 6+ approved photos', () => {
  const makeImages = (count: number): PropertyImageItem[] =>
    Array.from({length: count}, (_, i) => ({
      id: `img-${i}`,
      url: `https://example.supabase.co/storage/v1/object/public/property-media-public/LOT-200/p${i}.webp`,
      caption: `Plate ${i + 1}`,
      isCover: i === 0,
      sortOrder: i,
      isApprovedPublic: true,
      storageBucket: PUBLIC_MEDIA_BUCKET,
      storagePath: `LOT-200/p${i}.webp`,
    }));

  const expectations: Array<[number, string, number, number]> = [
    [0, 'none', 0, 0],
    [1, 'cover-only', 0, 0],
    [2, 'single-secondary', 1, 0],
    [3, 'two-up', 2, 0],
    [4, 'three-up', 3, 0],
    [9, 'four-to-six-grid', 6, 2], // 1 cover + 6 Page 2 plates + 2 extra online
  ];

  for (const [count, expectedMode, expectedSecondary, expectedExtra] of expectations) {
    const prop = makeBaseProperty({
      images: makeImages(count),
      photos: makeImages(count).map((i) => i.url),
    });
    const dossier = buildPropertyDossierModel(prop, {
      isPreviewAllowed: false,
      effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
    });
    assert.equal(dossier.accessible, true);
    if (dossier.accessible) {
      assert.equal(dossier.portfolio.totalApprovedPhotos, count);
      assert.equal(dossier.portfolio.gridMode, expectedMode);
      assert.equal(dossier.portfolio.secondaryPhotos.length, expectedSecondary);
      assert.equal(dossier.portfolio.additionalOnlinePhotoCount, expectedExtra);
    }
  }
});

test('Phase 2 Dossier QR & Print Workflow: valid HTTPS canonical URL and strict A4 5-page architecture', () => {
  const validDossier = buildPropertyDossierModel(makeBaseProperty({lotId: 'LOT-007'}), {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev/',
  });
  assert.equal(validDossier.accessible, true);
  if (validDossier.accessible) {
    assert.equal(validDossier.qr.canonicalValid, true);
    assert.equal(
      validDossier.qr.qrTargetUrl,
      'https://benmicuborealestate.pages.dev/property/LOT-007'
    );
    assert.equal(validDossier.pageTitles.length, 5);
  }

  const localBlocked = buildPropertyDossierModel(makeBaseProperty({lotId: 'LOT-007'}), {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'http://localhost:3000',
  });
  assert.equal(localBlocked.accessible, true);
  if (localBlocked.accessible) {
    assert.equal(localBlocked.qr.canonicalValid, false);
    assert.equal(localBlocked.qr.qrTargetUrl, '');
  }

  assert.equal(DOSSIER_PALETTE.ivory, '#FAF8F4');
  assert.equal(DOSSIER_PALETTE.charcoal, '#1C1B19');
  assert.equal(DOSSIER_PALETTE.champagne, '#B89B6A');
  assert.equal(DOSSIER_PAGE_TITLES.length, 5);

  const root = process.cwd();
  const css = readFileSync(join(root, 'src/index.css'), 'utf8');
  const dossierComponent = readFileSync(join(root, 'src/components/PropertyDossierA4.tsx'), 'utf8');
  const dossierPage = readFileSync(join(root, 'src/pages/DossierPrintPage.tsx'), 'utf8');
  const pkgJson = readFileSync(join(root, 'package.json'), 'utf8');

  assert.ok(css.includes('@page dossier-a4'));
  assert.ok(css.includes('size: A4 portrait'));
  assert.ok(css.includes('break-after: page'));
  assert.ok(css.includes('.dossier-a4-page:last-child'));
  for (let p = 1; p <= 5; p++) {
    assert.ok(
      dossierComponent.includes(`data-dossier-page="${p}"`),
      `PropertyDossierA4 renders A4 folio page ${p}`
    );
  }
  assert.ok(dossierPage.includes('window.print()'));
  assert.ok(!pkgJson.includes('@react-pdf/renderer'));
});
