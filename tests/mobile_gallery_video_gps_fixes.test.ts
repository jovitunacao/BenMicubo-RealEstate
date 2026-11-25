import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildPropertyGallerySlides, resolveNextGalleryIndex} from '../src/utils/gallery';
import {parsePropertyVideoUrl} from '../src/utils/video';
import {
  assessCoordinateLocationConsistency,
  haversineDistanceMeters,
  isLegacyPlaceholderCoordinate,
  parseGoogleMapsCoordinates,
  shouldRequireSyncConfirmation,
} from '../src/utils/googleMaps';
import type {Property} from '../src/types/property';

const ROOT_DIR = process.cwd();

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
}

function makeTestProperty(overrides: Partial<Property> = {}): Property {
  return {
    id: 'prop-test-1',
    lotId: 'LOT-001',
    title: 'Alta Mall',
    classification: 'Commercial',
    status: 'Available',
    visibility: 'Published',
    isFeatured: true,
    isArchived: false,
    barangay: 'Tetuan',
    city: 'Zamboanga City',
    province: 'Zamboanga del Sur',
    region: 'Zamboanga Peninsula (Region IX)',
    completeLocation: 'Tetuan, Zamboanga City, Zamboanga del Sur',
    lotAreaSqm: 2500,
    frontageLengthM: null,
    pricePerSqm: 25000,
    priceTotalPhp: 62500000,
    showSellingPrice: true,
    showPricePerSqm: true,
    isPriceManualOverride: false,
    isNegotiable: false,
    dimensions: '',
    boundaryDescription: 'Along national highway',
    roadAccess: 'Concrete highway frontage',
    utilities: 'Power & water available',
    terrain: 'Flat',
    nearbyLandmarks: 'Tetuan Commercial District',
    titleStatus: 'Clean TCT',
    taxDeclarationStatus: 'Updated',
    additionalRemarks: '',
    description: 'Prime commercial parcel in Zamboanga City.',
    highlights: ['Corner frontage'],
    photos: [],
    images: [
      {
        id: 'img-2',
        url: 'https://cdn.example.com/storage/v1/object/public/property-media-public/LOT-001/images/gallery-1.webp',
        caption: 'Side entrance',
        isCover: false,
        sortOrder: 1,
        isApprovedPublic: true,
        storageBucket: 'property-media-public',
        storagePath: 'LOT-001/images/gallery-1.webp',
      },
      {
        id: 'img-1',
        url: 'https://cdn.example.com/storage/v1/object/public/property-media-public/LOT-001/images/cover.webp',
        caption: 'Main facade',
        isCover: true,
        sortOrder: 0,
        isApprovedPublic: true,
        storageBucket: 'property-media-public',
        storagePath: 'LOT-001/images/cover.webp',
      },
      {
        id: 'img-priv',
        url: 'https://cdn.example.com/storage/v1/object/sign/property-media-private/LOT-001/images/survey.webp?token=expired',
        caption: 'Internal survey photo',
        isCover: false,
        sortOrder: 2,
        isApprovedPublic: false,
        storageBucket: 'property-media-private',
        storagePath: 'LOT-001/images/survey.webp',
      },
    ],
    youtubeUrl: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing',
    videos: [
      {
        id: 'vid-1',
        sourceType: 'google_drive',
        url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing',
        title: 'Site Walkthrough',
        description: 'Aerial & street tour',
        sortOrder: 0,
      },
    ],
    documents: [],
    presentations: [],
    latitude: 14.1228,
    longitude: 120.9856,
    googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=14.1228,120.9856',
    agentName: 'BEN MICUBO REAL ESTATE SERVICES',
    agentPhone: '+63 917 000 0000',
    agentWhatsapp: '639170000000',
    agentMessenger: 'benmicubo',
    updatedAt: '2026-11-20T00:00:00Z',
    ...overrides,
  };
}

test('Issue 1: Gallery slides preserve public/private isolation, cover order, and reuse URLs without duplicate downloads', () => {
  const prop = makeTestProperty();

  // Public viewer sees ONLY approved public images, cover first
  const publicSlides = buildPropertyGallerySlides(prop, {isPreviewAllowed: false});
  assert.equal(publicSlides.length, 2);
  assert.equal(publicSlides[0].id, 'img-1');
  assert.equal(publicSlides[1].id, 'img-2');
  assert.equal(publicSlides[0].thumbUrl, publicSlides[0].url);
  assert.equal(publicSlides[1].thumbUrl, publicSlides[1].url);
  assert.equal(
    publicSlides.some((s) => s.storageBucket === 'property-media-private'),
    false
  );

  // Authorized admin preview sees private image with storageBucket & storagePath for signed URL recovery
  const adminSlides = buildPropertyGallerySlides(prop, {isPreviewAllowed: true});
  assert.equal(adminSlides.length, 3);
  assert.equal(adminSlides[2].id, 'img-priv');
  assert.equal(adminSlides[2].storageBucket, 'property-media-private');
  assert.equal(adminSlides[2].storagePath, 'LOT-001/images/survey.webp');

  // Swipe index wraps cleanly
  assert.equal(resolveNextGalleryIndex(0, 2, -60), 1);
  assert.equal(resolveNextGalleryIndex(0, 2, 60), 1);
});

