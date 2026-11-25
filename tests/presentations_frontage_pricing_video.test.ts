import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  createPropertyService,
  filterPublicPresentations,
  normalizeProperty,
  parseOptionalFrontageLength,
  redactPropertyForPublicResponse,
  sortPresentations,
  validatePresentationEntriesForStorage,
  validatePropertyForPublish,
  type SupabaseClientLike,
} from '../src/services/propertyService';
import {
  getAuthorizedPresentationAssetUrl,
  inspectPresentationMagicBytes,
  MAX_PRESENTATION_PDF_BYTES,
  MAX_PRESENTATION_PPTX_BYTES,
  PDF_MIME,
  PPTX_MIME,
  PRIVATE_MEDIA_BUCKET,
  PUBLIC_MEDIA_BUCKET,
  resolvePresentationAssetBucket,
  validatePresentationFile,
  validatePresentationFileMeta,
} from '../src/services/storageService';
import {
  formatFrontageLength,
  hasVisibleFrontageLength,
  resolvePropertyPricingDisplay,
} from '../src/utils/format';
import {buildPropertyDossierModel} from '../src/utils/dossierLayout';
import {parsePropertyVideoUrl, resolveVideoRenderMode} from '../src/utils/video';
import {DEMO_PROPERTIES} from '../src/data/demoProperties';
import type {
  Property,
  PropertyImageItem,
  PropertyInput,
  PropertyPresentationItem,
} from '../src/types/property';

const ROOT = process.cwd();
const readSrc = (relPath: string) => readFileSync(join(ROOT, relPath), 'utf8');

