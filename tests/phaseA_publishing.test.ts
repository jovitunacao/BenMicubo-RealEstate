import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPropertyService,
  type SupabaseClientLike,
} from '../src/services/propertyService';
import {
  PRIVATE_MEDIA_BUCKET,
  PUBLIC_MEDIA_BUCKET,
} from '../src/services/storageService';
import {DEMO_PROPERTIES} from '../src/data/demoProperties';
import type {PropertyDocumentItem, PropertyImageItem, PropertyInput} from '../src/types/property';

interface FailureFlags {
  failPropertyInsert?: string;
  failPropertyUpdate?: string;
  failPropertyDelete?: string;
  failImagesInsert?: string;
  failPublicUploadPath?: string;
  failPublicRemove?: string;
}

function createStatefulMockSupabase(failures: FailureFlags = {}) {
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
      onfulfilled?: ((value: {data: unknown; error: {message: string} | null}) => TResult1 | PromiseLike<TResult1>) | null,
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
          }
          return {data: null, error: null};
        }

        // select
        const rows = tables[this.table]
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
            if (!entry) return {data: null, error: {message: 'Not found'}};
            return {
              data: new Blob([entry.bytes], {type: entry.contentType}),
              error: null,
            };
          },
          async upload(path: string, blob: Blob, opts?: {contentType?: string}) {
            operationLog.push(`storage.upload:${bucket}:${path}`);
            if (
              bucket === PUBLIC_MEDIA_BUCKET &&
              failures.failPublicUploadPath === path
            ) {
              return {data: null, error: {message: 'Simulated public upload failure'}};
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

  return {client, buckets, tables, operationLog};
}

function buildValidPublishedInput(
  images: PropertyImageItem[],
  documents: PropertyDocumentItem[] = []
): PropertyInput {
  const base = DEMO_PROPERTIES[0];
  const {id: _id, updatedAt: _u, ...rest} = base;
  return {
    ...rest,
    lotId: 'LOT-PHASE-A',
    visibility: 'Published',
    isArchived: false,
    agentName: 'Ben Micubo',
    agentPhone: '+63 917 888 1234',
    agentWhatsapp: '639178881234',
    agentMessenger: 'benmicubo.ph',
    images,
    photos: images.map((i) => i.url),
    documents,
  };
}

test('Phase A: createProperty as Published inserts DB row BEFORE promoting approved media and never touches public Storage on DB failure', async () => {
  const mockFail = createStatefulMockSupabase({
    failPropertyInsert: 'duplicate key value violates unique constraint',
  });
  mockFail.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-PHASE-A/images/cover.webp', {
    bytes: 'cover-bytes',
    contentType: 'image/webp',
  });

  const serviceFail = createPropertyService(() => mockFail.client);
  const input = buildValidPublishedInput([
    {
      id: 'img-1',
      url: 'https://signed.example.invalid/cover.webp',
      caption: 'Frontage',
      isCover: true,
      sortOrder: 0,
      isApprovedPublic: true,
      storageBucket: PRIVATE_MEDIA_BUCKET,
      storagePath: 'LOT-PHASE-A/images/cover.webp',
    },
  ]);

  await assert.rejects(() => serviceFail.createProperty(input), /duplicate key/);
  assert.equal(mockFail.buckets[PUBLIC_MEDIA_BUCKET].size, 0);
  assert.equal(
    mockFail.operationLog.some((op) => op.startsWith(`storage.upload:${PUBLIC_MEDIA_BUCKET}`)),
    false
  );

  // Success path must insert properties row BEFORE promoting to property-media-public
  const mockOk = createStatefulMockSupabase();
  mockOk.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-PHASE-A/images/cover.webp', {
    bytes: 'cover-bytes',
    contentType: 'image/webp',
  });
  const serviceOk = createPropertyService(() => mockOk.client);
  const created = await serviceOk.createProperty(input);

  const insertPropIdx = mockOk.operationLog.indexOf('db.insert:properties');
  const uploadPubIdx = mockOk.operationLog.indexOf(
    `storage.upload:${PUBLIC_MEDIA_BUCKET}:LOT-PHASE-A/images/cover.webp`
  );
  assert.ok(insertPropIdx >= 0);
  assert.ok(uploadPubIdx > insertPropIdx, 'Property row must exist before public Storage promotion');
  assert.equal(created.images[0].storageBucket, PUBLIC_MEDIA_BUCKET);
  assert.ok(mockOk.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-PHASE-A/images/cover.webp'));
});

