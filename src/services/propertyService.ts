import {
  DEFAULT_SITE_SETTINGS,
  DEMO_INQUIRIES,
  DEMO_PROPERTIES,
} from '../data/demoProperties';
import {isSupabaseConfigured, supabase} from '../lib/supabase';
import type {
  BuyerInquiry,
  InquiryStatus,
  Property,
  PropertyDocumentItem,
  PropertyImageItem,
  PropertyInput,
  PropertyPresentationItem,
  PropertyStatus,
  PropertyVideoItem,
  PropertyVisibility,
  SiteSettings,
} from '../types/property';
import {computePricePerSqm} from '../utils/format';
import {buildGoogleMapsPinUrl, validateCoordinates} from '../utils/googleMaps';
import {parsePropertyVideoUrl} from '../utils/video';
import {
  cleanupPromotedPublicObjects,
  demoteFileFromPublicBucket,
  ensurePrivateBackupFromPublicBucket,
  PRIVATE_MEDIA_BUCKET,
  promoteFileToPublicBucket,
  promoteImageToPublicBucket,
  PUBLIC_MEDIA_BUCKET,
  refreshPrivateImageSignedUrl,
  removeStoragePathsFromBucket,
  resolvePresentationAssetBucket,
  type StorageBucketName,
} from './storageService';

export type SupabaseClientLike = typeof supabase;

function resolveSupabaseClient(clientOverride?: SupabaseClientLike): SupabaseClientLike {
  if (clientOverride !== undefined) return clientOverride;
  return isSupabaseConfigured && supabase ? supabase : null;
}

const PROPERTIES_STORAGE_KEY = 'amihan_demo_properties_v2';
const INQUIRIES_STORAGE_KEY = 'amihan_demo_inquiries_v1';
const SETTINGS_STORAGE_KEY = 'benmicubo_site_settings_v1';