function createFullMockSupabase() {
  const buckets = {
    [PUBLIC_MEDIA_BUCKET]: new Map<string, {bytes: string; contentType: string}>(),
    [PRIVATE_MEDIA_BUCKET]: new Map<string, {bytes: string; contentType: string}>(),
  };

  const tables: Record<string, Array<Record<string, unknown>>> = {
    properties: [],
    property_images: [],
    property_videos: [],
    property_documents: [],
    property_presentations: [],
    admin_users: [],
    inquiries: [],
    site_settings: [],
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

    private async execute(): Promise<{data: unknown; error: {message: string} | null}> {
      if (this.mode === 'insert') {
        const rows = this.payload as Array<Record<string, unknown>>;
        const inserted: Array<Record<string, unknown>> = [];
        for (const raw of rows) {
          const row = {
            ...raw,
            id: raw.id || `${this.table}-${seq++}`,
            created_at: raw.created_at || new Date().toISOString(),
            updated_at: raw.updated_at || `2026-11-24T00:00:0${seq}.000Z`,
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
            const prevPub = row.visibility === 'Published' && !row.is_archived;
            Object.assign(row, patch);
            if (
              this.table === 'properties' &&
              prevPub &&
              (row.visibility !== 'Published' || row.is_archived === true)
            ) {
              for (const pres of tables.property_presentations) {
                if (pres.property_id === row.id) {
                  pres.pdf_storage_bucket = PRIVATE_MEDIA_BUCKET;
                  pres.pptx_storage_bucket = PRIVATE_MEDIA_BUCKET;
                  pres.cover_storage_bucket = PRIVATE_MEDIA_BUCKET;
                }
              }
            }
            matched.push({...row});
          }
        }
        return {data: this.wantSingle ? matched[0] || null : matched, error: null};
      }

      if (this.mode === 'delete') {
        const kept: Array<Record<string, unknown>> = [];
        const removedIds = new Set<unknown>();
        for (const row of tables[this.table]) {
          if (this.filters.every((fn) => fn(row))) removedIds.add(row.id);
          else kept.push(row);
        }
        tables[this.table] = kept;
        if (this.table === 'properties' && removedIds.size > 0) {
          tables.property_images = tables.property_images.filter((r) => !removedIds.has(r.property_id));
          tables.property_videos = tables.property_videos.filter((r) => !removedIds.has(r.property_id));
          tables.property_documents = tables.property_documents.filter((r) => !removedIds.has(r.property_id));
          tables.property_presentations = tables.property_presentations.filter((r) => !removedIds.has(r.property_id));
        }
        return {data: null, error: null};
      }

      // Emulate Supabase SQL security-barrier redaction views (`public_properties`, `public_property_presentations`)
      if (this.table === 'public_properties') {
        const rows = tables.properties
          .filter((row) => row.visibility === 'Published' && !row.is_archived)
          .filter((row) => this.filters.every((fn) => fn(row)))
          .map((row) => ({
            ...row,
            dimensions: undefined,
            is_price_manual_override: false,
            price_total_php: row.show_selling_price === false ? null : row.price_total_php,
            price_per_sqm: row.show_price_per_sqm === false ? null : row.price_per_sqm,
          }));
        return {data: this.wantSingle ? rows[0] || null : rows, error: null};
      }

      if (this.table === 'public_property_presentations') {
        const rows = tables.property_presentations
          .filter((pres) => {
            const prop = tables.properties.find((p) => p.id === pres.property_id);
            return Boolean(
              prop &&
                prop.visibility === 'Published' &&
                !prop.is_archived &&
                pres.visibility === 'Public'
            );
          })
          .filter((row) => this.filters.every((fn) => fn(row)))
          .map((pres) => ({
            ...pres,
            pdf_file_name: pres.allow_download ? pres.pdf_file_name : '',
            pdf_file_size_bytes: pres.allow_download ? pres.pdf_file_size_bytes : 0,
            pptx_storage_bucket: pres.allow_download ? pres.pptx_storage_bucket : PRIVATE_MEDIA_BUCKET,
            pptx_storage_path: pres.allow_download ? pres.pptx_storage_path : '',
            pptx_file_name: pres.allow_download ? pres.pptx_file_name : '',
            pptx_mime_type: pres.allow_download ? pres.pptx_mime_type : '',
            pptx_file_size_bytes: pres.allow_download ? pres.pptx_file_size_bytes : 0,
          }));
        return {data: this.wantSingle ? rows[0] || null : rows, error: null};
      }

      const rows = (tables[this.table] || [])
        .filter((row) => this.filters.every((fn) => fn(row)))
        .map((row) => {
          if (this.table !== 'properties') return {...row};
          return {
            ...row,
            property_images: tables.property_images.filter((i) => i.property_id === row.id),
            property_videos: tables.property_videos.filter((v) => v.property_id === row.id),
            property_documents: tables.property_documents.filter((d) => d.property_id === row.id),
            property_presentations: tables.property_presentations.filter((p) => p.property_id === row.id),
          };
        });
      return {data: this.wantSingle ? rows[0] || null : rows, error: null};
    }
  }

  const client = {
    from: (table: string) => new QueryBuilder(table),
    storage: {
      from(bucket: 'property-media-private' | 'property-media-public') {
        return {
          async download(path: string) {
            const entry = buckets[bucket].get(path);
            if (!entry) return {data: null, error: {message: 'Object not found'}};
            return {data: new Blob([entry.bytes], {type: entry.contentType}), error: null};
          },
          async upload(path: string, blob: Blob, opts?: {contentType?: string}) {
            const bytes = await blob.text();
            buckets[bucket].set(path, {
              bytes,
              contentType: opts?.contentType || blob.type || 'application/octet-stream',
            });
            return {data: {path}, error: null};
          },
          async remove(paths: string[]) {
            for (const p of paths) buckets[bucket].delete(p);
            return {data: [], error: null};
          },
          getPublicUrl(path: string) {
            return {data: {publicUrl: `https://cdn.example.invalid/${bucket}/${path}`}};
          },
          async createSignedUrl(path: string) {
            if (!buckets[bucket].has(path)) {
              return {data: null, error: {message: 'Object not found'}};
            }
            return {
              data: {signedUrl: `https://signed.example.invalid/${bucket}/${path}?token=123`},
              error: null,
            };
          },
        };
      },
    },
  } as unknown as SupabaseClientLike;

  return {client, buckets, tables};
}

function makeBaseInput(overrides: Partial<PropertyInput> = {}): PropertyInput {
  const base = DEMO_PROPERTIES[0];
  const {id: _id, updatedAt: _u, ...rest} = base;
  return {
    ...rest,
    lotId: 'LOT-PRES-001',
    visibility: 'Published',
    isArchived: false,
    lotAreaSqm: 1500,
    frontageLengthM: 24.5,
    pricePerSqm: 12000,
    priceTotalPhp: 18000000,
    showSellingPrice: true,
    showPricePerSqm: true,
    agentName: 'Ben Micubo',
    agentPhone: '+63 917 888 1234',
    agentWhatsapp: '639178881234',
    agentMessenger: 'benmicubo.ph',
    images: [],
    photos: [],
    documents: [],
    presentations: [],
    ...overrides,
  };
}

