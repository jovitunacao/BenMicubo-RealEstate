export type PropertyStatus = 'Available' | 'Reserved' | 'Sold';

export type PropertyVisibility = 'Draft' | 'Published' | 'Archived';

export type PropertyClassification =
  | 'Residential'
  | 'Commercial'
  | 'Agricultural'
  | 'Beachfront'
  | 'Other';

export interface PropertyImageItem {
  id: string;
  url: string;
  caption: string;
  isCover: boolean;
  sortOrder: number;
  isApprovedPublic: boolean;
  storageBucket: 'property-media-private' | 'property-media-public';
  storagePath?: string;
}

export interface PropertyVideoItem {
  id: string;
  sourceType: 'youtube' | 'google_drive' | 'direct';
  url: string;
  title: string;
  description: string;
  sortOrder: number;
}

export type DocumentCategory =
  | 'Survey Plan'
  | 'Lot Plan'
  | 'Technical Description'
  | 'Vicinity Map'
  | 'Tax Declaration'
  | 'Title Document'
  | 'PDF Brochure'
  | 'Other';

export type DocumentVisibility = 'Private' | 'Public';

export interface PropertyDocumentItem {
  id: string;
  title: string;
  category: DocumentCategory;
  visibility: DocumentVisibility;
  storageBucket: 'property-media-private' | 'property-media-public';
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  publicUrl?: string;
  dataUrl?: string; // Stage 1 local demo fallback for browser preview only
  uploadedAt: string;
}

export interface Property {
  id: string;
  lotId: string; // Permanent URL identifier, e.g., LOT-001 (locked on edit)
  title: string;
  barangay: string;
  city: string;
  province: string;
  region: string;
  completeLocation: string;
  lotAreaSqm: number;
  dimensions: string;
  boundaryDescription: string;
  pricePerSqm: number;
  priceTotalPhp: number;
  isPriceManualOverride: boolean;
  isNegotiable: boolean;
  classification: PropertyClassification;
  status: PropertyStatus;
  visibility: PropertyVisibility;
  isArchived: boolean;
  isFeatured: boolean;
  roadAccess: string;
  utilities: string;
  terrain: string;
  nearbyLandmarks: string;
  titleStatus: string;
  taxDeclarationStatus: string;
  additionalRemarks: string;
  description: string;
  highlights: string[];
  photos: string[]; // Ordered Supabase gallery URLs (cover photo first)
  images: PropertyImageItem[];
  youtubeUrl: string;
  videos: PropertyVideoItem[];
  documents: PropertyDocumentItem[];
  latitude: number;
  longitude: number;
  googleMapsUrl: string;
  agentName: string;
  agentPhone: string;
  agentWhatsapp: string;
  agentMessenger: string;
  publishedAt?: string;
  updatedAt: string;
}

export type InquiryStatus = 'New' | 'Contacted' | 'Scheduled' | 'Closed';

export interface BuyerInquiry {
  id: string;
  propertyLotId: string | null;
  propertyTitle: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  preferredDate?: string;
  message: string;
  status: InquiryStatus;
  createdAt: string;
}

export interface SiteSettings {
  canonicalSiteUrl: string;
  defaultAgentName: string;
  defaultAgentPhone: string;
  defaultAgentWhatsapp: string;
  defaultAgentMessenger: string;
}

export type PropertyInput = Omit<Property, 'id' | 'updatedAt'> & {
  expectedUpdatedAt?: string;
};
