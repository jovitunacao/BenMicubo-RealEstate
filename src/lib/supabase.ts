import {createClient, type SupabaseClient} from '@supabase/supabase-js';

export interface SupabaseEnvLike {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_ENABLE_DEMO_MODE?: string;
  DEV?: boolean;
  PROD?: boolean;
}

export type SupabaseConfigStatus =
  | 'configured'
  | 'explicit_demo'
  | 'missing_env'
  | 'invalid_url';

export interface SupabaseEnvironmentEvaluation {
  configStatus: SupabaseConfigStatus;
  isSupabaseConfigured: boolean;
  isExplicitDemoMode: boolean;
  isNodeTestRuntime: boolean;
  isDevRuntime: boolean;
  isProdBundle: boolean;
  hasUrl: boolean;
  hasAnonKey: boolean;
  hasValidUrl: boolean;
  supabaseHost: string | null;
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function extractSupabaseHost(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.host : null;
  } catch {
    return null;
  }
}

export function evaluateSupabaseEnvironment(
  env: SupabaseEnvLike | undefined
): SupabaseEnvironmentEvaluation {
  const isNodeTestRuntime = env === undefined;
  const rawUrl = (env?.VITE_SUPABASE_URL ?? '').trim();
  const rawAnonKey = (env?.VITE_SUPABASE_ANON_KEY ?? '').trim();
  const rawDemoFlag = (env?.VITE_ENABLE_DEMO_MODE ?? '').trim().toLowerCase();

  const isProdBundle = Boolean(env?.PROD);
  const isDevRuntime = Boolean(env?.DEV);

  const hasUrl = rawUrl.length > 0;
  const hasAnonKey = rawAnonKey.length > 0;
  const hasValidUrl = hasUrl && isValidHttpUrl(rawUrl);
  const supabaseHost = hasValidUrl ? extractSupabaseHost(rawUrl) : null;

  // Demo mode is permitted ONLY when explicitly opted into via VITE_ENABLE_DEMO_MODE=true
  // inside a local Vite dev server (DEV=true, PROD=false). Production and preview builds
  // (PROD=true) can NEVER enter demo mode even if VITE_ENABLE_DEMO_MODE were set.
  const isExplicitDemoMode =
    !isNodeTestRuntime && isDevRuntime && !isProdBundle && rawDemoFlag === 'true';

  const isSupabaseConfigured = !isExplicitDemoMode && hasValidUrl && hasAnonKey;

  let configStatus: SupabaseConfigStatus;
  if (isExplicitDemoMode) {
    configStatus = 'explicit_demo';
  } else if (isSupabaseConfigured) {
    configStatus = 'configured';
  } else if (hasUrl && !hasValidUrl) {
    configStatus = 'invalid_url';
  } else {
    configStatus = 'missing_env';
  }

  return {
    configStatus,
    isSupabaseConfigured,
    isExplicitDemoMode,
    isNodeTestRuntime,
    isDevRuntime,
    isProdBundle,
    hasUrl,
    hasAnonKey,
    hasValidUrl,
    supabaseHost,
  };
}

const runtimeEnv = (import.meta as unknown as {env?: SupabaseEnvLike}).env;
export const supabaseEnvironment = evaluateSupabaseEnvironment(runtimeEnv);

export const isSupabaseConfigured = supabaseEnvironment.isSupabaseConfigured;
export const isExplicitDemoMode = supabaseEnvironment.isExplicitDemoMode;
export const isNodeTestRuntime = supabaseEnvironment.isNodeTestRuntime;
export const supabaseHost = supabaseEnvironment.supabaseHost;

const rawUrl = (runtimeEnv?.VITE_SUPABASE_URL ?? '').trim();
const rawAnonKey = (runtimeEnv?.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(rawUrl, rawAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;