test('Phase A: createProperty rolls back newly promoted public Storage objects and property row when relation sync fails', async () => {
  const mock = createStatefulMockSupabase({
    failImagesInsert: 'Simulated property_images trigger error',
  });
  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-PHASE-A/images/cover.webp', {
    bytes: 'cover-bytes',
    contentType: 'image/webp',
  });

  const service = createPropertyService(() => mock.client);
  const input = buildValidPublishedInput([
    {
      id: 'img-1',
      url: 'https://signed.example.invalid/cover.webp',
      caption: 'Frontage',
      isCover: true,
      sortOrder: 0,
      isApprovedPublic: true,
      storageBucket: PRIVATE_MEDIA_BUCKET,
      storagePath: 'LOT-PHASE-A/images/cover.webp',
    },
  ]);

  await assert.rejects(() => service.createProperty(input), /Simulated property_images trigger error/);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].size, 0, 'Promoted object must be cleaned up on failure');
  assert.equal(mock.tables.properties.length, 0, 'Failed property row must be rolled back');
  assert.ok(mock.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-PHASE-A/images/cover.webp'));
});

test('Phase A: updateProperty promotes only approved media after DB update, preserves private media, and rolls back cleanly on failure', async () => {
  const mock = createStatefulMockSupabase();
  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-PHASE-A/images/cover.webp', {
    bytes: 'cover-bytes',
    contentType: 'image/webp',
  });
  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-PHASE-A/images/internal.webp', {
    bytes: 'internal-bytes',
    contentType: 'image/webp',
  });
  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-PHASE-A/documents/tct.pdf', {
    bytes: 'pdf-bytes',
    contentType: 'application/pdf',
  });

  const service = createPropertyService(() => mock.client);
  const draftInput: PropertyInput = {
    ...buildValidPublishedInput([
      {
        id: 'img-cover',
        url: 'https://signed.example.invalid/cover.webp',
        caption: 'Cover',
        isCover: true,
        sortOrder: 0,
        isApprovedPublic: false,
        storageBucket: PRIVATE_MEDIA_BUCKET,
        storagePath: 'LOT-PHASE-A/images/cover.webp',
      },
      {
        id: 'img-priv',
        url: 'https://signed.example.invalid/internal.webp',
        caption: 'Internal Boundary Survey',
        isCover: false,
        sortOrder: 1,
        isApprovedPublic: false,
        storageBucket: PRIVATE_MEDIA_BUCKET,
        storagePath: 'LOT-PHASE-A/images/internal.webp',
      },
    ], [
      {
        id: 'doc-priv',
        title: 'Owner TCT',
        category: 'Title Document',
        visibility: 'Private',
        storageBucket: PRIVATE_MEDIA_BUCKET,
        storagePath: 'LOT-PHASE-A/documents/tct.pdf',
        fileName: 'tct.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 1024,
        uploadedAt: '2026-01-01T00:00:00.000Z',
      },
    ]),
    visibility: 'Draft',
  };

  const createdDraft = await service.createProperty(draftInput);
  assert.equal(mock.buckets[PUBLIC_MEDIA_BUCKET].size, 0);

  // Now simulate failure during relation sync when publishing via updateProperty
  const failingMock = createStatefulMockSupabase({
    failImagesInsert: 'Simulated DB relation failure',
  });
  failingMock.tables.properties = structuredClone(mock.tables.properties);
  failingMock.tables.property_images = structuredClone(mock.tables.property_images);
  failingMock.tables.property_documents = structuredClone(mock.tables.property_documents);
  failingMock.buckets[PRIVATE_MEDIA_BUCKET] = new Map(mock.buckets[PRIVATE_MEDIA_BUCKET]);

  const failingService = createPropertyService(() => failingMock.client);
  await assert.rejects(
    () =>
      failingService.updateProperty(createdDraft.id, {
        ...draftInput,
        visibility: 'Published',
        images: [
          {...draftInput.images[0], isApprovedPublic: true},
          draftInput.images[1],
        ],
      }),
    /Simulated DB relation failure/
  );

  // Public bucket must be empty and Draft row must be restored
  assert.equal(failingMock.buckets[PUBLIC_MEDIA_BUCKET].size, 0);
  assert.equal(failingMock.tables.properties[0].visibility, 'Draft');
  assert.equal(failingMock.tables.property_images.length, 2);

  // Now succeed publishing via updateProperty
  const published = await service.updateProperty(createdDraft.id, {
    ...draftInput,
    visibility: 'Published',
    images: [
      {...draftInput.images[0], isApprovedPublic: true},
      draftInput.images[1],
    ],
  });

  assert.equal(published.visibility, 'Published');
  assert.ok(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-PHASE-A/images/cover.webp'));
  assert.equal(
    mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-PHASE-A/images/internal.webp'),
    false,
    'Unapproved image must stay out of public bucket'
  );
  assert.equal(
    mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-PHASE-A/documents/tct.pdf'),
    false,
    'Private document must stay out of public bucket'
  );
});