test('Issue 1: PropertyImage & PropertyDetailPage fix WebKit/Safari blank thumbnail race conditions', () => {
  const propertyImageSrc = readSrc('src/components/PropertyImage.tsx');
  const detailPageSrc = readSrc('src/pages/PropertyDetailPage.tsx');

  // Must not leave thumbnails permanently hidden with opacity-0 on Safari cache load
  assert.equal(propertyImageSrc.includes('opacity-0'), false);
  assert.ok(propertyImageSrc.includes('useLayoutEffect'));
  assert.ok(propertyImageSrc.includes('el.complete && el.naturalWidth > 0'));
  assert.ok(propertyImageSrc.includes('compact'));
  assert.ok(propertyImageSrc.includes('onRecoverSignedUrl'));

  // Thumbnails inside horizontal overflow strip must eager-load so Safari doesn't stall clipped items
  assert.match(detailPageSrc, /aria-label="Gallery thumbnails"/);
  assert.match(detailPageSrc, /src=\{img\.thumbUrl\}[\s\S]*?loading="eager"[\s\S]*?compact/);
  // Private signed URL recovery must only trigger when isPreviewAllowed is true
  assert.match(detailPageSrc, /isPreviewAllowed &&[\s\S]*?refreshPrivateImageSignedUrl/);
});

