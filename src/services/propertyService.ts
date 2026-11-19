import {DEMO_INQUIRIES, DEMO_PROPERTIES} from '../data/demoProperties';
import {isSupabaseConfigured, supabase} from '../lib/supabase';
import type {BuyerInquiry, InquiryStatus, Property, PropertyInput} from '../types/property';

const PROPERTIES_STORAGE_KEY = 'amihan_demo_properties_v1';
const INQUIRIES_STORAGE_KEY = 'amihan_demo_inquiries_v1';

function readDemoProperties(): Property[] {
  try {
    const raw = localStorage.getItem(PROPERTIES_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(PROPERTIES_STORAGE_KEY, JSON.stringify(DEMO_PROPERTIES));
      return DEMO_PROPERTIES;
    }
    const parsed = JSON.parse(raw) as Property[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEMO_PROPERTIES;
  } catch {
    return DEMO_PROPERTIES;
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

interface SupabasePropertyRow {
  id: string;
  lot_id: string;
  title: string;
  barangay: string;
  city: string;
  province: string;
  region: string;
  lot_area_sqm: number;
  dimensions: string;
  price_total_php: number;
  classification: Property['classification'];
  status: Property['status'];
  is_archived: boolean;
  is_featured: boolean;
  road_access: string;
  title_status: string;
  terrain: string;
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
  updated_at: string;
}

function mapRowToProperty(row: SupabasePropertyRow): Property {
  return {
    id: row.id,
    lotId: row.lot_id,
    title: row.title,
    barangay: row.barangay,
    city: row.city,
    province: row.province,
    region: row.region,
    lotAreaSqm: Number(row.lot_area_sqm),
    dimensions: row.dimensions,
    priceTotalPhp: Number(row.price_total_php),
    classification: row.classification,
    status: row.status,
    isArchived: row.is_archived,
    isFeatured: row.is_featured,
    roadAccess: row.road_access,
    titleStatus: row.title_status,
    terrain: row.terrain,
    description: row.description,
    highlights: row.highlights || [],
    photos: row.photos || [],
    youtubeUrl: row.youtube_url || '',
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    googleMapsUrl: row.google_maps_url,
    agentName: row.agent_name,
    agentPhone: row.agent_phone,
    agentWhatsapp: row.agent_whatsapp,
    agentMessenger: row.agent_messenger,
    updatedAt: row.updated_at,
  };
}

function mapPropertyToRow(input: PropertyInput) {
  return {
    lot_id: input.lotId.trim().toUpperCase(),
    title: input.title,
    barangay: input.barangay,
    city: input.city,
    province: input.province,
    region: input.region,
    lot_area_sqm: input.lotAreaSqm,
    dimensions: input.dimensions,
    price_total_php: input.priceTotalPhp,
    classification: input.classification,
    status: input.status,
    is_archived: input.isArchived,
    is_featured: input.isFeatured,
    road_access: input.roadAccess,
    title_status: input.titleStatus,
    terrain: input.terrain,
    description: input.description,
    highlights: input.highlights,
    photos: input.photos,
    youtube_url: input.youtubeUrl || null,
    latitude: input.latitude,
    longitude: input.longitude,
    google_maps_url: input.googleMapsUrl,
    agent_name: input.agentName,
    agent_phone: input.agentPhone,
    agent_whatsapp: input.agentWhatsapp,
    agent_messenger: input.agentMessenger,
    updated_at: new Date().toISOString(),
  };
}

export const propertyService = {
  async listProperties(includeArchived = false): Promise<Property[]> {
    if (isSupabaseConfigured && supabase) {
      let query = supabase
        .from('properties')
        .select('*')
        .order('lot_id', {ascending: true});
      if (!includeArchived) {
        query = query.eq('is_archived', false);
      }
      const {data, error} = await query;
      if (error) throw new Error(error.message);
      return (data as SupabasePropertyRow[]).map(mapRowToProperty);
    }

    const items = readDemoProperties();
    return includeArchived ? items : items.filter((p) => !p.isArchived);
  },

  async createProperty(input: PropertyInput): Promise<Property> {
    const normalizedLotId = input.lotId.trim().toUpperCase();
    if (isSupabaseConfigured && supabase) {
      const {data, error} = await supabase
        .from('properties')
        .insert(mapPropertyToRow({...input, lotId: normalizedLotId}))
        .select()
        .single();
      if (error) throw new Error(error.message);
      return mapRowToProperty(data as SupabasePropertyRow);
    }

    const existing = readDemoProperties();
    if (existing.some((item) => item.lotId.toUpperCase() === normalizedLotId)) {
      throw new Error(`Lot ID ${normalizedLotId} already exists. Permanent Lot IDs must be unique.`);
    }
    const created: Property = {
      ...input,
      lotId: normalizedLotId,
      id: `demo-${Date.now()}`,
      updatedAt: new Date().toISOString(),
    };
    const next = [created, ...existing];
    writeDemoProperties(next);
    return created;
  },

  async updateProperty(id: string, input: PropertyInput): Promise<Property> {
    const normalizedLotId = input.lotId.trim().toUpperCase();
    if (isSupabaseConfigured && supabase) {
      const {data, error} = await supabase
        .from('properties')
        .update(mapPropertyToRow({...input, lotId: normalizedLotId}))
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return mapRowToProperty(data as SupabasePropertyRow);
    }

    const existing = readDemoProperties();
    if (
      existing.some(
        (item) => item.id !== id && item.lotId.toUpperCase() === normalizedLotId
      )
    ) {
      throw new Error(`Lot ID ${normalizedLotId} is already assigned to another listing.`);
    }
    const updated: Property = {
      ...input,
      lotId: normalizedLotId,
      id,
      updatedAt: new Date().toISOString(),
    };
    const next = existing.map((item) => (item.id === id ? updated : item));
    writeDemoProperties(next);
    return updated;
  },

  async setArchived(id: string, isArchived: boolean): Promise<void> {
    if (isSupabaseConfigured && supabase) {
      const {error} = await supabase
        .from('properties')
        .update({is_archived: isArchived, updated_at: new Date().toISOString()})
        .eq('id', id);
      if (error) throw new Error(error.message);
      return;
    }

    const existing = readDemoProperties();
    writeDemoProperties(
      existing.map((item) =>
        item.id === id
          ? {...item, isArchived, updatedAt: new Date().toISOString()}
          : item
      )
    );
  },

  async deleteProperty(id: string): Promise<void> {
    if (isSupabaseConfigured && supabase) {
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
      const {data, error} = await supabase
        .from('inquiries')
        .insert({
          property_lot_id: payload.propertyLotId,
          property_title: payload.propertyTitle,
          buyer_name: payload.buyerName,
          buyer_email: payload.buyerEmail,
          buyer_phone: payload.buyerPhone,
          preferred_date: payload.preferredDate || null,
          message: payload.message,
          status: 'New',
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return {
        id: data.id,
        propertyLotId: data.property_lot_id,
        propertyTitle: data.property_title,
        buyerName: data.buyer_name,
        buyerEmail: data.buyer_email,
        buyerPhone: data.buyer_phone,
        preferredDate: data.preferred_date || undefined,
        message: data.message,
        status: data.status,
        createdAt: data.created_at,
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

  resetDemoData(): {properties: Property[]; inquiries: BuyerInquiry[]} {
    writeDemoProperties(DEMO_PROPERTIES);
    writeDemoInquiries(DEMO_INQUIRIES);
    return {
      properties: DEMO_PROPERTIES,
      inquiries: DEMO_INQUIRIES,
    };
  },
};
