export type PropertyStatus = 'Available' | 'Reserved' | 'Sold';

export type PropertyClassification =
  | 'Residential'
  | 'Beachfront'
  | 'Commercial'
  | 'Agricultural';

export interface Property {
  id: string;
  lotId: string; // Permanent URL identifier, e.g., LOT-001
  title: string;
  barangay: string;
  city: string;
  province: string;
  region: string;
  lotAreaSqm: number;
  dimensions: string;
  priceTotalPhp: number;
  classification: PropertyClassification;
  status: PropertyStatus;
  isArchived: boolean;
  isFeatured: boolean;
  roadAccess: string;
  titleStatus: string;
  terrain: string;
  description: string;
  highlights: string[];
  photos: string[];
  youtubeUrl: string;
  latitude: number;
  longitude: number;
  googleMapsUrl: string;
  agentName: string;
  agentPhone: string;
  agentWhatsapp: string;
  agentMessenger: string;
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

export type PropertyInput = Omit<Property, 'id' | 'updatedAt'>;
