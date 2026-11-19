export interface CanonicalUrlValidation {
  valid: boolean;
  normalizedUrl: string;
  reason?: string;
}

const DISALLOWED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\.\d+\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /\.local$/i,
  /\.run\.app$/i,
  /^ais-dev-/i,
  /^ais-pre-/i,
  /aistudio\.google\.com$/i,
  /\.webcontainer\.io$/i,
  /\.stackblitz\.io$/i,
  /\.codesandbox\.io$/i,
  /\.ngrok\.io$/i,
  /\.ngrok-free\.app$/i,
  /\.trycloudflare\.com$/i,
  /\.loca\.lt$/i,
];

export function validateCanonicalSiteUrl(rawUrl: string): CanonicalUrlValidation {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      valid: false,
      normalizedUrl: '',
      reason:
        'Public website URL (VITE_PUBLIC_SITE_URL) is not configured yet. Configure a valid HTTPS production domain before generating QR codes for distribution.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      normalizedUrl: '',
      reason:
        'Enter a valid full URL starting with https:// (e.g., https://benmicuborealestate.com).',
    };
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      normalizedUrl: '',
      reason: 'Public website URL must use https:// for distributable QR codes.',
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (DISALLOWED_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    return {
      valid: false,
      normalizedUrl: '',
      reason: `Temporary, localhost, or preview host (${host}) cannot be used in distributable QR codes.`,
    };
  }

  const normalizedUrl = `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`;
  return {
    valid: true,
    normalizedUrl,
  };
}

export function buildCanonicalPropertyUrl(
  canonicalSiteUrl: string,
  lotId: string
): string {
  const validation = validateCanonicalSiteUrl(canonicalSiteUrl);
  const path = `/property/${encodeURIComponent(lotId.trim().toUpperCase())}`;
  if (!validation.valid) {
    return path;
  }
  return `${validation.normalizedUrl}${path}`;
}

export function buildDistributableQrUrl(
  canonicalSiteUrl: string,
  lotId: string
): string | null {
  const validation = validateCanonicalSiteUrl(canonicalSiteUrl);
  if (!validation.valid) {
    return null;
  }
  const path = `/property/${encodeURIComponent(lotId.trim().toUpperCase())}`;
  return `${validation.normalizedUrl}${path}`;
}

export function getEnvCanonicalSiteUrl(): string {
  return (import.meta.env?.VITE_PUBLIC_SITE_URL || '').trim();
}

export function getEffectiveCanonicalSiteUrl(settingsCanonicalUrl = ''): string {
  const settingsTrimmed = settingsCanonicalUrl.trim();
  if (validateCanonicalSiteUrl(settingsTrimmed).valid) {
    return validateCanonicalSiteUrl(settingsTrimmed).normalizedUrl;
  }
  const envUrl = getEnvCanonicalSiteUrl();
  if (validateCanonicalSiteUrl(envUrl).valid) {
    return validateCanonicalSiteUrl(envUrl).normalizedUrl;
  }
  return settingsTrimmed || envUrl;
}