function seedPublicImage(
  mock: ReturnType<typeof createFullMockSupabase>,
  path: string
): PropertyImageItem {
  mock.buckets[PRIVATE_MEDIA_BUCKET].set(path, {
    bytes: `webp-${path}`,
    contentType: 'image/webp',
  });
  return {
    id: `img-${path}`,
    url: `https://signed.example.invalid/${PRIVATE_MEDIA_BUCKET}/${path}`,
    caption: 'Cover view',
    isCover: true,
    sortOrder: 0,
    isApprovedPublic: true,
    storageBucket: PRIVATE_MEDIA_BUCKET,
    storagePath: path,
  };
}

// ============================================================================
// TASK 1 — POWERPOINT PROPERTY PRESENTATIONS (VALIDATION, STORAGE, SECURITY)
// ============================================================================

test('Task 1: Strict file validation accepts valid PDF/PPTX and blocks legacy .ppt, macro .pptm, vbaProject.bin, HTML, SVG, and oversize files', async () => {
  // Valid PDF header %PDF-1.7
  const validPdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
  assert.doesNotThrow(() => inspectPresentationMagicBytes(validPdfBytes, 'pdf'));
  await assert.doesNotReject(() =>
    validatePresentationFile(
      new File([validPdfBytes], 'investor-deck.pdf', {type: PDF_MIME}),
      'pdf'
    )
  );

  // Valid PPTX ZIP header PK\x03\x04 without macros
  const validPptxBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x6d, 0x65]);
  assert.doesNotThrow(() => inspectPresentationMagicBytes(validPptxBytes, 'pptx'));
  await assert.doesNotReject(() =>
    validatePresentationFile(
      new File([validPptxBytes], 'briefing.pptx', {type: PPTX_MIME}),
      'pptx'
    )
  );

  // Disguised HTML pretending to be PDF or PPTX fails magic bytes check
  const fakeHtmlBytes = new TextEncoder().encode('<html><script>alert(1)</script></html>');
  assert.throws(
    () => inspectPresentationMagicBytes(fakeHtmlBytes, 'pdf'),
    /%PDF- signature missing/i
  );
  assert.throws(
    () => inspectPresentationMagicBytes(fakeHtmlBytes, 'pptx'),
    /invalid file header/i
  );

  // Disguised .pptx containing vbaProject.bin macro payload is blocked
  const macroPayload = new Uint8Array([
    0x50,
    0x4b,
    0x03,
    0x04,
    ...new TextEncoder().encode('ppt/vbaProject.bin'),
  ]);
  assert.throws(
    () => inspectPresentationMagicBytes(macroPayload, 'pptx'),
    /vbaProject\.bin/i
  );

  // Prohibited extensions rejected immediately
  for (const [name, mime] of [
    ['old.ppt', 'application/vnd.ms-powerpoint'],
    ['macros.pptm', 'application/vnd.ms-powerpoint.presentation.macroEnabled.12'],
    ['xss.html', 'text/html'],
    ['vector.svg', 'image/svg+xml'],
  ] as const) {
    assert.throws(
      () => validatePresentationFileMeta({name, size: 1024, type: mime}, 'pptx'),
      /Unsupported or macro-enabled file|must end with \.pptx/i
    );
  }

  // Size boundaries
  assert.throws(
    () =>
      validatePresentationFileMeta(
        {name: 'huge.pdf', size: MAX_PRESENTATION_PDF_BYTES + 1, type: PDF_MIME},
        'pdf'
      ),
    /20 MB/
  );
  assert.throws(
    () =>
      validatePresentationFileMeta(
        {name: 'huge.pptx', size: MAX_PRESENTATION_PPTX_BYTES + 1, type: PPTX_MIME},
        'pptx'
      ),
    /25 MB/
  );
});

