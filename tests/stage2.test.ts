import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {buildCanonicalPropertyUrl, validateCanonicalSiteUrl} from '../src/utils/siteUrl';
import {computeTotalPrice, generateNextLotId} from '../src/utils/format';
import {
  filterPublicDocuments,
  isPropertyPubliclyVisible,
  propertyService,
  validatePropertyForPublish,
} from '../src/services/propertyService';
import {DEMO_PROPERTIES} from '../src/data/demoProperties';
import type {PropertyDocumentItem, PropertyInput} from '../src/types/property';

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

test('Canonical production URL validation blocks localhost, http, and preview domains', () => {
  assert.equal(validateCanonicalSiteUrl('').valid, false);
  assert.equal(validateCanonicalSiteUrl('http://benmicuborealestate.com').valid, false);
  assert.equal(validateCanonicalSiteUrl('https://localhost:3000').valid, false);
  assert.equal(validateCanonicalSiteUrl('https://127.0.0.1:8788').valid, false);
  assert.equal(
    validateCanonicalSiteUrl('https://ais-dev-demo-123.asia-east1.run.app').valid,
    false
  );

  const validCheck = validateCanonicalSiteUrl(`${PRODUCTION_SITE_URL}/`);
  assert.equal(validCheck.valid, true);
  assert.equal(validCheck.normalizedUrl, PRODUCTION_SITE_URL);
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
  // Attempt to mutate lotId in payload to verify backend/service locks existing lotId
  const mutatedInput: PropertyInput = {
    ...rest,
    lotId: 'LOT-999-SHOULD-BE-IGNORED',
    priceTotalPhp: target.priceTotalPhp + 500000,
    status: 'Sold',
    description: 'Updated price and marked Sold while keeping permanent QR board active.',
  };

  const updated = await propertyService.updateProperty(id, mutatedInput);
  assert.equal(updated.lotId, target.lotId);
  assert.equal(updated.status, 'Sold');
  assert.equal(updated.priceTotalPhp, target.priceTotalPhp + 500000);
  assert.equal(
    buildCanonicalPropertyUrl(PRODUCTION_SITE_URL, updated.lotId),
    originalUrl
  );
  // Sold + Published remains publicly accessible at /property/{lotId}
  assert.equal(isPropertyPubliclyVisible(updated), true);
});

test('Publishing validation blocks empty or non-production URLs and missing required fields', () => {
  const sample = DEMO_PROPERTIES[0];
  const {id: _id, updatedAt: _u, ...validInput} = sample;

  assert.ok(validatePropertyForPublish(validInput, 'https://localhost:3000').length > 0);
  assert.ok(validatePropertyForPublish(validInput, '').length > 0);
  assert.equal(validatePropertyForPublish(validInput, PRODUCTION_SITE_URL).length, 0);

  const missingPhotos: PropertyInput = {...validInput, images: [], photos: []};
  assert.ok(validatePropertyForPublish(missingPhotos, PRODUCTION_SITE_URL).length > 0);
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