test('Phase A: unpublishing via updateProperty or setVisibility never deletes public Storage if DB update fails, and cleans up after commit', async () => {
  const mock = createStatefulMockSupabase();
  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-PHASE-A/images/cover.webp', {
    bytes: 'cover-bytes',
    contentType: 'image/webp',
  });

  const service = createPropertyService(() => mock.client);
  const published = await service.createProperty(
    buildValidPublishedInput([
      {
        id: 'img-1',
        url: 'https://signed.example.invalid/cover.webp',
        caption: 'Cover',
        isCover: true,
        sortOrder: 0,
        isApprovedPublic: true,
        storageBucket: PRIVATE_MEDIA_BUCKET,
        storagePath: 'LOT-PHASE-A/images/cover.webp',
      },
    ])
  );
  assert.ok(mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-PHASE-A/images/cover.webp'));

  // Simulate DB failure when trying to unpublish via setVisibility('Archived')
  const failUnpubMock = createStatefulMockSupabase({
    failPropertyUpdate: 'Simulated network timeout during unpublish',
  });
  failUnpubMock.tables.properties = structuredClone(mock.tables.properties);
  failUnpubMock.tables.property_images = structuredClone(mock.tables.property_images);
  failUnpubMock.buckets[PUBLIC_MEDIA_BUCKET] = new Map(mock.buckets[PUBLIC_MEDIA_BUCKET]);
  failUnpubMock.buckets[PRIVATE_MEDIA_BUCKET] = new Map(mock.buckets[PRIVATE_MEDIA_BUCKET]);

  const failUnpubService = createPropertyService(() => failUnpubMock.client);
  await assert.rejects(
    () => failUnpubService.setVisibility(published.id, 'Archived'),
    /Simulated network timeout/
  );
  assert.ok(
    failUnpubMock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-PHASE-A/images/cover.webp'),
    'Live published Storage object must NOT be deleted when DB unpublish fails'
  );

  // Now unpublish cleanly
  mock.operationLog.length = 0;
  const archived = await service.setVisibility(published.id, 'Archived');
  assert.equal(archived?.visibility, 'Archived');
  assert.equal(archived?.isArchived, true);
  assert.equal(
    mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-PHASE-A/images/cover.webp'),
    false,
    'Previously published object must be physically removed from public Storage after unpublish'
  );
  assert.ok(
    mock.buckets[PRIVATE_MEDIA_BUCKET].has('LOT-PHASE-A/images/cover.webp'),
    'Private backup must remain intact'
  );

  const dbUpdateIdx = mock.operationLog.indexOf('db.update:properties');
  const pubRemoveIdx = mock.operationLog.indexOf(
    `storage.remove:${PUBLIC_MEDIA_BUCKET}:LOT-PHASE-A/images/cover.webp`
  );
  assert.ok(dbUpdateIdx >= 0);
  assert.ok(pubRemoveIdx > dbUpdateIdx, 'Public Storage removal must happen AFTER DB unpublish commit');
});

test('Phase A: deleteProperty deletes DB record first so failed deletes do not destroy Storage blobs', async () => {
  const mock = createStatefulMockSupabase({
    failPropertyDelete: 'Permission denied',
  });
  mock.buckets[PRIVATE_MEDIA_BUCKET].set('LOT-PHASE-A/images/cover.webp', {
    bytes: 'cover-bytes',
    contentType: 'image/webp',
  });
  const service = createPropertyService(() => mock.client);
  const created = await service.createProperty(
    buildValidPublishedInput([
      {
        id: 'img-1',
        url: 'https://signed.example.invalid/cover.webp',
        caption: 'Cover',
        isCover: true,
        sortOrder: 0,
        isApprovedPublic: true,
        storageBucket: PRIVATE_MEDIA_BUCKET,
        storagePath: 'LOT-PHASE-A/images/cover.webp',
      },
    ])
  );

  await assert.rejects(() => service.deleteProperty(created.id), /Permission denied/);
  assert.ok(
    mock.buckets[PUBLIC_MEDIA_BUCKET].has('LOT-PHASE-A/images/cover.webp'),
    'Failed DB delete must not delete public Storage blobs'
  );

  // Clear delete error and confirm cleanup removes both buckets
  const okMock = createStatefulMockSupabase();
  okMock.tables.properties = structuredClone(mock.tables.properties);
  okMock.tables.property_images = structuredClone(mock.tables.property_images);
  okMock.buckets[PUBLIC_MEDIA_BUCKET] = new Map(mock.buckets[PUBLIC_MEDIA_BUCKET]);
  okMock.buckets[PRIVATE_MEDIA_BUCKET] = new Map(mock.buckets[PRIVATE_MEDIA_BUCKET]);

  const okService = createPropertyService(() => okMock.client);
  await okService.deleteProperty(created.id);
  assert.equal(okMock.tables.properties.length, 0);
  assert.equal(okMock.buckets[PUBLIC_MEDIA_BUCKET].size, 0);
  assert.equal(okMock.buckets[PRIVATE_MEDIA_BUCKET].size, 0);
});