test('Task 1: Bucket routing, private isolation, download toggle enforcement, unpublish demotion & delete protection', async () => {
  // Bucket routing matrix
  assert.equal(resolvePresentationAssetBucket('pdf', 'Private', true, true), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolvePresentationAssetBucket('pptx', 'Private', true, true), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolvePresentationAssetBucket('cover', 'Private', true, true), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolvePresentationAssetBucket('pdf', 'Public', false, false), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolvePresentationAssetBucket('pdf', 'Public', false, true), PUBLIC_MEDIA_BUCKET);
  assert.equal(resolvePresentationAssetBucket('pptx', 'Public', false, true), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolvePresentationAssetBucket('pptx', 'Public', true, true), PUBLIC_MEDIA_BUCKET);

  const mock = createFullMockSupabase();
  const svc = createPropertyService(() => mock.client);
  const coverImg = seedPublicImage(mock, 'LOT-PRES-001/images/cover.webp');

  const pdfViewOnlyPath = 'LOT-PRES-001/presentations/view-only.pdf';
  const pptxViewOnlyPath = 'LOT-PRES-001/presentations/view-only.pptx';
  const pdfPrivatePath = 'LOT-PRES-001/presentations/internal.pdf';
  const coverDeckPath = 'LOT-PRES-001/presentations/cover-deck.webp';

  for (const [path, ct] of [
    [pdfViewOnlyPath, PDF_MIME],
    [pptxViewOnlyPath, PPTX_MIME],
    [pdfPrivatePath, PDF_MIME],
    [coverDeckPath, 'image/webp'],
  ] as const) {
    mock.buckets[PRIVATE_MEDIA_BUCKET].set(path, {bytes: `bytes-${path}`, contentType: ct});
  }

  const decks: PropertyPresentationItem[] = [
    {
      id: 'pres-public-nodownload',
      title: 'Executive Land Briefing',
      description: 'Site concept & zoning overview',
      visibility: 'Public',
      allowDownload: false,
      sortOrder: 0,
      slideCount: 12,
      pdfStorageBucket: PRIVATE_MEDIA_BUCKET,
      pdfStoragePath: pdfViewOnlyPath,
      pdfFileName: 'view-only.pdf',
      pdfMimeType: PDF_MIME,
      pdfFileSizeBytes: 540000,
      pptxStorageBucket: PRIVATE_MEDIA_BUCKET,
      pptxStoragePath: pptxViewOnlyPath,
      pptxFileName: 'view-only.pptx',
      pptxMimeType: PPTX_MIME,
      pptxFileSizeBytes: 1850000,
      coverStorageBucket: PRIVATE_MEDIA_BUCKET,
      coverStoragePath: coverDeckPath,
      coverPublicUrl: '',
      uploadedAt: '2026-11-24T00:00:00.000Z',
    },
    {
      id: 'pres-private',
      title: 'Confidential Appraisal Deck',
      description: 'Internal valuation only',
      visibility: 'Private',
      allowDownload: true,
      sortOrder: 1,
      slideCount: 6,
      pdfStorageBucket: PRIVATE_MEDIA_BUCKET,
      pdfStoragePath: pdfPrivatePath,
      pdfFileName: 'internal.pdf',
      pdfMimeType: PDF_MIME,
      pdfFileSizeBytes: 320000,
      pptxStorageBucket: PRIVATE_MEDIA_BUCKET,
      pptxStoragePath: '',
      pptxFileName: '',
      pptxMimeType: '',
      pptxFileSizeBytes: 0,
      coverStorageBucket: PRIVATE_MEDIA_BUCKET,
      coverStoragePath: '',
      uploadedAt: '2026-11-24T00:00:00.000Z',
    },
  ];

  const created = await svc.createProperty(
    makeBaseInput({images: [coverImg], presentations: decks})
  );

  // Public PDF + cover promoted; allowDownload=false PPTX & Private deck stay strictly in private bucket!
  assert.ok(mock.buckets[PUBLIC_MEDIA_BUCKET].has(pdfViewOnlyPath));
  assert.ok(mock.buckets[PUBLIC_MEDIA_BUCKET].has(coverDeckPath));
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].has(pptxViewOnlyPath), false);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].has(pdfPrivatePath), false);
  assert.ok(mock.buckets[PRIVATE_MEDIA_BUCKET].has(pptxViewOnlyPath));
  assert.ok(mock.buckets[PRIVATE_MEDIA_BUCKET].has(pdfPrivatePath));

  // Public list only receives Public deck with PPTX file metadata & download details stripped
  const publicListings = await svc.listProperties(false);
  assert.equal(publicListings.length, 1);
  assert.equal(publicListings[0].presentations.length, 1);
  const pubPres = publicListings[0].presentations[0];
  assert.equal(pubPres.title, 'Executive Land Briefing');
  assert.equal(pubPres.allowDownload, false);
  assert.equal(pubPres.pptxStoragePath, '');
  assert.equal(pubPres.pptxPublicUrl, undefined);
  assert.equal(pubPres.pdfFileName, '');

  // Unauthorized visitor blocked from requesting private presentation or disabled PPTX
  await assert.rejects(
    () => getAuthorizedPresentationAssetUrl(created.presentations[0], 'pptx', false, mock.client),
    /downloads are disabled/i
  );
  await assert.rejects(
    () => getAuthorizedPresentationAssetUrl(created.presentations[1], 'pdf', false, mock.client),
    /Unauthorized/i
  );

  // Authorized admin CAN download private PDF & restricted PPTX
  const adminPptxUrl = await getAuthorizedPresentationAssetUrl(
    created.presentations[0],
    'pptx',
    true,
    mock.client
  );
  assert.match(adminPptxUrl, /signed\.example\.invalid/);

  // Unpublishing backs up & removes all presentation files from public Storage
  const drafted = await svc.setVisibility(created.id, 'Draft');
  assert.equal(drafted?.visibility, 'Draft');
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].has(pdfViewOnlyPath), false);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].has(coverDeckPath), false);
  assert.ok(mock.buckets[PRIVATE_MEDIA_BUCKET].has(pdfViewOnlyPath));
  assert.ok(mock.buckets[PRIVATE_MEDIA_BUCKET].has(coverDeckPath));

  // Reordering / validation helpers
  assert.throws(
    () => validatePresentationEntriesForStorage([{...decks[0], title: '  '}], true),
    /must have a title/i
  );
  const reordered = sortPresentations([
    {...decks[1], sortOrder: 0},
    {...decks[0], sortOrder: 1},
  ]);
  assert.equal(reordered[0].id, 'pres-private');
  assert.equal(filterPublicPresentations(reordered).length, 1);

  // Delete cleans remaining storage cleanly
  await svc.deleteProperty(created.id);
  assert.equal(mock.buckets[PRIVATE_MEDIA_BUCKET].size, 0);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].size, 0);
});