export function sortImagesCoverFirst(images: PropertyImageItem[]): PropertyImageItem[] {
  if (images.length === 0) return [];
  const sorted = [...images].sort((a, b) => {
    if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
  return sorted.map((img, idx) => ({
    ...img,
    isCover: idx === 0,
    sortOrder: idx,
  }));
}

export function sortPresentations(
  presentations: PropertyPresentationItem[] = []
): PropertyPresentationItem[] {
  return [...presentations]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((pres, idx) => ({
      ...pres,
      sortOrder: idx,
    }));
}

export function validateImageEntriesForStorage(
  images: PropertyImageItem[] = [],
  requireSupabaseStoragePath = false
): void {
  for (const img of images) {
    const path = (img.storagePath || '').trim();
    if (path.includes('..')) {
      throw new Error(`Invalid image storage path "${path}".`);
    }
    if (requireSupabaseStoragePath && !path) {
      throw new Error(
        'All property images must be uploaded to Supabase Storage. External image URLs are not permitted.'
      );
    }
  }
}

export function validatePresentationEntriesForStorage(
  presentations: PropertyPresentationItem[] = [],
  requireSupabaseStoragePath = false
): void {
  for (const pres of presentations) {
    if (!pres.title || !pres.title.trim()) {
      throw new Error('Every property presentation must have a title.');
    }
    const paths = [pres.pdfStoragePath, pres.pptxStoragePath, pres.coverStoragePath];
    for (const p of paths) {
      if (p && p.includes('..')) {
        throw new Error(`Invalid presentation storage path "${p}".`);
      }
    }
    const hasPdf = Boolean((pres.pdfStoragePath || '').trim() || pres.pdfDataUrl);
    const hasPptx = Boolean((pres.pptxStoragePath || '').trim() || pres.pptxDataUrl);
    if (!hasPdf && !hasPptx) {
      throw new Error(
        `Presentation "${pres.title}" must include a PDF or PPTX file.`
      );
    }
    if (
      requireSupabaseStoragePath &&
      !pres.pdfStoragePath.trim() &&
      !pres.pptxStoragePath.trim()
    ) {
      throw new Error(
        `Presentation "${pres.title}" must be uploaded to Supabase Storage.`
      );
    }
  }
}

export function parseOptionalFrontageLength(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number(num.toFixed(2));
}

export function normalizeProperty(raw: Partial<Property> & {id: string; lotId: string}): Property {
  const lotAreaSqm = Number(raw.lotAreaSqm) || 1;
  const showSellingPrice =
    raw.showSellingPrice === undefined ? true : Boolean(raw.showSellingPrice);
  const showPricePerSqm =
    raw.showPricePerSqm === undefined ? true : Boolean(raw.showPricePerSqm);

  const rawTotal = raw.priceTotalPhp;
  const priceTotalPhp =
    rawTotal === null || rawTotal === undefined || !Number.isFinite(Number(rawTotal))
      ? showSellingPrice
        ? 0
        : null
      : Number(rawTotal);

  const rawRate = raw.pricePerSqm;
  const pricePerSqm =
    rawRate === null || rawRate === undefined || !Number.isFinite(Number(rawRate))
      ? showPricePerSqm && priceTotalPhp !== null
        ? computePricePerSqm(priceTotalPhp, lotAreaSqm)
        : null
      : Number(rawRate) >= 0
        ? Number(rawRate)
        : showPricePerSqm && priceTotalPhp !== null
          ? computePricePerSqm(priceTotalPhp, lotAreaSqm)
          : null;

  const visibility: PropertyVisibility =
    raw.visibility || (raw.isArchived ? 'Archived' : 'Published');
  const isArchived = visibility === 'Archived' || Boolean(raw.isArchived);

  const images: PropertyImageItem[] =
    raw.images && raw.images.length > 0
      ? sortImagesCoverFirst(raw.images)
      : (raw.photos || []).map((url, idx) => ({
          id: `img-${raw.lotId}-${idx}`,
          url,
          caption: '',
          isCover: idx === 0,
          sortOrder: idx,
          isApprovedPublic: visibility === 'Published',
          storageBucket:
            visibility === 'Published' ? 'property-media-public' : 'property-media-private',
        }));

  const orderedPhotos =
    images.length > 0 ? images.map((img) => img.url) : raw.photos || [];

  const rawVideos: PropertyVideoItem[] =
    raw.videos && raw.videos.length > 0
      ? [...raw.videos].sort((a, b) => a.sortOrder - b.sortOrder)
      : raw.youtubeUrl
        ? [
            {
              id: `vid-${raw.lotId}-0`,
              sourceType: parsePropertyVideoUrl(raw.youtubeUrl)?.provider || 'youtube',
              url: raw.youtubeUrl,
              title: `${raw.title || raw.lotId} Video Tour`,
              description: '',
              sortOrder: 0,
            },
          ]
        : [];

  const videos: PropertyVideoItem[] = rawVideos.map((v, idx) => {
    const parsed = parsePropertyVideoUrl(v.url);
    return {
      ...v,
      sourceType: parsed ? parsed.provider : v.sourceType,
      sortOrder: v.sortOrder ?? idx,
    };
  });

  const presentations = sortPresentations(raw.presentations || []);

  return {
    id: raw.id,
    lotId: raw.lotId.trim().toUpperCase(),
    title: raw.title || '',
    barangay: raw.barangay || '',
    city: raw.city || '',
    province: raw.province || '',
    region: raw.region || '',
    completeLocation:
      raw.completeLocation ||
      [raw.barangay, raw.city, raw.province].filter(Boolean).join(', '),
    lotAreaSqm,
    frontageLengthM: parseOptionalFrontageLength(raw.frontageLengthM),
    dimensions: raw.dimensions || '',
    boundaryDescription: raw.boundaryDescription || '',
    pricePerSqm,
    priceTotalPhp,
    showSellingPrice,
    showPricePerSqm,
    isPriceManualOverride: Boolean(raw.isPriceManualOverride),
    isNegotiable: Boolean(raw.isNegotiable),
    classification: raw.classification || 'Residential',
    status: raw.status || 'Available',
    visibility,
    isArchived,
    isFeatured: Boolean(raw.isFeatured),
    roadAccess: raw.roadAccess || '',
    utilities: raw.utilities || '',
    terrain: raw.terrain || '',
    nearbyLandmarks: raw.nearbyLandmarks || '',
    titleStatus: raw.titleStatus || '',
    taxDeclarationStatus: raw.taxDeclarationStatus || '',
    additionalRemarks: raw.additionalRemarks || '',
    description: raw.description || '',
    highlights: raw.highlights || [],
    photos: orderedPhotos,
    images,
    youtubeUrl: videos[0]?.url || raw.youtubeUrl || '',
    videos,
    documents: raw.documents || [],
    presentations,
    latitude:
      raw.latitude !== undefined &&
      raw.latitude !== null &&
      raw.latitude !== ('' as unknown) &&
      Number.isFinite(Number(raw.latitude))
        ? Number(raw.latitude)
        : Number.NaN,
    longitude:
      raw.longitude !== undefined &&
      raw.longitude !== null &&
      raw.longitude !== ('' as unknown) &&
      Number.isFinite(Number(raw.longitude))
        ? Number(raw.longitude)
        : Number.NaN,
    googleMapsUrl: raw.googleMapsUrl || '',
    agentName: (raw.agentName || '').trim(),
    agentPhone: (raw.agentPhone || '').trim(),
    agentWhatsapp: (raw.agentWhatsapp || '').trim(),
    agentMessenger: (raw.agentMessenger || '').trim(),
    publishedAt: raw.publishedAt,
    updatedAt: raw.updatedAt || new Date().toISOString(),
  };
}

/**
 * Strips all private media, non-public documents, private presentations,
 * non-downloadable PPTX paths, legacy dimensions, and disabled pricing figures
 * from public property projections.
 */
export function redactPropertyForPublicResponse(property: Property): Property {
  const publicImages = property.images.filter(
    (img) => img.isApprovedPublic && img.storageBucket === PUBLIC_MEDIA_BUCKET
  );
  const publicDocs = property.documents.filter(
    (doc) => doc.visibility === 'Public'
  );
  const publicPresentations = sortPresentations(
    (property.presentations || [])
      .filter((p) => p.visibility === 'Public')
      .map((p) => ({
        ...p,
        pdfFileName: p.allowDownload ? p.pdfFileName : '',
        pdfFileSizeBytes: p.allowDownload ? p.pdfFileSizeBytes : 0,
        pptxStorageBucket: p.allowDownload ? p.pptxStorageBucket : PRIVATE_MEDIA_BUCKET,
        pptxStoragePath: p.allowDownload ? p.pptxStoragePath : '',
        pptxFileName: p.allowDownload ? p.pptxFileName : '',
        pptxMimeType: p.allowDownload ? p.pptxMimeType : '',
        pptxFileSizeBytes: p.allowDownload ? p.pptxFileSizeBytes : 0,
        pptxPublicUrl: p.allowDownload ? p.pptxPublicUrl : undefined,
        pptxDataUrl: p.allowDownload ? p.pptxDataUrl : undefined,
      }))
  );

  return {
    ...property,
    dimensions: '',
    priceTotalPhp: property.showSellingPrice ? property.priceTotalPhp : null,
    pricePerSqm: property.showPricePerSqm ? property.pricePerSqm : null,
    isPriceManualOverride: false,
    images: publicImages,
    photos: publicImages.length > 0 ? publicImages.map((i) => i.url) : [],
    documents: publicDocs,
    presentations: publicPresentations,
  };
}

export function validatePropertyForPublish(
  input: PropertyInput,
  _canonicalSiteUrl?: string
): string[] {
  const errors: string[] = [];
  if (!input.lotId.trim()) errors.push('Unique Lot ID is required.');
  if (!input.title.trim()) errors.push('Property title is required.');
  if (!input.city.trim() || !input.province.trim()) {
    errors.push('City/Municipality and Province are required.');
  }
  if (!input.lotAreaSqm || input.lotAreaSqm <= 0) {
    errors.push('Lot area (sqm) must be greater than 0.');
  }
  if (
    input.frontageLengthM !== null &&
    input.frontageLengthM !== undefined &&
    (!Number.isFinite(input.frontageLengthM) || input.frontageLengthM <= 0)
  ) {
    errors.push('Frontage length (meters) must be a positive number when provided.');
  }
  if (input.priceTotalPhp !== null && input.priceTotalPhp < 0) {
    errors.push('Total selling price cannot be negative.');
  }
  if (!input.description || input.description.trim().length < 10) {
    errors.push('Detailed property description (at least 10 characters) is required.');
  }
  if ((!input.images || input.images.length === 0) && (!input.photos || input.photos.length === 0)) {
    errors.push('At least one property photo is required before publishing.');
  } else if (
    input.images &&
    input.images.length > 0 &&
    !input.images.some((img) => img.isApprovedPublic)
  ) {
    errors.push('At least one property photo must be approved for public display before publishing.');
  }
  const trimmedName = (input.agentName || '').trim();
  const phoneDigits = (input.agentPhone || '').replace(/[^0-9]/g, '');
  const whatsappDigits = (input.agentWhatsapp || '').replace(/[^0-9]/g, '');
  const trimmedMessenger = (input.agentMessenger || '').trim();
  const placeholderPattern =
    /(\b555[\s-]?01\d{2}\b|0000000|^(tbd|placeholder|example|n\/a)$|^rafael mendoza$|^benmicubo\.realestate$)/i;

  if (trimmedName.length < 2 || placeholderPattern.test(trimmedName)) {
    errors.push('Assigned advisor or agency contact name is required before publishing.');
  }
  if (
    phoneDigits.length < 7 ||
    placeholderPattern.test((input.agentPhone || '').trim()) ||
    placeholderPattern.test(phoneDigits)
  ) {
    errors.push('A valid assigned phone number (at least 7 digits) is required before publishing.');
  }
  if (
    (whatsappDigits.length < 7 && trimmedMessenger.length < 2) ||
    placeholderPattern.test((input.agentWhatsapp || '').trim()) ||
    placeholderPattern.test(trimmedMessenger)
  ) {
    errors.push(
      'Provide at least one valid WhatsApp number or Messenger handle (without placeholder values) before publishing.'
    );
  }
  for (const vid of input.videos || []) {
    if (!parsePropertyVideoUrl(vid.url)) {
      errors.push(
        `Invalid video URL (${vid.url || 'empty'}). Only YouTube and Google Drive links are supported.`
      );
    }
  }
  if (input.youtubeUrl && !parsePropertyVideoUrl(input.youtubeUrl)) {
    errors.push('Primary video URL is invalid. Use a valid YouTube or Google Drive link.');
  }
  const coordCheck = validateCoordinates(input.latitude, input.longitude);
  if (!coordCheck.valid) {
    errors.push(
      coordCheck.error ||
        'Valid GPS coordinates (Latitude -90 to 90, Longitude -180 to 180) are required before publishing.'
    );
  }
  return errors;
}

function validateAndNormalizeVideos(videos: PropertyVideoItem[] = []): PropertyVideoItem[] {
  return videos.map((v, idx) => {
    const parsed = parsePropertyVideoUrl(v.url);
    if (!parsed) {
      throw new Error(
        `Invalid video URL "${v.url}". Only validated YouTube and Google Drive video links are permitted.`
      );
    }
    return {
      ...v,
      sourceType: parsed.provider,
      sortOrder: idx,
    };
  });
}

export function isPropertyPubliclyVisible(property: Pick<Property, 'visibility' | 'isArchived'>): boolean {
  return property.visibility === 'Published' && !property.isArchived;
}

export function filterPublicDocuments(documents: PropertyDocumentItem[]): PropertyDocumentItem[] {
  return documents.filter((doc) => doc.visibility === 'Public');
}

export function filterPublicPresentations(
  presentations: PropertyPresentationItem[] = []
): PropertyPresentationItem[] {
  return sortPresentations(
    presentations.filter((pres) => pres.visibility === 'Public')
  );
}

function readDemoProperties(): Property[] {
  try {
    const raw = localStorage.getItem(PROPERTIES_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(PROPERTIES_STORAGE_KEY, JSON.stringify(DEMO_PROPERTIES));
      return DEMO_PROPERTIES.map((p) => normalizeProperty(p));
    }
    const parsed = JSON.parse(raw) as Property[];
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed.map((p) => normalizeProperty(p))
      : DEMO_PROPERTIES.map((p) => normalizeProperty(p));
  } catch {
    return DEMO_PROPERTIES.map((p) => normalizeProperty(p));
  }
}

function writeDemoProperties(items: Property[]): void {
  try {
    localStorage.setItem(PROPERTIES_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors in restricted environments
  }
}

function readDemoInquiries(): BuyerInquiry[] {
  try {
    const raw = localStorage.getItem(INQUIRIES_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(INQUIRIES_STORAGE_KEY, JSON.stringify(DEMO_INQUIRIES));
      return DEMO_INQUIRIES;
    }
    const parsed = JSON.parse(raw) as BuyerInquiry[];
    return Array.isArray(parsed) ? parsed : DEMO_INQUIRIES;
  } catch {
    return DEMO_INQUIRIES;
  }
}

function writeDemoInquiries(items: BuyerInquiry[]): void {
  try {
    localStorage.setItem(INQUIRIES_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

function readLocalSettings(): SiteSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SITE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<SiteSettings>;
    return {
      ...DEFAULT_SITE_SETTINGS,
      ...parsed,
      canonicalSiteUrl:
        parsed.canonicalSiteUrl || DEFAULT_SITE_SETTINGS.canonicalSiteUrl,
    };
  } catch {
    return DEFAULT_SITE_SETTINGS;
  }
}

function writeLocalSettings(settings: SiteSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

interface SupabasePresentationRow {
  id: string;
  property_id: string;
  title: string;
  description: string;
  visibility: PropertyPresentationItem['visibility'];
  allow_download: boolean;
  sort_order: number;
  slide_count: number | null;
  pdf_storage_bucket: StorageBucketName;
  pdf_storage_path: string;
  pdf_file_name: string;
  pdf_mime_type: string;
  pdf_file_size_bytes: number;
  pptx_storage_bucket: StorageBucketName;
  pptx_storage_path: string;
  pptx_file_name: string;
  pptx_mime_type: string;
  pptx_file_size_bytes: number;
  cover_storage_bucket: StorageBucketName;
  cover_storage_path: string;
  cover_public_url: string;
  created_at: string;
  updated_at?: string;
}

interface SupabasePropertyRow {
  id: string;
  lot_id: string;
  title: string;
  barangay: string;
  city: string;
  province: string;
  region: string;
  complete_location?: string;
  lot_area_sqm: number;
  frontage_length_m?: number | null;
  dimensions?: string;
  boundary_description?: string;
  price_per_sqm?: number | null;
  price_total_php: number | null;
  show_selling_price?: boolean;
  show_price_per_sqm?: boolean;
  is_price_manual_override?: boolean;
  is_negotiable?: boolean;
  classification: Property['classification'];
  status: Property['status'];
  visibility?: Property['visibility'];
  is_archived: boolean;
  is_featured: boolean;
  road_access: string;
  utilities?: string;
  terrain: string;
  nearby_landmarks?: string;
  title_status: string;
  tax_declaration_status?: string;
  additional_remarks?: string;
  description: string;
  highlights: string[];
  photos: string[];
  youtube_url: string | null;
  latitude: number;
  longitude: number;
  google_maps_url: string;
  agent_name: string;
  agent_phone: string;
  agent_whatsapp: string;
  agent_messenger: string;
  published_at?: string | null;
  updated_at: string;
  property_images?: Array<{
    id: string;
    property_id?: string;
    storage_bucket: StorageBucketName;
    storage_path: string;
    public_url: string;
    caption: string;
    is_cover: boolean;
    is_approved_public: boolean;
    sort_order: number;
  }>;
  property_videos?: Array<{
    id: string;
    property_id?: string;
    source_type: 'youtube' | 'google_drive' | 'direct';
    youtube_url: string;
    title: string;
    description: string;
    sort_order: number;
  }>;
  property_documents?: Array<{
    id: string;
    property_id?: string;
    title: string;
    category: PropertyDocumentItem['category'];
    visibility: PropertyDocumentItem['visibility'];
    storage_bucket: StorageBucketName;
    storage_path: string;
    file_name: string;
    mime_type: string;
    file_size_bytes: number;
    created_at: string;
  }>;
  property_presentations?: SupabasePresentationRow[];
}

function mapPresentationRow(
  row: SupabasePresentationRow,
  client?: NonNullable<SupabaseClientLike>
): PropertyPresentationItem {
  const getPub = (bucket: StorageBucketName, path: string): string | undefined => {
    if (bucket !== PUBLIC_MEDIA_BUCKET || !path || !client) return undefined;
    return client.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  };

  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    visibility: row.visibility,
    allowDownload: Boolean(row.allow_download),
    sortOrder: row.sort_order ?? 0,
    slideCount: row.slide_count ?? null,
    pdfStorageBucket: row.pdf_storage_bucket,
    pdfStoragePath: row.pdf_storage_path || '',
    pdfFileName: row.pdf_file_name || '',
    pdfMimeType: row.pdf_mime_type || '',
    pdfFileSizeBytes: Number(row.pdf_file_size_bytes) || 0,
    pdfPublicUrl: getPub(row.pdf_storage_bucket, row.pdf_storage_path),
    pptxStorageBucket: row.pptx_storage_bucket,
    pptxStoragePath: row.pptx_storage_path || '',
    pptxFileName: row.pptx_file_name || '',
    pptxMimeType: row.pptx_mime_type || '',
    pptxFileSizeBytes: Number(row.pptx_file_size_bytes) || 0,
    pptxPublicUrl: row.allow_download
      ? getPub(row.pptx_storage_bucket, row.pptx_storage_path)
      : undefined,
    coverStorageBucket: row.cover_storage_bucket,
    coverStoragePath: row.cover_storage_path || '',
    coverPublicUrl:
      row.cover_public_url || getPub(row.cover_storage_bucket, row.cover_storage_path) || '',
    uploadedAt: row.created_at,
  };
}

function mapRowToProperty(
  row: SupabasePropertyRow,
  client?: NonNullable<SupabaseClientLike>
): Property {
  const images: PropertyImageItem[] = (row.property_images || []).map((img) => ({
    id: img.id,
    url: img.public_url,
    storageBucket: img.storage_bucket,
    storagePath: img.storage_path,
    caption: img.caption,
    isCover: img.is_cover,
    isApprovedPublic: img.is_approved_public,
    sortOrder: img.sort_order,
  }));

  const videos: PropertyVideoItem[] = (row.property_videos || []).map((v) => ({
    id: v.id,
    sourceType: v.source_type,
    url: v.youtube_url,
    title: v.title,
    description: v.description,
    sortOrder: v.sort_order,
  }));

  const documents: PropertyDocumentItem[] = (row.property_documents || []).map((d) => ({
    id: d.id,
    title: d.title,
    category: d.category,
    visibility: d.visibility,
    storageBucket: d.storage_bucket,
    storagePath: d.storage_path,
    fileName: d.file_name,
    mimeType: d.mime_type,
    fileSizeBytes: Number(d.file_size_bytes) || 0,
    uploadedAt: d.created_at,
  }));

  const presentations: PropertyPresentationItem[] = (
    row.property_presentations || []
  ).map((p) => mapPresentationRow(p, client));

  const showSellingPrice =
    row.show_selling_price === undefined || row.show_selling_price === null
      ? true
      : Boolean(row.show_selling_price);
  const showPricePerSqm =
    row.show_price_per_sqm === undefined || row.show_price_per_sqm === null
      ? true
      : Boolean(row.show_price_per_sqm);

  return normalizeProperty({
    id: row.id,
    lotId: row.lot_id,
    title: row.title,
    barangay: row.barangay,
    city: row.city,
    province: row.province,
    region: row.region,
    completeLocation: row.complete_location || '',
    lotAreaSqm: Number(row.lot_area_sqm),
    frontageLengthM: parseOptionalFrontageLength(row.frontage_length_m),
    dimensions: row.dimensions || '',
    boundaryDescription: row.boundary_description || '',
    pricePerSqm:
      row.price_per_sqm !== undefined && row.price_per_sqm !== null
        ? Number(row.price_per_sqm)
        : null,
    priceTotalPhp:
      row.price_total_php !== undefined && row.price_total_php !== null
        ? Number(row.price_total_php)
        : null,
    showSellingPrice,
    showPricePerSqm,
    isPriceManualOverride: Boolean(row.is_price_manual_override),
    isNegotiable: Boolean(row.is_negotiable),
    classification: row.classification,
    status: row.status,
    visibility: row.visibility || (row.is_archived ? 'Archived' : 'Published'),
    isArchived: row.is_archived,
    isFeatured: row.is_featured,
    roadAccess: row.road_access,
    utilities: row.utilities || '',
    terrain: row.terrain,
    nearbyLandmarks: row.nearby_landmarks || '',
    titleStatus: row.title_status,
    taxDeclarationStatus: row.tax_declaration_status || '',
    additionalRemarks: row.additional_remarks || '',
    description: row.description,
    highlights: row.highlights || [],
    photos: row.photos || [],
    images,
    youtubeUrl: row.youtube_url || '',
    videos,
    documents,
    presentations,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    googleMapsUrl: row.google_maps_url,
    agentName: row.agent_name,
    agentPhone: row.agent_phone,
    agentWhatsapp: row.agent_whatsapp,
    agentMessenger: row.agent_messenger,
    publishedAt: row.published_at || undefined,
    updatedAt: row.updated_at,
  });
}

function mapPropertyToRow(input: PropertyInput) {
  const orderedImages = sortImagesCoverFirst(input.images || []);
  const photos =
    orderedImages.length > 0 ? orderedImages.map((img) => img.url) : input.photos;
  const isArchived = input.visibility === 'Archived' || input.isArchived;

  return {
    lot_id: input.lotId.trim().toUpperCase(),
    title: input.title,
    barangay: input.barangay,
    city: input.city,
    province: input.province,
    region: input.region,
    complete_location: input.completeLocation,
    lot_area_sqm: input.lotAreaSqm,
    frontage_length_m: parseOptionalFrontageLength(input.frontageLengthM),
    boundary_description: input.boundaryDescription,
    price_per_sqm: input.pricePerSqm ?? 0,
    price_total_php: input.priceTotalPhp ?? 0,
    show_selling_price:
      input.showSellingPrice === undefined ? true : Boolean(input.showSellingPrice),
    show_price_per_sqm:
      input.showPricePerSqm === undefined ? true : Boolean(input.showPricePerSqm),
    is_price_manual_override: input.isPriceManualOverride,
    is_negotiable: input.isNegotiable,
    classification: input.classification,
    status: input.status,
    visibility: input.visibility,
    is_archived: isArchived,
    is_featured: input.isFeatured,
    road_access: input.roadAccess,
    utilities: input.utilities,
    terrain: input.terrain,
    nearby_landmarks: input.nearbyLandmarks,
    title_status: input.titleStatus,
    tax_declaration_status: input.taxDeclarationStatus,
    additional_remarks: input.additionalRemarks,
    description: input.description,
    highlights: input.highlights,
    photos,
    youtube_url: input.videos?.[0]?.url || input.youtubeUrl || null,
    latitude: input.latitude,
    longitude: input.longitude,
    google_maps_url:
      (input.googleMapsUrl || '').trim() ||
      buildGoogleMapsPinUrl(input.latitude, input.longitude),
    agent_name: input.agentName,
    agent_phone: input.agentPhone,
    agent_whatsapp: input.agentWhatsapp,
    agent_messenger: input.agentMessenger,
    published_at:
      input.visibility === 'Published'
        ? input.publishedAt || new Date().toISOString()
        : input.publishedAt || null,
    updated_at: new Date().toISOString(),
  };
}

interface RelationSyncResult {
  orphanPublicPaths: string[];
  orphanPrivatePaths: string[];
  redundantPrivatePaths: string[];
}

interface PreviousRelationsSnapshot {
  images: Array<Record<string, unknown>>;
  videos: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  presentations: Array<Record<string, unknown>>;
}

function nextOptimisticTimestamp(previousTimestamp?: string | null): string {
  const nowMs = Date.now();
  const prevMs = previousTimestamp ? Date.parse(previousTimestamp) : Number.NaN;
  if (Number.isFinite(prevMs) && nowMs <= prevMs) {
    return new Date(prevMs + 1).toISOString();
  }
  return new Date(nowMs).toISOString();
}

async function restorePropertyRowSnapshot(
  client: NonNullable<SupabaseClientLike>,
  propertyId: string,
  prevRow: SupabasePropertyRow,
  expectedCommittedUpdatedAt?: string
): Promise<boolean> {
  try {
    let query = client
      .from('properties')
      .update({
        lot_id: prevRow.lot_id,
        title: prevRow.title,
        barangay: prevRow.barangay,
        city: prevRow.city,
        province: prevRow.province,
        region: prevRow.region,
        complete_location: prevRow.complete_location || '',
        lot_area_sqm: prevRow.lot_area_sqm,
        frontage_length_m: prevRow.frontage_length_m ?? null,
        boundary_description: prevRow.boundary_description || '',
        price_per_sqm: prevRow.price_per_sqm ?? 0,
        price_total_php: prevRow.price_total_php ?? 0,
        show_selling_price: prevRow.show_selling_price ?? true,
        show_price_per_sqm: prevRow.show_price_per_sqm ?? true,
        is_price_manual_override: Boolean(prevRow.is_price_manual_override),
        is_negotiable: Boolean(prevRow.is_negotiable),
        classification: prevRow.classification,
        status: prevRow.status,
        visibility: prevRow.visibility || (prevRow.is_archived ? 'Archived' : 'Published'),
        is_archived: prevRow.is_archived,
        is_featured: prevRow.is_featured,
        road_access: prevRow.road_access,
        utilities: prevRow.utilities || '',
        terrain: prevRow.terrain,
        nearby_landmarks: prevRow.nearby_landmarks || '',
        title_status: prevRow.title_status,
        tax_declaration_status: prevRow.tax_declaration_status || '',
        additional_remarks: prevRow.additional_remarks || '',
        description: prevRow.description,
        highlights: prevRow.highlights || [],
        photos: prevRow.photos || [],
        youtube_url: prevRow.youtube_url,
        latitude: prevRow.latitude,
        longitude: prevRow.longitude,
        google_maps_url: prevRow.google_maps_url,
        agent_name: prevRow.agent_name,
        agent_phone: prevRow.agent_phone,
        agent_whatsapp: prevRow.agent_whatsapp,
        agent_messenger: prevRow.agent_messenger,
        published_at: prevRow.published_at ?? null,
        updated_at: prevRow.updated_at,
      })
      .eq('id', propertyId);

    if (expectedCommittedUpdatedAt) {
      query = query.eq('updated_at', expectedCommittedUpdatedAt);
    }

    const {data, error} = await query.select('id').maybeSingle();
    if (error) return false;
    return expectedCommittedUpdatedAt ? Boolean(data) : true;
  } catch {
    return false;
  }
}

async function restoreRelationsSnapshot(
  client: NonNullable<SupabaseClientLike>,
  propertyId: string,
  snapshot: PreviousRelationsSnapshot
): Promise<void> {
  try {
    await client.from('property_images').delete().eq('property_id', propertyId);
    if (snapshot.images.length > 0) {
      await client.from('property_images').insert(snapshot.images);
    }
    await client.from('property_videos').delete().eq('property_id', propertyId);
    if (snapshot.videos.length > 0) {
      await client.from('property_videos').insert(snapshot.videos);
    }
    await client.from('property_documents').delete().eq('property_id', propertyId);
    if (snapshot.documents.length > 0) {
      await client.from('property_documents').insert(snapshot.documents);
    }
    await client.from('property_presentations').delete().eq('property_id', propertyId);
    if (snapshot.presentations.length > 0) {
      await client.from('property_presentations').insert(snapshot.presentations);
    }
  } catch {
    // Best-effort compensating rollback
  }
}

function collectActiveStoragePaths(
  input: Pick<
    PropertyInput,
    'images' | 'documents' | 'presentations' | 'visibility' | 'isArchived'
  >
): {activePublicPaths: Set<string>; activePrivatePaths: Set<string>} {
  const isPublished = input.visibility === 'Published' && !input.isArchived;
  const activePublicPaths = new Set<string>();
  const activePrivatePaths = new Set<string>();

  for (const img of input.images || []) {
    if (!img.storagePath) continue;
    const isPublic =
      isPublished && Boolean(img.isApprovedPublic) && img.storageBucket === PUBLIC_MEDIA_BUCKET;
    if (isPublic) activePublicPaths.add(img.storagePath);
    else activePrivatePaths.add(img.storagePath);
  }
  for (const doc of input.documents || []) {
    if (!doc.storagePath) continue;
    const isPublic =
      isPublished && doc.visibility === 'Public' && doc.storageBucket === PUBLIC_MEDIA_BUCKET;
    if (isPublic) activePublicPaths.add(doc.storagePath);
    else activePrivatePaths.add(doc.storagePath);
  }
  for (const pres of input.presentations || []) {
    if (pres.pdfStoragePath) {
      const pdfPublic =
        isPublished &&
        pres.visibility === 'Public' &&
        pres.pdfStorageBucket === PUBLIC_MEDIA_BUCKET;
      if (pdfPublic) activePublicPaths.add(pres.pdfStoragePath);
      else activePrivatePaths.add(pres.pdfStoragePath);
    }
    if (pres.pptxStoragePath) {
      const pptxPublic =
        isPublished &&
        pres.visibility === 'Public' &&
        pres.allowDownload &&
        pres.pptxStorageBucket === PUBLIC_MEDIA_BUCKET;
      if (pptxPublic) activePublicPaths.add(pres.pptxStoragePath);
      else activePrivatePaths.add(pres.pptxStoragePath);
    }
    if (pres.coverStoragePath) {
      const coverPublic =
        isPublished &&
        pres.visibility === 'Public' &&
        pres.coverStorageBucket === PUBLIC_MEDIA_BUCKET;
      if (coverPublic) activePublicPaths.add(pres.coverStoragePath);
      else activePrivatePaths.add(pres.coverStoragePath);
    }
  }

  return {activePublicPaths, activePrivatePaths};
}

/**
 * Ensures Storage files still referenced by another property record
 * are NEVER deleted when cleaning up orphans or deleting a property.
 */
async function findDeletableStoragePaths(
  client: NonNullable<SupabaseClientLike>,
  bucket: StorageBucketName,
  candidatePaths: string[],
  currentPropertyId?: string
): Promise<string[]> {
  const uniquePaths = Array.from(
    new Set(candidatePaths.filter((p) => Boolean(p && !p.includes('..'))))
  );
  if (uniquePaths.length === 0) return [];

  const [
    {data: imgRefs, error: imgErr},
    {data: docRefs, error: docErr},
    {data: presPdfRefs, error: presPdfErr},
    {data: presPptxRefs, error: presPptxErr},
    {data: presCoverRefs, error: presCoverErr},
  ] = await Promise.all([
    client
      .from('property_images')
      .select('property_id, storage_bucket, storage_path')
      .in('storage_path', uniquePaths),
    client
      .from('property_documents')
      .select('property_id, storage_bucket, storage_path')
      .in('storage_path', uniquePaths),
    client
      .from('property_presentations')
      .select('property_id, pdf_storage_bucket, pdf_storage_path')
      .in('pdf_storage_path', uniquePaths),
    client
      .from('property_presentations')
      .select('property_id, pptx_storage_bucket, pptx_storage_path')
      .in('pptx_storage_path', uniquePaths),
    client
      .from('property_presentations')
      .select('property_id, cover_storage_bucket, cover_storage_path')
      .in('cover_storage_path', uniquePaths),
  ]);

  if (imgErr || docErr || presPdfErr || presPptxErr || presCoverErr) {
    return [];
  }

  const normalizedRefs: Array<{
    property_id: string;
    storage_bucket: StorageBucketName;
    storage_path: string;
  }> = [
    ...((imgRefs || []) as Array<{
      property_id: string;
      storage_bucket: StorageBucketName;
      storage_path: string;
    }>),
    ...((docRefs || []) as Array<{
      property_id: string;
      storage_bucket: StorageBucketName;
      storage_path: string;
    }>),
    ...((presPdfRefs || []) as Array<{
      property_id: string;
      pdf_storage_bucket: StorageBucketName;
      pdf_storage_path: string;
    }>).map((r) => ({
      property_id: r.property_id,
      storage_bucket: r.pdf_storage_bucket,
      storage_path: r.pdf_storage_path,
    })),
    ...((presPptxRefs || []) as Array<{
      property_id: string;
      pptx_storage_bucket: StorageBucketName;
      pptx_storage_path: string;
    }>).map((r) => ({
      property_id: r.property_id,
      storage_bucket: r.pptx_storage_bucket,
      storage_path: r.pptx_storage_path,
    })),
    ...((presCoverRefs || []) as Array<{
      property_id: string;
      cover_storage_bucket: StorageBucketName;
      cover_storage_path: string;
    }>).map((r) => ({
      property_id: r.property_id,
      storage_bucket: r.cover_storage_bucket,
      storage_path: r.cover_storage_path,
    })),
  ];

  const protectedPaths = new Set<string>();
  for (const row of normalizedRefs) {
    if (!row.storage_path) continue;
    if (bucket === PUBLIC_MEDIA_BUCKET) {
      if (row.storage_bucket === PUBLIC_MEDIA_BUCKET) {
        protectedPaths.add(row.storage_path);
      }
    } else {
      if (
        row.storage_bucket === PRIVATE_MEDIA_BUCKET ||
        !currentPropertyId ||
        row.property_id !== currentPropertyId
      ) {
        protectedPaths.add(row.storage_path);
      }
    }
  }

  return uniquePaths.filter((p) => !protectedPaths.has(p));
}

async function syncPropertyRelationsInSupabase(
  propertyId: string,
  input: PropertyInput,
  clientOverride?: SupabaseClientLike,
  options?: {deferStorageCleanup?: boolean}
): Promise<RelationSyncResult> {
  const client = resolveSupabaseClient(clientOverride);
  if (!client) return {orphanPublicPaths: [], orphanPrivatePaths: [], redundantPrivatePaths: []};

  const [{data: prevImgs}, {data: prevDocs}, {data: prevPres}] = await Promise.all([
    client
      .from('property_images')
      .select('storage_bucket, storage_path')
      .eq('property_id', propertyId),
    client
      .from('property_documents')
      .select('storage_bucket, storage_path')
      .eq('property_id', propertyId),
    client
      .from('property_presentations')
      .select(
        'pdf_storage_bucket, pdf_storage_path, pptx_storage_bucket, pptx_storage_path, cover_storage_bucket, cover_storage_path'
      )
      .eq('property_id', propertyId),
  ]);

  const orderedImages = sortImagesCoverFirst(input.images || []);
  const orderedPresentations = sortPresentations(input.presentations || []);
  const normalizedInput: PropertyInput = {
    ...input,
    images: orderedImages,
    presentations: orderedPresentations,
  };
  const {activePublicPaths, activePrivatePaths} = collectActiveStoragePaths(normalizedInput);

  const prevPathEntries: Array<{bucket: string; path: string}> = [
    ...((prevImgs || []) as Array<{storage_bucket: string; storage_path: string}>).map((r) => ({
      bucket: r.storage_bucket,
      path: r.storage_path,
    })),
    ...((prevDocs || []) as Array<{storage_bucket: string; storage_path: string}>).map((r) => ({
      bucket: r.storage_bucket,
      path: r.storage_path,
    })),
  ];
  for (const row of (prevPres || []) as Array<SupabasePresentationRow>) {
    if (row.pdf_storage_path) {
      prevPathEntries.push({bucket: row.pdf_storage_bucket, path: row.pdf_storage_path});
    }
    if (row.pptx_storage_path) {
      prevPathEntries.push({bucket: row.pptx_storage_bucket, path: row.pptx_storage_path});
    }
    if (row.cover_storage_path) {
      prevPathEntries.push({bucket: row.cover_storage_bucket, path: row.cover_storage_path});
    }
  }

  const orphanPublicPaths: string[] = [];
  const orphanPrivatePaths: string[] = [];
  for (const entry of prevPathEntries) {
    if (!entry.path) continue;
    if (entry.bucket === PUBLIC_MEDIA_BUCKET && !activePublicPaths.has(entry.path)) {
      orphanPublicPaths.push(entry.path);
    }
    if (!activePrivatePaths.has(entry.path) && !activePublicPaths.has(entry.path)) {
      orphanPrivatePaths.push(entry.path);
    }
  }

  const redundantPrivatePaths = Array.from(activePublicPaths).filter(
    (p) => !activePrivatePaths.has(p)
  );

  // Write DB relations BEFORE removing Storage objects
  const {error: delImgErr} = await client
    .from('property_images')
    .delete()
    .eq('property_id', propertyId);
  if (delImgErr) throw new Error(delImgErr.message);

  if (orderedImages.length > 0) {
    const imgRows = orderedImages.map((img, idx) => {
      const isPublicBucket =
        input.visibility === 'Published' &&
        !input.isArchived &&
        img.isApprovedPublic &&
        img.storageBucket === PUBLIC_MEDIA_BUCKET;
      return {
        property_id: propertyId,
        storage_bucket: isPublicBucket ? PUBLIC_MEDIA_BUCKET : PRIVATE_MEDIA_BUCKET,
        storage_path: img.storagePath || '',
        public_url: img.url,
        caption: img.caption,
        is_cover: idx === 0,
        is_approved_public: isPublicBucket,
        sort_order: idx,
      };
    });
    const {error} = await client.from('property_images').insert(imgRows);
    if (error) throw new Error(error.message);
  }

  const {error: delVidErr} = await client
    .from('property_videos')
    .delete()
    .eq('property_id', propertyId);
  if (delVidErr) throw new Error(delVidErr.message);

  if (input.videos && input.videos.length > 0) {
    const vidRows = input.videos.map((v, idx) => ({
      property_id: propertyId,
      source_type: v.sourceType,
      youtube_url: v.url,
      title: v.title,
      description: v.description,
      sort_order: idx,
    }));
    const {error} = await client.from('property_videos').insert(vidRows);
    if (error) throw new Error(error.message);
  }

  const {error: delDocErr} = await client
    .from('property_documents')
    .delete()
    .eq('property_id', propertyId);
  if (delDocErr) throw new Error(delDocErr.message);

  if (input.documents && input.documents.length > 0) {
    const docRows = input.documents.map((d) => {
      const isPublicDoc =
        d.visibility === 'Public' &&
        input.visibility === 'Published' &&
        !input.isArchived &&
        d.storageBucket === PUBLIC_MEDIA_BUCKET;
      return {
        property_id: propertyId,
        title: d.title,
        category: d.category,
        visibility: d.visibility,
        storage_bucket: isPublicDoc ? PUBLIC_MEDIA_BUCKET : PRIVATE_MEDIA_BUCKET,
        storage_path: d.storagePath,
        file_name: d.fileName,
        mime_type: d.mimeType,
        file_size_bytes: d.fileSizeBytes,
      };
    });
    const {error} = await client.from('property_documents').insert(docRows);
    if (error) throw new Error(error.message);
  }

  const {error: delPresErr} = await client
    .from('property_presentations')
    .delete()
    .eq('property_id', propertyId);
  if (delPresErr) throw new Error(delPresErr.message);

  if (orderedPresentations.length > 0) {
    const isPropPub = input.visibility === 'Published' && !input.isArchived;
    const presRows = orderedPresentations.map((p, idx) => {
      const pdfBucket =
        isPropPub && p.visibility === 'Public' && p.pdfStorageBucket === PUBLIC_MEDIA_BUCKET
          ? PUBLIC_MEDIA_BUCKET
          : PRIVATE_MEDIA_BUCKET;
      const pptxBucket =
        isPropPub &&
        p.visibility === 'Public' &&
        p.allowDownload &&
        p.pptxStorageBucket === PUBLIC_MEDIA_BUCKET
          ? PUBLIC_MEDIA_BUCKET
          : PRIVATE_MEDIA_BUCKET;
      const coverBucket =
        isPropPub &&
        p.visibility === 'Public' &&
        p.coverStorageBucket === PUBLIC_MEDIA_BUCKET
          ? PUBLIC_MEDIA_BUCKET
          : PRIVATE_MEDIA_BUCKET;
      return {
        property_id: propertyId,
        title: p.title.trim(),
        description: p.description || '',
        visibility: p.visibility,
        allow_download: Boolean(p.allowDownload),
        sort_order: idx,
        slide_count: p.slideCount ?? null,
        pdf_storage_bucket: pdfBucket,
        pdf_storage_path: p.pdfStoragePath || '',
        pdf_file_name: p.pdfFileName || '',
        pdf_mime_type: p.pdfMimeType || '',
        pdf_file_size_bytes: p.pdfFileSizeBytes || 0,
        pptx_storage_bucket: pptxBucket,
        pptx_storage_path: p.pptxStoragePath || '',
        pptx_file_name: p.pptxFileName || '',
        pptx_mime_type: p.pptxMimeType || '',
        pptx_file_size_bytes: p.pptxFileSizeBytes || 0,
        cover_storage_bucket: coverBucket,
        cover_storage_path: p.coverStoragePath || '',
        cover_public_url: p.coverPublicUrl || '',
      };
    });
    const {error} = await client.from('property_presentations').insert(presRows);
    if (error) throw new Error(error.message);
  }

  if (!options?.deferStorageCleanup) {
    const [safePubOrphans, safePrivOrphans, safeRedundantPriv] = await Promise.all([
      findDeletableStoragePaths(client, PUBLIC_MEDIA_BUCKET, orphanPublicPaths, propertyId),
      findDeletableStoragePaths(client, PRIVATE_MEDIA_BUCKET, orphanPrivatePaths, propertyId),
      findDeletableStoragePaths(client, PRIVATE_MEDIA_BUCKET, redundantPrivatePaths, propertyId),
    ]);
    await removeStoragePathsFromBucket(PUBLIC_MEDIA_BUCKET, safePubOrphans, client);
    await removeStoragePathsFromBucket(
      PRIVATE_MEDIA_BUCKET,
      [...safePrivOrphans, ...safeRedundantPriv],
      client
    );
  }

  return {orphanPublicPaths, orphanPrivatePaths, redundantPrivatePaths};
}

export async function prepareImagesForVisibility(
  images: PropertyImageItem[] = [],
  visibility: PropertyVisibility
): Promise<PropertyImageItem[]> {
  const isPublished = visibility === 'Published';
  const ordered = sortImagesCoverFirst(images);

  return Promise.all(
    ordered.map(async (img) => {
      const shouldBePublic = isPublished && Boolean(img.isApprovedPublic);

      if (!shouldBePublic) {
        if (
          isSupabaseConfigured &&
          supabase &&
          img.storagePath &&
          img.storageBucket === PUBLIC_MEDIA_BUCKET
        ) {
          const {signedUrl} = await demoteFileFromPublicBucket(img.storagePath, 'image');
          return {
            ...img,
            url: signedUrl || img.url,
            storageBucket: PRIVATE_MEDIA_BUCKET,
            isApprovedPublic: false,
          };
        }
        return {
          ...img,
          storageBucket: PRIVATE_MEDIA_BUCKET,
          isApprovedPublic: false,
        };
      }

      if (
        isSupabaseConfigured &&
        supabase &&
        img.storagePath &&
        img.storageBucket === PRIVATE_MEDIA_BUCKET
      ) {
        const publicUrl = await promoteImageToPublicBucket(img.storagePath);
        if (publicUrl) {
          return {
            ...img,
            url: publicUrl,
            storageBucket: PUBLIC_MEDIA_BUCKET,
            isApprovedPublic: true,
          };
        }
        return {
          ...img,
          storageBucket: PRIVATE_MEDIA_BUCKET,
          isApprovedPublic: false,
        };
      }

      return {
        ...img,
        storageBucket: img.storagePath ? img.storageBucket : PRIVATE_MEDIA_BUCKET,
        isApprovedPublic: Boolean(img.storagePath || !isSupabaseConfigured),
      };
    })
  );
}

export async function prepareDocumentsForVisibility(
  documents: PropertyDocumentItem[] = [],
  visibility: PropertyVisibility
): Promise<PropertyDocumentItem[]> {
  const isPublished = visibility === 'Published';

  return Promise.all(
    documents.map(async (doc) => {
      const shouldBeInPublicBucket = isPublished && doc.visibility === 'Public';

      if (!shouldBeInPublicBucket) {
        if (
          isSupabaseConfigured &&
          supabase &&
          doc.storagePath &&
          doc.storageBucket === PUBLIC_MEDIA_BUCKET
        ) {
          await demoteFileFromPublicBucket(doc.storagePath, 'document');
        }
        return {
          ...doc,
          storageBucket: PRIVATE_MEDIA_BUCKET,
          publicUrl: doc.visibility === 'Public' ? doc.publicUrl : undefined,
        };
      }

      if (
        isSupabaseConfigured &&
        supabase &&
        doc.storagePath &&
        doc.storageBucket === PRIVATE_MEDIA_BUCKET
      ) {
        const publicUrl = await promoteFileToPublicBucket(doc.storagePath, doc.mimeType);
        if (publicUrl) {
          return {
            ...doc,
            storageBucket: PUBLIC_MEDIA_BUCKET,
            publicUrl,
          };
        }
        return {
          ...doc,
          storageBucket: PRIVATE_MEDIA_BUCKET,
          publicUrl: undefined,
        };
      }

      return {
        ...doc,
        storageBucket: doc.storagePath ? doc.storageBucket : PRIVATE_MEDIA_BUCKET,
      };
    })
  );
}

export async function preparePresentationsForVisibility(
  presentations: PropertyPresentationItem[] = [],
  visibility: PropertyVisibility
): Promise<PropertyPresentationItem[]> {
  const isPublished = visibility === 'Published';
  return sortPresentations(presentations).map((p) => {
    const pdfBucket = resolvePresentationAssetBucket('pdf', p.visibility, p.allowDownload, isPublished);
    const pptxBucket = resolvePresentationAssetBucket('pptx', p.visibility, p.allowDownload, isPublished);
    const coverBucket = resolvePresentationAssetBucket('cover', p.visibility, p.allowDownload, isPublished);
    return {
      ...p,
      pdfStorageBucket: p.pdfStoragePath ? pdfBucket : PRIVATE_MEDIA_BUCKET,
      pdfPublicUrl: pdfBucket === PUBLIC_MEDIA_BUCKET ? p.pdfPublicUrl || p.pdfDataUrl : undefined,
      pptxStorageBucket: p.pptxStoragePath ? pptxBucket : PRIVATE_MEDIA_BUCKET,
      pptxPublicUrl:
        pptxBucket === PUBLIC_MEDIA_BUCKET ? p.pptxPublicUrl || p.pptxDataUrl : undefined,
      coverStorageBucket: p.coverStoragePath ? coverBucket : PRIVATE_MEDIA_BUCKET,
    };
  });
}

async function refreshPrivateMediaForAdmin(
  properties: Property[],
  clientOverride?: SupabaseClientLike
): Promise<Property[]> {
  const client = resolveSupabaseClient(clientOverride);
  if (!client) return properties;
  return Promise.all(
    properties.map(async (prop) => {
      const hasPrivateImg = prop.images.some(
        (img) => img.storageBucket === PRIVATE_MEDIA_BUCKET && img.storagePath
      );
      const hasPrivatePresCover = (prop.presentations || []).some(
        (p) => p.coverStorageBucket === PRIVATE_MEDIA_BUCKET && p.coverStoragePath
      );
      if (!hasPrivateImg && !hasPrivatePresCover) return prop;

      const refreshedImages = hasPrivateImg
        ? await Promise.all(
            prop.images.map(async (img) => {
              if (img.storageBucket === PRIVATE_MEDIA_BUCKET && img.storagePath) {
                const signed = await refreshPrivateImageSignedUrl(img.storagePath, client);
                if (signed) return {...img, url: signed};
              }
              return img;
            })
          )
        : prop.images;

      const refreshedPresentations = hasPrivatePresCover
        ? await Promise.all(
            (prop.presentations || []).map(async (pres) => {
              if (pres.coverStorageBucket === PRIVATE_MEDIA_BUCKET && pres.coverStoragePath) {
                const signed = await refreshPrivateImageSignedUrl(pres.coverStoragePath, client);
                if (signed) return {...pres, coverPublicUrl: signed};
              }
              return pres;
            })
          )
        : prop.presentations;

      return normalizeProperty({
        ...prop,
        images: refreshedImages,
        photos: refreshedImages.map((i) => i.url),
        presentations: refreshedPresentations,
      });
    })
  );
}

async function resolveMediaAfterPropertyCommitted(
  client: NonNullable<SupabaseClientLike>,
  input: PropertyInput,
  previouslyPublicPaths: Set<string>,
  newlyPromotedPublicPaths: string[]
): Promise<{
  preparedImages: PropertyImageItem[];
  preparedDocuments: PropertyDocumentItem[];
  preparedPresentations: PropertyPresentationItem[];
}> {
  const isPublished = input.visibility === 'Published' && !input.isArchived;
  const orderedImages = sortImagesCoverFirst(input.images || []);

  const preparedImages: PropertyImageItem[] = [];
  for (const img of orderedImages) {
    const shouldBePublic = isPublished && Boolean(img.isApprovedPublic);
    if (!shouldBePublic) {
      let nextUrl = img.url;
      if (img.storagePath) {
        const signed = await refreshPrivateImageSignedUrl(img.storagePath, client);
        if (signed) nextUrl = signed;
      }
      preparedImages.push({
        ...img,
        url: nextUrl,
        storageBucket: PRIVATE_MEDIA_BUCKET,
        isApprovedPublic: false,
      });
      continue;
    }

    if (img.storagePath && img.storageBucket === PRIVATE_MEDIA_BUCKET) {
      const publicUrl = await promoteImageToPublicBucket(img.storagePath, client);
      if (!publicUrl) {
        throw new Error(`Failed to promote approved image "${img.storagePath}" to public storage.`);
      }
      if (!previouslyPublicPaths.has(img.storagePath)) {
        newlyPromotedPublicPaths.push(img.storagePath);
      }
      preparedImages.push({
        ...img,
        url: publicUrl,
        storageBucket: PUBLIC_MEDIA_BUCKET,
        isApprovedPublic: true,
      });
      continue;
    }

    preparedImages.push({
      ...img,
      storageBucket: img.storagePath ? img.storageBucket : PRIVATE_MEDIA_BUCKET,
      isApprovedPublic: Boolean(img.storagePath && img.storageBucket === PUBLIC_MEDIA_BUCKET),
    });
  }

  const preparedDocuments: PropertyDocumentItem[] = [];
  for (const doc of input.documents || []) {
    const shouldBeInPublicBucket = isPublished && doc.visibility === 'Public';
    if (!shouldBeInPublicBucket) {
      preparedDocuments.push({
        ...doc,
        storageBucket: PRIVATE_MEDIA_BUCKET,
        publicUrl: undefined,
      });
      continue;
    }

    if (doc.storagePath && doc.storageBucket === PRIVATE_MEDIA_BUCKET) {
      const publicUrl = await promoteFileToPublicBucket(doc.storagePath, doc.mimeType, client);
      if (!publicUrl) {
        throw new Error(`Failed to promote public document "${doc.fileName}" to public storage.`);
      }
      if (!previouslyPublicPaths.has(doc.storagePath)) {
        newlyPromotedPublicPaths.push(doc.storagePath);
      }
      preparedDocuments.push({
        ...doc,
        storageBucket: PUBLIC_MEDIA_BUCKET,
        publicUrl,
      });
      continue;
    }

    preparedDocuments.push({
      ...doc,
      storageBucket: doc.storagePath ? doc.storageBucket : PRIVATE_MEDIA_BUCKET,
    });
  }

  const preparedPresentations: PropertyPresentationItem[] = [];
  for (const pres of sortPresentations(input.presentations || [])) {
    const pdfPublicWanted = isPublished && pres.visibility === 'Public' && Boolean(pres.pdfStoragePath);
    const pptxPublicWanted =
      isPublished && pres.visibility === 'Public' && pres.allowDownload && Boolean(pres.pptxStoragePath);
    const coverPublicWanted =
      isPublished && pres.visibility === 'Public' && Boolean(pres.coverStoragePath);

    let nextPdfBucket: StorageBucketName = PRIVATE_MEDIA_BUCKET;
    let nextPdfPublicUrl: string | undefined;
    if (pdfPublicWanted && pres.pdfStoragePath) {
      if (pres.pdfStorageBucket === PRIVATE_MEDIA_BUCKET) {
        const promoted = await promoteFileToPublicBucket(
          pres.pdfStoragePath,
          pres.pdfMimeType || 'application/pdf',
          client
        );
        if (!promoted) {
          throw new Error(`Failed to promote presentation PDF "${pres.pdfFileName}" to public storage.`);
        }
        if (!previouslyPublicPaths.has(pres.pdfStoragePath)) {
          newlyPromotedPublicPaths.push(pres.pdfStoragePath);
        }
        nextPdfBucket = PUBLIC_MEDIA_BUCKET;
        nextPdfPublicUrl = promoted;
      } else {
        nextPdfBucket = PUBLIC_MEDIA_BUCKET;
        nextPdfPublicUrl =
          pres.pdfPublicUrl ||
          client.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(pres.pdfStoragePath).data.publicUrl;
      }
    }

    let nextPptxBucket: StorageBucketName = PRIVATE_MEDIA_BUCKET;
    let nextPptxPublicUrl: string | undefined;
    if (pptxPublicWanted && pres.pptxStoragePath) {
      if (pres.pptxStorageBucket === PRIVATE_MEDIA_BUCKET) {
        const promoted = await promoteFileToPublicBucket(
          pres.pptxStoragePath,
          pres.pptxMimeType || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          client
        );
        if (!promoted) {
          throw new Error(`Failed to promote presentation PPTX "${pres.pptxFileName}" to public storage.`);
        }
        if (!previouslyPublicPaths.has(pres.pptxStoragePath)) {
          newlyPromotedPublicPaths.push(pres.pptxStoragePath);
        }
        nextPptxBucket = PUBLIC_MEDIA_BUCKET;
        nextPptxPublicUrl = promoted;
      } else {
        nextPptxBucket = PUBLIC_MEDIA_BUCKET;
        nextPptxPublicUrl =
          pres.pptxPublicUrl ||
          client.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(pres.pptxStoragePath).data.publicUrl;
      }
    }

    let nextCoverBucket: StorageBucketName = PRIVATE_MEDIA_BUCKET;
    let nextCoverUrl = pres.coverPublicUrl || '';
    if (coverPublicWanted && pres.coverStoragePath) {
      if (pres.coverStorageBucket === PRIVATE_MEDIA_BUCKET) {
        const promoted = await promoteImageToPublicBucket(pres.coverStoragePath, client);
        if (!promoted) {
          throw new Error(`Failed to promote presentation cover "${pres.coverStoragePath}" to public storage.`);
        }
        if (!previouslyPublicPaths.has(pres.coverStoragePath)) {
          newlyPromotedPublicPaths.push(pres.coverStoragePath);
        }
        nextCoverBucket = PUBLIC_MEDIA_BUCKET;
        nextCoverUrl = promoted;
      } else {
        nextCoverBucket = PUBLIC_MEDIA_BUCKET;
      }
    } else if (pres.coverStoragePath) {
      const signed = await refreshPrivateImageSignedUrl(pres.coverStoragePath, client);
      if (signed) nextCoverUrl = signed;
    }

    preparedPresentations.push({
      ...pres,
      pdfStorageBucket: nextPdfBucket,
      pdfPublicUrl: nextPdfPublicUrl,
      pptxStorageBucket: nextPptxBucket,
      pptxPublicUrl: nextPptxPublicUrl,
      coverStorageBucket: nextCoverBucket,
      coverPublicUrl: nextCoverUrl,
    });
  }

  return {
    preparedImages: sortImagesCoverFirst(preparedImages),
    preparedDocuments,
    preparedPresentations,
  };
}

const propertyMutationLocks = new Map<string, Promise<unknown>>();

async function withPropertyMutationLock<T>(
  propertyId: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = propertyMutationLocks.get(propertyId) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => gate, () => gate);
  propertyMutationLocks.set(propertyId, chained);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (propertyMutationLocks.get(propertyId) === chained) {
      propertyMutationLocks.delete(propertyId);
    }
  }
}

export function createPropertyService(getClient?: () => SupabaseClientLike) {
  const activeClient = () => resolveSupabaseClient(getClient ? getClient() : undefined);

  return {
    async checkCurrentUserAdminRole(userId: string): Promise<{
      isAuthorized: boolean;
      role: 'admin' | 'super_admin' | null;
    }> {
      const client = activeClient();
      if (!client || !userId) {
        return {isAuthorized: false, role: null};
      }
      const {data, error} = await client
        .from('admin_users')
        .select('role, is_active')
        .eq('user_id', userId)
        .maybeSingle();
      if (error || !data || !data.is_active) {
        return {isAuthorized: false, role: null};
      }
      const role = data.role === 'super_admin' ? 'super_admin' : 'admin';
      return {isAuthorized: true, role};
    },

    async listProperties(includeUnpublished = false): Promise<Property[]> {
      const client = activeClient();
      if (client) {
        if (includeUnpublished) {
          const {data, error} = await client
            .from('properties')
            .select(
              '*, property_images(*), property_videos(*), property_documents(*), property_presentations(*)'
            )
            .order('lot_id', {ascending: true});
          if (error) throw new Error(error.message);
          const mapped = (data as SupabasePropertyRow[]).map((r) =>
            mapRowToProperty(r, client)
          );
          return refreshPrivateMediaForAdmin(mapped, client);
        }

        // Public reads query SQL-redacted views (`public_properties`, `public_property_presentations`)
        // plus RLS-isolated child media so disabled pricing & private assets never cross the wire.
        const {data: propRows, error: propErr} = await client
          .from('public_properties')
          .select('*')
          .order('lot_id', {ascending: true});
        if (propErr) throw new Error(propErr.message);

        const rows = (propRows || []) as SupabasePropertyRow[];
        if (rows.length === 0) return [];
        const propertyIds = rows.map((r) => r.id);

        const [
          {data: imgRows},
          {data: vidRows},
          {data: docRows},
          {data: presRows},
        ] = await Promise.all([
          client.from('property_images').select('*').in('property_id', propertyIds),
          client.from('property_videos').select('*').in('property_id', propertyIds),
          client.from('property_documents').select('*').in('property_id', propertyIds),
          client
            .from('public_property_presentations')
            .select('*')
            .in('property_id', propertyIds),
        ]);

        return rows.map((row) => {
          const enriched: SupabasePropertyRow = {
            ...row,
            property_images: (imgRows || []).filter((i) => i.property_id === row.id),
            property_videos: (vidRows || []).filter((v) => v.property_id === row.id),
            property_documents: (docRows || []).filter((d) => d.property_id === row.id),
            property_presentations: (presRows || []).filter(
              (p) => p.property_id === row.id
            ),
          };
          return redactPropertyForPublicResponse(mapRowToProperty(enriched, client));
        });
      }

      const items = readDemoProperties();
      return includeUnpublished
        ? items
        : items
            .filter(isPropertyPubliclyVisible)
            .map(redactPropertyForPublicResponse);
    },

    async createProperty(input: PropertyInput): Promise<Property> {
      const normalizedLotId = input.lotId.trim().toUpperCase();
      if (!normalizedLotId) {
        throw new Error('Unique Lot ID is required.');
      }
      if (!input.title.trim() || !input.city.trim() || !input.province.trim()) {
        throw new Error('Property Title, City, and Province are required.');
      }
      if (!input.lotAreaSqm || input.lotAreaSqm <= 0) {
        throw new Error('Lot area (sqm) must be greater than 0.');
      }
      if (
        input.frontageLengthM !== null &&
        input.frontageLengthM !== undefined &&
        (!Number.isFinite(input.frontageLengthM) || input.frontageLengthM <= 0)
      ) {
        throw new Error('Frontage length (meters) must be a positive number when provided.');
      }

      const coordCheck = validateCoordinates(input.latitude, input.longitude);
      if (!coordCheck.valid || coordCheck.latitude === undefined || coordCheck.longitude === undefined) {
        throw new Error(
          coordCheck.error || 'Valid GPS coordinates (Latitude -90 to 90, Longitude -180 to 180) are required.'
        );
      }

      const normalizedInput: PropertyInput = {
        ...input,
        frontageLengthM: parseOptionalFrontageLength(input.frontageLengthM),
        latitude: coordCheck.latitude,
        longitude: coordCheck.longitude,
        googleMapsUrl:
          (input.googleMapsUrl || '').trim() ||
          buildGoogleMapsPinUrl(coordCheck.latitude, coordCheck.longitude),
      };

      const validatedVideos = validateAndNormalizeVideos(normalizedInput.videos || []);
      const orderedRawImages = sortImagesCoverFirst(normalizedInput.images || []);
      const orderedRawPresentations = sortPresentations(normalizedInput.presentations || []);
      const isArchived = normalizedInput.visibility === 'Archived' || normalizedInput.isArchived;
      const isPublishing = normalizedInput.visibility === 'Published' && !isArchived;

      const client = activeClient();
      validateImageEntriesForStorage(orderedRawImages, Boolean(client));
      validatePresentationEntriesForStorage(orderedRawPresentations, Boolean(client));

      if (isPublishing) {
        const publishErrors = validatePropertyForPublish({
          ...normalizedInput,
          lotId: normalizedLotId,
          isArchived,
          images: orderedRawImages,
          videos: validatedVideos,
          presentations: orderedRawPresentations,
        });
        if (publishErrors.length > 0) {
          throw new Error(publishErrors[0]);
        }
      }

      if (client) {
        const safeInitialRow = mapPropertyToRow({
          ...normalizedInput,
          lotId: normalizedLotId,
          visibility: 'Draft',
          isArchived: false,
          publishedAt: undefined,
          images: [],
          videos: validatedVideos,
          youtubeUrl: validatedVideos[0]?.url || '',
          photos: [],
          presentations: [],
        });

        const {data, error} = await client
          .from('properties')
          .insert(safeInitialRow)
          .select()
          .single();
        if (error) throw new Error(error.message);

        const createdId = data.id as string;
        const newlyPromotedPublicPaths: string[] = [];

        try {
          const stagedImages: PropertyImageItem[] = orderedRawImages.map((img) => ({
            ...img,
            storageBucket: PRIVATE_MEDIA_BUCKET,
            isApprovedPublic: false,
          }));
          const stagedDocuments: PropertyDocumentItem[] = (normalizedInput.documents || []).map((doc) => ({
            ...doc,
            storageBucket: PRIVATE_MEDIA_BUCKET,
            publicUrl: undefined,
          }));
          const stagedPresentations: PropertyPresentationItem[] = orderedRawPresentations.map((p) => ({
            ...p,
            pdfStorageBucket: PRIVATE_MEDIA_BUCKET,
            pdfPublicUrl: undefined,
            pptxStorageBucket: PRIVATE_MEDIA_BUCKET,
            pptxPublicUrl: undefined,
            coverStorageBucket: PRIVATE_MEDIA_BUCKET,
          }));

          const stagedInput: PropertyInput = {
            ...normalizedInput,
            lotId: normalizedLotId,
            visibility: 'Draft',
            isArchived: false,
            images: stagedImages,
            documents: stagedDocuments,
            presentations: stagedPresentations,
            videos: validatedVideos,
            youtubeUrl: validatedVideos[0]?.url || '',
            photos: [],
          };

          await syncPropertyRelationsInSupabase(createdId, stagedInput, client, {
            deferStorageCleanup: true,
          });

          const {preparedImages, preparedDocuments, preparedPresentations} =
            await resolveMediaAfterPropertyCommitted(
              client,
              {
                ...normalizedInput,
                lotId: normalizedLotId,
                isArchived,
                images: orderedRawImages,
                videos: validatedVideos,
                presentations: orderedRawPresentations,
              },
              new Set<string>(),
              newlyPromotedPublicPaths
            );

          const orderedApprovedUrls = sortImagesCoverFirst(preparedImages)
            .filter((img) => (isPublishing ? img.isApprovedPublic : true))
            .map((img) => img.url);
          const finalPhotoList =
            orderedApprovedUrls.length > 0
              ? orderedApprovedUrls
              : isPublishing
                ? []
                : normalizedInput.photos;

          const targetPublishedAt = isPublishing
            ? normalizedInput.publishedAt || new Date().toISOString()
            : null;

          const {data: finalPropRow, error: propCommitErr} = await client
            .from('properties')
            .update({
              visibility: normalizedInput.visibility,
              is_archived: isArchived,
              published_at: targetPublishedAt,
              photos: finalPhotoList,
              updated_at: new Date().toISOString(),
            })
            .eq('id', createdId)
            .select()
            .single();
          if (propCommitErr) throw new Error(propCommitErr.message);

          const finalInput: PropertyInput = {
            ...normalizedInput,
            lotId: normalizedLotId,
            isArchived,
            images: preparedImages,
            documents: preparedDocuments,
            presentations: preparedPresentations,
            videos: validatedVideos,
            youtubeUrl: validatedVideos[0]?.url || '',
            photos: finalPhotoList,
            publishedAt: targetPublishedAt || undefined,
          };

          const cleanupTargets = await syncPropertyRelationsInSupabase(createdId, finalInput, client, {
            deferStorageCleanup: true,
          });

          if (cleanupTargets.redundantPrivatePaths.length > 0) {
            const safeRedundant = await findDeletableStoragePaths(
              client,
              PRIVATE_MEDIA_BUCKET,
              cleanupTargets.redundantPrivatePaths,
              createdId
            );
            await removeStoragePathsFromBucket(PRIVATE_MEDIA_BUCKET, safeRedundant, client);
          }

          return normalizeProperty({
            ...finalInput,
            id: createdId,
            updatedAt: finalPropRow?.updated_at || data.updated_at,
          });
        } catch (err) {
          await cleanupPromotedPublicObjects(newlyPromotedPublicPaths, client);
          try {
            const {error: delErr} = await client.from('properties').delete().eq('id', createdId);
            if (delErr) {
              await client
                .from('properties')
                .update({visibility: 'Draft', is_archived: false, photos: []})
                .eq('id', createdId);
            }
          } catch {
            // Best-effort compensating rollback
          }
          throw err;
        }
      }

      const [preparedImages, preparedDocuments, preparedPresentations] = await Promise.all([
        prepareImagesForVisibility(orderedRawImages, normalizedInput.visibility),
        prepareDocumentsForVisibility(normalizedInput.documents || [], normalizedInput.visibility),
        preparePresentationsForVisibility(orderedRawPresentations, normalizedInput.visibility),
      ]);
      const preparedInput: PropertyInput = {
        ...normalizedInput,
        lotId: normalizedLotId,
        isArchived,
        images: preparedImages,
        documents: preparedDocuments,
        presentations: preparedPresentations,
        videos: validatedVideos,
        youtubeUrl: validatedVideos[0]?.url || '',
        photos:
          preparedImages.length > 0
            ? sortImagesCoverFirst(preparedImages).map((img) => img.url)
            : normalizedInput.photos,
      };

      const existing = readDemoProperties();
      if (existing.some((item) => item.lotId.toUpperCase() === normalizedLotId)) {
        throw new Error(`Lot ID ${normalizedLotId} already exists. Permanent Lot IDs must be unique.`);
      }
      const created = normalizeProperty({
        ...preparedInput,
        id: `demo-${Date.now()}`,
        updatedAt: new Date().toISOString(),
      });
      const next = [created, ...existing];
      writeDemoProperties(next);
      return created;
    },

    async updateProperty(id: string, input: PropertyInput): Promise<Property> {
      return withPropertyMutationLock(id, async () => {
        if (
          input.frontageLengthM !== null &&
          input.frontageLengthM !== undefined &&
          (!Number.isFinite(input.frontageLengthM) || input.frontageLengthM <= 0)
        ) {
          throw new Error('Frontage length (meters) must be a positive number when provided.');
        }

        const coordCheck = validateCoordinates(input.latitude, input.longitude);
        if (!coordCheck.valid || coordCheck.latitude === undefined || coordCheck.longitude === undefined) {
          throw new Error(
            coordCheck.error || 'Valid GPS coordinates (Latitude -90 to 90, Longitude -180 to 180) are required.'
          );
        }

        const normalizedInput: PropertyInput = {
          ...input,
          frontageLengthM: parseOptionalFrontageLength(input.frontageLengthM),
          latitude: coordCheck.latitude,
          longitude: coordCheck.longitude,
          googleMapsUrl:
            (input.googleMapsUrl || '').trim() ||
            buildGoogleMapsPinUrl(coordCheck.latitude, coordCheck.longitude),
        };

        const validatedVideos = validateAndNormalizeVideos(normalizedInput.videos || []);
        const orderedRawImages = sortImagesCoverFirst(normalizedInput.images || []);
        const orderedRawPresentations = sortPresentations(normalizedInput.presentations || []);
        const client = activeClient();

        if (client) {
          validateImageEntriesForStorage(orderedRawImages, true);
          validatePresentationEntriesForStorage(orderedRawPresentations, true);

          const [
            {data: existingRow, error: fetchErr},
            {data: prevImgRows},
            {data: prevVidRows},
            {data: prevDocRows},
            {data: prevPresRows},
          ] = await Promise.all([
            client.from('properties').select('*').eq('id', id).single(),
            client.from('property_images').select('*').eq('property_id', id),
            client.from('property_videos').select('*').eq('property_id', id),
            client.from('property_documents').select('*').eq('property_id', id),
            client.from('property_presentations').select('*').eq('property_id', id),
          ]);
          if (fetchErr || !existingRow) {
            throw new Error(fetchErr?.message || 'Property record not found.');
          }

          const prevSnapshot = existingRow as SupabasePropertyRow;
          if (
            normalizedInput.expectedUpdatedAt &&
            prevSnapshot.updated_at !== normalizedInput.expectedUpdatedAt
          ) {
            throw new Error(
              'Concurrent update detected: another administrator saved newer changes while this listing was open. Reload before saving.'
            );
          }

          const lockedLotId = prevSnapshot.lot_id;
          const isArchived = normalizedInput.visibility === 'Archived' || normalizedInput.isArchived;
          const willBePublished = normalizedInput.visibility === 'Published' && !isArchived;

          if (willBePublished) {
            const publishErrors = validatePropertyForPublish({
              ...normalizedInput,
              lotId: lockedLotId,
              isArchived,
              images: orderedRawImages,
              videos: validatedVideos,
              presentations: orderedRawPresentations,
            });
            if (publishErrors.length > 0) {
              throw new Error(publishErrors[0]);
            }
          }

          const prevPublicPaths = new Set<string>();
          for (const row of [...(prevImgRows || []), ...(prevDocRows || [])]) {
            if (row.storage_bucket === PUBLIC_MEDIA_BUCKET && row.storage_path) {
              prevPublicPaths.add(row.storage_path as string);
            }
          }
          for (const row of (prevPresRows || []) as SupabasePresentationRow[]) {
            if (row.pdf_storage_bucket === PUBLIC_MEDIA_BUCKET && row.pdf_storage_path) {
              prevPublicPaths.add(row.pdf_storage_path);
            }
            if (row.pptx_storage_bucket === PUBLIC_MEDIA_BUCKET && row.pptx_storage_path) {
              prevPublicPaths.add(row.pptx_storage_path);
            }
            if (row.cover_storage_bucket === PUBLIC_MEDIA_BUCKET && row.cover_storage_path) {
              prevPublicPaths.add(row.cover_storage_path);
            }
          }

          // Create & verify private backups BEFORE mutating DB or removing public objects
          for (const img of orderedRawImages) {
            const leavingPublic =
              img.storagePath &&
              img.storageBucket === PUBLIC_MEDIA_BUCKET &&
              (!willBePublished || !img.isApprovedPublic);
            if (leavingPublic && img.storagePath) {
              await ensurePrivateBackupFromPublicBucket(img.storagePath, 'image/webp', client);
            }
          }
          for (const doc of normalizedInput.documents || []) {
            const leavingPublic =
              doc.storagePath &&
              doc.storageBucket === PUBLIC_MEDIA_BUCKET &&
              (!willBePublished || doc.visibility !== 'Public');
            if (leavingPublic && doc.storagePath) {
              await ensurePrivateBackupFromPublicBucket(doc.storagePath, doc.mimeType, client);
            }
          }
          for (const pres of orderedRawPresentations) {
            const isPresPub = willBePublished && pres.visibility === 'Public';
            if (pres.pdfStoragePath && pres.pdfStorageBucket === PUBLIC_MEDIA_BUCKET && !isPresPub) {
              await ensurePrivateBackupFromPublicBucket(
                pres.pdfStoragePath,
                pres.pdfMimeType || 'application/pdf',
                client
              );
            }
            if (
              pres.pptxStoragePath &&
              pres.pptxStorageBucket === PUBLIC_MEDIA_BUCKET &&
              (!isPresPub || !pres.allowDownload)
            ) {
              await ensurePrivateBackupFromPublicBucket(
                pres.pptxStoragePath,
                pres.pptxMimeType || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                client
              );
            }
            if (pres.coverStoragePath && pres.coverStorageBucket === PUBLIC_MEDIA_BUCKET && !isPresPub) {
              await ensurePrivateBackupFromPublicBucket(pres.coverStoragePath, 'image/webp', client);
            }
          }

          const newlyPromotedPublicPaths: string[] = [];

          const step3UpdatedAt = nextOptimisticTimestamp(prevSnapshot.updated_at);
          const initialRow = {
            ...mapPropertyToRow({
              ...normalizedInput,
              lotId: lockedLotId,
              isArchived,
              images: orderedRawImages,
              videos: validatedVideos,
              presentations: orderedRawPresentations,
              youtubeUrl: validatedVideos[0]?.url || '',
              photos: willBePublished ? prevSnapshot.photos || [] : [],
            }),
            updated_at: step3UpdatedAt,
          };

          const {data: updatedPropRow, error: propUpdateErr} = await client
            .from('properties')
            .update(initialRow)
            .eq('id', id)
            .eq('updated_at', prevSnapshot.updated_at)
            .select()
            .maybeSingle();
          if (propUpdateErr) throw new Error(propUpdateErr.message);
          if (!updatedPropRow) {
            throw new Error(
              'Concurrent update detected: this listing was modified by another session. Reload and try again.'
            );
          }

          const committedUpdatedAt = (updatedPropRow.updated_at as string) || step3UpdatedAt;

          const prevRelations: PreviousRelationsSnapshot = {
            images: (prevImgRows || []) as Array<Record<string, unknown>>,
            videos: (prevVidRows || []) as Array<Record<string, unknown>>,
            documents: (prevDocRows || []) as Array<Record<string, unknown>>,
            presentations: (prevPresRows || []) as Array<Record<string, unknown>>,
          };

          let cleanupTargets: RelationSyncResult = {
            orphanPublicPaths: [],
            orphanPrivatePaths: [],
            redundantPrivatePaths: [],
          };

          try {
            const {preparedImages, preparedDocuments, preparedPresentations} =
              await resolveMediaAfterPropertyCommitted(
                client,
                {
                  ...normalizedInput,
                  lotId: lockedLotId,
                  isArchived,
                  images: orderedRawImages,
                  videos: validatedVideos,
                  presentations: orderedRawPresentations,
                },
                prevPublicPaths,
                newlyPromotedPublicPaths
              );

            const orderedApprovedUrls = sortImagesCoverFirst(preparedImages)
              .filter((img) => (willBePublished ? img.isApprovedPublic : true))
              .map((img) => img.url);
            const orderedPhotos =
              orderedApprovedUrls.length > 0
                ? orderedApprovedUrls
                : willBePublished
                  ? []
                  : normalizedInput.photos;

            const preparedInput: PropertyInput = {
              ...normalizedInput,
              lotId: lockedLotId,
              isArchived,
              images: preparedImages,
              documents: preparedDocuments,
              presentations: preparedPresentations,
              photos: orderedPhotos,
              videos: validatedVideos,
              youtubeUrl: validatedVideos[0]?.url || '',
            };

            cleanupTargets = await syncPropertyRelationsInSupabase(id, preparedInput, client, {
              deferStorageCleanup: true,
            });

            const finalUpdatedAt = nextOptimisticTimestamp(committedUpdatedAt);
            const {data: finalPropRow, error: photosErr} = await client
              .from('properties')
              .update({photos: orderedPhotos, updated_at: finalUpdatedAt})
              .eq('id', id)
              .eq('updated_at', committedUpdatedAt)
              .select()
              .maybeSingle();
            if (photosErr) throw new Error(photosErr.message);
            if (!finalPropRow) {
              throw new Error(
                'Concurrent update detected during media sync: another administrator saved newer changes.'
              );
            }

            const [safePubOrphans, safePrivOrphans, safeRedundantPriv] = await Promise.all([
              findDeletableStoragePaths(
                client,
                PUBLIC_MEDIA_BUCKET,
                cleanupTargets.orphanPublicPaths,
                id
              ),
              findDeletableStoragePaths(
                client,
                PRIVATE_MEDIA_BUCKET,
                cleanupTargets.orphanPrivatePaths,
                id
              ),
              findDeletableStoragePaths(
                client,
                PRIVATE_MEDIA_BUCKET,
                cleanupTargets.redundantPrivatePaths,
                id
              ),
            ]);

            await removeStoragePathsFromBucket(PUBLIC_MEDIA_BUCKET, safePubOrphans, client);
            await removeStoragePathsFromBucket(
              PRIVATE_MEDIA_BUCKET,
              [...safePrivOrphans, ...safeRedundantPriv],
              client
            );

            return normalizeProperty({
              ...preparedInput,
              id: finalPropRow?.id || updatedPropRow.id,
              updatedAt: finalPropRow?.updated_at || committedUpdatedAt,
            });
          } catch (err) {
            const restoredRow = await restorePropertyRowSnapshot(
              client,
              id,
              prevSnapshot,
              committedUpdatedAt
            );
            if (restoredRow) {
              await restoreRelationsSnapshot(client, id, prevRelations);
            }
            if (newlyPromotedPublicPaths.length > 0) {
              const safePromotedCleanup = await findDeletableStoragePaths(
                client,
                PUBLIC_MEDIA_BUCKET,
                newlyPromotedPublicPaths
              );
              await cleanupPromotedPublicObjects(safePromotedCleanup, client);
            }
            if (!restoredRow) {
              const baseMessage = err instanceof Error ? err.message : 'Update failed.';
              throw new Error(
                `${baseMessage} Concurrent changes from another administrator were detected and preserved.`
              );
            }
            throw err;
          }
        }

        const existing = readDemoProperties();
        const current = existing.find((item) => item.id === id);
        if (!current) {
          throw new Error('Property record not found.');
        }
        if (
          normalizedInput.expectedUpdatedAt &&
          current.updatedAt !== normalizedInput.expectedUpdatedAt
        ) {
          throw new Error(
            'Concurrent update detected: another session modified this listing. Reload before saving.'
          );
        }

        const lockedLotId = current.lotId;
        const [preparedImages, preparedDocuments, preparedPresentations] = await Promise.all([
          prepareImagesForVisibility(orderedRawImages, normalizedInput.visibility),
          prepareDocumentsForVisibility(normalizedInput.documents || [], normalizedInput.visibility),
          preparePresentationsForVisibility(orderedRawPresentations, normalizedInput.visibility),
        ]);
        const updated = normalizeProperty({
          ...normalizedInput,
          lotId: lockedLotId,
          id,
          isArchived: normalizedInput.visibility === 'Archived' || normalizedInput.isArchived,
          images: preparedImages,
          documents: preparedDocuments,
          presentations: preparedPresentations,
          photos:
            preparedImages.length > 0
              ? sortImagesCoverFirst(preparedImages).map((img) => img.url)
              : normalizedInput.photos,
          videos: validatedVideos,
          youtubeUrl: validatedVideos[0]?.url || '',
          updatedAt: nextOptimisticTimestamp(current.updatedAt),
        });
        const next = existing.map((item) => (item.id === id ? updated : item));
        writeDemoProperties(next);
        return updated;
      });
    },

    async setVisibility(id: string, visibility: PropertyVisibility): Promise<Property | void> {
      return withPropertyMutationLock(id, async () => {
        const isArchived = visibility === 'Archived';
        const client = activeClient();

        if (client) {
          const {data: currentRow, error: fetchErr} = await client
            .from('properties')
            .select(
              '*, property_images(*), property_videos(*), property_documents(*), property_presentations(*)'
            )
            .eq('id', id)
            .single();
          if (fetchErr || !currentRow) {
            throw new Error(fetchErr?.message || 'Property record not found.');
          }

          const prevSnapshot = currentRow as SupabasePropertyRow;
          const mapped = mapRowToProperty(prevSnapshot, client);
          const imgRows = prevSnapshot.property_images || [];
          const docRows = prevSnapshot.property_documents || [];
          const presRows = prevSnapshot.property_presentations || [];
          const prevRelations: PreviousRelationsSnapshot = {
            images: imgRows.map((img) => ({...img, property_id: id})),
            videos: (prevSnapshot.property_videos || []).map((v) => ({...v, property_id: id})),
            documents: docRows.map((d) => ({...d, property_id: id})),
            presentations: presRows.map((p) => ({...p, property_id: id})),
          };

          if (visibility === 'Published') {
            const publishErrors = validatePropertyForPublish(mapped);
            if (publishErrors.length > 0) {
              throw new Error(publishErrors[0]);
            }

            const prevPublicPaths = new Set<string>(
              [...imgRows, ...docRows]
                .filter((r) => r.storage_bucket === PUBLIC_MEDIA_BUCKET && r.storage_path)
                .map((r) => r.storage_path)
            );
            for (const p of presRows) {
              if (p.pdf_storage_bucket === PUBLIC_MEDIA_BUCKET && p.pdf_storage_path) {
                prevPublicPaths.add(p.pdf_storage_path);
              }
              if (p.pptx_storage_bucket === PUBLIC_MEDIA_BUCKET && p.pptx_storage_path) {
                prevPublicPaths.add(p.pptx_storage_path);
              }
              if (p.cover_storage_bucket === PUBLIC_MEDIA_BUCKET && p.cover_storage_path) {
                prevPublicPaths.add(p.cover_storage_path);
              }
            }

            const newlyPromotedPublicPaths: string[] = [];
            const nextPublishedAt = mapped.publishedAt || new Date().toISOString();
            const step1UpdatedAt = nextOptimisticTimestamp(prevSnapshot.updated_at);
            const {data: pubRow, error: propPubErr} = await client
              .from('properties')
              .update({
                visibility: 'Published',
                is_archived: false,
                published_at: nextPublishedAt,
                updated_at: step1UpdatedAt,
              })
              .eq('id', id)
              .eq('updated_at', prevSnapshot.updated_at)
              .select()
              .maybeSingle();
            if (propPubErr) throw new Error(propPubErr.message);
            if (!pubRow) {
              throw new Error(
                'Concurrent update detected while publishing. Reload and try again.'
              );
            }
            const committedUpdatedAt = (pubRow.updated_at as string) || step1UpdatedAt;

            try {
              const updatedImages: PropertyImageItem[] = [];
              const promotedPrivateDuplicates: string[] = [];

              for (const row of imgRows) {
                if (!row.is_approved_public) {
                  const signed = row.storage_path
                    ? await refreshPrivateImageSignedUrl(row.storage_path, client)
                    : null;
                  updatedImages.push({
                    id: row.id,
                    url: signed || row.public_url,
                    storageBucket: PRIVATE_MEDIA_BUCKET,
                    storagePath: row.storage_path,
                    caption: row.caption,
                    isCover: row.is_cover,
                    isApprovedPublic: false,
                    sortOrder: row.sort_order,
                  });
                  continue;
                }

                let finalUrl = row.public_url;
                if (row.storage_bucket === PRIVATE_MEDIA_BUCKET && row.storage_path) {
                  const promoted = await promoteImageToPublicBucket(row.storage_path, client);
                  if (!promoted) {
                    throw new Error(
                      `Failed to promote approved image "${row.storage_path}" to public storage before publishing.`
                    );
                  }
                  if (!prevPublicPaths.has(row.storage_path)) {
                    newlyPromotedPublicPaths.push(row.storage_path);
                  }
                  promotedPrivateDuplicates.push(row.storage_path);
                  finalUrl = promoted;
                }

                const {error: imgUpdErr} = await client
                  .from('property_images')
                  .update({
                    storage_bucket: PUBLIC_MEDIA_BUCKET,
                    is_approved_public: true,
                    public_url: finalUrl,
                  })
                  .eq('id', row.id);
                if (imgUpdErr) throw new Error(imgUpdErr.message);

                updatedImages.push({
                  id: row.id,
                  url: finalUrl,
                  storageBucket: PUBLIC_MEDIA_BUCKET,
                  storagePath: row.storage_path,
                  caption: row.caption,
                  isCover: row.is_cover,
                  isApprovedPublic: true,
                  sortOrder: row.sort_order,
                });
              }

              const updatedDocs: PropertyDocumentItem[] = [];
              for (const d of docRows) {
                if (
                  d.visibility === 'Public' &&
                  d.storage_bucket === PRIVATE_MEDIA_BUCKET &&
                  d.storage_path
                ) {
                  const promotedDocUrl = await promoteFileToPublicBucket(
                    d.storage_path,
                    d.mime_type,
                    client
                  );
                  if (!promotedDocUrl) {
                    throw new Error(
                      `Failed to promote public document "${d.file_name}" before publishing.`
                    );
                  }
                  if (!prevPublicPaths.has(d.storage_path)) {
                    newlyPromotedPublicPaths.push(d.storage_path);
                  }
                  promotedPrivateDuplicates.push(d.storage_path);
                  const {error: docUpdErr} = await client
                    .from('property_documents')
                    .update({storage_bucket: PUBLIC_MEDIA_BUCKET})
                    .eq('id', d.id);
                  if (docUpdErr) throw new Error(docUpdErr.message);

                  updatedDocs.push({
                    id: d.id,
                    title: d.title,
                    category: d.category,
                    visibility: d.visibility,
                    storageBucket: PUBLIC_MEDIA_BUCKET,
                    storagePath: d.storage_path,
                    fileName: d.file_name,
                    mimeType: d.mime_type,
                    fileSizeBytes: Number(d.file_size_bytes) || 0,
                    publicUrl: promotedDocUrl,
                    uploadedAt: d.created_at,
                  });
                } else {
                  updatedDocs.push({
                    id: d.id,
                    title: d.title,
                    category: d.category,
                    visibility: d.visibility,
                    storageBucket: d.storage_bucket,
                    storagePath: d.storage_path,
                    fileName: d.file_name,
                    mimeType: d.mime_type,
                    fileSizeBytes: Number(d.file_size_bytes) || 0,
                    uploadedAt: d.created_at,
                  });
                }
              }

              const updatedPres: PropertyPresentationItem[] = [];
              for (const p of presRows) {
                const isPublicPres = p.visibility === 'Public';
                let pdfBucket = p.pdf_storage_bucket;
                let pptxBucket = p.pptx_storage_bucket;
                let coverBucket = p.cover_storage_bucket;
                let coverUrl = p.cover_public_url;

                if (isPublicPres && p.pdf_storage_path && p.pdf_storage_bucket === PRIVATE_MEDIA_BUCKET) {
                  const promotedPdf = await promoteFileToPublicBucket(
                    p.pdf_storage_path,
                    p.pdf_mime_type || 'application/pdf',
                    client
                  );
                  if (!promotedPdf) {
                    throw new Error(`Failed to promote public presentation "${p.title}" PDF.`);
                  }
                  if (!prevPublicPaths.has(p.pdf_storage_path)) {
                    newlyPromotedPublicPaths.push(p.pdf_storage_path);
                  }
                  promotedPrivateDuplicates.push(p.pdf_storage_path);
                  pdfBucket = PUBLIC_MEDIA_BUCKET;
                }
                if (
                  isPublicPres &&
                  p.allow_download &&
                  p.pptx_storage_path &&
                  p.pptx_storage_bucket === PRIVATE_MEDIA_BUCKET
                ) {
                  const promotedPptx = await promoteFileToPublicBucket(
                    p.pptx_storage_path,
                    p.pptx_mime_type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    client
                  );
                  if (!promotedPptx) {
                    throw new Error(`Failed to promote public presentation "${p.title}" PPTX.`);
                  }
                  if (!prevPublicPaths.has(p.pptx_storage_path)) {
                    newlyPromotedPublicPaths.push(p.pptx_storage_path);
                  }
                  promotedPrivateDuplicates.push(p.pptx_storage_path);
                  pptxBucket = PUBLIC_MEDIA_BUCKET;
                }
                if (isPublicPres && p.cover_storage_path && p.cover_storage_bucket === PRIVATE_MEDIA_BUCKET) {
                  const promotedCover = await promoteImageToPublicBucket(p.cover_storage_path, client);
                  if (!promotedCover) {
                    throw new Error(`Failed to promote presentation cover for "${p.title}".`);
                  }
                  if (!prevPublicPaths.has(p.cover_storage_path)) {
                    newlyPromotedPublicPaths.push(p.cover_storage_path);
                  }
                  promotedPrivateDuplicates.push(p.cover_storage_path);
                  coverBucket = PUBLIC_MEDIA_BUCKET;
                  coverUrl = promotedCover;
                }

                if (
                  pdfBucket !== p.pdf_storage_bucket ||
                  pptxBucket !== p.pptx_storage_bucket ||
                  coverBucket !== p.cover_storage_bucket ||
                  coverUrl !== p.cover_public_url
                ) {
                  const {error: presUpdErr} = await client
                    .from('property_presentations')
                    .update({
                      pdf_storage_bucket: pdfBucket,
                      pptx_storage_bucket: pptxBucket,
                      cover_storage_bucket: coverBucket,
                      cover_public_url: coverUrl,
                    })
                    .eq('id', p.id);
                  if (presUpdErr) throw new Error(presUpdErr.message);
                }

                updatedPres.push(
                  mapPresentationRow(
                    {
                      ...p,
                      pdf_storage_bucket: pdfBucket,
                      pptx_storage_bucket: pptxBucket,
                      cover_storage_bucket: coverBucket,
                      cover_public_url: coverUrl,
                    },
                    client
                  )
                );
              }

              const orderedApprovedUrls = sortImagesCoverFirst(updatedImages)
                .filter((img) => img.isApprovedPublic)
                .map((img) => img.url);
              const fallbackPhotos =
                orderedApprovedUrls.length > 0 ? orderedApprovedUrls : mapped.photos;

              const finalUpdatedAt = nextOptimisticTimestamp(committedUpdatedAt);
              const {data: finalRow, error: photoSyncErr} = await client
                .from('properties')
                .update({photos: fallbackPhotos, updated_at: finalUpdatedAt})
                .eq('id', id)
                .eq('updated_at', committedUpdatedAt)
                .select()
                .maybeSingle();
              if (photoSyncErr) throw new Error(photoSyncErr.message);
              if (!finalRow) {
                throw new Error(
                  'Concurrent update detected while publishing media. Newer administrator changes were detected.'
                );
              }

              if (promotedPrivateDuplicates.length > 0) {
                const safeRedundant = await findDeletableStoragePaths(
                  client,
                  PRIVATE_MEDIA_BUCKET,
                  promotedPrivateDuplicates,
                  id
                );
                await removeStoragePathsFromBucket(PRIVATE_MEDIA_BUCKET, safeRedundant, client);
              }

              return normalizeProperty({
                ...mapped,
                visibility: 'Published',
                isArchived: false,
                publishedAt: nextPublishedAt,
                images: sortImagesCoverFirst(updatedImages),
                photos: fallbackPhotos,
                documents: updatedDocs,
                presentations: sortPresentations(updatedPres),
                updatedAt: finalRow?.updated_at || committedUpdatedAt,
              });
            } catch (err) {
              const restoredRow = await restorePropertyRowSnapshot(
                client,
                id,
                prevSnapshot,
                committedUpdatedAt
              );
              if (restoredRow) {
                await restoreRelationsSnapshot(client, id, prevRelations);
              }
              if (newlyPromotedPublicPaths.length > 0) {
                const safePromotedCleanup = await findDeletableStoragePaths(
                  client,
                  PUBLIC_MEDIA_BUCKET,
                  newlyPromotedPublicPaths
                );
                await cleanupPromotedPublicObjects(safePromotedCleanup, client);
              }
              if (!restoredRow) {
                const baseMessage = err instanceof Error ? err.message : 'Publishing failed.';
                throw new Error(
                  `${baseMessage} Concurrent changes from another administrator were detected and preserved.`
                );
              }
              throw err;
            }
          }

          // Unpublishing / Archiving:
          const publicPathsToRemove: string[] = [];
          for (const row of imgRows) {
            if (row.storage_bucket === PUBLIC_MEDIA_BUCKET && row.storage_path) {
              await ensurePrivateBackupFromPublicBucket(row.storage_path, 'image/webp', client);
              publicPathsToRemove.push(row.storage_path);
            }
          }
          for (const doc of docRows) {
            if (doc.storage_bucket === PUBLIC_MEDIA_BUCKET && doc.storage_path) {
              await ensurePrivateBackupFromPublicBucket(doc.storage_path, doc.mime_type, client);
              publicPathsToRemove.push(doc.storage_path);
            }
          }
          for (const pres of presRows) {
            if (pres.pdf_storage_bucket === PUBLIC_MEDIA_BUCKET && pres.pdf_storage_path) {
              await ensurePrivateBackupFromPublicBucket(
                pres.pdf_storage_path,
                pres.pdf_mime_type || 'application/pdf',
                client
              );
              publicPathsToRemove.push(pres.pdf_storage_path);
            }
            if (pres.pptx_storage_bucket === PUBLIC_MEDIA_BUCKET && pres.pptx_storage_path) {
              await ensurePrivateBackupFromPublicBucket(
                pres.pptx_storage_path,
                pres.pptx_mime_type || 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                client
              );
              publicPathsToRemove.push(pres.pptx_storage_path);
            }
            if (pres.cover_storage_bucket === PUBLIC_MEDIA_BUCKET && pres.cover_storage_path) {
              await ensurePrivateBackupFromPublicBucket(
                pres.cover_storage_path,
                'image/webp',
                client
              );
              publicPathsToRemove.push(pres.cover_storage_path);
            }
          }

          const step2UpdatedAt = nextOptimisticTimestamp(prevSnapshot.updated_at);
          const {data: unpubRow, error: propUnpubErr} = await client
            .from('properties')
            .update({
              visibility,
              is_archived: isArchived,
              updated_at: step2UpdatedAt,
            })
            .eq('id', id)
            .eq('updated_at', prevSnapshot.updated_at)
            .select()
            .maybeSingle();
          if (propUnpubErr) throw new Error(propUnpubErr.message);
          if (!unpubRow) {
            throw new Error(
              'Concurrent update detected while unpublishing. Reload and try again.'
            );
          }
          const committedUpdatedAt = (unpubRow.updated_at as string) || step2UpdatedAt;

          try {
            const demotedImages: PropertyImageItem[] = [];
            for (const row of imgRows) {
              let nextUrl = row.public_url;
              if (row.storage_path) {
                const signed = await refreshPrivateImageSignedUrl(row.storage_path, client);
                if (signed) nextUrl = signed;
              }
              const {error: imgDemoteErr} = await client
                .from('property_images')
                .update({
                  storage_bucket: PRIVATE_MEDIA_BUCKET,
                  is_approved_public: false,
                  public_url: nextUrl,
                })
                .eq('id', row.id);
              if (imgDemoteErr) throw new Error(imgDemoteErr.message);

              demotedImages.push({
                id: row.id,
                url: nextUrl,
                storageBucket: PRIVATE_MEDIA_BUCKET,
                storagePath: row.storage_path,
                caption: row.caption,
                isCover: row.is_cover,
                isApprovedPublic: false,
                sortOrder: row.sort_order,
              });
            }

            const demotedDocs: PropertyDocumentItem[] = [];
            for (const doc of docRows) {
              if (doc.storage_bucket === PUBLIC_MEDIA_BUCKET) {
                const {error: docDemoteErr} = await client
                  .from('property_documents')
                  .update({storage_bucket: PRIVATE_MEDIA_BUCKET})
                  .eq('id', doc.id);
                if (docDemoteErr) throw new Error(docDemoteErr.message);
              }
              demotedDocs.push({
                id: doc.id,
                title: doc.title,
                category: doc.category,
                visibility: doc.visibility,
                storageBucket: PRIVATE_MEDIA_BUCKET,
                storagePath: doc.storage_path,
                fileName: doc.file_name,
                mimeType: doc.mime_type,
                fileSizeBytes: Number(doc.file_size_bytes) || 0,
                uploadedAt: doc.created_at,
              });
            }

            const demotedPres: PropertyPresentationItem[] = [];
            for (const p of presRows) {
              let nextCoverUrl = p.cover_public_url;
              if (p.cover_storage_path) {
                const signedCover = await refreshPrivateImageSignedUrl(p.cover_storage_path, client);
                if (signedCover) nextCoverUrl = signedCover;
              }
              if (
                p.pdf_storage_bucket === PUBLIC_MEDIA_BUCKET ||
                p.pptx_storage_bucket === PUBLIC_MEDIA_BUCKET ||
                p.cover_storage_bucket === PUBLIC_MEDIA_BUCKET
              ) {
                const {error: presDemoteErr} = await client
                  .from('property_presentations')
                  .update({
                    pdf_storage_bucket: PRIVATE_MEDIA_BUCKET,
                    pptx_storage_bucket: PRIVATE_MEDIA_BUCKET,
                    cover_storage_bucket: PRIVATE_MEDIA_BUCKET,
                    cover_public_url: nextCoverUrl,
                  })
                  .eq('id', p.id);
                if (presDemoteErr) throw new Error(presDemoteErr.message);
              }
              demotedPres.push(
                mapPresentationRow(
                  {
                    ...p,
                    pdf_storage_bucket: PRIVATE_MEDIA_BUCKET,
                    pptx_storage_bucket: PRIVATE_MEDIA_BUCKET,
                    cover_storage_bucket: PRIVATE_MEDIA_BUCKET,
                    cover_public_url: nextCoverUrl,
                  },
                  client
                )
              );
            }

            const demotedPhotoUrls = sortImagesCoverFirst(demotedImages).map((i) => i.url);
            let finalUpdatedAt = committedUpdatedAt;
            if (demotedPhotoUrls.length > 0) {
              const nextUnpubTs = nextOptimisticTimestamp(committedUpdatedAt);
              const {data: photosUpdRow, error: photosUpdErr} = await client
                .from('properties')
                .update({photos: demotedPhotoUrls, updated_at: nextUnpubTs})
                .eq('id', id)
                .eq('updated_at', committedUpdatedAt)
                .select()
                .maybeSingle();
              if (photosUpdErr) throw new Error(photosUpdErr.message);
              if (!photosUpdRow) {
                throw new Error(
                  'Concurrent update detected while unpublishing media. Newer administrator changes were detected.'
                );
              }
              finalUpdatedAt = (photosUpdRow.updated_at as string) || nextUnpubTs;
            }

            const safePublicRemoval = await findDeletableStoragePaths(
              client,
              PUBLIC_MEDIA_BUCKET,
              publicPathsToRemove,
              id
            );
            await removeStoragePathsFromBucket(PUBLIC_MEDIA_BUCKET, safePublicRemoval, client);

            return normalizeProperty({
              ...mapped,
              visibility,
              isArchived,
              images: sortImagesCoverFirst(demotedImages),
              photos: demotedPhotoUrls.length > 0 ? demotedPhotoUrls : mapped.photos,
              documents: demotedDocs,
              presentations: sortPresentations(demotedPres),
              updatedAt: finalUpdatedAt,
            });
          } catch (err) {
            const restoredRow = await restorePropertyRowSnapshot(
              client,
              id,
              prevSnapshot,
              committedUpdatedAt
            );
            if (restoredRow) {
              await restoreRelationsSnapshot(client, id, prevRelations);
            }
            if (!restoredRow) {
              const baseMessage = err instanceof Error ? err.message : 'Unpublishing failed.';
              throw new Error(
                `${baseMessage} Concurrent changes from another administrator were detected and preserved.`
              );
            }
            throw err;
          }
        }

        const existing = readDemoProperties();
        if (visibility === 'Published') {
          const target = existing.find((item) => item.id === id);
          if (target) {
            const publishErrors = validatePropertyForPublish(target);
            if (publishErrors.length > 0) {
              throw new Error(publishErrors[0]);
            }
          }
        }
        let updatedDemoProperty: Property | undefined;
        const updatedList = await Promise.all(
          existing.map(async (item) => {
            if (item.id !== id) return item;
            const [preparedImages, preparedDocuments, preparedPresentations] = await Promise.all([
              prepareImagesForVisibility(item.images, visibility),
              prepareDocumentsForVisibility(item.documents, visibility),
              preparePresentationsForVisibility(item.presentations || [], visibility),
            ]);
            const orderedPhotos =
              preparedImages.length > 0
                ? sortImagesCoverFirst(preparedImages).map((img) => img.url)
                : item.photos;
            updatedDemoProperty = normalizeProperty({
              ...item,
              visibility,
              isArchived,
              images: preparedImages,
              photos: orderedPhotos,
              documents: preparedDocuments,
              presentations: preparedPresentations,
              publishedAt:
                visibility === 'Published'
                  ? item.publishedAt || new Date().toISOString()
                  : item.publishedAt,
              updatedAt: new Date().toISOString(),
            });
            return updatedDemoProperty;
          })
        );
        writeDemoProperties(updatedList);
        return updatedDemoProperty;
      });
    },

    async bulkUpdateStatus(ids: string[], status: PropertyStatus): Promise<void> {
      if (ids.length === 0) return;
      const client = activeClient();
      if (client) {
        const {error} = await client
          .from('properties')
          .update({status, updated_at: new Date().toISOString()})
          .in('id', ids);
        if (error) throw new Error(error.message);
        return;
      }

      const idSet = new Set(ids);
      const existing = readDemoProperties();
      writeDemoProperties(
        existing.map((item) =>
          idSet.has(item.id)
            ? {...item, status, updatedAt: new Date().toISOString()}
            : item
        )
      );
    },

    async bulkUpdateVisibility(ids: string[], visibility: PropertyVisibility): Promise<void> {
      if (ids.length === 0) return;
      for (const id of ids) {
        await this.setVisibility(id, visibility);
      }
    },

    async deleteProperty(id: string): Promise<void> {
      return withPropertyMutationLock(id, async () => {
        const client = activeClient();
        if (client) {
          const [{data: imgRows}, {data: docRows}, {data: presRows}] = await Promise.all([
            client
              .from('property_images')
              .select('storage_bucket, storage_path')
              .eq('property_id', id),
            client
              .from('property_documents')
              .select('storage_bucket, storage_path')
              .eq('property_id', id),
            client
              .from('property_presentations')
              .select(
                'pdf_storage_bucket, pdf_storage_path, pptx_storage_bucket, pptx_storage_path, cover_storage_bucket, cover_storage_path'
              )
              .eq('property_id', id),
          ]);

          const publicPaths: string[] = [];
          const privatePaths: string[] = [];
          for (const row of [...(imgRows || []), ...(docRows || [])]) {
            const path = row.storage_path as string;
            if (!path) continue;
            if (row.storage_bucket === PUBLIC_MEDIA_BUCKET) {
              publicPaths.push(path);
            } else {
              privatePaths.push(path);
            }
          }
          for (const p of (presRows || []) as SupabasePresentationRow[]) {
            if (p.pdf_storage_path) {
              (p.pdf_storage_bucket === PUBLIC_MEDIA_BUCKET ? publicPaths : privatePaths).push(
                p.pdf_storage_path
              );
            }
            if (p.pptx_storage_path) {
              (p.pptx_storage_bucket === PUBLIC_MEDIA_BUCKET ? publicPaths : privatePaths).push(
                p.pptx_storage_path
              );
            }
            if (p.cover_storage_path) {
              (p.cover_storage_bucket === PUBLIC_MEDIA_BUCKET ? publicPaths : privatePaths).push(
                p.cover_storage_path
              );
            }
          }

          const {error} = await client.from('properties').delete().eq('id', id);
          if (error) throw new Error(error.message);

          const [safePublicPaths, safePrivatePaths] = await Promise.all([
            findDeletableStoragePaths(client, PUBLIC_MEDIA_BUCKET, publicPaths),
            findDeletableStoragePaths(client, PRIVATE_MEDIA_BUCKET, [...privatePaths, ...publicPaths]),
          ]);

          await removeStoragePathsFromBucket(PUBLIC_MEDIA_BUCKET, safePublicPaths, client);
          await removeStoragePathsFromBucket(PRIVATE_MEDIA_BUCKET, safePrivatePaths, client);
          return;
        }

        const existing = readDemoProperties();
        writeDemoProperties(existing.filter((item) => item.id !== id));
      });
    },

    async listInquiries(): Promise<BuyerInquiry[]> {
      const client = activeClient();
      if (client) {
        const {data, error} = await client
          .from('inquiries')
          .select('*')
          .order('created_at', {ascending: false});
        if (error) throw new Error(error.message);
        return (data || []).map((row) => ({
          id: row.id,
          propertyLotId: row.property_lot_id,
          propertyTitle: row.property_title,
          buyerName: row.buyer_name,
          buyerEmail: row.buyer_email,
          buyerPhone: row.buyer_phone,
          preferredDate: row.preferred_date || undefined,
          message: row.message,
          status: row.status,
          createdAt: row.created_at,
        }));
      }

      return readDemoInquiries();
    },

    async createInquiry(
      payload: Omit<BuyerInquiry, 'id' | 'status' | 'createdAt'>
    ): Promise<BuyerInquiry> {
      const client = activeClient();
      if (client) {
        // Omit status/id/created_at: anon & non-admin authenticated only have column-level INSERT on user-facing fields
        const {error} = await client.from('inquiries').insert({
          property_lot_id: payload.propertyLotId,
          property_title: payload.propertyTitle,
          buyer_name: payload.buyerName,
          buyer_email: payload.buyerEmail,
          buyer_phone: payload.buyerPhone,
          preferred_date: payload.preferredDate || null,
          message: payload.message,
        });
        if (error) throw new Error(error.message);
        return {
          id: `inq-${Date.now()}`,
          propertyLotId: payload.propertyLotId,
          propertyTitle: payload.propertyTitle,
          buyerName: payload.buyerName,
          buyerEmail: payload.buyerEmail,
          buyerPhone: payload.buyerPhone,
          preferredDate: payload.preferredDate,
          message: payload.message,
          status: 'New',
          createdAt: new Date().toISOString(),
        };
      }

      const created: BuyerInquiry = {
        ...payload,
        id: `inq-${Date.now()}`,
        status: 'New',
        createdAt: new Date().toISOString(),
      };
      const next = [created, ...readDemoInquiries()];
      writeDemoInquiries(next);
      return created;
    },

    async updateInquiryStatus(id: string, status: InquiryStatus): Promise<void> {
      const client = activeClient();
      if (client) {
        const {error} = await client
          .from('inquiries')
          .update({status})
          .eq('id', id);
        if (error) throw new Error(error.message);
        return;
      }

      const next = readDemoInquiries().map((item) =>
        item.id === id ? {...item, status} : item
      );
      writeDemoInquiries(next);
    },

    async getSiteSettings(): Promise<SiteSettings> {
      const client = activeClient();
      if (client) {
        const {data, error} = await client
          .from('site_settings')
          .select('*')
          .eq('id', 'default')
          .maybeSingle();
        if (!error && data) {
          return {
            canonicalSiteUrl:
              data.canonical_site_url || DEFAULT_SITE_SETTINGS.canonicalSiteUrl,
            defaultAgentName: data.default_agent_name || '',
            defaultAgentPhone: data.default_agent_phone || '',
            defaultAgentWhatsapp: data.default_agent_whatsapp || '',
            defaultAgentMessenger: data.default_agent_messenger || '',
          };
        }
      }
      return readLocalSettings();
    },

    async saveSiteSettings(settings: SiteSettings): Promise<SiteSettings> {
      const client = activeClient();
      if (client) {
        const {error} = await client.from('site_settings').upsert({
          id: 'default',
          canonical_site_url: settings.canonicalSiteUrl,
          default_agent_name: settings.defaultAgentName,
          default_agent_phone: settings.defaultAgentPhone,
          default_agent_whatsapp: settings.defaultAgentWhatsapp,
          default_agent_messenger: settings.defaultAgentMessenger,
          updated_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        return settings;
      }
      writeLocalSettings(settings);
      return settings;
    },

    resetDemoData(): {properties: Property[]; inquiries: BuyerInquiry[]} {
      const normalized = DEMO_PROPERTIES.map((p) => normalizeProperty(p));
      writeDemoProperties(normalized);
      writeDemoInquiries(DEMO_INQUIRIES);
      return {
        properties: normalized,
        inquiries: DEMO_INQUIRIES,
      };
    },
  };
}

export const propertyService = createPropertyService();
