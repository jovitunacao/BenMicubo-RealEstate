import type {SupabaseEnvironmentEvaluation} from './supabase';

export type SupabaseFailureCategory =
  | 'missing_env'
  | 'missing_migration'
  | 'rls_or_permission'
  | 'auth_or_session'
  | 'network_or_service'
  | 'unknown';

export interface SupabaseDiagnosticInfo {
  category: SupabaseFailureCategory;
  operation: string;
  supabaseHost: string | null;
  errorCode: string | null;
  sanitizedMessage: string;
  recommendedAction: string;
  pendingMigrations: string[];
  occurredAt: string;
}

export class SupabaseQueryError extends Error {
  readonly operation: string;
  readonly code: string | null;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(
    message: string,
    meta: {
      operation: string;
      code?: string | null;
      details?: string | null;
      hint?: string | null;
    }
  ) {
    super(message);
    this.name = 'SupabaseQueryError';
    this.operation = meta.operation;
    this.code = meta.code ?? null;
    this.details = meta.details ?? null;
    this.hint = meta.hint ?? null;
  }
}

export function sanitizeDiagnosticText(input: string): string {
  return (input || '')
    // Redact JWT tokens (anon/service/session tokens)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g, '[REDACTED_JWT]')
    // Redact Bearer / apikey header values
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(apikey|api_key|service_role|anon_key|password|token)=([^\s&]+)/gi, '$1=[REDACTED]')
    .trim();
}

export function classifySupabaseEnvFailure(
  envEval: SupabaseEnvironmentEvaluation
): SupabaseDiagnosticInfo {
  const missingParts: string[] = [];
  if (!envEval.hasUrl) missingParts.push('VITE_SUPABASE_URL');
  else if (!envEval.hasValidUrl) missingParts.push('VITE_SUPABASE_URL (invalid HTTP/HTTPS URL)');
  if (!envEval.hasAnonKey) missingParts.push('VITE_SUPABASE_ANON_KEY');

  return {
    category: 'missing_env',
    operation: 'supabase.env',
    supabaseHost: envEval.supabaseHost,
    errorCode: envEval.configStatus === 'invalid_url' ? 'INVALID_URL' : 'MISSING_ENV',
    sanitizedMessage:
      missingParts.length > 0
        ? `Missing or invalid Supabase frontend environment configuration: ${missingParts.join(', ')}.`
        : 'Supabase client is not initialized.',
    recommendedAction:
      'Set valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY variables in Cloudflare Pages (Production & Preview environments) and redeploy. Do not enable demo mode in live deployments.',
    pendingMigrations: [],
    occurredAt: new Date().toISOString(),
  };
}

export function classifySupabaseError(
  err: unknown,
  context: {
    operation?: string;
    supabaseHost: string | null;
  }
): SupabaseDiagnosticInfo {
  const queryErr = err instanceof SupabaseQueryError ? err : null;
  const rawMessage = err instanceof Error ? err.message : String(err || 'Unknown Supabase error');
  const sanitizedMessage = sanitizeDiagnosticText(rawMessage);
  const operation = queryErr?.operation || context.operation || 'supabase.query';
  const code = queryErr?.code ?? null;
  const combined = `${code || ''} ${sanitizedMessage} ${queryErr?.details || ''} ${queryErr?.hint || ''}`.toLowerCase();

  if (code === 'MISSING_ENV' || code === 'INVALID_URL') {
    return {
      category: 'missing_env',
      operation,
      supabaseHost: context.supabaseHost,
      errorCode: code,
      sanitizedMessage,
      recommendedAction:
        'Configure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your deployment environment variables and rebuild.',
      pendingMigrations: [],
      occurredAt: new Date().toISOString(),
    };
  }

  const looksLikeMissingMigration =
    code === 'PGRST205' ||
    code === 'PGRST200' ||
    code === '42P01' ||
    code === '42703' ||
    /could not find the table|could not find a relationship|schema cache|does not exist|undefined column/i.test(
      combined
    );

  if (looksLikeMissingMigration) {
    const mentionsNewFeatures =
      /public_properties|public_property_presentations|property_presentations|frontage_length_m|show_selling_price|show_price_per_sqm/.test(
        combined
      ) ||
      /public_properties|public_property_presentations|property_presentations/.test(
        operation.toLowerCase()
      );

    const pendingMigrations = mentionsNewFeatures
      ? ['supabase/migrations/20261124_presentations_frontage_price_visibility.sql']
      : [];

    return {
      category: 'missing_migration',
      operation,
      supabaseHost: context.supabaseHost,
      errorCode: code,
      sanitizedMessage,
      recommendedAction: mentionsNewFeatures
        ? 'The frontend expects database views/tables from the incremental migration. Review and apply supabase/migrations/20261124_presentations_frontage_price_visibility.sql in Supabase SQL Editor. Do NOT run 20261119_fresh_install.sql or reset existing data.'
        : 'A required database table, view, or column is missing. Inspect the error message and apply only the pending incremental migration without running fresh-install scripts.',
      pendingMigrations,
      occurredAt: new Date().toISOString(),
    };
  }

  if (
    code === '42501' ||
    code === 'PGRST301' ||
    /permission denied|row-level security|insufficient privilege|not authorized/i.test(combined)
  ) {
    return {
      category: 'rls_or_permission',
      operation,
      supabaseHost: context.supabaseHost,
      errorCode: code,
      sanitizedMessage,
      recommendedAction:
        'Verify RLS policies, view grants (public_properties / public_property_presentations), and active membership in public.admin_users.',
      pendingMigrations: [],
      occurredAt: new Date().toISOString(),
    };
  }

  if (/jwt|token|refresh_token|session|invalid login|unauthorized/i.test(combined)) {
    return {
      category: 'auth_or_session',
      operation,
      supabaseHost: context.supabaseHost,
      errorCode: code,
      sanitizedMessage,
      recommendedAction:
        'Sign out and sign back in with an authorized administrator account listed in public.admin_users.',
      pendingMigrations: [],
      occurredAt: new Date().toISOString(),
    };
  }

  if (
    /failed to fetch|networkerror|network request failed|fetch|timeout|timed out|econnrefused|502|503|504/i.test(
      combined
    )
  ) {
    return {
      category: 'network_or_service',
      operation,
      supabaseHost: context.supabaseHost,
      errorCode: code,
      sanitizedMessage,
      recommendedAction:
        'Check network connectivity and Supabase project status/health for this host, then retry.',
      pendingMigrations: [],
      occurredAt: new Date().toISOString(),
    };
  }

  return {
    category: 'unknown',
    operation,
    supabaseHost: context.supabaseHost,
    errorCode: code,
    sanitizedMessage,
    recommendedAction:
      'Review Supabase API logs and table/view schema for the failing operation.',
    pendingMigrations: [],
    occurredAt: new Date().toISOString(),
  };
}
