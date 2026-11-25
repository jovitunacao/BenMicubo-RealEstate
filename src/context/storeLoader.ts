import {DEFAULT_SITE_SETTINGS} from '../data/demoProperties';
import type {SupabaseEnvironmentEvaluation} from '../lib/supabase';
import {
  classifySupabaseEnvFailure,
  classifySupabaseError,
  sanitizeDiagnosticText,
  type SupabaseDiagnosticInfo,
} from '../lib/supabaseDiagnostics';
import type {BuyerInquiry, Property, SiteSettings} from '../types/property';

export interface StoreLoaderService {
  getSiteSettings: () => Promise<SiteSettings>;
  checkCurrentUserAdminRole: (userId: string) => Promise<{
    isAuthorized: boolean;
    role: 'admin' | 'super_admin' | null;
    error?: Error;
  }>;
  listProperties: (includeUnpublished?: boolean) => Promise<Property[]>;
  listInquiries: () => Promise<BuyerInquiry[]>;
}

export interface StoreSnapshotResult {
  properties: Property[];
  inquiries: BuyerInquiry[];
  siteSettings: SiteSettings;
  isDemoMode: boolean;
  isUsingDemoFallback: false;
  isServiceUnavailable: boolean;
  isAdminAuthorized: boolean;
  adminRole: 'admin' | 'super_admin' | null;
  adminAuthCheckFailed: boolean;
  supabaseError: string | null;
  supabaseDiagnostic: SupabaseDiagnosticInfo | null;
}

export async function loadStoreSnapshot(params: {
  env: SupabaseEnvironmentEvaluation;
  sessionUserId: string | null;
  service: StoreLoaderService;
}): Promise<StoreSnapshotResult> {
  const {env, sessionUserId, service} = params;

  // Demo mode is allowed ONLY when explicitly enabled in local dev via VITE_ENABLE_DEMO_MODE=true.
  if (env.isExplicitDemoMode) {
    const [siteSettings, properties, inquiries] = await Promise.all([
      service.getSiteSettings(),
      service.listProperties(true),
      service.listInquiries(),
    ]);
    return {
      properties,
      inquiries,
      siteSettings,
      isDemoMode: true,
      isUsingDemoFallback: false,
      isServiceUnavailable: false,
      isAdminAuthorized: true,
      adminRole: 'admin',
      adminAuthCheckFailed: false,
      supabaseError: null,
      supabaseDiagnostic: null,
    };
  }

  // Never fall back to demo data or bypass admin auth when Supabase env configuration is missing/invalid.
  if (!env.isSupabaseConfigured) {
    const diagnostic = classifySupabaseEnvFailure(env);
    return {
      properties: [],
      inquiries: [],
      siteSettings: DEFAULT_SITE_SETTINGS,
      isDemoMode: false,
      isUsingDemoFallback: false,
      isServiceUnavailable: true,
      isAdminAuthorized: false,
      adminRole: null,
      adminAuthCheckFailed: Boolean(sessionUserId),
      supabaseError: diagnostic.sanitizedMessage,
      supabaseDiagnostic: diagnostic,
    };
  }

  let authorizedAdmin = false;
  let resolvedRole: 'admin' | 'super_admin' | null = null;
  let adminAuthCheckFailed = false;

  if (sessionUserId) {
    try {
      const check = await service.checkCurrentUserAdminRole(sessionUserId);
      if (check.error) {
        adminAuthCheckFailed = true;
        const diagnostic = classifySupabaseError(check.error, {
          operation: 'public.admin_users',
          supabaseHost: env.supabaseHost,
        });
        return {
          properties: [],
          inquiries: [],
          siteSettings: DEFAULT_SITE_SETTINGS,
          isDemoMode: false,
          isUsingDemoFallback: false,
          isServiceUnavailable: true,
          isAdminAuthorized: false,
          adminRole: null,
          adminAuthCheckFailed: true,
          supabaseError: diagnostic.sanitizedMessage,
          supabaseDiagnostic: diagnostic,
        };
      }
      authorizedAdmin = check.isAuthorized;
      resolvedRole = check.role;
    } catch (err) {
      adminAuthCheckFailed = true;
      const diagnostic = classifySupabaseError(err, {
        operation: 'public.admin_users',
        supabaseHost: env.supabaseHost,
      });
      return {
        properties: [],
        inquiries: [],
        siteSettings: DEFAULT_SITE_SETTINGS,
        isDemoMode: false,
        isUsingDemoFallback: false,
        isServiceUnavailable: true,
        isAdminAuthorized: false,
        adminRole: null,
        adminAuthCheckFailed: true,
        supabaseError: diagnostic.sanitizedMessage,
        supabaseDiagnostic: diagnostic,
      };
    }
  }

  let siteSettings = DEFAULT_SITE_SETTINGS;
  try {
    siteSettings = await service.getSiteSettings();
  } catch {
    siteSettings = DEFAULT_SITE_SETTINGS;
  }

  try {
    const properties = await service.listProperties(authorizedAdmin);
    let inquiries: BuyerInquiry[] = [];
    let partialError: string | null = null;
    let partialDiagnostic: SupabaseDiagnosticInfo | null = null;

    if (authorizedAdmin) {
      try {
        inquiries = await service.listInquiries();
      } catch (inqErr) {
        inquiries = [];
        partialDiagnostic = classifySupabaseError(inqErr, {
          operation: 'public.inquiries',
          supabaseHost: env.supabaseHost,
        });
        partialError = sanitizeDiagnosticText(partialDiagnostic.sanitizedMessage);
      }
    }

    return {
      properties,
      inquiries,
      siteSettings,
      isDemoMode: false,
      isUsingDemoFallback: false,
      isServiceUnavailable: false,
      isAdminAuthorized: authorizedAdmin,
      adminRole: resolvedRole,
      adminAuthCheckFailed,
      supabaseError: partialError,
      supabaseDiagnostic: partialDiagnostic,
    };
  } catch (err) {
    // CRITICAL: Never substitute DEMO_PROPERTIES or DEMO_INQUIRIES when a live query fails.
    const diagnostic = classifySupabaseError(err, {
      operation: authorizedAdmin
        ? 'public.properties (admin)'
        : 'public.public_properties',
      supabaseHost: env.supabaseHost,
    });

    return {
      properties: [],
      inquiries: [],
      siteSettings,
      isDemoMode: false,
      isUsingDemoFallback: false,
      isServiceUnavailable: true,
      isAdminAuthorized: authorizedAdmin,
      adminRole: resolvedRole,
      adminAuthCheckFailed,
      supabaseError: diagnostic.sanitizedMessage,
      supabaseDiagnostic: diagnostic,
    };
  }
}
