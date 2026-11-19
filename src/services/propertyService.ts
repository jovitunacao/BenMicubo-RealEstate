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
import {parsePropertyVideoUrl} from '../utils/video';
import {
  demoteFileFromPublicBucket,
  PRIVATE_MEDIA_BUCKET,
  promoteFileToPublicBucket,
  promoteImageToPublicBucket,
  PUBLIC_MEDIA_BUCKET,
  refreshPrivateImageSignedUrl,
  removeStoragePathsFromBucket,
} from './storageService';

const PROPERTIES_STORAGE_KEY = 'amihan_demo_properties_v2';
const INQUIRIES_STORAGE_KEY = 'amihan_demo_inquiries_v1';
const SETTINGS_STORAGE_KEY = 'benmicubo_site_settings_v1';

function sortImagesCoverFirst(images: PropertyImageItem[]): PropertyImageItem[] {
  return [...images].sort((a, b) => {
    if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
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
    latitude: Number(raw.latitude) || 14.5995,
    longitude: Number(raw.longitude) || 120.9842,
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
    storage_bucket: 'property-media-private' | 'property-media-public';
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
    storage_bucket: 'property-media-private' | 'property-media-public';
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
    google_maps_url: input.googleMapsUrl,
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

async function syncPropertyRelationsInSupabase(
  propertyId: string,
  input: PropertyInput
): Promise<void> {
  if (!supabase) return;

  // Identify removed/replaced Storage files so orphaned previously-published media are deleted
  const [{data: prevImgs}, {data: prevDocs}] = await Promise.all([
    supabase
      .from('property_images')
      .select('storage_bucket, storage_path')
      .eq('property_id', propertyId),
    supabase
      .from('property_documents')
      .select('storage_bucket, storage_path')
      .eq('property_id', propertyId),
  ]);

  const activePublicPaths = new Set<string>();
  const activePrivatePaths = new Set<string>();
  for (const img of input.images || []) {
    if (!img.storagePath) continue;
    if (img.storageBucket === PUBLIC_MEDIA_BUCKET) activePublicPaths.add(img.storagePath);
    else activePrivatePaths.add(img.storagePath);
  }
  for (const doc of input.documents || []) {
    if (!doc.storagePath) continue;
    if (doc.storageBucket === PUBLIC_MEDIA_BUCKET) activePublicPaths.add(doc.storagePath);
    else activePrivatePaths.add(doc.storagePath);
  }

  const orphanPublicPaths: string[] = [];
  const orphanPrivatePaths: string[] = [];
  for (const row of [...(prevImgs || []), ...(prevDocs || [])]) {
    const path = row.storage_path as string;
    if (!path) continue;
    if (row.storage_bucket === PUBLIC_MEDIA_BUCKET && !activePublicPaths.has(path)) {
      orphanPublicPaths.push(path);
    } else if (
      row.storage_bucket === PRIVATE_MEDIA_BUCKET &&
      !activePrivatePaths.has(path) &&
      !activePublicPaths.has(path)
    ) {
      orphanPrivatePaths.push(path);
    }
  }
  await removeStoragePathsFromBucket(PUBLIC_MEDIA_BUCKET, orphanPublicPaths);
  await removeStoragePathsFromBucket(PRIVATE_MEDIA_BUCKET, orphanPrivatePaths);

  const {error: delImgErr} = await supabase
    .from('property_images')
    .delete()
    .eq('property_id', propertyId);
  if (delImgErr) throw new Error(delImgErr.message);

  if (input.images && input.images.length > 0) {
    const imgRows = input.images.map((img, idx) => {
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
        is_cover: img.isCover,
        is_approved_public: isPublicBucket,
        sort_order: idx,
      };
    });
    const {error} = await supabase.from('property_images').insert(imgRows);
    if (error) throw new Error(error.message);
  }

  const {error: delVidErr} = await supabase
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
    const {error} = await supabase.from('property_videos').insert(vidRows);
    if (error) throw new Error(error.message);
  }

  const {error: delDocErr} = await supabase
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
    const {error} = await supabase.from('property_documents').insert(docRows);
    if (error) throw new Error(error.message);
  }
}

export async function prepareImagesForVisibility(
  images: PropertyImageItem[] = [],
  visibility: PropertyVisibility
): Promise<PropertyImageItem[]> {
  const isPublished = visibility === 'Published';

  return Promise.all(
    images.map(async (img) => {
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
        storageBucket: img.storagePath ? img.storageBucket : PUBLIC_MEDIA_BUCKET,
        isApprovedPublic: true,
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
        storageBucket: doc.storagePath ? doc.storageBucket : PUBLIC_MEDIA_BUCKET,
      };
    })
  );
}

