import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {evaluateSupabaseEnvironment} from '../src/lib/supabase';
import {
  classifySupabaseError,
  sanitizeDiagnosticText,
  SupabaseQueryError,
} from '../src/lib/supabaseDiagnostics';
import {createPropertyService, type SupabaseClientLike} from '../src/services/propertyService';
import {loadStoreSnapshot} from '../src/context/storeLoader';
import {DEFAULT_SITE_SETTINGS, DEMO_PROPERTIES} from '../src/data/demoProperties';

const ROOT = process.cwd();
const readSrc = (relPath: string) => readFileSync(join(ROOT, relPath), 'utf8');

test('evaluateSupabaseEnvironment: PROD build NEVER enters demo mode even if VITE_ENABLE_DEMO_MODE=true', () => {
  const prodMissingWithFlag = evaluateSupabaseEnvironment({
    PROD: true,
    DEV: false,
    VITE_ENABLE_DEMO_MODE: 'true',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
  });
  assert.equal(prodMissingWithFlag.isExplicitDemoMode, false);
  assert.equal(prodMissingWithFlag.isSupabaseConfigured, false);
  assert.equal(prodMissingWithFlag.configStatus, 'missing_env');

  const prodConfiguredWithFlag = evaluateSupabaseEnvironment({
    PROD: true,
    DEV: false,
    VITE_ENABLE_DEMO_MODE: 'true',
    VITE_SUPABASE_URL: 'https://rlltjnlztyozbamtaiue.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'public-anon-key-placeholder',
  });
  assert.equal(prodConfiguredWithFlag.isExplicitDemoMode, false);
  assert.equal(prodConfiguredWithFlag.isSupabaseConfigured, true);
  assert.equal(prodConfiguredWithFlag.configStatus, 'configured');
  assert.equal(prodConfiguredWithFlag.supabaseHost, 'rlltjnlztyozbamtaiue.supabase.co');
});

test('evaluateSupabaseEnvironment: DEV without opt-in stays unconfigured; invalid URL stays invalid_url; explicit DEV opt-in works', () => {
  const devMissingNoOptIn = evaluateSupabaseEnvironment({
    DEV: true,
    PROD: false,
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
  });
  assert.equal(devMissingNoOptIn.isExplicitDemoMode, false);
  assert.equal(devMissingNoOptIn.isSupabaseConfigured, false);
  assert.equal(devMissingNoOptIn.configStatus, 'missing_env');

  const invalidUrlEnv = evaluateSupabaseEnvironment({
    DEV: true,
    PROD: false,
    VITE_SUPABASE_URL: 'not-a-valid-url',
    VITE_SUPABASE_ANON_KEY: 'abc',
  });
  assert.equal(invalidUrlEnv.isSupabaseConfigured, false);
  assert.equal(invalidUrlEnv.configStatus, 'invalid_url');

  const devExplicitDemo = evaluateSupabaseEnvironment({
    DEV: true,
    PROD: false,
    VITE_ENABLE_DEMO_MODE: 'true',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
  });
  assert.equal(devExplicitDemo.isExplicitDemoMode, true);
  assert.equal(devExplicitDemo.isSupabaseConfigured, false);
  assert.equal(devExplicitDemo.configStatus, 'explicit_demo');
});

test('createPropertyService with allowLocalDemo=false fails closed instead of returning DEMO_PROPERTIES', async () => {
  const prodService = createPropertyService(() => null, {allowLocalDemo: false});

  await assert.rejects(
    () => prodService.listProperties(false),
    (err: unknown) =>
      err instanceof SupabaseQueryError &&
      err.code === 'MISSING_ENV' &&
      err.operation === 'public.public_properties'
  );

  await assert.rejects(
    () => prodService.listProperties(true),
    (err: unknown) =>
      err instanceof SupabaseQueryError &&
      err.code === 'MISSING_ENV' &&
      err.operation === 'public.properties'
  );

  const settings = await prodService.getSiteSettings();
  assert.deepEqual(settings, DEFAULT_SITE_SETTINGS);

  await assert.rejects(
    () =>
      prodService.createInquiry({
        propertyLotId: 'LOT-001',
        propertyTitle: 'Sample',
        buyerName: 'Buyer Test',
        buyerEmail: 'buyer@example.com',
        buyerPhone: '+63 917 000 0000',
        preferredDate: '',
        message: 'Inquiry should fail closed when database is unavailable.',
      }),
    (err: unknown) => err instanceof SupabaseQueryError && err.code === 'MISSING_ENV'
  );

  const adminCheck = await prodService.checkCurrentUserAdminRole('user-123');
  assert.equal(adminCheck.isAuthorized, false);
  assert.equal(adminCheck.role, null);
  assert.ok(adminCheck.error instanceof SupabaseQueryError);
  assert.equal(adminCheck.error.code, 'MISSING_ENV');
});

