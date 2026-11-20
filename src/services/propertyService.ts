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

export function normalizeProperty(raw: Partial<Property> & {id: string; lotId: string}): Property {
  const lotAreaSqm = Number(raw.lotAreaSqm) || 1;
  const priceTotalPhp = Number(raw.priceTotalPhp) || 0;
  const pricePerSqm =
    raw.pricePerSqm !== undefined && raw.pricePerSqm >= 0
      ? Number(raw.pricePerSqm)
      : computePricePerSqm(priceTotalPhp, lotAreaSqm);

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
    dimensions: raw.dimensions || '',
    boundaryDescription: raw.boundaryDescription || '',
    pricePerSqm,
    priceTotalPhp,
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
    latitude:
      raw.latitude !== undefined && raw.latitude !== null && raw.latitude !== ('' as unknown) && Number.isFinite(Number(raw.latitude))
        ? Number(raw.latitude)
        : Number.NaN,
    longitude:
      raw.longitude !== undefined && raw.longitude !== null && raw.longitude !== ('' as unknown) && Number.isFinite(Number(raw.longitude))
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
  if (input.priceTotalPhp < 0) {
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
  dimensions: string;
  boundary_description?: string;
  price_per_sqm?: number;
  price_total_php: number;
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
    source_type: 'youtube' | 'google_drive' | 'direct';
    youtube_url: string;
    title: string;
    description: string;
    sort_order: number;
  }>;
  property_documents?: Array<{
    id: string;
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
}

function mapRowToProperty(row: SupabasePropertyRow): Property {
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
    dimensions: row.dimensions,
    boundaryDescription: row.boundary_description || '',
    pricePerSqm:
      row.price_per_sqm !== undefined ? Number(row.price_per_sqm) : undefined,
    priceTotalPhp: Number(row.price_total_php),
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
    dimensions: input.dimensions,
    boundary_description: input.boundaryDescription,
    price_per_sqm: input.pricePerSqm,
    price_total_php: input.priceTotalPhp,
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
}

async function restorePropertyRowSnapshot(
  client: NonNullable<SupabaseClientLike>,
  propertyId: string,
  prevRow: SupabasePropertyRow
): Promise<void> {
  try {
    await client
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
        dimensions: prevRow.dimensions,
        boundary_description: prevRow.boundary_description || '',
        price_per_sqm: prevRow.price_per_sqm ?? 0,
        price_total_php: prevRow.price_total_php,
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
  } catch {
    // Best-effort compensating rollback
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
  } catch {
    // Best-effort compensating rollback
  }
}

function collectActiveStoragePaths(
  input: Pick<PropertyInput, 'images' | 'documents' | 'visibility' | 'isArchived'>
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

  return {activePublicPaths, activePrivatePaths};
}

/**
 * Ensures Storage files still referenced by another property record (or still active in the bucket)
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

  const [{data: imgRefs, error: imgErr}, {data: docRefs, error: docErr}] = await Promise.all([
    client
      .from('property_images')
      .select('property_id, storage_bucket, storage_path')
      .in('storage_path', uniquePaths),
    client
      .from('property_documents')
      .select('property_id, storage_bucket, storage_path')
      .in('storage_path', uniquePaths),
  ]);

  if (imgErr || docErr) {
    // Fail safe: do not delete files if reference verification fails
    return [];
  }

  const protectedPaths = new Set<string>();
  const allRefs = [...(imgRefs || []), ...(docRefs || [])] as Array<{
    property_id: string;
    storage_bucket: StorageBucketName;
    storage_path: string;
  }>;

  for (const row of allRefs) {
    if (!row.storage_path) continue;
    if (bucket === PUBLIC_MEDIA_BUCKET) {
      if (row.storage_bucket === PUBLIC_MEDIA_BUCKET) {
        protectedPaths.add(row.storage_path);
      }
    } else {
      // In private bucket: protect if stored in private bucket on ANY property,
      // OR if referenced by ANY OTHER property regardless of bucket.
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

  const [{data: prevImgs}, {data: prevDocs}] = await Promise.all([
    client
      .from('property_images')
      .select('storage_bucket, storage_path')
      .eq('property_id', propertyId),
    client
      .from('property_documents')
      .select('storage_bucket, storage_path')
      .eq('property_id', propertyId),
  ]);

  const orderedImages = sortImagesCoverFirst(input.images || []);
  const normalizedInput: PropertyInput = {
    ...input,
    images: orderedImages,
  };
  const {activePublicPaths, activePrivatePaths} = collectActiveStoragePaths(normalizedInput);

  const orphanPublicPaths: string[] = [];
  const orphanPrivatePaths: string[] = [];
  for (const row of [...(prevImgs || []), ...(prevDocs || [])]) {
    const path = row.storage_path as string;
    if (!path) continue;
    if (row.storage_bucket === PUBLIC_MEDIA_BUCKET && !activePublicPaths.has(path)) {
      orphanPublicPaths.push(path);
    }
    if (!activePrivatePaths.has(path) && !activePublicPaths.has(path)) {
      orphanPrivatePaths.push(path);
    }
  }

  // Redundant staged copies in private bucket for files now safely active in public bucket
  const redundantPrivatePaths = Array.from(activePublicPaths).filter(
    (p) => !activePrivatePaths.has(p)
  );

  // Write DB relations BEFORE removing Storage objects so failed DB writes never leave broken links
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

async function refreshPrivateImagesForAdmin(
  properties: Property[],
  clientOverride?: SupabaseClientLike
): Promise<Property[]> {
  const client = resolveSupabaseClient(clientOverride);
  if (!client) return properties;
  return Promise.all(
    properties.map(async (prop) => {
      const hasPrivate = prop.images.some(
        (img) => img.storageBucket === PRIVATE_MEDIA_BUCKET && img.storagePath
      );
      if (!hasPrivate) return prop;
      const refreshedImages = await Promise.all(
        prop.images.map(async (img) => {
          if (img.storageBucket === PRIVATE_MEDIA_BUCKET && img.storagePath) {
            const signed = await refreshPrivateImageSignedUrl(img.storagePath, client);
            if (signed) return {...img, url: signed};
          }
          return img;
        })
      );
      return normalizeProperty({
        ...prop,
        images: refreshedImages,
        photos: refreshedImages.map((i) => i.url),
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

  return {preparedImages: sortImagesCoverFirst(preparedImages), preparedDocuments};
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
        let query = client
          .from('properties')
          .select('*, property_images(*), property_videos(*), property_documents(*)')
          .order('lot_id', {ascending: true});
        if (!includeUnpublished) {
          query = query.eq('visibility', 'Published').eq('is_archived', false);
        }
        const {data, error} = await query;
        if (error) throw new Error(error.message);
        const mapped = (data as SupabasePropertyRow[]).map(mapRowToProperty);
        return includeUnpublished ? refreshPrivateImagesForAdmin(mapped, client) : mapped;
      }

      const items = readDemoProperties();
      return includeUnpublished ? items : items.filter(isPropertyPubliclyVisible);
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

      const coordCheck = validateCoordinates(input.latitude, input.longitude);
      if (!coordCheck.valid || coordCheck.latitude === undefined || coordCheck.longitude === undefined) {
        throw new Error(
          coordCheck.error || 'Valid GPS coordinates (Latitude -90 to 90, Longitude -180 to 180) are required.'
        );
      }

      const normalizedInput: PropertyInput = {
        ...input,
        latitude: coordCheck.latitude,
        longitude: coordCheck.longitude,
        googleMapsUrl:
          (input.googleMapsUrl || '').trim() ||
          buildGoogleMapsPinUrl(coordCheck.latitude, coordCheck.longitude),
      };

      const validatedVideos = validateAndNormalizeVideos(normalizedInput.videos || []);
      const orderedRawImages = sortImagesCoverFirst(normalizedInput.images || []);
      const isArchived = normalizedInput.visibility === 'Archived' || normalizedInput.isArchived;
      const isPublishing = normalizedInput.visibility === 'Published' && !isArchived;

      const client = activeClient();
      validateImageEntriesForStorage(orderedRawImages, Boolean(client));

      if (isPublishing) {
        const publishErrors = validatePropertyForPublish({
          ...normalizedInput,
          lotId: normalizedLotId,
          isArchived,
          images: orderedRawImages,
          videos: validatedVideos,
        });
        if (publishErrors.length > 0) {
          throw new Error(publishErrors[0]);
        }
      }

      if (client) {
        // 1. Insert property row FIRST in safe Draft state (never publicly visible mid-flight)
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
          // 2. Stage relations cleanly in private storage state FIRST
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

          const stagedInput: PropertyInput = {
            ...normalizedInput,
            lotId: normalizedLotId,
            visibility: 'Draft',
            isArchived: false,
            images: stagedImages,
            documents: stagedDocuments,
            videos: validatedVideos,
            youtubeUrl: validatedVideos[0]?.url || '',
            photos: [],
          };

          await syncPropertyRelationsInSupabase(createdId, stagedInput, client, {
            deferStorageCleanup: true,
          });

          // 3. Promote ONLY authorized approved images & public docs when publishing
          const {preparedImages, preparedDocuments} = await resolveMediaAfterPropertyCommitted(
            client,
            {
              ...normalizedInput,
              lotId: normalizedLotId,
              isArchived,
              images: orderedRawImages,
              videos: validatedVideos,
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

          // 4. Commit final property visibility + public photos URLs
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
            videos: validatedVideos,
            youtubeUrl: validatedVideos[0]?.url || '',
            photos: finalPhotoList,
            publishedAt: targetPublishedAt || undefined,
          };

          // 5. Update relation metadata now that property is in final visibility state (safe for DB trigger)
          let cleanupTargets: RelationSyncResult = {
            orphanPublicPaths: [],
            orphanPrivatePaths: [],
            redundantPrivatePaths: [],
          };
          if (isPublishing) {
            cleanupTargets = await syncPropertyRelationsInSupabase(createdId, finalInput, client, {
              deferStorageCleanup: true,
            });
          } else {
            // Update signed preview URLs in property_images for Draft/Archived without touching public bucket
            cleanupTargets = await syncPropertyRelationsInSupabase(createdId, finalInput, client, {
              deferStorageCleanup: true,
            });
          }

          // 6. Post-commit cleanup: remove redundant staged copies in private bucket if promoted & unreferenced elsewhere
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

      const [preparedImages, preparedDocuments] = await Promise.all([
        prepareImagesForVisibility(orderedRawImages, normalizedInput.visibility),
        prepareDocumentsForVisibility(normalizedInput.documents || [], normalizedInput.visibility),
      ]);
      const preparedInput: PropertyInput = {
        ...normalizedInput,
        lotId: normalizedLotId,
        isArchived,
        images: preparedImages,
        documents: preparedDocuments,
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
        const coordCheck = validateCoordinates(input.latitude, input.longitude);
        if (!coordCheck.valid || coordCheck.latitude === undefined || coordCheck.longitude === undefined) {
          throw new Error(
            coordCheck.error || 'Valid GPS coordinates (Latitude -90 to 90, Longitude -180 to 180) are required.'
          );
        }

        const normalizedInput: PropertyInput = {
          ...input,
          latitude: coordCheck.latitude,
          longitude: coordCheck.longitude,
          googleMapsUrl:
            (input.googleMapsUrl || '').trim() ||
            buildGoogleMapsPinUrl(coordCheck.latitude, coordCheck.longitude),
        };

        const validatedVideos = validateAndNormalizeVideos(normalizedInput.videos || []);
        const orderedRawImages = sortImagesCoverFirst(normalizedInput.images || []);
        const client = activeClient();

        if (client) {
          validateImageEntriesForStorage(orderedRawImages, true);

          // 1. Capture complete pre-mutation snapshot for rollback, diffing & optimistic concurrency check
          const [
            {data: existingRow, error: fetchErr},
            {data: prevImgRows},
            {data: prevVidRows},
            {data: prevDocRows},
          ] = await Promise.all([
            client.from('properties').select('*').eq('id', id).single(),
            client.from('property_images').select('*').eq('property_id', id),
            client.from('property_videos').select('*').eq('property_id', id),
            client.from('property_documents').select('*').eq('property_id', id),
          ]);
          if (fetchErr || !existingRow) {
            throw new Error(fetchErr?.message || 'Property record not found.');
          }

          const prevSnapshot = existingRow as SupabasePropertyRow;
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

          // 2. Create & verify private backups BEFORE mutating DB or removing public objects
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

          const newlyPromotedPublicPaths: string[] = [];

          // 3. Commit properties row FIRST with optimistic concurrency lock on updated_at
          const initialRow = mapPropertyToRow({
            ...normalizedInput,
            lotId: lockedLotId,
            isArchived,
            images: orderedRawImages,
            videos: validatedVideos,
            youtubeUrl: validatedVideos[0]?.url || '',
            photos: willBePublished ? prevSnapshot.photos || [] : [],
          });

          const {data: updatedPropRow, error: propUpdateErr} = await client
            .from('properties')
            .update(initialRow)
            .eq('id', id)
            .eq('updated_at', prevSnapshot.updated_at)
            .select()
            .single();
          if (propUpdateErr) throw new Error(propUpdateErr.message);
          if (!updatedPropRow) {
            throw new Error(
              'Concurrent update detected: this listing was modified by another session. Reload and try again.'
            );
          }

          const prevRelations: PreviousRelationsSnapshot = {
            images: (prevImgRows || []) as Array<Record<string, unknown>>,
            videos: (prevVidRows || []) as Array<Record<string, unknown>>,
            documents: (prevDocRows || []) as Array<Record<string, unknown>>,
          };

          let cleanupTargets: RelationSyncResult = {
            orphanPublicPaths: [],
            orphanPrivatePaths: [],
            redundantPrivatePaths: [],
          };

          try {
            // 4. Promote approved media ONLY now that properties row is committed
            const {preparedImages, preparedDocuments} = await resolveMediaAfterPropertyCommitted(
              client,
              {
                ...normalizedInput,
                lotId: lockedLotId,
                isArchived,
                images: orderedRawImages,
                videos: validatedVideos,
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
              photos: orderedPhotos,
              videos: validatedVideos,
              youtubeUrl: validatedVideos[0]?.url || '',
            };

            // 5. Sync DB relations BEFORE deleting any Storage orphans
            cleanupTargets = await syncPropertyRelationsInSupabase(id, preparedInput, client, {
              deferStorageCleanup: true,
            });

            const {data: finalPropRow, error: photosErr} = await client
              .from('properties')
              .update({photos: orderedPhotos, updated_at: new Date().toISOString()})
              .eq('id', id)
              .select()
              .single();
            if (photosErr) throw new Error(photosErr.message);

            // 6. Post-commit Storage cleanup (verified against cross-record references)
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
              updatedAt: finalPropRow?.updated_at || updatedPropRow.updated_at,
            });
          } catch (err) {
            await cleanupPromotedPublicObjects(newlyPromotedPublicPaths, client);
            await restorePropertyRowSnapshot(client, id, prevSnapshot);
            await restoreRelationsSnapshot(client, id, prevRelations);
            throw err;
          }
        }

        const existing = readDemoProperties();
        const current = existing.find((item) => item.id === id);
        if (!current) {
          throw new Error('Property record not found.');
        }

        const lockedLotId = current.lotId;
        const [preparedImages, preparedDocuments] = await Promise.all([
          prepareImagesForVisibility(orderedRawImages, normalizedInput.visibility),
          prepareDocumentsForVisibility(normalizedInput.documents || [], normalizedInput.visibility),
        ]);
        const updated = normalizeProperty({
          ...normalizedInput,
          lotId: lockedLotId,
          id,
          isArchived: normalizedInput.visibility === 'Archived' || normalizedInput.isArchived,
          images: preparedImages,
          documents: preparedDocuments,
          photos:
            preparedImages.length > 0
              ? sortImagesCoverFirst(preparedImages).map((img) => img.url)
              : normalizedInput.photos,
          videos: validatedVideos,
          youtubeUrl: validatedVideos[0]?.url || '',
          updatedAt: new Date().toISOString(),
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
            .select('*, property_images(*), property_videos(*), property_documents(*)')
            .eq('id', id)
            .single();
          if (fetchErr || !currentRow) {
            throw new Error(fetchErr?.message || 'Property record not found.');
          }

          const prevSnapshot = currentRow as SupabasePropertyRow;
          const mapped = mapRowToProperty(prevSnapshot);
          const imgRows = prevSnapshot.property_images || [];
          const docRows = prevSnapshot.property_documents || [];
          const prevRelations: PreviousRelationsSnapshot = {
            images: imgRows.map((img) => ({...img, property_id: id})),
            videos: (prevSnapshot.property_videos || []).map((v) => ({...v, property_id: id})),
            documents: docRows.map((d) => ({...d, property_id: id})),
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
            const newlyPromotedPublicPaths: string[] = [];

            // 1. Update property visibility FIRST with optimistic concurrency lock
            const nextPublishedAt = mapped.publishedAt || new Date().toISOString();
            const {data: pubRow, error: propPubErr} = await client
              .from('properties')
              .update({
                visibility: 'Published',
                is_archived: false,
                published_at: nextPublishedAt,
                updated_at: new Date().toISOString(),
              })
              .eq('id', id)
              .eq('updated_at', prevSnapshot.updated_at)
              .select()
              .single();
            if (propPubErr) throw new Error(propPubErr.message);
            if (!pubRow) {
              throw new Error(
                'Concurrent update detected while publishing. Reload and try again.'
              );
            }

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

            const orderedApprovedUrls = sortImagesCoverFirst(updatedImages)
              .filter((img) => img.isApprovedPublic)
              .map((img) => img.url);
            const fallbackPhotos =
              orderedApprovedUrls.length > 0 ? orderedApprovedUrls : mapped.photos;

            const {data: finalRow, error: photoSyncErr} = await client
              .from('properties')
              .update({photos: fallbackPhotos, updated_at: new Date().toISOString()})
              .eq('id', id)
              .select()
              .single();
            if (photoSyncErr) throw new Error(photoSyncErr.message);

            // Post-commit cleanup of redundant staged private copies
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
              updatedAt: finalRow?.updated_at || pubRow?.updated_at || new Date().toISOString(),
            });
          } catch (err) {
            await cleanupPromotedPublicObjects(newlyPromotedPublicPaths, client);
            await restorePropertyRowSnapshot(client, id, prevSnapshot);
            await restoreRelationsSnapshot(client, id, prevRelations);
            throw err;
          }
        }

        // Unpublishing / Archiving:
        // 1. Verify & create private backups BEFORE changing DB or deleting from public bucket
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

        // 2. Commit DB unpublish & relation demotion inside rollback boundary
        try {
          const {data: unpubRow, error: propUnpubErr} = await client
            .from('properties')
            .update({
              visibility,
              is_archived: isArchived,
              updated_at: new Date().toISOString(),
            })
            .eq('id', id)
            .eq('updated_at', prevSnapshot.updated_at)
            .select()
            .single();
          if (propUnpubErr) throw new Error(propUnpubErr.message);
          if (!unpubRow) {
            throw new Error(
              'Concurrent update detected while unpublishing. Reload and try again.'
            );
          }

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

          const demotedPhotoUrls = sortImagesCoverFirst(demotedImages).map((i) => i.url);
          if (demotedPhotoUrls.length > 0) {
            const {error: photosUpdErr} = await client
              .from('properties')
              .update({photos: demotedPhotoUrls})
              .eq('id', id);
            if (photosUpdErr) throw new Error(photosUpdErr.message);
          }

          // 3. Post-commit physical deletion from property-media-public (excluding any path still referenced elsewhere)
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
            updatedAt: unpubRow?.updated_at || new Date().toISOString(),
          });
        } catch (err) {
          await restorePropertyRowSnapshot(client, id, prevSnapshot);
          await restoreRelationsSnapshot(client, id, prevRelations);
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
          const [preparedImages, preparedDocuments] = await Promise.all([
            prepareImagesForVisibility(item.images, visibility),
            prepareDocumentsForVisibility(item.documents, visibility),
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
          const [{data: imgRows}, {data: docRows}] = await Promise.all([
            client
              .from('property_images')
              .select('storage_bucket, storage_path')
              .eq('property_id', id),
            client
              .from('property_documents')
              .select('storage_bucket, storage_path')
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

          // Delete DB record FIRST (cascade revokes Storage RLS before removing blobs)
          const {error} = await client.from('properties').delete().eq('id', id);
          if (error) throw new Error(error.message);

          // Protect any Storage paths still referenced by another property
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