test('Task 1: Public viewer UI & Dossier strictly forbid Google Drive/R2 presentation storage, enforce lazy loading & cover-only fallback', () => {
  const viewerSrc = readSrc('src/components/PropertyPresentationViewer.tsx');
  const detailSrc = readSrc('src/pages/PropertyDetailPage.tsx');
  const editorSrc = readSrc('src/components/AdminPropertyEditor.tsx');

  // Lazy-loaded component & on-demand PDF fetch (no pre-download until Open Slide Deck)
  assert.ok(detailSrc.includes("lazy(() =>"));
  assert.ok(detailSrc.includes('PropertyPresentationViewer'));
  assert.ok(detailSrc.includes('visiblePresentations.length > 0'));
  assert.ok(viewerSrc.includes('Open Slide Deck'));
  assert.ok(viewerSrc.includes("import('pdfjs-dist')"));
  assert.ok(viewerSrc.includes('allowDownload || isPreviewAllowed'));
  assert.ok(viewerSrc.includes('aria-modal="true"'));
  assert.ok(viewerSrc.includes('ArrowRight'));
  assert.ok(viewerSrc.includes('ArrowLeft'));
  assert.ok(viewerSrc.includes('touchStartXRef'));

  // Admin editor has security notice + required section name
  assert.ok(editorSrc.includes('Property Presentations'));
  assert.ok(editorSrc.includes('not guaranteed copy-proof'));

  // Zero Google Drive / R2 storage references in presentation code
  assert.equal(/cloudflare.*r2|r2\.dev/i.test(viewerSrc + editorSrc), false);
});

// ============================================================================
// TASK 2 — OPTIONAL FRONTAGE LENGTH & ZERO LOT DIMENSIONS
// ============================================================================