function createFailingPostgrestClient(config: {
  adminRow?: {role: 'admin' | 'super_admin'; is_active: boolean} | null;
  adminError?: {code: string; message: string; details?: string; hint?: string} | null;
  publicPropertiesError?: {code: string; message: string; details?: string; hint?: string} | null;
  adminPropertiesError?: {code: string; message: string; details?: string; hint?: string} | null;
}): SupabaseClientLike {
  return {
    from(table: string) {
      const state = {
        execute: async () => {
          if (table === 'admin_users') {
            if (config.adminError) {
              return {data: null, error: config.adminError};
            }
            return {data: config.adminRow ?? null, error: null};
          }
          if (table === 'site_settings') {
            return {data: null, error: null};
          }
          if (table === 'public_properties' && config.publicPropertiesError) {
            return {data: null, error: config.publicPropertiesError};
          }
          if (table === 'properties' && config.adminPropertiesError) {
            return {data: null, error: config.adminPropertiesError};
          }
          return {data: [], error: null};
        },
      };

      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        in() {
          return builder;
        },
        order() {
          return builder;
        },
        maybeSingle() {
          return state.execute();
        },
        single() {
          return state.execute();
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?: ((value: {data: unknown; error: unknown}) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return state.execute().then(onfulfilled, onrejected);
        },
      };

      return builder;
    },
    storage: {
      from() {
        return {};
      },
    },
  } as unknown as SupabaseClientLike;
}

test('loadStoreSnapshot: missing env vars fail closed with service-unavailable diagnostic & zero demo data', async () => {
  const missingEnv = evaluateSupabaseEnvironment({
    PROD: true,
    DEV: false,
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
  });
  const service = createPropertyService(() => null, {allowLocalDemo: false});

  const snapshot = await loadStoreSnapshot({
    env: missingEnv,
    sessionUserId: 'admin-session-should-still-not-bypass',
    service,
  });

  assert.equal(snapshot.isDemoMode, false);
  assert.equal(snapshot.isUsingDemoFallback, false);
  assert.equal(snapshot.isServiceUnavailable, true);
  assert.equal(snapshot.isAdminAuthorized, false);
  assert.equal(snapshot.adminAuthCheckFailed, true);
  assert.deepEqual(snapshot.properties, []);
  assert.deepEqual(snapshot.inquiries, []);
  assert.equal(snapshot.supabaseDiagnostic?.category, 'missing_env');
  assert.equal(snapshot.supabaseDiagnostic?.errorCode, 'MISSING_ENV');
});

test('loadStoreSnapshot: PGRST205 on public_properties shows temporary unavailable, zero demo listings, and identifies pending 20261124 migration', async () => {
  const prodEnv = evaluateSupabaseEnvironment({
    PROD: true,
    DEV: false,
    VITE_SUPABASE_URL: 'https://rlltjnlztyozbamtaiue.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon-key',
  });

  const client = createFailingPostgrestClient({
    publicPropertiesError: {
      code: 'PGRST205',
      message: "Could not find the table 'public.public_properties' in the schema cache",
    },
  });
  const service = createPropertyService(() => client, {allowLocalDemo: false});

  const snapshot = await loadStoreSnapshot({
    env: prodEnv,
    sessionUserId: null,
    service,
  });

  assert.equal(snapshot.isDemoMode, false);
  assert.equal(snapshot.isUsingDemoFallback, false);
  assert.equal(snapshot.isServiceUnavailable, true);
  assert.deepEqual(snapshot.properties, []);
  assert.deepEqual(snapshot.inquiries, []);
  assert.equal(snapshot.supabaseDiagnostic?.category, 'missing_migration');
  assert.equal(snapshot.supabaseDiagnostic?.errorCode, 'PGRST205');
  assert.equal(snapshot.supabaseDiagnostic?.supabaseHost, 'rlltjnlztyozbamtaiue.supabase.co');
  assert.deepEqual(snapshot.supabaseDiagnostic?.pendingMigrations, [
    'supabase/migrations/20261124_presentations_frontage_price_visibility.sql',
  ]);
  assert.match(snapshot.supabaseDiagnostic?.recommendedAction || '', /Do NOT run 20261119_fresh_install\.sql/i);
});

test('loadStoreSnapshot: verified admin still gets diagnostics when admin properties query fails (missing relationship) without losing admin badge', async () => {
  const prodEnv = evaluateSupabaseEnvironment({
    PROD: true,
    DEV: false,
    VITE_SUPABASE_URL: 'https://rlltjnlztyozbamtaiue.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon-key',
  });

  const client = createFailingPostgrestClient({
    adminRow: {role: 'super_admin', is_active: true},
    adminPropertiesError: {
      code: 'PGRST200',
      message: "Could not find a relationship between 'properties' and 'property_presentations' in the schema cache",
    },
  });
  const service = createPropertyService(() => client, {allowLocalDemo: false});

  const snapshot = await loadStoreSnapshot({
    env: prodEnv,
    sessionUserId: 'uid-super-admin',
    service,
  });

  assert.equal(snapshot.isAdminAuthorized, true);
  assert.equal(snapshot.adminRole, 'super_admin');
  assert.equal(snapshot.isServiceUnavailable, true);
  assert.equal(snapshot.isDemoMode, false);
  assert.deepEqual(snapshot.properties, []);
  assert.equal(snapshot.supabaseDiagnostic?.category, 'missing_migration');
  assert.equal(snapshot.supabaseDiagnostic?.errorCode, 'PGRST200');
  assert.ok(
    snapshot.supabaseDiagnostic?.pendingMigrations.includes(
      'supabase/migrations/20261124_presentations_frontage_price_visibility.sql'
    )
  );
});

