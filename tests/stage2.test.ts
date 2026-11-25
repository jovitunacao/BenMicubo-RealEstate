import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import QRCode from 'qrcode';
import {
  buildCanonicalPropertyUrl,
  buildDistributableQrUrl,
  getEffectiveCanonicalSiteUrl,
  validateCanonicalSiteUrl,
} from '../src/utils/siteUrl';
import {computeTotalPrice, generateNextLotId, getPropertyPermalink} from '../src/utils/format';
import {
  filterPublicDocuments,
  isPropertyPubliclyVisible,
  prepareDocumentsForVisibility,
  prepareImagesForVisibility,
  propertyService,
  validatePropertyForPublish,
} from '../src/services/propertyService';
import {DEFAULT_SITE_SETTINGS, DEMO_PROPERTIES} from '../src/data/demoProperties';
import type {PropertyDocumentItem, PropertyImageItem, PropertyInput} from '../src/types/property';
import {
  extractGoogleDriveFileId,
  extractYouTubeVideoId,
  isValidPropertyVideoUrl,
  parsePropertyVideoUrl,
} from '../src/utils/video';
import {
  getAuthorizedDocumentDownloadUrl,
  MAX_PRIVATE_FILE_BYTES,
  MAX_PUBLIC_FILE_BYTES,
  PRIVATE_MEDIA_BUCKET,
  PUBLIC_MEDIA_BUCKET,
  resolveDocumentUploadBucket,
  resolveImageUploadBucket,
  validateDocumentFile,
} from '../src/services/storageService';

// Provide minimal in-memory localStorage shim for Node test runner
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

const PRODUCTION_SITE_URL = 'https://benmicuborealestate.pages.dev';

test('Canonical production URL validation and QR target builder block localhost, http, and preview domains', () => {
  assert.equal(validateCanonicalSiteUrl('').valid, false);
  assert.equal(validateCanonicalSiteUrl('http://benmicuborealestate.com').valid, false);
  assert.equal(validateCanonicalSiteUrl('https://localhost:3000').valid, false);
  assert.equal(validateCanonicalSiteUrl('https://127.0.0.1:8788').valid, false);
  assert.equal(
    validateCanonicalSiteUrl('https://ais-dev-demo-123.asia-east1.run.app').valid,
    false
  );
  assert.equal(
    validateCanonicalSiteUrl('https://ais-pre-demo-123.us-central1.run.app').valid,
    false
  );
  assert.equal(
    validateCanonicalSiteUrl('https://preview-123.webcontainer.io').valid,
    false
  );

  // Distributable QR URL must return null when URL is missing or temporary/dev
  assert.equal(buildDistributableQrUrl('', 'LOT-001'), null);
  assert.equal(buildDistributableQrUrl('https://localhost:3000', 'LOT-001'), null);
  assert.equal(
    buildDistributableQrUrl('https://ais-dev-demo.asia-east1.run.app', 'LOT-001'),
    null
  );

  const validCheck = validateCanonicalSiteUrl(`${PRODUCTION_SITE_URL}/`);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.normalizedUrl, PRODUCTION_SITE_URL);
  assert.equal(
    buildDistributableQrUrl(`${PRODUCTION_SITE_URL}/`, 'LOT-001'),
    `${PRODUCTION_SITE_URL}/property/LOT-001`
  );
  assert.equal(
    getPropertyPermalink('LOT-001', PRODUCTION_SITE_URL),
    `${PRODUCTION_SITE_URL}/property/LOT-001`
  );
  assert.equal(getEffectiveCanonicalSiteUrl(`${PRODUCTION_SITE_URL}/`), PRODUCTION_SITE_URL);
});

