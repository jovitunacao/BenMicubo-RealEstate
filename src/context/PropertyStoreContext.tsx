import React, {createContext, useCallback, useContext, useEffect, useState} from 'react';
import type {Session} from '@supabase/supabase-js';
import {DEMO_INQUIRIES, DEMO_PROPERTIES} from '../data/demoProperties';
import {isSupabaseConfigured, supabase} from '../lib/supabase';
import {propertyService} from '../services/propertyService';
import type {
  BuyerInquiry,
  InquiryStatus,
  Property,
  PropertyInput,
} from '../types/property';

interface PropertyStoreValue {
  properties: Property[];
  activeProperties: Property[];
  inquiries: BuyerInquiry[];
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
  toggleArchiveProperty: (id: string, archive: boolean) => Promise<void>;
  deleteProperty: (id: string) => Promise<void>;
  submitInquiry: (
    payload: Omit<BuyerInquiry, 'id' | 'status' | 'createdAt'>
  ) => Promise<BuyerInquiry>;
  updateInquiryStatus: (id: string, status: InquiryStatus) => Promise<void>;
  resetDemoData: () => void;
  signInWithSupabase: (email: string, password: string) => Promise<void>;
  signOutSupabase: () => Promise<void>;
}

const PropertyStoreContext = createContext<PropertyStoreValue | null>(null);

export function PropertyStoreProvider({children}: {children: React.ReactNode}) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [inquiries, setInquiries] = useState<BuyerInquiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [supabaseError, setSupabaseError] = useState<string | null>(null);
  const [isUsingDemoFallback, setIsUsingDemoFallback] = useState(false);

  const isDemoMode = !isSupabaseConfigured || isUsingDemoFallback;

  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setSupabaseError(null);
    try {
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
      setProperties(DEMO_PROPERTIES);
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

  const activeProperties = properties.filter((p) => !p.isArchived);

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
          'Supabase database is not ready yet (see notice above). Apply supabase/schema.sql before saving live properties.'
        );
      }
      const created = await propertyService.createProperty(input);
      setProperties((prev) => [created, ...prev]);
      return created;
    },
    [isUsingDemoFallback]
  );

  const updateProperty = useCallback(
    async (id: string, input: PropertyInput) => {
      if (isUsingDemoFallback) {
        throw new Error(
          'Supabase database is not ready yet. Apply supabase/schema.sql before updating live properties.'
        );
      }
      const updated = await propertyService.updateProperty(id, input);
      setProperties((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return updated;
    },
    [isUsingDemoFallback]
  );

  const toggleArchiveProperty = useCallback(
    async (id: string, archive: boolean) => {
      if (isUsingDemoFallback) {
        throw new Error(
          'Supabase database is not ready yet. Apply supabase/schema.sql before archiving live properties.'
        );
      }
      await propertyService.setArchived(id, archive);
      setProperties((prev) =>
        prev.map((p) =>
          p.id === id ? {...p, isArchived: archive, updatedAt: new Date().toISOString()} : p
        )
      );
    },
    [isUsingDemoFallback]
  );

  const deleteProperty = useCallback(
    async (id: string) => {
      if (isUsingDemoFallback) {
        throw new Error(
          'Supabase database is not ready yet. Apply supabase/schema.sql before deleting live properties.'
        );
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
        inquiries,
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
        toggleArchiveProperty,
        deleteProperty,
        submitInquiry,
        updateInquiryStatus,
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
