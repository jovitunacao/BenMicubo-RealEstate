import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {
  createPropertyService,
  sortImagesCoverFirst,
  validateImageEntriesForStorage,
  type SupabaseClientLike,
} from '../src/services/propertyService';
import {
  ensurePrivateBackupFromPublicBucket,
  getAuthorizedDocumentDownloadUrl,
  PRIVATE_MEDIA_BUCKET,
  PUBLIC_MEDIA_BUCKET,
  removeStoragePathsFromBucket,
  verifyObjectExistsInBucket,
} from '../src/services/storageService';
import {buildPropertyGallerySlides} from '../src/utils/gallery';
import {
  calculateScaledDimensions,
  computeFileFingerprint,
  MAX_IMAGE_DIMENSION,
  selectTargetOutputMime,
  TARGET_MAX_IMAGE_BYTES,
} from '../src/utils/imageProcessor';
import {buildCanonicalPropertyUrl} from '../src/utils/siteUrl';
import {DEMO_PROPERTIES} from '../src/data/demoProperties';
import type {
  Property,
  PropertyDocumentItem,
  PropertyImageItem,
  PropertyInput,
} from '../src/types/property';

interface FailureFlags {
  failPropertyInsert?: string;
  failPropertyUpdate?: string;
  failPropertyDelete?: string;
  failImagesInsert?: string;
  failPublicUploadPath?: string;
  failPublicRemove?: string;
  failPrivateRemove?: string;
  failPrivateBackupUploadPath?: string;
}