test('Two different properties generate distinct canonical URLs and distinct QR codes', async () => {
  const urlLot1 = buildCanonicalPropertyUrl(PRODUCTION_SITE_URL, 'LOT-001');
  const urlLot2 = buildCanonicalPropertyUrl(PRODUCTION_SITE_URL, 'LOT-002');

  assert.equal(urlLot1, `${PRODUCTION_SITE_URL}/property/LOT-001`);
  assert.equal(urlLot2, `${PRODUCTION_SITE_URL}/property/LOT-002`);
  assert.notEqual(urlLot1, urlLot2);

  const [svg1, svg2, png1, png2] = await Promise.all([
    QRCode.toString(urlLot1, {type: 'svg', errorCorrectionLevel: 'M'}),
    QRCode.toString(urlLot2, {type: 'svg', errorCorrectionLevel: 'M'}),
    QRCode.toDataURL(urlLot1, {width: 400, errorCorrectionLevel: 'M'}),
    QRCode.toDataURL(urlLot2, {width: 400, errorCorrectionLevel: 'M'}),
  ]);

  assert.notEqual(svg1, svg2);
  assert.notEqual(png1, png2);
});

test('Updating a property price, description, or Sold status preserves its permanent lotId and QR URL', async () => {
  const reset = propertyService.resetDemoData();
  const target = reset.properties[0];
  const originalUrl = buildCanonicalPropertyUrl(PRODUCTION_SITE_URL, target.lotId);

  const {id, updatedAt: _u, ...rest} = target;
  const baseTotalPrice = target.priceTotalPhp ?? 0;
  // Attempt to mutate lotId in payload to verify backend/service locks existing lotId
  const mutatedInput: PropertyInput = {
    ...rest,
    lotId: 'LOT-999-SHOULD-BE-IGNORED',
    priceTotalPhp: baseTotalPrice + 500000,
    status: 'Sold',
    description: 'Updated price and marked Sold while keeping permanent QR board active.',
  };

  const updated = await propertyService.updateProperty(id, mutatedInput);
  assert.equal(updated.lotId, target.lotId);
  assert.equal(updated.status, 'Sold');
  assert.equal(updated.priceTotalPhp, baseTotalPrice + 500000);
  assert.equal(
    buildCanonicalPropertyUrl(PRODUCTION_SITE_URL, updated.lotId),
    originalUrl
  );
  // Sold + Published remains publicly accessible at /property/{lotId}
  assert.equal(isPropertyPubliclyVisible(updated), true);
});

test('Property publishing works in dev/preview without VITE_PUBLIC_SITE_URL while enforcing required fields, photos, and real contact details', () => {
  const sample = DEMO_PROPERTIES[0];
  const {id: _id, updatedAt: _u, ...baseInput} = sample;
  const validInput: PropertyInput = {
    ...baseInput,
    agentName: 'Ben Micubo',
    agentPhone: '+63 917 888 1234',
    agentWhatsapp: '639178881234',
    agentMessenger: 'benmicubo.ph',
  };

  // Missing or dev canonical URLs must NOT block property publishing
  assert.equal(validatePropertyForPublish(validInput, '').length, 0);
  assert.equal(validatePropertyForPublish(validInput, 'https://localhost:3000').length, 0);
  assert.equal(validatePropertyForPublish(validInput, PRODUCTION_SITE_URL).length, 0);

  const missingPhotos: PropertyInput = {...validInput, images: [], photos: []};
  assert.ok(validatePropertyForPublish(missingPhotos, '').length > 0);

  // Missing or placeholder contact details must be rejected before publication
  const missingContacts: PropertyInput = {
    ...validInput,
    agentName: '',
    agentPhone: '',
    agentWhatsapp: '',
    agentMessenger: '',
  };
  assert.ok(validatePropertyForPublish(missingContacts, PRODUCTION_SITE_URL).length >= 3);

  const placeholderContacts: PropertyInput = {
    ...validInput,
    agentName: 'Rafael Mendoza',
    agentPhone: '+63 917 555 0142',
    agentWhatsapp: '639175550142',
    agentMessenger: 'benmicubo.realestate',
  };
  assert.ok(validatePropertyForPublish(placeholderContacts, PRODUCTION_SITE_URL).length >= 3);
});