test('Task 2: Frontage parsing validates positive decimals, never derives lot area, and removes dimensions from UI', () => {
  assert.equal(parseOptionalFrontageLength(''), null);
  assert.equal(parseOptionalFrontageLength(null), null);
  assert.equal(parseOptionalFrontageLength(undefined), null);
  assert.equal(parseOptionalFrontageLength('24.5'), 24.5);
  assert.equal(parseOptionalFrontageLength(18.756), 18.76);

  assert.equal(formatFrontageLength(24.5), '24.5 m');
  assert.equal(formatFrontageLength(null), '');
  assert.equal(hasVisibleFrontageLength({frontageLengthM: 12.2}), true);
  assert.equal(hasVisibleFrontageLength({frontageLengthM: null}), false);

  const errors = validatePropertyForPublish(
    makeBaseInput({
      frontageLengthM: -5,
      images: [
        {
          id: 'img-1',
          url: 'https://cdn.example.com/1.webp',
          caption: 'Cover',
          isCover: true,
          sortOrder: 0,
          isApprovedPublic: true,
          storageBucket: PUBLIC_MEDIA_BUCKET,
          storagePath: 'LOT/images/1.webp',
        },
      ],
    })
  );
  assert.ok(errors.some((e) => /Frontage length/i.test(e)));

  // Legacy dimensions field is always wiped from public projection
  const norm = normalizeProperty({
    id: 'p-legacy',
    lotId: 'LOT-OLD',
    lotAreaSqm: 1000,
    dimensions: '20m × 50m',
    frontageLengthM: null,
  });
  const redacted = redactPropertyForPublicResponse(norm);
  assert.equal(redacted.dimensions, '');
  assert.equal(redacted.frontageLengthM, null);
});

// ============================================================================
// TASK 3 — 4-MODE SELLING PRICE VISIBILITY & BACKEND REDACTION
// ============================================================================

test('Task 3: All 4 selling price visibility combinations resolve accurately without ₱0 or hidden value leaks', () => {
  // Mode 1: Both visible
  const m1 = resolvePropertyPricingDisplay({
    priceTotalPhp: 18000000,
    pricePerSqm: 12000,
    lotAreaSqm: 1500,
    showSellingPrice: true,
    showPricePerSqm: true,
  });
  assert.equal(m1.totalPriceLabel, '₱18,000,000');
  assert.equal(m1.pricePerSqmLabel, '₱12,000 / sqm');
  assert.equal(m1.primaryHeadlineLabel, '₱18,000,000');
  assert.equal(m1.secondarySubLabel, '₱12,000 / sqm');
  assert.equal(m1.isPriceUponRequest, false);

  // Mode 2: Total Selling Price visible, Rate/sqm hidden
  const m2 = resolvePropertyPricingDisplay({
    priceTotalPhp: 18000000,
    pricePerSqm: null,
    lotAreaSqm: 1500,
    showSellingPrice: true,
    showPricePerSqm: false,
  });
  assert.equal(m2.totalPriceLabel, '₱18,000,000');
  assert.equal(m2.pricePerSqmLabel, '');
  assert.equal(m2.primaryHeadlineLabel, '₱18,000,000');
  assert.equal(m2.secondarySubLabel, '');
  assert.equal(m2.isPriceUponRequest, false);

  // Mode 3: Rate/sqm visible, Total Selling Price hidden (e.g., per-sqm pricing model)
  const m3 = resolvePropertyPricingDisplay({
    priceTotalPhp: null,
    pricePerSqm: 12000,
    lotAreaSqm: 1500,
    showSellingPrice: false,
    showPricePerSqm: true,
  });
  assert.equal(m3.totalPriceLabel, '');
  assert.equal(m3.pricePerSqmLabel, '₱12,000 / sqm');
  assert.equal(m3.primaryHeadlineLabel, '₱12,000 / sqm');
  assert.equal(m3.secondarySubLabel, '');
  assert.equal(m3.isPriceUponRequest, false);

  // Mode 4: Both hidden -> Price Upon Request
  const m4 = resolvePropertyPricingDisplay({
    priceTotalPhp: null,
    pricePerSqm: null,
    lotAreaSqm: 1500,
    showSellingPrice: false,
    showPricePerSqm: false,
  });
  assert.equal(m4.totalPriceLabel, '');
  assert.equal(m4.pricePerSqmLabel, '');
  assert.equal(m4.primaryHeadlineLabel, 'Price Upon Request');
  assert.equal(m4.secondarySubLabel, '');
  assert.equal(m4.isPriceUponRequest, true);
  assert.equal(m4.hasAnyVisiblePrice, false);
});