function createPhase1MockSupabase(failures: FailureFlags = {}) {
  const operationLog: string[] = [];
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

  let idSeq = 1;

  function applyEnforceTrigger(table: string, row: Record<string, unknown>) {
    if (table === 'property_images') {
      const prop = tables.properties.find((p) => p.id === row.property_id);
      const isPub = Boolean(prop && prop.visibility === 'Published' && !prop.is_archived);
      if ((row.storage_bucket === PUBLIC_MEDIA_BUCKET || row.is_approved_public) && !isPub) {
        throw new Error(
          'SECURITY VIOLATION: Unapproved or unpublished property images cannot target property-media-public'
        );
      }
    }
    if (table === 'property_documents') {
      const prop = tables.properties.find((p) => p.id === row.property_id);
      const isPub = Boolean(prop && prop.visibility === 'Published' && !prop.is_archived);
      if (row.visibility === 'Private' && row.storage_bucket !== PRIVATE_MEDIA_BUCKET) {
        throw new Error('SECURITY VIOLATION: Private documents must always target property-media-private');
      }
      if (row.storage_bucket === PUBLIC_MEDIA_BUCKET && !isPub) {
        throw new Error(
          'SECURITY VIOLATION: Unpublished property documents cannot target property-media-public'
        );
      }
    }
    if (table === 'property_presentations') {
      const prop = tables.properties.find((p) => p.id === row.property_id);
      const isPub = Boolean(prop && prop.visibility === 'Published' && !prop.is_archived);
      const allowPub = isPub && row.visibility === 'Public';
      if (row.pdf_storage_bucket === PUBLIC_MEDIA_BUCKET && !allowPub) {
        throw new Error('SECURITY VIOLATION: Private or unpublished presentation PDF cannot target public storage');
      }
      if (row.pptx_storage_bucket === PUBLIC_MEDIA_BUCKET && (!allowPub || !row.allow_download)) {
        throw new Error('SECURITY VIOLATION: Non-downloadable or private PPTX cannot target public storage');
      }
      if (row.cover_storage_bucket === PUBLIC_MEDIA_BUCKET && !allowPub) {
        throw new Error('SECURITY VIOLATION: Private or unpublished presentation cover cannot target public storage');
      }
    }
  }

  class QueryBuilder {
    private filters: Array<(row: Record<string, unknown>) => boolean> = [];
    private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: unknown = null;
    private wantSingle = false;

    constructor(private readonly table: string) {}

    select(_cols?: string) {
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
      onfulfilled?:
        | ((value: {data: unknown; error: {message: string} | null}) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return this.execute().then(onfulfilled, onrejected);
    }

    private async execute(): Promise<{data: unknown; error: {message: string} | null}> {
      try {
        if (this.mode === 'insert') {
          operationLog.push(`db.insert:${this.table}`);
          if (this.table === 'properties' && failures.failPropertyInsert) {
            return {data: null, error: {message: failures.failPropertyInsert}};
          }
          if (this.table === 'property_images' && failures.failImagesInsert) {
            const msg = failures.failImagesInsert;
            failures.failImagesInsert = undefined;
            return {data: null, error: {message: msg}};
          }
          const rows = this.payload as Array<Record<string, unknown>>;
          const inserted: Array<Record<string, unknown>> = [];
          for (const raw of rows) {
            const row = {
              ...raw,
              id: raw.id || `${this.table}-${idSeq++}`,
              created_at: raw.created_at || new Date().toISOString(),
              updated_at: raw.updated_at || new Date().toISOString(),
            };
            applyEnforceTrigger(this.table, row);
            tables[this.table].push(row);
            inserted.push({...row});
          }
          return {data: this.wantSingle ? inserted[0] : inserted, error: null};
        }

        if (this.mode === 'update') {
          operationLog.push(`db.update:${this.table}`);
          if (this.table === 'properties' && failures.failPropertyUpdate) {
            return {data: null, error: {message: failures.failPropertyUpdate}};
          }
          const patch = this.payload as Record<string, unknown>;
          const matched: Array<Record<string, unknown>> = [];
          for (const row of tables[this.table]) {
            if (this.filters.every((fn) => fn(row))) {
              const prevVisibility = row.visibility;
              const prevArchived = row.is_archived;
              Object.assign(row, patch);
              applyEnforceTrigger(this.table, row);
              if (
                this.table === 'properties' &&
                prevVisibility === 'Published' &&
                !prevArchived &&
                (row.visibility !== 'Published' || row.is_archived === true)
              ) {
                for (const img of tables.property_images) {
                  if (img.property_id === row.id) {
                    img.is_approved_public = false;
                    img.storage_bucket = PRIVATE_MEDIA_BUCKET;
                  }
                }
                for (const doc of tables.property_documents) {
                  if (doc.property_id === row.id) {
                    doc.storage_bucket = PRIVATE_MEDIA_BUCKET;
                  }
                }
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
          operationLog.push(`db.delete:${this.table}`);
          if (this.table === 'properties' && failures.failPropertyDelete) {
            return {data: null, error: {message: failures.failPropertyDelete}};
          }
          const kept: Array<Record<string, unknown>> = [];
          const removedIds = new Set<unknown>();
          for (const row of tables[this.table]) {
            if (this.filters.every((fn) => fn(row))) {
              removedIds.add(row.id);
            } else {
              kept.push(row);
            }
          }
          tables[this.table] = kept;
          if (this.table === 'properties' && removedIds.size > 0) {
            tables.property_images = tables.property_images.filter(
              (r) => !removedIds.has(r.property_id)
            );
            tables.property_videos = tables.property_videos.filter(
              (r) => !removedIds.has(r.property_id)
            );
            tables.property_documents = tables.property_documents.filter(
              (r) => !removedIds.has(r.property_id)
            );
            tables.property_presentations = tables.property_presentations.filter(
              (r) => !removedIds.has(r.property_id)
            );
          }
          return {data: null, error: null};
        }

        const sourceRows: Array<Record<string, unknown>> =
          this.table === 'public_properties'
            ? tables.properties
                .filter((row) => row.visibility === 'Published' && !row.is_archived)
                .map((row) => ({
                  ...row,
                  dimensions: undefined,
                  price_total_php: row.show_selling_price === false ? null : row.price_total_php,
                  price_per_sqm: row.show_price_per_sqm === false ? null : row.price_per_sqm,
                }))
            : this.table === 'public_property_presentations'
              ? tables.property_presentations.filter((row) => row.visibility === 'Public')
              : tables[this.table] || [];

        const rows = sourceRows
          .filter((row) => this.filters.every((fn) => fn(row)))
          .map((row) => {
            if (this.table !== 'properties') return {...row};
            return {
              ...row,
              property_images: tables.property_images
                .filter((i) => i.property_id === row.id)
                .map((i) => ({...i})),
              property_videos: tables.property_videos
                .filter((v) => v.property_id === row.id)
                .map((v) => ({...v})),
              property_documents: tables.property_documents
                .filter((d) => d.property_id === row.id)
                .map((d) => ({...d})),
              property_presentations: tables.property_presentations
                .filter((p) => p.property_id === row.id)
                .map((p) => ({...p})),
            };
          });
        return {data: this.wantSingle ? rows[0] || null : rows, error: null};
      } catch (err) {
        return {data: null, error: {message: (err as Error).message}};
      }
    }
  }

  const client = {
    from(table: string) {
      return new QueryBuilder(table);
    },
    storage: {
      from(bucket: 'property-media-private' | 'property-media-public') {
        return {
          async download(path: string) {
            operationLog.push(`storage.download:${bucket}:${path}`);
            const entry = buckets[bucket].get(path);
            if (!entry) return {data: null, error: {message: 'Object not found'}};
            return {
              data: new Blob([entry.bytes], {type: entry.contentType}),
              error: null,
            };
          },
          async upload(path: string, blob: Blob, opts?: {contentType?: string}) {
            operationLog.push(`storage.upload:${bucket}:${path}`);
            if (bucket === PUBLIC_MEDIA_BUCKET && failures.failPublicUploadPath === path) {
              return {data: null, error: {message: 'Simulated public upload failure'}};
            }
            if (
              bucket === PRIVATE_MEDIA_BUCKET &&
              failures.failPrivateBackupUploadPath === path
            ) {
              return {data: null, error: {message: 'Simulated private backup upload failure'}};
            }
            const bytes = await blob.text();
            buckets[bucket].set(path, {
              bytes,
              contentType: opts?.contentType || blob.type || 'application/octet-stream',
            });
            return {data: {path}, error: null};
          },
          async remove(paths: string[]) {
            operationLog.push(`storage.remove:${bucket}:${paths.join(',')}`);
            if (bucket === PUBLIC_MEDIA_BUCKET && failures.failPublicRemove) {
              return {data: null, error: {message: failures.failPublicRemove}};
            }
            if (bucket === PRIVATE_MEDIA_BUCKET && failures.failPrivateRemove) {
              return {data: null, error: {message: failures.failPrivateRemove}};
            }
            for (const p of paths) {
              if (!buckets[bucket].has(p)) {
                return {data: null, error: {message: `Object not found: ${p}`}};
              }
              buckets[bucket].delete(p);
            }
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
              data: {signedUrl: `https://signed.example.invalid/${bucket}/${path}?token=fresh`},
              error: null,
            };
          },
        };
      },
    },
  } as unknown as SupabaseClientLike;

  return {client, buckets, tables, operationLog};
}

function buildPropertyInput(
  overrides: Partial<PropertyInput> = {}
): PropertyInput {
  const base = DEMO_PROPERTIES[0];
  const {id: _id, updatedAt: _u, ...rest} = base;
  return {
    ...rest,
    lotId: 'LOT-P1-001',
    visibility: 'Published',
    isArchived: false,
    agentName: 'Ben Micubo',
    agentPhone: '+63 917 888 1234',
    agentWhatsapp: '639178881234',
    agentMessenger: 'benmicubo.ph',
    images: [],
    photos: [],
    documents: [],
    ...overrides,
  };
}

function seedPrivateImage(
  mock: ReturnType<typeof createPhase1MockSupabase>,
  path: string,
  caption = 'Photo',
  isCover = false,
  sortOrder = 0,
  isApprovedPublic = true
): PropertyImageItem {
  mock.buckets[PRIVATE_MEDIA_BUCKET].set(path, {
    bytes: `webp-bytes-${path}`,
    contentType: 'image/webp',
  });
  return {
    id: `img-${path}`,
    url: `https://signed.example.invalid/${PRIVATE_MEDIA_BUCKET}/${path}?token=init`,
    caption,
    isCover,
    sortOrder,
    isApprovedPublic,
    storageBucket: PRIVATE_MEDIA_BUCKET,
    storagePath: path,
  };
}

function seedPrivateDoc(
  mock: ReturnType<typeof createPhase1MockSupabase>,
  path: string,
  visibility: 'Private' | 'Public'
): PropertyDocumentItem {
  mock.buckets[PRIVATE_MEDIA_BUCKET].set(path, {
    bytes: `pdf-bytes-${path}`,
    contentType: 'application/pdf',
  });
  return {
    id: `doc-${path}`,
    title: visibility === 'Private' ? 'Confidential TCT' : 'Public Lot Brochure',
    category: visibility === 'Private' ? 'Title Document' : 'PDF Brochure',
    visibility,
    storageBucket: PRIVATE_MEDIA_BUCKET,
    storagePath: path,
    fileName: path.split('/').pop() || 'doc.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 2048,
    uploadedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('1 & 2. Draft property creation keeps media private, reloads for admin with signed URLs, and stays hidden publicly', async () => {
  const mock = createPhase1MockSupabase();
  const service = createPropertyService(() => mock.client);
  const cover = seedPrivateImage(mock, 'LOT-P1-001/images/cover.webp', 'Frontage', true, 0, false);

  const created = await service.createProperty(
    buildPropertyInput({visibility: 'Draft', images: [cover], photos: [cover.url]})
  );

  assert.equal(created.visibility, 'Draft');
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].size, 0);
  assert.ok(mock.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-P1-001/images/cover.webp'));

  // Simulate reload: public visitor gets 0 Draft properties; admin gets refreshed signed URLs
  const publicList = await service.listProperties(false);
  assert.equal(publicList.length, 0);

  const adminList = await service.listProperties(true);
  assert.equal(adminList.length, 1);
  assert.equal(adminList[0].images[0].storageBucket, PRIVATE_MEDIA_BUCKET);
  assert.match(adminList[0].images[0].url, /token=fresh/);
});

test('3 & 4. Publishing Draft and direct Published creation promote approved media and clean redundant private duplicates', async () => {
  const mock = createPhase1MockSupabase();
  const service = createPropertyService(() => mock.client);

  const img1 = seedPrivateImage(mock, 'LOT-P1-001/images/cover.webp', 'Cover', true, 0, true);
  const imgPrivate = seedPrivateImage(
    mock,
    'LOT-P1-001/images/survey.webp',
    'Internal survey',
    false,
    1,
    false
  );
  const docPub = seedPrivateDoc(mock, 'LOT-P1-001/documents/brochure.pdf', 'Public');
  const docPriv = seedPrivateDoc(mock, 'LOT-P1-001/documents/tct.pdf', 'Private');

  const draft = await service.createProperty(
    buildPropertyInput({
      visibility: 'Draft',
      images: [img1, imgPrivate],
      documents: [docPub, docPriv],
    })
  );
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].size, 0);

  // Approve img1 before publishing via updateProperty (simulating admin Publish action)
  const published = await service.updateProperty(draft.id, {
    ...draft,
    visibility: 'Published',
    isArchived: false,
    images: [{...draft.images[0], isApprovedPublic: true}, draft.images[1]],
  });

  assert.equal(published.visibility, 'Published');
  assert.ok(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-001/images/cover.webp'));
  assert.ok(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-001/documents/brochure.pdf'));
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-001/images/survey.webp'), false);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-001/documents/tct.pdf'), false);

  // Unnecessary duplicate private copies for promoted items are cleaned up, while private-only files stay intact
  assert.equal(mock.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-P1-001/images/cover.webp'), false);
  assert.equal(mock.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-P1-001/documents/brochure.pdf'), false);
  assert.ok(mock.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-P1-001/images/survey.webp'));
  assert.ok(mock.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-P1-001/documents/tct.pdf'));

  // Test direct Published creation ordering & clean private deduplication
  const mockDirect = createPhase1MockSupabase();
  const serviceDirect = createPropertyService(() => mockDirect.client);
  const directCover = seedPrivateImage(mockDirect, 'LOT-P1-002/images/main.webp', 'Main', true, 0, true);
  const createdPub = await serviceDirect.createProperty(
    buildPropertyInput({
      lotId: 'LOT-P1-002',
      visibility: 'Published',
      images: [directCover],
    })
  );
  assert.equal(createdPub.images[0].storageBucket, PUBLIC_MEDIA_BUCKET);
  assert.ok(mockDirect.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-002/images/main.webp'));
  assert.equal(mockDirect.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-P1-002/images/main.webp'), false);
});

test('5, 6 & 14. Unpublishing and Archiving verify private backup BEFORE deleting public objects and physically revoke public URLs', async () => {
  const mock = createPhase1MockSupabase();
  const service = createPropertyService(() => mock.client);
  const cover = seedPrivateImage(mock, 'LOT-P1-003/images/cover.webp', 'Cover', true, 0, true);
  const docPub = seedPrivateDoc(mock, 'LOT-P1-003/documents/brochure.pdf', 'Public');

  const pub = await service.createProperty(
    buildPropertyInput({
      lotId: 'LOT-P1-003',
      visibility: 'Published',
      images: [cover],
      documents: [docPub],
    })
  );
  assert.ok(await verifyObjectExistsInBucket(PUBLIC_MEDIA_BUCKET, 'LOT-P1-003/images/cover.webp', mock.client));

  mock.operationLog.length = 0;
  const drafted = await service.setVisibility(pub.id, 'Draft');
  assert.equal(drafted?.visibility, 'Draft');
  assert.equal(
    await verifyObjectExistsInBucket(PUBLIC_MEDIA_BUCKET, 'LOT-P1-003/images/cover.webp', mock.client),
    false,
    'Public image must be physically removed after unpublishing'
  );
  assert.equal(
    await verifyObjectExistsInBucket(PUBLIC_MEDIA_BUCKET, 'LOT-P1-003/documents/brochure.pdf', mock.client),
    false
  );
  assert.ok(
    await verifyObjectExistsInBucket(PRIVATE_MEDIA_BUCKET, 'LOT-P1-003/images/cover.webp', mock.client),
    'Verified private backup must exist after unpublishing'
  );

  // Confirm backup upload ran strictly BEFORE public removal
  const backupIdx = mock.operationLog.indexOf(
    `storage.upload:${PRIVATE_MEDIA_BUCKET}:LOT-P1-003/images/cover.webp`
  );
  const removeIdx = mock.operationLog.indexOf(
    `storage.remove:${PUBLIC_MEDIA_BUCKET}:LOT-P1-003/images/cover.webp,LOT-P1-003/documents/brochure.pdf`
  );
  assert.ok(backupIdx >= 0 && removeIdx > backupIdx);

  // Re-publish then Archive
  const republished = await service.updateProperty(pub.id, {
    ...(drafted as PropertyInput),
    visibility: 'Published',
    isArchived: false,
    images: [{...(drafted as Property).images[0], isApprovedPublic: true}],
  });
  assert.ok(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-003/images/cover.webp'));

  const archived = await service.setVisibility(republished.id, 'Archived');
  assert.equal(archived?.visibility, 'Archived');
  assert.equal(archived?.isArchived, true);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].size, 0);
  assert.ok(mock.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-P1-003/images/cover.webp'));
});

test('7 & 8. Replacing cover image, adding/reordering gallery photos, and removing images keeps cover first and cleans orphans', async () => {
  const mock = createPhase1MockSupabase();
  const service = createPropertyService(() => mock.client);
  const oldCover = seedPrivateImage(mock, 'LOT-P1-004/images/old-cover.webp', 'Old', true, 0, true);
  const second = seedPrivateImage(mock, 'LOT-P1-004/images/second.webp', 'Second', false, 1, true);

  const created = await service.createProperty(
    buildPropertyInput({
      lotId: 'LOT-P1-004',
      visibility: 'Published',
      images: [oldCover, second],
    })
  );

  // Add a third photo and promote it to cover while removing oldCover
  const newCover = seedPrivateImage(mock, 'LOT-P1-004/images/new-cover.webp', 'New Cover', true, 0, true);
  const reordered = sortImagesCoverFirst([
    {...created.images[1], isCover: false, sortOrder: 1},
    newCover,
  ]);
  assert.equal(reordered[0].storagePath, 'LOT-P1-004/images/new-cover.webp');
  assert.equal(reordered[0].isCover, true);
  assert.equal(reordered[1].isCover, false);

  const updated = await service.updateProperty(created.id, {
    ...created,
    images: reordered,
  });

  assert.equal(updated.images[0].storagePath, 'LOT-P1-004/images/new-cover.webp');
  assert.equal(updated.images[0].isCover, true);
  assert.equal(updated.photos[0], updated.images[0].url);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-004/images/old-cover.webp'), false);
  assert.equal(mock.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-P1-004/images/old-cover.webp'), false);
  assert.ok(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-004/images/new-cover.webp'));
  assert.ok(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-004/images/second.webp'));
});

test('9 & 10. Unauthorized visitors cannot view Drafts, unapproved images, or Private documents', async () => {
  const mock = createPhase1MockSupabase();
  const service = createPropertyService(() => mock.client);
  const pubImg = seedPrivateImage(mock, 'LOT-P1-005/images/pub.webp', 'Public View', true, 0, true);
  const privImg = seedPrivateImage(mock, 'LOT-P1-005/images/priv.webp', 'Private Survey', false, 1, false);
  const privDoc = seedPrivateDoc(mock, 'LOT-P1-005/documents/tct.pdf', 'Private');

  const prop = await service.createProperty(
    buildPropertyInput({
      lotId: 'LOT-P1-005',
      visibility: 'Published',
      images: [pubImg, privImg],
      documents: [privDoc],
    })
  );

  // Public visitor gallery slides exclude unapproved images
  const buyerSlides = buildPropertyGallerySlides(prop, {isPreviewAllowed: false});
  assert.equal(buyerSlides.length, 1);
  assert.equal(buyerSlides[0].caption, 'Public View');

  // Admin preview slides include all images
  const adminSlides = buildPropertyGallerySlides(prop, {isPreviewAllowed: true});
  assert.equal(adminSlides.length, 2);

  // Public visitor cannot obtain Private document URL
  await assert.rejects(() => getAuthorizedDocumentDownloadUrl(privDoc, false), /Unauthorized/);

  // Draft property returns 0 slides for non-admin
  const draftProp = {...prop, visibility: 'Draft' as const};
  assert.equal(buildPropertyGallerySlides(draftProp, {isPreviewAllowed: false}).length, 0);
});

test('11 & 12. DB failures, missing private backup, and Storage deletion retry behavior recover safely', async () => {
  // Simulate failed private backup upload during unpublish: must abort BEFORE DB change or public delete
  const mockBackupFail = createPhase1MockSupabase({
    failPrivateBackupUploadPath: 'LOT-P1-006/images/cover.webp',
  });
  const svcBackup = createPropertyService(() => mockBackupFail.client);
  const cover = seedPrivateImage(mockBackupFail, 'LOT-P1-006/images/cover.webp', 'Cover', true, 0, true);
  const pub = await svcBackup.createProperty(
    buildPropertyInput({lotId: 'LOT-P1-006', visibility: 'Published', images: [cover]})
  );

  await assert.rejects(() => svcBackup.setVisibility(pub.id, 'Draft'), /Simulated private backup/);
  assert.equal(mockBackupFail.tables.properties[0].visibility, 'Published');
  assert.ok(mockBackupFail.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-P1-006/images/cover.webp'));

  // Simulate public upload failure during createProperty -> cleans Draft row cleanly
  const mockUpFail = createPhase1MockSupabase({
    failPublicUploadPath: 'LOT-P1-007/images/cover.webp',
  });
  const svcUpFail = createPropertyService(() => mockUpFail.client);
  const coverUp = seedPrivateImage(mockUpFail, 'LOT-P1-007/images/cover.webp', 'Cover', true, 0, true);
  await assert.rejects(
    () =>
      svcUpFail.createProperty(
        buildPropertyInput({lotId: 'LOT-P1-007', visibility: 'Published', images: [coverUp]})
      ),
    /Failed to promote approved image/
  );
  assert.equal(mockUpFail.tables.properties.length, 0);
  assert.equal(mockUpFail.buckets[PUBLIC_MEDIA_BUCKET].size, 0);

  // Storage deletion failure reports clearly, and 404/Object not found on retry is idempotent
  const mockRm = createPhase1MockSupabase();
  await assert.doesNotReject(() =>
    removeStoragePathsFromBucket(PUBLIC_MEDIA_BUCKET, ['LOT-P1-007/images/already-gone.webp'], mockRm.client)
  );

  const mockRealErr = createPhase1MockSupabase({failPublicRemove: 'Storage policy denied'});
  mockRealErr.buckets[PUBLIC_MEDIA_BUCKET].set('LOT-P1-007/images/locked.webp', {
    bytes: 'data',
    contentType: 'image/webp',
  });
  await assert.rejects(
    () =>
      removeStoragePathsFromBucket(PUBLIC_MEDIA_BUCKET, ['LOT-P1-007/images/locked.webp'], mockRealErr.client),
    /Failed to remove 1 storage file\(s\) from property-media-public/
  );

  // Missing public AND missing private backup must fail loudly in ensurePrivateBackupFromPublicBucket
  await assert.rejects(
    () => ensurePrivateBackupFromPublicBucket('LOT-MISSING/images/none.webp', 'image/webp', mockRm.client),
    /Failed to back up published file/
  );
});

test('13. Cross-record reference protection prevents deleting shared Storage files, and external image URLs are rejected', async () => {
  // Issue E: Reject arbitrary external image URLs without storagePath
  assert.throws(
    () =>
      validateImageEntriesForStorage(
        [
          {
            id: 'ext-1',
            url: 'https://evil.example.com/photo.jpg',
            caption: 'External',
            isCover: true,
            sortOrder: 0,
            isApprovedPublic: true,
            storageBucket: PUBLIC_MEDIA_BUCKET,
            storagePath: '',
          },
        ],
        true
      ),
    /External image URLs are not permitted/
  );

  // Issue D: Shared storagePath used by Property A and Property B
  const mock = createPhase1MockSupabase();
  const service = createPropertyService(() => mock.client);
  const sharedPath = 'SHARED/images/aerial.webp';

  const imgA = seedPrivateImage(mock, sharedPath, 'Lot A', true, 0, true);
  const propA = await service.createProperty(
    buildPropertyInput({lotId: 'LOT-P1-A', visibility: 'Published', images: [imgA]})
  );

  // Seed same path for Property B (simulating a duplicated listing referencing the same Storage object)
  mock.buckets[PRIVATE_MEDIA_BUCKET].set(sharedPath, {bytes: 'shared', contentType: 'image/webp'});
  const imgB: PropertyImageItem = {
    id: 'img-b',
    url: 'https://signed.example.invalid/shared',
    caption: 'Lot B',
    isCover: true,
    sortOrder: 0,
    isApprovedPublic: true,
    storageBucket: PRIVATE_MEDIA_BUCKET,
    storagePath: sharedPath,
  };
  const propB = await service.createProperty(
    buildPropertyInput({lotId: 'LOT-P1-B', visibility: 'Published', images: [imgB]})
  );

  // Delete Property A -> sharedPath MUST remain in property-media-public because Property B still references it!
  await service.deleteProperty(propA.id);
  assert.ok(
    mock.buckets[PUBLIC_MEDIA_BUCKET].has(sharedPath),
    'Shared Storage object referenced by Property B must NOT be deleted when Property A is deleted'
  );

  // Now delete Property B -> sharedPath has 0 references left and must be deleted cleanly
  await service.deleteProperty(propB.id);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].has(sharedPath), false);
});

test('15. Image processor parameters, canonical QR URLs, README CDN caveat, and clean repo verification', () => {
  assert.equal(selectTargetOutputMime(true), 'image/webp');
  assert.equal(selectTargetOutputMime(false), 'image/jpeg');
  assert.equal(MAX_IMAGE_DIMENSION, 1920);
  assert.equal(TARGET_MAX_IMAGE_BYTES, 500 * 1024);

  const scaled = calculateScaledDimensions(4000, 3000);
  assert.equal(scaled.width, 1920);
  assert.equal(scaled.height, 1440);

  const fp1 = computeFileFingerprint({
    name: 'Frontage.JPG',
    size: 123456,
    lastModified: 1700000000,
    type: 'image/jpeg',
  });
  const fp2 = computeFileFingerprint({
    name: 'frontage.jpg',
    size: 123456,
    lastModified: 1700000000,
    type: 'image/jpeg',
  });
  assert.equal(fp1, fp2);

  assert.equal(
    buildCanonicalPropertyUrl('https://benmicuborealestate.pages.dev', 'LOT-001'),
    'https://benmicuborealestate.pages.dev/property/LOT-001'
  );

  const readme = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
  assert.match(readme, /Cache-Control/i);
  assert.equal(/GOOGLE_SERVICE_ACCOUNT/.test(readme), false);
});