test('Draft and Archived listings are hidden publicly, and Private documents are never exposed publicly', () => {
  assert.equal(isPropertyPubliclyVisible({visibility: 'Draft', isArchived: false}), false);
  assert.equal(isPropertyPubliclyVisible({visibility: 'Archived', isArchived: true}), false);
  assert.equal(isPropertyPubliclyVisible({visibility: 'Published', isArchived: false}), true);

  const docs: PropertyDocumentItem[] = [
    {
      id: 'd1',
      title: 'TCT Copy',
      category: 'Title Document',
      visibility: 'Private',
      storageBucket: 'property-media-private',
      storagePath: 'LOT-001/documents/tct.pdf',
      fileName: 'tct.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 120000,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'd2',
      title: 'Public Brochure',
      category: 'PDF Brochure',
      visibility: 'Public',
      storageBucket: 'property-media-public',
      storagePath: 'LOT-001/documents/brochure.pdf',
      fileName: 'brochure.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 85000,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const visibleDocs = filterPublicDocuments(docs);
  assert.equal(visibleDocs.length, 1);
  assert.equal(visibleDocs[0].id, 'd2');
});

test('Price calculation and next Lot ID generator work accurately', () => {
  assert.equal(computeTotalPrice(1200, 15000), 18000000);
  assert.equal(
    generateNextLotId([{lotId: 'LOT-001'}, {lotId: 'LOT-007'}, {lotId: 'LOT-003'}]),
    'LOT-008'
  );
});

test('YouTube regular, short, unlisted, and Shorts links are recognized and embedded safely', () => {
  const regular = parsePropertyVideoUrl('https://www.youtube.com/watch?v=LXb3EKWsInQ');
  const shortLink = parsePropertyVideoUrl('https://youtu.be/LXb3EKWsInQ?si=share123');
  const shorts = parsePropertyVideoUrl('https://www.youtube.com/shorts/LXb3EKWsInQ');

  assert.equal(regular?.provider, 'youtube');
  assert.equal(regular?.videoId, 'LXb3EKWsInQ');
  assert.equal(
    regular?.embedUrl,
    'https://www.youtube-nocookie.com/embed/LXb3EKWsInQ?autoplay=1&rel=0&modestbranding=1'
  );
  assert.equal(shortLink?.videoId, 'LXb3EKWsInQ');
  assert.equal(shorts?.videoId, 'LXb3EKWsInQ');
});

test('Google Drive video links are recognized and converted to /preview iframe URLs', () => {
  const shareUrl =
    'https://drive.google.com/file/d/1AbCDefGhIjKlMnOpQrStUvWxYz123456/view?usp=sharing';
  const openUrl =
    'https://drive.google.com/open?id=1AbCDefGhIjKlMnOpQrStUvWxYz123456';
  const previewUrl =
    'https://drive.google.com/file/d/1AbCDefGhIjKlMnOpQrStUvWxYz123456/preview';

  const parsedShare = parsePropertyVideoUrl(shareUrl);
  assert.equal(parsedShare?.provider, 'google_drive');
  assert.equal(parsedShare?.videoId, '1AbCDefGhIjKlMnOpQrStUvWxYz123456');
  assert.equal(parsedShare?.embedUrl, previewUrl);
  assert.equal(
    parsedShare?.canonicalUrl,
    'https://drive.google.com/file/d/1AbCDefGhIjKlMnOpQrStUvWxYz123456/view'
  );
  assert.equal(parsedShare?.thumbnailUrl, null);

  assert.equal(
    extractGoogleDriveFileId(openUrl),
    '1AbCDefGhIjKlMnOpQrStUvWxYz123456'
  );
  assert.equal(
    parsePropertyVideoUrl(previewUrl)?.embedUrl,
    previewUrl
  );
});

test('Invalid, non-provider, or arbitrary iframe URLs are rejected', async () => {
  const invalidUrls = [
    '',
    'not-a-url',
    'javascript:alert(1)',
    'https://evil.example.com/embed/video',
    'https://vimeo.com/123456789',
    'https://drive.google.com/drive/folders/1AbCDefGhIjKlMnOpQrStUvWxYz',
    'https://evil.com/youtube.com/watch?v=LXb3EKWsInQ',
    'LXb3EKWsInQ',
  ];

  for (const url of invalidUrls) {
    assert.equal(isValidPropertyVideoUrl(url), false, `Expected rejection for ${url}`);
    assert.equal(extractYouTubeVideoId(url), null);
    assert.equal(extractGoogleDriveFileId(url), null);
  }

  const reset = propertyService.resetDemoData();
  const target = reset.properties[0];
  const {id, updatedAt: _u, ...rest} = target;

  await assert.rejects(
    () =>
      propertyService.updateProperty(id, {
        ...rest,
        videos: [
          {
            id: 'bad-vid',
            sourceType: 'youtube',
            url: 'https://evil.example.com/iframe',
            title: 'Bad video',
            description: '',
            sortOrder: 0,
          },
        ],
      }),
    /Invalid video URL/
  );
});

test('Multiple YouTube and Google Drive videos persist on a property without altering lotId or QR URL', async () => {
  const reset = propertyService.resetDemoData();
  const target = reset.properties[0];
  const originalQrUrl = buildCanonicalPropertyUrl(PRODUCTION_SITE_URL, target.lotId);
  const {id, updatedAt: _u, ...rest} = target;

  const updated = await propertyService.updateProperty(id, {
    ...rest,
    videos: [
      {
        id: 'v-yt',
        sourceType: 'youtube',
        url: 'https://youtu.be/LXb3EKWsInQ',
        title: 'Aerial Drone Flight (YouTube)',
        description: '4K aerial flyover',
        sortOrder: 0,
      },
      {
        id: 'v-drive',
        sourceType: 'youtube', // Deliberately mismatched to confirm normalization sets 'google_drive'
        url: 'https://drive.google.com/file/d/1AbCDefGhIjKlMnOpQrStUvWxYz123456/view?usp=sharing',
        title: 'Road Frontage Drive Tour (Google Drive)',
        description: 'Unedited walkthrough video',
        sortOrder: 1,
      },
    ],
  });

  assert.equal(updated.lotId, target.lotId);
  assert.equal(
    buildCanonicalPropertyUrl(PRODUCTION_SITE_URL, updated.lotId),
    originalQrUrl
  );
  assert.equal(updated.videos.length, 2);
  assert.equal(updated.videos[0].sourceType, 'youtube');
  assert.equal(updated.videos[1].sourceType, 'google_drive');
});

test('Storage file validation enforces size/MIME restrictions and blocks unauthorized private document access', async () => {
  assert.doesNotThrow(() =>
    validateDocumentFile(
      {name: 'brochure.pdf', size: 2048, type: 'application/pdf'},
      'Public'
    )
  );
  assert.doesNotThrow(() =>
    validateDocumentFile(
      {
        name: 'deed.docx',
        size: 4096,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      'Private'
    )
  );

  assert.throws(
    () =>
      validateDocumentFile(
        {name: 'contract.docx', size: 4096, type: 'application/msword'},
        'Public'
      ),
    /Public documents must be PDF, JPG, PNG, or WebP/
  );
  assert.throws(
    () =>
      validateDocumentFile(
        {name: 'huge.pdf', size: MAX_PUBLIC_FILE_BYTES + 1, type: 'application/pdf'},
        'Public'
      ),
    /10 MB/
  );

  assert.throws(
    () =>
      validateDocumentFile(
        {name: 'payload.html', size: 1024, type: 'text/html'},
        'Private'
      ),
    /Private documents must be PDF, DOC, DOCX, JPG, PNG, or WebP/
  );
  assert.throws(
    () =>
      validateDocumentFile(
        {name: 'oversize.pdf', size: MAX_PRIVATE_FILE_BYTES + 1, type: 'application/pdf'},
        'Private'
      ),
    /20 MB/
  );

  const privateDoc: PropertyDocumentItem = {
    id: 'doc-priv',
    title: 'Owner TCT Copy',
    category: 'Title Document',
    visibility: 'Private',
    storageBucket: 'property-media-private',
    storagePath: 'LOT-001/documents/tct.pdf',
    fileName: 'tct.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 12000,
    dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ=',
    uploadedAt: '2026-01-01T00:00:00.000Z',
  };

  await assert.rejects(
    () => getAuthorizedDocumentDownloadUrl(privateDoc, false),
    /Unauthorized/
  );
  const adminUrl = await getAuthorizedDocumentDownloadUrl(privateDoc, true);
  assert.equal(adminUrl, privateDoc.dataUrl);
});

test('Buyer inquiry creation and status updates work cleanly in local service mode', async () => {
  propertyService.resetDemoData();
  const created = await propertyService.createInquiry({
    propertyLotId: 'LOT-001',
    propertyTitle: 'Sungay West Highland Ridge Lot',
    buyerName: 'Maria Santos',
    buyerEmail: 'maria.santos@example.ph',
    buyerPhone: '+63 917 123 4567',
    message: 'Requesting site tripping this Saturday morning.',
  });
  assert.equal(created.status, 'New');
  assert.equal(created.propertyLotId, 'LOT-001');

  await propertyService.updateInquiryStatus(created.id, 'Scheduled');
  const all = await propertyService.listInquiries();
  const found = all.find((item) => item.id === created.id);
  assert.equal(found?.status, 'Scheduled');
});

test('Consolidated fresh-install SQL migration and frontend queries pass security regression assertions', () => {
  const freshSql = readFileSync(
    join(process.cwd(), 'supabase/migrations/20261119_fresh_install.sql'),
    'utf8'
  );
  const schemaSql = readFileSync(join(process.cwd(), 'supabase/schema.sql'), 'utf8');
  const propertyServiceSrc = readFileSync(
    join(process.cwd(), 'src/services/propertyService.ts'),
    'utf8'
  );

  // 1. Consolidated script has no duplicate ALTER/DROP constraint patches
  assert.equal(/\badd constraint\b/i.test(freshSql), false);
  assert.equal(/\bdrop constraint if exists\b/i.test(freshSql), false);

  // 2. Zero placeholder agency contact details remain in SQL, defaults, or demo listings
  const forbiddenPlaceholders = ['555 0142', '5550142', '555 0188', '555 0195', 'Rafael Mendoza', 'benmicubo.realestate'];
  for (const token of forbiddenPlaceholders) {
    assert.equal(freshSql.includes(token), false, `Found placeholder "${token}" in fresh_install.sql`);
    assert.equal(schemaSql.includes(token), false, `Found placeholder "${token}" in schema.sql`);
  }
  assert.equal(DEFAULT_SITE_SETTINGS.defaultAgentName, '');
  assert.equal(DEFAULT_SITE_SETTINGS.defaultAgentPhone, '');
  assert.equal(DEFAULT_SITE_SETTINGS.defaultAgentWhatsapp, '');
  assert.equal(DEFAULT_SITE_SETTINGS.defaultAgentMessenger, '');
  for (const prop of DEMO_PROPERTIES) {
    assert.equal(prop.agentPhone, '');
    assert.equal(prop.agentWhatsapp, '');
    assert.equal(prop.agentMessenger, '');
  }

  // 3. Admin & trigger SECURITY DEFINER hardening and function EXECUTE lockdown
  assert.match(freshSql, /set search_path = pg_catalog, public/i);
  assert.match(freshSql, /revoke all on function public\.is_authorized_admin\(\) from public;/i);
  assert.match(freshSql, /revoke all on function public\.is_authorized_admin\(\) from anon;/i);
  assert.match(
    freshSql,
    /grant execute on function public\.is_authorized_admin\(\) to authenticated, service_role;/i
  );
  assert.match(
    freshSql,
    /revoke all on function public\.enforce_public_inquiry_defaults\(\) from anon, authenticated;/i
  );

  // 4. Inquiries column-level INSERT for BOTH anon & authenticated excludes id, status, created_at
  const grantMatch = freshSql.match(
    /grant insert\s*\(([\s\S]*?)\)\s*on public\.inquiries to anon, authenticated;/i
  );
  assert.ok(
    grantMatch,
    'Expected column-level INSERT grant on public.inquiries for both anon and authenticated'
  );
  const grantedCols = grantMatch[1];
  assert.equal(/\bid\b/.test(grantedCols), false);
  assert.equal(/\bstatus\b/.test(grantedCols), false);
  assert.equal(/\bcreated_at\b/.test(grantedCols), false);
  assert.match(freshSql, /grant select, update, delete on public\.inquiries to authenticated;/i);
  assert.equal(
    /grant select, insert, update, delete on public\.inquiries to authenticated;/i.test(freshSql),
    false
  );
  assert.match(freshSql, /create policy "Admin select inquiries"/i);
  assert.match(freshSql, /create policy "Admin update inquiries"/i);
  assert.match(freshSql, /create policy "Admin delete inquiries"/i);
  assert.match(freshSql, /property_lot_id is null\s+or exists/i);
  assert.match(freshSql, /p\.visibility = 'Published'\s+and p\.is_archived = false/i);

  // Frontend createInquiry payload must omit status/id/created_at for anon & authenticated column-level INSERT
  const createInquiryBlock = propertyServiceSrc.slice(
    propertyServiceSrc.indexOf('async createInquiry('),
    propertyServiceSrc.indexOf('async updateInquiryStatus(')
  );
  const supabaseInsertSection = createInquiryBlock.slice(
    0,
    createInquiryBlock.indexOf('if (error) throw new Error(error.message);')
  );
  assert.equal(/\bstatus\s*:/.test(supabaseInsertSection), false);

  // 5. Private document, unapproved image, unpublish demotion & Storage bucket isolation invariants
  assert.match(freshSql, /constraint property_images_bucket_public_check/i);
  assert.match(freshSql, /constraint property_documents_bucket_visibility_check/i);
  assert.match(freshSql, /constraint properties_published_contact_check/i);
  assert.match(freshSql, /create or replace function public\.enforce_media_public_scope\(\)/i);
  assert.match(freshSql, /create or replace function public\.demote_media_on_property_unpublish\(\)/i);
  assert.match(freshSql, /'property-media-private',\s*'property-media-private',\s*false,/i);
  assert.match(
    freshSql,
    /bucket_id = 'property-media-public'\s+and \(storage\.foldername\(name\)\)\[2\] in \('images', 'documents'\)/i
  );
  assert.match(freshSql, /pi\.is_approved_public = true/i);

  const storageServiceSrc = readFileSync(
    join(process.cwd(), 'src/services/storageService.ts'),
    'utf8'
  );
  assert.match(storageServiceSrc, /\.from\(PUBLIC_MEDIA_BUCKET\)\s*\.remove\(\[storagePath\]\)/);

  const rlsRegressionSql = readFileSync(
    join(process.cwd(), 'supabase/tests/rls_security_regression.sql'),
    'utf8'
  );
  assert.match(rlsRegressionSql, /foreach role_name in array array\['anon', 'authenticated'\]/i);
  assert.match(rlsRegressionSql, /set local role authenticated;/i);
  assert.match(rlsRegressionSql, /post_unpublish_obj_count/i);
});

test('Private documents and unapproved images never target public Storage, and unpublishing demotes all published media', async () => {
  // Unapproved images never target public Storage even on Published properties
  assert.equal(resolveImageUploadBucket(false, true), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolveImageUploadBucket(false, false), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolveImageUploadBucket(true, false), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolveImageUploadBucket(true, true), PUBLIC_MEDIA_BUCKET);

  // Private documents never target public Storage, and Draft documents stay in private Storage
  assert.equal(resolveDocumentUploadBucket('Private', true), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolveDocumentUploadBucket('Private', false), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolveDocumentUploadBucket('Public', false), PRIVATE_MEDIA_BUCKET);
  assert.equal(resolveDocumentUploadBucket('Public', true), PUBLIC_MEDIA_BUCKET);

  const sampleImages: PropertyImageItem[] = [
    {
      id: 'img-pub',
      url: 'https://example.invalid/pub.webp',
      caption: 'Approved',
      isCover: true,
      sortOrder: 0,
      isApprovedPublic: true,
      storageBucket: PUBLIC_MEDIA_BUCKET,
      storagePath: 'LOT-001/images/pub.webp',
    },
    {
      id: 'img-unapproved',
      url: 'https://example.invalid/priv.webp',
      caption: 'Internal survey',
      isCover: false,
      sortOrder: 1,
      isApprovedPublic: false,
      storageBucket: PUBLIC_MEDIA_BUCKET,
      storagePath: 'LOT-001/images/priv.webp',
    },
  ];

  // Publishing keeps unapproved image in private bucket
  const publishedImgs = await prepareImagesForVisibility(sampleImages, 'Published');
  assert.equal(publishedImgs[0].storageBucket, PUBLIC_MEDIA_BUCKET);
  assert.equal(publishedImgs[0].isApprovedPublic, true);
  assert.equal(publishedImgs[1].storageBucket, PRIVATE_MEDIA_BUCKET);
  assert.equal(publishedImgs[1].isApprovedPublic, false);

  // Unpublishing (Draft or Archived) demotes ALL images back to private bucket
  const draftedImgs = await prepareImagesForVisibility(publishedImgs, 'Draft');
  assert.equal(draftedImgs[0].storageBucket, PRIVATE_MEDIA_BUCKET);
  assert.equal(draftedImgs[0].isApprovedPublic, false);
  assert.equal(draftedImgs[1].storageBucket, PRIVATE_MEDIA_BUCKET);
  assert.equal(draftedImgs[1].isApprovedPublic, false);

  const sampleDocs: PropertyDocumentItem[] = [
    {
      id: 'doc-pub',
      title: 'Public Brochure',
      category: 'PDF Brochure',
      visibility: 'Public',
      storageBucket: PUBLIC_MEDIA_BUCKET,
      storagePath: 'LOT-001/documents/brochure.pdf',
      fileName: 'brochure.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 5000,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'doc-priv',
      title: 'Confidential TCT',
      category: 'Title Document',
      visibility: 'Private',
      storageBucket: PUBLIC_MEDIA_BUCKET,
      storagePath: 'LOT-001/documents/tct.pdf',
      fileName: 'tct.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 5000,
      uploadedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const publishedDocs = await prepareDocumentsForVisibility(sampleDocs, 'Published');
  assert.equal(publishedDocs[0].storageBucket, PUBLIC_MEDIA_BUCKET);
  assert.equal(publishedDocs[1].storageBucket, PRIVATE_MEDIA_BUCKET);

  const archivedDocs = await prepareDocumentsForVisibility(publishedDocs, 'Archived');
  assert.equal(archivedDocs[0].storageBucket, PRIVATE_MEDIA_BUCKET);
  assert.equal(archivedDocs[1].storageBucket, PRIVATE_MEDIA_BUCKET);
});



