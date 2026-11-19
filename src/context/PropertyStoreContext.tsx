import React, {createContext, useCallback, useContext, useEffect, useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {
  DEFAULT_SITE_SETTINGS,
  DEMO_INQUIRIES,
  DEMO_PROPERTIES,
} from '../data/demoProperties';
import {isSupabaseConfigured, supabase} from '../lib/supabase';
import {
  isPropertyPubliclyVisible,
  normalizeProperty,
  propertyService,
  validatePropertyForPublish,
} from '../services/propertyService';
import type {
  BuyerInquiry,
  InquiryStatus,
  Property,
  PropertyInput,
  PropertyStatus,
  PropertyVisibility,
  SiteSettings,
} from '../types/property';
import {validateCanonicalSiteUrl} from '../utils/siteUrl';

interface PropertyStoreValue {
  properties: Property[];
  activeProperties: Property[];
  draftProperties: Property[];
  archivedProperties: Property[];
  inquiries: BuyerInquiry[];
  siteSettings: SiteSettings;
  canonicalUrlValidation: ReturnType<typeof validateCanonicalSiteUrl>;
  isLoading: boolean;
  isDemoMode: boolean;
  isUsingDemoFallback: boolean;
  supabaseError: string | null;
  session: Session | null;
  authReady: boolean;
  refreshAll: () => Promise<void>;
  getByLotId: (lotId: string) => Property | undefined;
  createProperty: (input: PropertyInput) => Promise<Property>;
  updateProperty: (id: string, input: PropertyInput) => Promise<Property>;
  setPropertyVisibility: (id: string, visibility: PropertyVisibility) => Promise<void>;
  toggleArchiveProperty: (id: string, archive: boolean) => Promise<void>;
  bulkUpdateStatus: (ids: string[], status: PropertyStatus) => Promise<void>;
  bulkUpdateVisibility: (ids: string[], visibility: PropertyVisibility) => Promise<void>;
  deleteProperty: (id: string) => Promise<void>;
  submitInquiry: (
    payload: Omit<BuyerInquiry, 'id' | 'status' | 'createdAt'>
  ) => Promise<BuyerInquiry>;
  updateInquiryStatus: (id: string, status: InquiryStatus) => Promise<void>;
  saveSiteSettings: (settings: SiteSettings) => Promise<void>;
  resetDemoData: () => void;
  signInWithSupabase: (email: string, password: string) => Promise<void>;
  signOutSupabase: () => Promise<void>;
}

const PropertyStoreContext = createContext<PropertyStoreValue | null>(null);

export function PropertyStoreProvider({children}: {children: React.ReactNode}) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [inquiries, setInquiries] = useState<BuyerInquiry[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [isUsingDemoFallback, setIsUsingDemoFallback] = useState(false);

  const isDemoMode = !isSupabaseConfigured || isUsingDemoFallback;
  const canonicalUrlValidation = validateCanonicalSiteUrl(siteSettings.canonicalSiteUrl);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setSupabaseError(null);
    try {
      const settings = await propertyService.getSiteSettings();
      setSiteSettings(settings);

      if (!isSupabaseConfigured) {
        const [propsList, inqList] = await Promise.all([
          propertyService.listProperties(true),
          propertyService.listInquiries(),
        ]);
        setProperties(propsList);
        setInquiries(inqList);
        setIsUsingDemoFallback(false);
        return;
      }

      const propsList = await propertyService.listProperties(Boolean(session));
      setProperties(propsList);
      setIsUsingDemoFallback(false);

      if (session) {
        try {
          const inqList = await propertyService.listInquiries();
          setInquiries(inqList);
        } catch (inqErr) {
          setInquiries([]);
          setSupabaseError(
            inqErr instanceof Error ? inqErr.message : 'Unable to load inquiries from Supabase.'
          );
        }
      } else {
        setInquiries([]);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to connect to Supabase tables.';
      setSupabaseError(message);
      setIsUsingDemoFallback(true);
      setProperties(DEMO_PROPERTIES.map((p) => normalizeProperty(p)));
      setInquiries(DEMO_INQUIRIES);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setAuthReady(true);
      return;
    }

    supabase.auth
      .getSession()
      .then(({data}) => {
        setSession(data.session ?? null);
        setAuthReady(true);
      })
      .catch(() => {
        setSession(null);
        setAuthReady(true);
      });

    const {data: subscription} = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authReady) {
      void refreshAll();
    }
  }, [authReady, refreshAll]);

  const activeProperties = properties.filter(isPropertyPubliclyVisible);
  const draftProperties = properties.filter((p) => p.visibility === 'Draft' && !p.isArchived);
  const archivedProperties = properties.filter(
    (p) => p.visibility === 'Archived' || p.isArchived
  );

  const getByLotId = useCallback(
    (lotId: string) => {
      const normalized = decodeURIComponent(lotId).trim().toUpperCase();
      return properties.find((p) => p.lotId.toUpperCase() === normalized);
    },
    [properties]
  );

  const createProperty = useCallback(
    async (input: PropertyInput) => {
      if (isUsingDemoFallback) {
        throw new Error(
          'Supabase database is not ready yet. Apply supabase/migrations/20261118_stage2_property_management.sql first.'
        );
      }
      if (input.visibility === 'Published') {
        const errors = validatePropertyForPublish(input, siteSettings.canonicalSiteUrl);
        if (errors.length > 0) {
          throw new Error(errors[0]);
        }
      }
      const created = await propertyService.createProperty(input);
      setProperties((prev) => [created, ...prev]);
      return created;
    },
    [isUsingDemoFallback, siteSettings.canonicalSiteUrl]
  );

  const updateProperty = useCallback(
    async (id: string, input: PropertyInput) => {
      if (isUsingDemoFallback) {
        throw new Error(
          'Supabase database is not ready yet. Apply the Stage 2 migration SQL first.'
        );
      }
      if (input.visibility === 'Published') {
        const errors = validatePropertyForPublish(input, siteSettings.canonicalSiteUrl);
        if (errors.length > 0) {
          throw new Error(errors[0]);
        }
      }
      const updated = await propertyService.updateProperty(id, input);
      setProperties((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    },
    [isUsingDemoFallback, siteSettings.canonicalSiteUrl]
  );

  const setPropertyVisibility = useCallback(
    async (id: string, visibility: PropertyVisibility) => {
      if (isUsingDemoFallback) {
        throw new Error('Supabase database is not ready yet.');
      }
      const target = properties.find((p) => p.id === id);
      if (target && visibility === 'Published') {
        const errors = validatePropertyForPublish(target, siteSettings.canonicalSiteUrl);
        if (errors.length > 0) {
          throw new Error(errors[0]);
        }
      }
      await propertyService.setVisibility(id, visibility);
      const isArchived = visibility === 'Archived';
      setProperties((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                visibility,
                isArchived,
                publishedAt:
                  visibility === 'Published'
                    ? p.publishedAt || new Date().toISOString()
                    : p.publishedAt,
                updatedAt: new Date().toISOString(),
              }
            : p
        )
      );
    },
    [isUsingDemoFallback, properties, siteSettings.canonicalSiteUrl]
  );

  const toggleArchiveProperty = useCallback(
    async (id: string, archive: boolean) => {
      await setPropertyVisibility(id, archive ? 'Archived' : 'Published');
    },
    [setPropertyVisibility]
  );

  const bulkUpdateStatus = useCallback(
    async (ids: string[], status: PropertyStatus) => {
      if (isUsingDemoFallback) {
        throw new Error('Supabase database is not ready yet.');
      }
      await propertyService.bulkUpdateStatus(ids, status);
      const idSet = new Set(ids);
      setProperties((prev) =>
        prev.map((p) =>
          idSet.has(p.id) ? {...p, status, updatedAt: new Date().toISOString()} : p
        )
      );
    },
    [isUsingDemoFallback]
  );

  const bulkUpdateVisibility = useCallback(
    async (ids: string[], visibility: PropertyVisibility) => {
      if (isUsingDemoFallback) {
        throw new Error('Supabase database is not ready yet.');
      }
      if (visibility === 'Published') {
        if (!canonicalUrlValidation.valid) {
          throw new Error(
            canonicalUrlValidation.reason ||
              'Configure canonical production URL in Settings before publishing.'
          );
        }
        for (const id of ids) {
          const item = properties.find((p) => p.id === id);
          if (item) {
            const errs = validatePropertyForPublish(item, siteSettings.canonicalSiteUrl);
            if (errs.length > 0) {
              throw new Error(`${item.lotId}: ${errs[0]}`);
            }
          }
        }
      }
      await propertyService.bulkUpdateVisibility(ids, visibility);
      const idSet = new Set(ids);
      const isArchived = visibility === 'Archived';
      setProperties((prev) =>
        prev.map((p) =>
          idSet.has(p.id)
            ? {...p, visibility, isArchived, updatedAt: new Date().toISOString()}
            : p
        )
      );
    },
    [
      canonicalUrlValidation.reason,
      canonicalUrlValidation.valid,
      isUsingDemoFallback,
      properties,
      siteSettings.canonicalSiteUrl,
    ]
  );

  const deleteProperty = useCallback(
    async (id: string) => {
      if (isUsingDemoFallback) {
        throw new Error('Supabase database is not ready yet.');
      }
      await propertyService.deleteProperty(id);
      setProperties((prev) => prev.filter((p) => p.id !== id));
    },
    [isUsingDemoFallback]
  );

  const submitInquiry = useCallback(
    async (payload: Omit<BuyerInquiry, 'id' | 'status' | 'createdAt'>) => {
      if (isUsingDemoFallback) {
        const localDemo: BuyerInquiry = {
          ...payload,
          id: `inq-fallback-${Date.now()}`,
          status: 'New',
          createdAt: new Date().toISOString(),
        };
        setInquiries((prev) => [localDemo, ...prev]);
        return localDemo;
      }
      const created = await propertyService.createInquiry(payload);
      setInquiries((prev) => [created, ...prev]);
      return created;
    },
    [isUsingDemoFallback]
  );

  const updateInquiryStatus = useCallback(
    async (id: string, status: InquiryStatus) => {
      if (isUsingDemoFallback) {
        setInquiries((prev) =>
          prev.map((item) => (item.id === id ? {...item, status} : item))
        );
        return;
      }
      await propertyService.updateInquiryStatus(id, status);
      setInquiries((prev) =>
        prev.map((item) => (item.id === id ? {...item, status} : item))
      );
    },
    [isUsingDemoFallback]
  );

  const saveSiteSettings = useCallback(
    async (settings: SiteSettings) => {
      const saved = await propertyService.saveSiteSettings(settings);
      setSiteSettings(saved);
    },
    []
  );

  const resetDemoData = useCallback(() => {
    const reset = propertyService.resetDemoData();
    setProperties(reset.properties);
    setInquiries(reset.inquiries);
  }, []);

  const signInWithSupabase = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      throw new Error('Supabase is not configured in this Stage 1 Demo environment.');
    }
    const {error} = await supabase.auth.signInWithPassword({email, password});
    if (error) throw new Error(error.message);
  }, []);

  const signOutSupabase = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  return (
    <PropertyStoreContext.Provider
      value={{
        properties,
        activeProperties,
        draftProperties,
        archivedProperties,
        inquiries,
        siteSettings,
        canonicalUrlValidation,
        isLoading,
        isDemoMode,
        isUsingDemoFallback,
        supabaseError,
        session,
        authReady,
        refreshAll,
        getByLotId,
        createProperty,
        updateProperty,
        setPropertyVisibility,
        toggleArchiveProperty,
        bulkUpdateStatus,
        bulkUpdateVisibility,
        deleteProperty,
        submitInquiry,
        updateInquiryStatus,
        saveSiteSettings,
        resetDemoData,
        signInWithSupabase,
        signOutSupabase,
      }}
    >
      {children}
    </PropertyStoreContext.Provider>
  );
}

export function usePropertyStore() {
  const ctx = useContext(PropertyStoreContext);
  if (!ctx) {
    throw new Error('usePropertyStore must be used inside PropertyStoreProvider');
  }
  return ctx;
}