test('loadStoreSnapshot: admin_users verification failure NEVER bypasses admin authorization', async () => {
  const prodEnv = evaluateSupabaseEnvironment({
    PROD: true,
    DEV: false,
    VITE_SUPABASE_URL: 'https://rlltjnlztyozbamtaiue.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'anon-key',
  });

  const client = createFailingPostgrestClient({
    adminError: {
      code: '503',
      message: 'Failed to fetch from Supabase auth/admin_users',
    },
  });
  const service = createPropertyService(() => client, {allowLocalDemo: false});

  const snapshot = await loadStoreSnapshot({
    env: prodEnv,
    sessionUserId: 'uid-some-session',
    service,
  });

  assert.equal(snapshot.isAdminAuthorized, false);
  assert.equal(snapshot.adminRole, null);
  assert.equal(snapshot.adminAuthCheckFailed, true);
  assert.equal(snapshot.isServiceUnavailable, true);
  assert.deepEqual(snapshot.properties, []);
});

test('loadStoreSnapshot: explicit local DEV demo mode loads demo properties intentionally', async () => {
  const demoEnv = evaluateSupabaseEnvironment({
    DEV: true,
    PROD: false,
    VITE_ENABLE_DEMO_MODE: 'true',
  });
  const service = createPropertyService(() => null, {allowLocalDemo: true});

  const snapshot = await loadStoreSnapshot({
    env: demoEnv,
    sessionUserId: null,
    service,
  });

  assert.equal(snapshot.isDemoMode, true);
  assert.equal(snapshot.isUsingDemoFallback, false);
  assert.equal(snapshot.isServiceUnavailable, false);
  assert.equal(snapshot.properties.length, DEMO_PROPERTIES.length);
});

test('sanitizeDiagnosticText & classifySupabaseError redact JWTs, Bearer tokens, apikeys, and passwords', () => {
  const sampleJwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIn0.signature123456';
  const raw = `Request failed with Bearer secretBearerToken123 apikey=sb_secret_key_999 password=mySecret123 token=tok_abc ${sampleJwt}`;
  const cleaned = sanitizeDiagnosticText(raw);

  assert.equal(cleaned.includes(sampleJwt), false);
  assert.equal(cleaned.includes('secretBearerToken123'), false);
  assert.equal(cleaned.includes('sb_secret_key_999'), false);
  assert.equal(cleaned.includes('mySecret123'), false);
  assert.equal(cleaned.includes('tok_abc'), false);
  assert.match(cleaned, /\[REDACTED_JWT\]/);
  assert.match(cleaned, /Bearer \[REDACTED\]/);

  const diag = classifySupabaseError(new Error(raw), {
    operation: 'public.public_properties',
    supabaseHost: 'rlltjnlztyozbamtaiue.supabase.co',
  });
  assert.equal(diag.sanitizedMessage.includes(sampleJwt), false);
  assert.equal(diag.sanitizedMessage.includes('sb_secret_key_999'), false);
});

test('Static security audit: zero silent demo fallback and zero unauthenticated admin bypass in context/pages', () => {
  const storeSrc = readSrc('src/context/PropertyStoreContext.tsx');
  const adminSrc = readSrc('src/pages/AdminDashboardPage.tsx');
  const homeSrc = readSrc('src/pages/HomePage.tsx');
  const detailSrc = readSrc('src/pages/PropertyDetailPage.tsx');

  // Context must not import fictional demo properties/inquiries or fall back silently
  assert.equal(storeSrc.includes('DEMO_PROPERTIES'), false);
  assert.equal(storeSrc.includes('DEMO_INQUIRIES'), false);
  assert.equal(storeSrc.includes('setIsUsingDemoFallback(true)'), false);
  assert.equal(storeSrc.includes('!isSupabaseConfigured'), true);
  assert.equal(/useState\(\s*!isSupabaseConfigured\s*\)/.test(storeSrc), false);

  // AdminDashboardPage must gate behind authReady & supabaseConfigured & isAdminAuthorized without bypass
  assert.ok(adminSrc.includes('Administrator Sign-In Unavailable'));
  assert.ok(adminSrc.includes('Unable to Verify Admin Role'));
  assert.ok(adminSrc.includes('Supabase Connection / Schema Diagnostics'));
  assert.ok(adminSrc.includes('isAdminAuthorized'));

  // Public views show unavailable message rather than demo listings or false 404
  assert.ok(homeSrc.includes('Property Listings Temporarily Unavailable'));
  assert.ok(detailSrc.includes('Property Dossier Temporarily Unavailable'));
});