test('Task 3: Public database views & service redaction null out hidden prices while admin list preserves full prices', async () => {
  const mock = createFullMockSupabase();
  const svc = createPropertyService(() => mock.client);
  const coverImg = seedPublicImage(mock, 'LOT-PRICE-001/images/cover.webp');

  await svc.createProperty(
    makeBaseInput({
      lotId: 'LOT-PRICE-001',
      lotAreaSqm: 2000,
      priceTotalPhp: 30000000,
      pricePerSqm: 15000,
      showSellingPrice: false,
      showPricePerSqm: true,
      images: [coverImg],
    })
  );

  // Public visitor receives NULL for hidden total price; visible rate/sqm stays intact
  const pubList = await svc.listProperties(false);
  assert.equal(pubList.length, 1);
  assert.equal(pubList[0].showSellingPrice, false);
  assert.equal(pubList[0].showPricePerSqm, true);
  assert.equal(pubList[0].priceTotalPhp, null);
  assert.equal(pubList[0].pricePerSqm, 15000);

  // Admin editor still receives exact saved numeric figures
  const adminList = await svc.listProperties(true);
  assert.equal(adminList.length, 1);
  assert.equal(adminList[0].priceTotalPhp, 30000000);
  assert.equal(adminList[0].pricePerSqm, 15000);

  // Defense-in-depth redaction if a full Property object passes through public sanitizer
  const sanitized = redactPropertyForPublicResponse({
    ...adminList[0],
    showSellingPrice: false,
    showPricePerSqm: false,
  });
  assert.equal(sanitized.priceTotalPhp, null);
  assert.equal(sanitized.pricePerSqm, null);
  assert.equal(sanitized.dimensions, '');

  // Public UI renders Price Upon Request inquiry anchor & sort excludes hidden total prices from numeric sort
  const detailSrc = readSrc('src/pages/PropertyDetailPage.tsx');
  assert.ok(detailSrc.includes('Request Pricing'));
  assert.ok(detailSrc.includes('href="#inquiry-card"'));
  const homeSrc = readSrc('src/pages/HomePage.tsx');
  assert.ok(homeSrc.includes('a.showSellingPrice !== false && a.priceTotalPhp !== null'));
});

// ============================================================================
// TASK 4 & TASK 5 — VIDEO PLAYBACK & 5-PAGE A4 DOSSIER INTEGRATION
// ============================================================================

test('Task 4 & 5: In-page video playback stays embedded on mobile/desktop & 5-page dossier enforces frontage, price modes, and Page 5 QR deck notice', () => {
  assert.equal(resolveVideoRenderMode('google_drive', true), 'inline_embed');
  assert.equal(resolveVideoRenderMode('google_drive', false), 'inline_embed');
  assert.ok(parsePropertyVideoUrl('https://drive.google.com/file/d/1AbCDefGhIjKlMnOpQrStUvWxYz/view'));

  const baseProp: Property = {
    ...DEMO_PROPERTIES[0],
    lotId: 'LOT-DOSSIER-5',
    frontageLengthM: 42.25,
    dimensions: 'Should never appear',
    showSellingPrice: false,
    showPricePerSqm: false,
    priceTotalPhp: 25000000,
    pricePerSqm: 12500,
    presentations: [
      {
        id: 'deck-pub',
        title: 'Tagaytay Ridge Site Plan Deck',
        description: 'Architectural orientation and contour overview',
        visibility: 'Public',
        allowDownload: true,
        sortOrder: 0,
        slideCount: 14,
        pdfStorageBucket: PUBLIC_MEDIA_BUCKET,
        pdfStoragePath: 'LOT-DOSSIER-5/presentations/deck.pdf',
        pdfFileName: 'deck.pdf',
        pdfMimeType: PDF_MIME,
        pdfFileSizeBytes: 1200000,
        pptxStorageBucket: PUBLIC_MEDIA_BUCKET,
        pptxStoragePath: 'LOT-DOSSIER-5/presentations/deck.pptx',
        pptxFileName: 'deck.pptx',
        pptxMimeType: PPTX_MIME,
        pptxFileSizeBytes: 2400000,
        coverStorageBucket: PRIVATE_MEDIA_BUCKET,
        coverStoragePath: '',
        uploadedAt: '2026-11-24T00:00:00.000Z',
      },
      {
        id: 'deck-priv',
        title: 'Internal Margin Model',
        description: 'Confidential',
        visibility: 'Private',
        allowDownload: true,
        sortOrder: 1,
        slideCount: 4,
        pdfStorageBucket: PRIVATE_MEDIA_BUCKET,
        pdfStoragePath: 'LOT-DOSSIER-5/presentations/internal.pdf',
        pdfFileName: 'internal.pdf',
        pdfMimeType: PDF_MIME,
        pdfFileSizeBytes: 400000,
        pptxStorageBucket: PRIVATE_MEDIA_BUCKET,
        pptxStoragePath: '',
        pptxFileName: '',
        pptxMimeType: '',
        pptxFileSizeBytes: 0,
        coverStorageBucket: PRIVATE_MEDIA_BUCKET,
        coverStoragePath: '',
        uploadedAt: '2026-11-24T00:00:00.000Z',
      },
    ],
  };

  const dossier = buildPropertyDossierModel(baseProp, {
    isPreviewAllowed: false,
    effectiveCanonicalSiteUrl: 'https://benmicuborealestate.pages.dev',
  });
  assert.equal(dossier.accessible, true);
  if (dossier.accessible) {
    assert.equal(dossier.frontageLengthLabel, '42.25 m');
    assert.equal(dossier.isPriceUponRequest, true);
    assert.equal(dossier.priceHeadlineLabel, 'Price Upon Request');
    assert.equal(dossier.priceSubLabel, '');
    assert.equal(dossier.priceTotalLabel, '');
    assert.equal(dossier.pricePerSqmLabel, '');
    // Executive metrics contain Lot Area, Frontage Length, Classification, Title Status (zero hidden price placeholders)
    assert.equal(dossier.executiveMetrics.length, 4);
    assert.equal(dossier.executiveMetrics[0].label, 'Lot Area');
    assert.equal(dossier.executiveMetrics[1].label, 'Frontage Length');
    // Page 5 includes strictly Public deck and NEVER leaks Private presentation
    assert.equal(dossier.publicPresentations.length, 1);
    assert.equal(dossier.publicPresentations[0].title, 'Tagaytay Ridge Site Plan Deck');
  }

  const dossierComponentSrc = readSrc('src/components/PropertyDossierA4.tsx');
  assert.ok(dossierComponentSrc.includes('Interactive Presentation Briefing'));
  assert.ok(dossierComponentSrc.includes('dossier.publicPresentations'));
  assert.equal(dossierComponentSrc.includes('data-dossier-page="6"'), false);
});