async function refreshPrivateImagesForAdmin(properties: Property[]): Promise<Property[]> {
  if (!isSupabaseConfigured || !supabase) return properties;
  return Promise.all(
    properties.map(async (prop) => {
      const hasPrivate = prop.images.some(
        (img) => img.storageBucket === 'property-media-private' && img.storagePath
      );
      if (!hasPrivate) return prop;
      const refreshedImages = await Promise.all(
        prop.images.map(async (img) => {
          if (img.storageBucket === 'property-media-private' && img.storagePath) {
            const signed = await refreshPrivateImageSignedUrl(img.storagePath);
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

export const propertyService = {
  async checkCurrentUserAdminRole(userId: string): Promise<{
    isAuthorized: boolean;
    role: 'admin' | 'super_admin' | null;
  }> {
    if (!isSupabaseConfigured || !supabase || !userId) {
      return {isAuthorized: false, role: null};
    }
    const {data, error} = await supabase
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
    if (isSupabaseConfigured && supabase) {
      let query = supabase
        .from('properties')
        .select('*, property_images(*), property_videos(*), property_documents(*)')
        .order('lot_id', {ascending: true});
      if (!includeUnpublished) {
        query = query.eq('visibility', 'Published').eq('is_archived', false);
      }
      const {data, error} = await query;
      if (error) throw new Error(error.message);
      const mapped = (data as SupabasePropertyRow[]).map(mapRowToProperty);
      return includeUnpublished ? refreshPrivateImagesForAdmin(mapped) : mapped;
    }

    const items = readDemoProperties();
    return includeUnpublished ? items : items.filter(isPropertyPubliclyVisible);
  },

  async createProperty(input: PropertyInput): Promise<Property> {
    const normalizedLotId = input.lotId.trim().toUpperCase();
    const validatedVideos = validateAndNormalizeVideos(input.videos || []);
    const [preparedImages, preparedDocuments] = await Promise.all([
      prepareImagesForVisibility(input.images || [], input.visibility),
      prepareDocumentsForVisibility(input.documents || [], input.visibility),
    ]);
    const preparedInput: PropertyInput = {
      ...input,
      lotId: normalizedLotId,
      isArchived: input.visibility === 'Archived' || input.isArchived,
      images: preparedImages,
      documents: preparedDocuments,
      videos: validatedVideos,
      youtubeUrl: validatedVideos[0]?.url || '',
      photos:
        preparedImages.length > 0
          ? sortImagesCoverFirst(preparedImages).map((img) => img.url)
          : input.photos,
    };

    if (isSupabaseConfigured && supabase) {
      const {data, error} = await supabase
        .from('properties')
        .insert(mapPropertyToRow(preparedInput))
        .select()
        .single();
      if (error) throw new Error(error.message);
      await syncPropertyRelationsInSupabase(data.id, preparedInput);
      return normalizeProperty({
        ...preparedInput,
        id: data.id,
        updatedAt: data.updated_at,
      });
    }

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
    const validatedVideos = validateAndNormalizeVideos(input.videos || []);

    if (isSupabaseConfigured && supabase) {
      // Preserve immutable Lot ID on existing property so QR codes never break
      const {data: existingRow, error: fetchErr} = await supabase
        .from('properties')
        .select('lot_id')
        .eq('id', id)
        .single();
      if (fetchErr) throw new Error(fetchErr.message);

      const lockedLotId = existingRow.lot_id;
      const [preparedImages, preparedDocuments] = await Promise.all([
        prepareImagesForVisibility(input.images || [], input.visibility),
        prepareDocumentsForVisibility(input.documents || [], input.visibility),
      ]);
      const preparedInput: PropertyInput = {
        ...input,
        lotId: lockedLotId,
        isArchived: input.visibility === 'Archived' || input.isArchived,
        images: preparedImages,
        documents: preparedDocuments,
        photos:
          preparedImages.length > 0
            ? sortImagesCoverFirst(preparedImages).map((img) => img.url)
            : input.photos,
        videos: validatedVideos,
        youtubeUrl: validatedVideos[0]?.url || '',
      };

      const {data, error} = await supabase
        .from('properties')
        .update(mapPropertyToRow(preparedInput))
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      await syncPropertyRelationsInSupabase(id, preparedInput);
      return normalizeProperty({
        ...preparedInput,
        id: data.id,
        updatedAt: data.updated_at,
      });
    }

    const existing = readDemoProperties();
    const current = existing.find((item) => item.id === id);
    if (!current) {
      throw new Error('Property record not found.');
    }

    // Preserve immutable Lot ID on edit
    const lockedLotId = current.lotId;
    const [preparedImages, preparedDocuments] = await Promise.all([
      prepareImagesForVisibility(input.images || [], input.visibility),
      prepareDocumentsForVisibility(input.documents || [], input.visibility),
    ]);
    const updated = normalizeProperty({
      ...input,
      lotId: lockedLotId,
      id,
      isArchived: input.visibility === 'Archived' || input.isArchived,
      images: preparedImages,
      documents: preparedDocuments,
      photos:
        preparedImages.length > 0
          ? sortImagesCoverFirst(preparedImages).map((img) => img.url)
          : input.photos,
      videos: validatedVideos,
      youtubeUrl: validatedVideos[0]?.url || '',
      updatedAt: new Date().toISOString(),
    });
    const next = existing.map((item) => (item.id === id ? updated : item));
    writeDemoProperties(next);
    return updated;
  },

  async setVisibility(id: string, visibility: PropertyVisibility): Promise<void> {
    const isArchived = visibility === 'Archived';
    if (isSupabaseConfigured && supabase) {
      if (visibility === 'Published') {
        const {data: currentRow, error: fetchErr} = await supabase
          .from('properties')
          .select('*, property_images(*), property_videos(*), property_documents(*)')
          .eq('id', id)
          .single();
        if (fetchErr) throw new Error(fetchErr.message);

        const mapped = mapRowToProperty(currentRow as SupabasePropertyRow);
        const publishErrors = validatePropertyForPublish(mapped);
        if (publishErrors.length > 0) {
          throw new Error(publishErrors[0]);
        }

        // Update property visibility FIRST so DB triggers allow public media promotion
        const {error: propPubErr} = await supabase
          .from('properties')
          .update({
            visibility: 'Published',
            is_archived: false,
            published_at: mapped.publishedAt || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', id);
        if (propPubErr) throw new Error(propPubErr.message);

        const [{data: imgRows}, {data: docRows}] = await Promise.all([
          supabase
            .from('property_images')
            .select('id, storage_bucket, storage_path, public_url')
            .eq('property_id', id),
          supabase
            .from('property_documents')
            .select('id, visibility, storage_bucket, storage_path, mime_type')
            .eq('property_id', id),
        ]);

        if (imgRows && imgRows.length > 0) {
          const promotedUrls: string[] = [];
          for (const row of imgRows) {
            let finalUrl = row.public_url as string;
            if (row.storage_bucket === PRIVATE_MEDIA_BUCKET && row.storage_path) {
              const promoted = await promoteImageToPublicBucket(row.storage_path);
              if (!promoted) {
                throw new Error('Failed to promote private image to public storage before publishing.');
              }
              finalUrl = promoted;
            }
            promotedUrls.push(finalUrl);
            const {error: imgUpdErr} = await supabase
              .from('property_images')
              .update({
                storage_bucket: PUBLIC_MEDIA_BUCKET,
                is_approved_public: true,
                public_url: finalUrl,
              })
              .eq('id', row.id);
            if (imgUpdErr) throw new Error(imgUpdErr.message);
          }
          if (promotedUrls.length > 0) {
            await supabase.from('properties').update({photos: promotedUrls}).eq('id', id);
          }
        }

        if (docRows && docRows.length > 0) {
          for (const d of docRows) {
            if (d.visibility === 'Public' && d.storage_bucket === PRIVATE_MEDIA_BUCKET && d.storage_path) {
              const promotedDocUrl = await promoteFileToPublicBucket(d.storage_path, d.mime_type);
              if (promotedDocUrl) {
                const {error: docUpdErr} = await supabase
                  .from('property_documents')
                  .update({storage_bucket: PUBLIC_MEDIA_BUCKET})
                  .eq('id', d.id);
                if (docUpdErr) throw new Error(docUpdErr.message);
              }
            }
          }
        }
        return;
      }

      // Unpublishing / Archiving: physically demote and delete previously-published files from public Storage
      const [{data: imgRows}, {data: docRows}] = await Promise.all([
        supabase
          .from('property_images')
          .select('id, storage_bucket, storage_path, public_url')
          .eq('property_id', id),
        supabase
          .from('property_documents')
          .select('id, storage_bucket, storage_path')
          .eq('property_id', id),
      ]);

      const demotedPhotoUrls: string[] = [];
      for (const row of imgRows || []) {
        let nextUrl = row.public_url as string;
        if (row.storage_bucket === PUBLIC_MEDIA_BUCKET && row.storage_path) {
          const {signedUrl} = await demoteFileFromPublicBucket(row.storage_path, 'image');
          if (signedUrl) nextUrl = signedUrl;
        }
        demotedPhotoUrls.push(nextUrl);
        const {error: imgDemoteErr} = await supabase
          .from('property_images')
          .update({
            storage_bucket: PRIVATE_MEDIA_BUCKET,
            is_approved_public: false,
            public_url: nextUrl,
          })
          .eq('id', row.id);
        if (imgDemoteErr) throw new Error(imgDemoteErr.message);
      }

      for (const doc of docRows || []) {
        if (doc.storage_bucket === PUBLIC_MEDIA_BUCKET && doc.storage_path) {
          await demoteFileFromPublicBucket(doc.storage_path, 'document');
          const {error: docDemoteErr} = await supabase
            .from('property_documents')
            .update({storage_bucket: PRIVATE_MEDIA_BUCKET})
            .eq('id', doc.id);
          if (docDemoteErr) throw new Error(docDemoteErr.message);
        }
      }

      const {error} = await supabase
        .from('properties')
        .update({
          visibility,
          is_archived: isArchived,
          ...(demotedPhotoUrls.length > 0 ? {photos: demotedPhotoUrls} : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw new Error(error.message);
      return;
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
    const updatedList = await Promise.all(
      existing.map(async (item) => {
        if (item.id !== id) return item;
        const [preparedImages, preparedDocuments] = await Promise.all([
          prepareImagesForVisibility(
            visibility === 'Published'
              ? item.images.map((img) => ({...img, isApprovedPublic: true}))
              : item.images,
            visibility
          ),
          prepareDocumentsForVisibility(item.documents, visibility),
        ]);
        return {
          ...item,
          visibility,
          isArchived,
          images: preparedImages,
          documents: preparedDocuments,
          publishedAt:
            visibility === 'Published'
              ? item.publishedAt || new Date().toISOString()
              : item.publishedAt,
          updatedAt: new Date().toISOString(),
        };
      })
    );
    writeDemoProperties(updatedList);
  },

  async bulkUpdateStatus(ids: string[], status: PropertyStatus): Promise<void> {
    if (ids.length === 0) return;
    if (isSupabaseConfigured && supabase) {
      const {error} = await supabase
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
    if (isSupabaseConfigured && supabase) {
      const [{data: imgRows}, {data: docRows}] = await Promise.all([
        supabase
          .from('property_images')
          .select('storage_bucket, storage_path')
          .eq('property_id', id),
        supabase
          .from('property_documents')
          .select('storage_bucket, storage_path')
          .eq('property_id', id),
      ]);

      const publicPaths: string[] = [];
      const privatePaths: string[] = [];
      for (const row of [...(imgRows || []), ...(docRows || [])]) {
        const path = row.storage_path as string;
        if (!path) continue;
        if (row.storage_bucket === PUBLIC_MEDIA_BUCKET) publicPaths.push(path);
        else privatePaths.push(path);
      }

      await removeStoragePathsFromBucket(PUBLIC_MEDIA_BUCKET, publicPaths);
      await removeStoragePathsFromBucket(PRIVATE_MEDIA_BUCKET, privatePaths);

      const {error} = await supabase.from('properties').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }

    const existing = readDemoProperties();
    writeDemoProperties(existing.filter((item) => item.id !== id));
  },

  async listInquiries(): Promise<BuyerInquiry[]> {
    if (isSupabaseConfigured && supabase) {
      const {data, error} = await supabase
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
    if (isSupabaseConfigured && supabase) {
      // Omit status/id/created_at: anon only has column-level INSERT on user-facing fields; DB defaults/trigger set 'New'
      const {error} = await supabase.from('inquiries').insert({
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
    if (isSupabaseConfigured && supabase) {
      const {error} = await supabase
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
    if (isSupabaseConfigured && supabase) {
      const {data, error} = await supabase
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
    if (isSupabaseConfigured && supabase) {
      const {error} = await supabase.from('site_settings').upsert({
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