test('Issue 2: Google Drive and YouTube video parsing and mobile-safe player constraints', () => {
  const driveParsed = parsePropertyVideoUrl(
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing'
  );
  assert.ok(driveParsed);
  assert.equal(driveParsed.provider, 'google_drive');
  assert.equal(
    driveParsed.embedUrl,
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/preview'
  );
  assert.equal(
    driveParsed.canonicalUrl,
    'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view'
  );

  // YouTube compatibility remains intact
  const ytParsed = parsePropertyVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.ok(ytParsed);
  assert.equal(ytParsed.provider, 'youtube');
  assert.ok(ytParsed.embedUrl.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'));

  // Reject Drive folders
  assert.equal(
    parsePropertyVideoUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz'),
    null
  );

  const videoPlayerSrc = readSrc('src/components/PropertyVideoPlayer.tsx');
  const detailPageSrc = readSrc('src/pages/PropertyDetailPage.tsx');

  // Strict viewport width clamping & grid column min-w-0 to prevent horizontal overflow
  assert.ok(videoPlayerSrc.includes('w-full max-w-full min-w-0'));
  assert.ok(videoPlayerSrc.includes('aspect-video'));
  assert.ok(videoPlayerSrc.includes('aria-modal="true"'));
  assert.ok(videoPlayerSrc.includes('parsed.canonicalUrl'));
  assert.equal(videoPlayerSrc.includes('window.open'), false);
  assert.ok(detailPageSrc.includes('lg:col-span-7 min-w-0'));
});

test('Issue 3: Detect legacy placeholder 14.1228,120.9856 on LOT-001 Alta Mall (Zamboanga City) without fabricating coordinates', () => {
  // LOT-001 Alta Mall in Tetuan, Zamboanga City with legacy 14.1228, 120.9856
  assert.equal(isLegacyPlaceholderCoordinate(14.1228, 120.9856), true);

  const altaMallAudit = assessCoordinateLocationConsistency(14.1228, 120.9856, {
    barangay: 'Tetuan',
    city: 'Zamboanga City',
    province: 'Zamboanga del Sur',
    region: 'Zamboanga Peninsula (Region IX)',
    title: 'Alta Mall',
  });
  assert.equal(altaMallAudit.consistent, false);
  assert.equal(altaMallAudit.isLegacyPlaceholder, true);
  assert.match(altaMallAudit.warning || '', /legacy Tagaytay sample\/placeholder/i);

  // Same 14.1228, 120.9856 on actual Tagaytay Cavite demo property is consistent
  const tagaytayAudit = assessCoordinateLocationConsistency(14.1228, 120.9856, {
    barangay: 'Sungay West',
    city: 'Tagaytay City',
    province: 'Cavite',
    region: 'CALABARZON (Region IV-A)',
    title: 'Sungay West Highland Ridge Lot',
  });
  assert.equal(tagaytayAudit.consistent, true);
  assert.equal(tagaytayAudit.isLegacyPlaceholder, false);

  // Verified Zamboanga City area coordinates pass consistency
  const zamboangaAudit = assessCoordinateLocationConsistency(6.9154, 122.0739, {
    barangay: 'Tetuan',
    city: 'Zamboanga City',
    province: 'Zamboanga del Sur',
    region: 'Zamboanga Peninsula (Region IX)',
    title: 'Alta Mall',
  });
  assert.equal(zamboangaAudit.consistent, true);
  assert.equal(zamboangaAudit.isLegacyPlaceholder, false);

  // Luzon coordinates paired with Zamboanga address outside legacy radius still trigger regional warning
  const distantMismatch = assessCoordinateLocationConsistency(14.5547, 121.0244, {
    city: 'Zamboanga City',
    province: 'Zamboanga del Sur',
  });
  assert.equal(distantMismatch.consistent, false);
  assert.match(distantMismatch.warning || '', /Zamboanga Peninsula \/ Mindanao/);
});

test('Issue 3: Sync GPS Pin requires admin confirmation on viewport-only URLs and differing existing pins', () => {
  // 1. Viewport-only URL (@lat,lng) must ALWAYS require admin confirmation even when empty
  const viewportParsed = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/place/Alta+Mall/@6.9154,122.0739,17z'
  );
  assert.equal(viewportParsed.ok, true);
  assert.equal(viewportParsed.isViewportOnly, true);

  const viewportEmptyDecision = shouldRequireSyncConfirmation('', '', viewportParsed);
  assert.equal(viewportEmptyDecision.requireConfirmation, true);
  assert.equal(viewportEmptyDecision.reason, 'viewport_only');

  const viewportExistingDecision = shouldRequireSyncConfirmation(
    '6.9154',
    '122.0739',
    viewportParsed
  );
  assert.equal(viewportExistingDecision.requireConfirmation, true);
  assert.equal(viewportExistingDecision.reason, 'viewport_only');

  // 2. Exact pin (!3d!4d) when no coordinates are set yet -> syncs directly without friction
  const exactPinParsed = parseGoogleMapsCoordinates(
    'https://www.google.com/maps/place/Alta+Mall/@6.9200,122.0800,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d6.9154!4d122.0739'
  );
  assert.equal(exactPinParsed.ok, true);
  assert.equal(exactPinParsed.isViewportOnly, false);
  assert.equal(exactPinParsed.latitude, 6.9154);
  assert.equal(exactPinParsed.longitude, 122.0739);

  const directDecision = shouldRequireSyncConfirmation('', '', exactPinParsed);
  assert.equal(directDecision.requireConfirmation, false);
  assert.equal(directDecision.reason, 'none');

  // 3. Exact pin differing significantly (>25m) from existing saved coordinates -> requires confirmation
  const overwriteDecision = shouldRequireSyncConfirmation(14.1228, 120.9856, exactPinParsed);
  assert.equal(overwriteDecision.requireConfirmation, true);
  assert.equal(overwriteDecision.reason, 'differs_from_verified');
  assert.ok((overwriteDecision.distanceMeters || 0) > 700_000);

  // 4. Exact pin within 25m of existing coordinates -> safe re-sync
  assert.ok(haversineDistanceMeters(6.9154, 122.0739, 6.91542, 122.07391) < 25);
  const samePinDecision = shouldRequireSyncConfirmation(6.91542, 122.07391, exactPinParsed);
  assert.equal(samePinDecision.requireConfirmation, false);
});

test('Issue 3: Zero navigator.geolocation usage and no hardcoded 14.1228/120.9856 placeholders in AdminPropertyEditor', () => {
  const editorSrc = readSrc('src/components/AdminPropertyEditor.tsx');
  assert.equal(editorSrc.includes('14.1228'), false);
  assert.equal(editorSrc.includes('120.9856'), false);
  assert.ok(editorSrc.includes('shouldRequireSyncConfirmation'));
  assert.ok(editorSrc.includes('assessCoordinateLocationConsistency'));
  assert.ok(editorSrc.includes('Confirm &amp; Apply Coordinates'));

  // Verify no browser geolocation is used anywhere in src/
  const srcDir = path.join(ROOT_DIR, 'src');
  const walk = (dir: string): string[] => {
    const entries = fs.readdirSync(dir, {withFileTypes: true});
    return entries.flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });
  };
  for (const file of walk(srcDir)) {
    const content = fs.readFileSync(file, 'utf8');
    assert.equal(
      content.includes('navigator.geolocation'),
      false,
      `Found prohibited navigator.geolocation in ${file}`
    );
  }
});