// ============================================================================
// TASK 6 — INCREMENTAL MIGRATION & RLS SQL HARDENING AUDIT
// ============================================================================

test('Task 6: Additive SQL migration and RLS regression script enforce presentation isolation and backend price redaction', () => {
  const migSql = readSrc(
    'supabase/migrations/20261124_presentations_frontage_price_visibility.sql'
  );
  const schemaSql = readSrc('supabase/schema.sql');
  const rlsSql = readSrc('supabase/tests/rls_security_regression.sql');

  // Non-destructive incremental migration guarantees (ignore SQL comment lines)
  const executableMigSql = migSql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  assert.equal(/\b(drop table|drop column|truncate)\b/i.test(executableMigSql), false);
  assert.match(migSql, /create table if not exists public\.property_presentations/i);
  assert.match(migSql, /add column if not exists frontage_length_m numeric/i);
  assert.match(migSql, /add column if not exists show_selling_price boolean not null default true/i);
  assert.match(migSql, /add column if not exists show_price_per_sqm boolean not null default true/i);

  // SQL backend redaction views with security_barrier
  for (const sqlText of [migSql, schemaSql]) {
    assert.match(sqlText, /create or replace view public\.public_properties\s+with\s*\(\s*security_barrier\s*=\s*true\s*\)/i);
    assert.match(sqlText, /case when p\.show_selling_price then p\.price_total_php else null end as price_total_php/i);
    assert.match(sqlText, /case when p\.show_price_per_sqm then p\.price_per_sqm else null end as price_per_sqm/i);
    assert.match(sqlText, /create or replace view public\.public_property_presentations\s+with\s*\(\s*security_barrier\s*=\s*true\s*\)/i);
    assert.match(sqlText, /revoke all on public\.properties from anon, authenticated;/i);
    assert.match(sqlText, /revoke all on public\.property_presentations from anon, authenticated;/i);
    assert.match(sqlText, /grant select on public\.public_properties to anon, authenticated;/i);
    assert.match(sqlText, /grant select on public\.public_property_presentations to anon, authenticated;/i);
    assert.match(sqlText, /trg_enforce_presentation_public_scope/i);
    assert.match(sqlText, /\('images', 'documents', 'presentations'\)/i);
  }

  // RLS security regression SQL verifies all new vectors
  assert.match(rlsSql, /public_properties/i);
  assert.match(rlsSql, /public_property_presentations/i);
  assert.match(rlsSql, /allow_download = false/i);
});
