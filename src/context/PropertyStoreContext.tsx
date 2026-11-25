import React, {createContext, useCallback, useContext, useEffect, useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {DEFAULT_SITE_SETTINGS} from '../data/demoProperties';
import {
  isExplicitDemoMode,
  isSupabaseConfigured,
  supabase,
  supabaseEnvironment,
} from '../lib/supabase';
import type {SupabaseDiagnosticInfo} from '../lib/supabaseDiagnostics';
import {
  isPropertyPubliclyVisible,
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
import {
  getEffectiveCanonicalSiteUrl,
  validateCanonicalSiteUrl,
} from '../utils/siteUrl';
import {loadStoreSnapshot} from './storeLoader';

interface PropertyStoreValue {
  properties: Property[];
  activeProperties: Property[];
  draftProperties: Property[];
  archivedProperties: Property[];
  inquiries: BuyerInquiry[];
  siteSettings: SiteSettings;
  effectiveCanonicalSiteUrl: string;
  canonicalUrlValidation: ReturnType<typeof validateCanonicalSiteUrl>;
  isLoading: boolean;
  isDemoMode: boolean;
  isUsingDemoFallback: boolean;
  isServiceUnavailable: boolean;
  isSupabaseConfigured: boolean;
  supabaseError: string | null;
  supabaseDiagnostic: SupabaseDiagnosticInfo | null;
  session: Session | null;
  authReady: boolean;
  isAdminAuthorized: boolean;
  adminRole: 'admin' | 'super_admin' | null;
  adminAuthCheckFailed: boolean;
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
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured || isExplicitDemoMode);
  const [isAdminAuthorized, setIsAdminAuthorized] = useState(false);
  const [adminRole, setAdminRole] = useState<'admin' | 'super_admin' | null>(null);
  const [adminAuthCheckFailed, setAdminAuthCheckFailed] = useState(false);
  const [isServiceUnavailable, setIsServiceUnavailable] = useState(false);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [supabaseDiagnostic, setSupabaseDiagnostic] =
    useState<SupabaseDiagnosticInfo | null>(null);

  const isDemoMode = isExplicitDemoMode;
  const isUsingDemoFallback = false;
  const effectiveCanonicalSiteUrl = getEffectiveCanonicalSiteUrl(
    siteSettings.canonicalSiteUrl
  );
  const canonicalUrlValidation = validateCanonicalSiteUrl(effectiveCanonicalSiteUrl);

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const snapshot = await loadStoreSnapshot({
        env: supabaseEnvironment,
        sessionUserId: session?.user.id ?? null,
        service: propertyService,
      });
      setSiteSettings(snapshot.siteSettings);
      setProperties(snapshot.properties);
      setInquiries(snapshot.inquiries);
      setIsAdminAuthorized(snapshot.isAdminAuthorized);
      setAdminRole(snapshot.adminRole);
      setAdminAuthCheckFailed(snapshot.adminAuthCheckFailed);
      setIsServiceUnavailable(snapshot.isServiceUnavailable);
      setSupabaseError(snapshot.supabaseError);
      setSupabaseDiagnostic(snapshot.supabaseDiagnostic);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (isExplicitDemoMode || !isSupabaseConfigured || !supabase) {
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

  const assertDatabaseWritable = useCallback(() => {
    if (!isDemoMode && isServiceUnavailable) {
      throw new Error(
        'Database connection is currently unavailable. Check Supabase diagnostics and retry before making changes.'
      );
    }
  }, [isDemoMode, isServiceUnavailable]);

  const createProperty = useCallback(
    async (input: PropertyInput) => {
      assertDatabaseWritable();
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
    [assertDatabaseWritable, siteSettings.canonicalSiteUrl]
  );

  const updateProperty = useCallback(
    async (id: string, input: PropertyInput) => {
      assertDatabaseWritable();
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
    [assertDatabaseWritable, siteSettings.canonicalSiteUrl]
  );

  const setPropertyVisibility = useCallback(
    async (id: string, visibility: PropertyVisibility) => {
      assertDatabaseWritable();
      const target = properties.find((p) => p.id === id);
      if (target && visibility === 'Published') {
        const errors = validatePropertyForPublish(target, siteSettings.canonicalSiteUrl);
        if (errors.length > 0) {
          throw new Error(errors[0]);
        }
      }
      const updated = await propertyService.setVisibility(id, visibility);
      const isArchived = visibility === 'Archived';
      setProperties((prev) =>
        prev.map((p) =>
          p.id === id
            ? updated || {
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
    [assertDatabaseWritable, properties, siteSettings.canonicalSiteUrl]
  );

  const toggleArchiveProperty = useCallback(
    async (id: string, archive: boolean) => {
      await setPropertyVisibility(id, archive ? 'Archived' : 'Published');
    },
    [setPropertyVisibility]
  );

  const bulkUpdateStatus = useCallback(
    async (ids: string[], status: PropertyStatus) => {
      assertDatabaseWritable();
      await propertyService.bulkUpdateStatus(ids, status);
      const idSet = new Set(ids);
      setProperties((prev) =>
        prev.map((p) =>
          idSet.has(p.id) ? {...p, status, updatedAt: new Date().toISOString()} : p
        )
      );
    },
    [assertDatabaseWritable]
  );

  const bulkUpdateVisibility = useCallback(
    async (ids: string[], visibility: PropertyVisibility) => {
      assertDatabaseWritable();
      if (visibility === 'Published') {
        for (const id of ids) {
          const item = properties.find((p) => p.id === id);
          if (item) {
            const errs = validatePropertyForPublish(item);
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
    [assertDatabaseWritable, properties]
  );

  const deleteProperty = useCallback(
    async (id: string) => {
      assertDatabaseWritable();
      await propertyService.deleteProperty(id);
      setProperties((prev) => prev.filter((p) => p.id !== id));
    },
    [assertDatabaseWritable]
  );

  const submitInquiry = useCallback(
    async (payload: Omit<BuyerInquiry, 'id' | 'status' | 'createdAt'>) => {
      if (!isDemoMode && isServiceUnavailable) {
        throw new Error(
          'Online inquiry submission is temporarily unavailable while the database reconnects. Please try again shortly.'
        );
      }
      const created = await propertyService.createInquiry(payload);
      setInquiries((prev) => [created, ...prev]);
      return created;
    },
    [isDemoMode, isServiceUnavailable]
  );

  const updateInquiryStatus = useCallback(
    async (id: string, status: InquiryStatus) => {
      assertDatabaseWritable();
      await propertyService.updateInquiryStatus(id, status);
      setInquiries((prev) =>
        prev.map((item) => (item.id === id ? {...item, status} : item))
      );
    },
    [assertDatabaseWritable]
  );

  const saveSiteSettings = useCallback(
    async (settings: SiteSettings) => {
      assertDatabaseWritable();
      const saved = await propertyService.saveSiteSettings(settings);
      setSiteSettings(saved);
    },
    [assertDatabaseWritable]
  );

  const resetDemoData = useCallback(() => {
    if (!isDemoMode) return;
    const reset = propertyService.resetDemoData();
    setProperties(reset.properties);
    setInquiries(reset.inquiries);
  }, [isDemoMode]);

  const signInWithSupabase = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      throw new Error(
        'Administrator authentication is unavailable because Supabase is not configured for this environment.'
      );
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
        effectiveCanonicalSiteUrl,
        canonicalUrlValidation,
        isLoading,
        isDemoMode,
        isUsingDemoFallback,
        isServiceUnavailable,
        isSupabaseConfigured,
        supabaseError,
        supabaseDiagnostic,
        session,
        authReady,
        isAdminAuthorized,
        adminRole,
        adminAuthCheckFailed,
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
