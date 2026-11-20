export type GoogleMapsParseStatus =
  | 'parsed'
  | 'empty'
  | 'shortened'
  | 'missing_coordinates'
  | 'invalid_range'
  | 'invalid_url';

export type GoogleMapsCoordSource =
  | 'place_data_pin'
  | 'query_param'
  | 'path_coords'
  | 'viewport_at';

export interface ParsedGoogleMapsResult {
  ok: boolean;
  status: GoogleMapsParseStatus;
  latitude?: number;
  longitude?: number;
  canonicalUrl?: string;
  source?: GoogleMapsCoordSource;
  isViewportOnly?: boolean;
  message: string;
}

export interface CoordinateValidationResult {
  valid: boolean;
  latitude?: number;
  longitude?: number;
  error?: string;
}

const STRICT_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;

export function normalizeCoordinatePrecision(value: number, decimals = 7): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function validateCoordinates(
  latitude: unknown,
  longitude: unknown
): CoordinateValidationResult {
  if (
    latitude === '' ||
    latitude === null ||
    latitude === undefined ||
    longitude === '' ||
    longitude === null ||
    longitude === undefined
  ) {
    return {
      valid: false,
      error: 'Both latitude and longitude are required.',
    };
  }

  const latNum = typeof latitude === 'number' ? latitude : Number(String(latitude).trim());
  const lngNum = typeof longitude === 'number' ? longitude : Number(String(longitude).trim());

  if (
    (typeof latitude === 'string' && !STRICT_NUMBER_PATTERN.test(latitude.trim())) ||
    (typeof longitude === 'string' && !STRICT_NUMBER_PATTERN.test(longitude.trim())) ||
    !Number.isFinite(latNum) ||
    !Number.isFinite(lngNum)
  ) {
    return {
      valid: false,
      error: 'Latitude and longitude must be valid decimal numbers.',
    };
  }

  if (latNum < -90 || latNum > 90) {
    return {
      valid: false,
      error: 'Latitude must be between -90 and 90 degrees.',
    };
  }

  if (lngNum < -180 || lngNum > 180) {
    return {
      valid: false,
      error: 'Longitude must be between -180 and 180 degrees.',
    };
  }

  return {
    valid: true,
    latitude: normalizeCoordinatePrecision(latNum),
    longitude: normalizeCoordinatePrecision(lngNum),
  };
}

export function validateCoordinateStrings(
  latitudeText: string,
  longitudeText: string
): CoordinateValidationResult {
  const latTrimmed = latitudeText.trim();
  const lngTrimmed = longitudeText.trim();
  if (!latTrimmed || !lngTrimmed) {
    return {
      valid: false,
      error: 'Enter both Latitude and Longitude, or paste a Google Maps link and click Sync GPS Pin.',
    };
  }
  return validateCoordinates(latTrimmed, lngTrimmed);
}

export function buildGoogleMapsPinUrl(latitude: number, longitude: number): string {
  const check = validateCoordinates(latitude, longitude);
  if (!check.valid || check.latitude === undefined || check.longitude === undefined) {
    return '';
  }
  return `https://www.google.com/maps/search/?api=1&query=${check.latitude},${check.longitude}`;
}

export function buildGoogleMapsEmbedUrl(
  latitude: number,
  longitude: number,
  zoom = 16
): string {
  const check = validateCoordinates(latitude, longitude);
  if (!check.valid || check.latitude === undefined || check.longitude === undefined) {
    return '';
  }
  const safeZoom = Math.min(20, Math.max(3, Math.round(zoom)));
  return `https://maps.google.com/maps?q=${check.latitude},${check.longitude}&z=${safeZoom}&output=embed`;
}

export function buildOpenStreetMapEmbedUrl(
  latitude: number,
  longitude: number,
  delta = 0.004
): string {
  const check = validateCoordinates(latitude, longitude);
  if (!check.valid || check.latitude === undefined || check.longitude === undefined) {
    return '';
  }
  const minLng = Math.max(-180, normalizeCoordinatePrecision(check.longitude - delta, 6));
  const maxLng = Math.min(180, normalizeCoordinatePrecision(check.longitude + delta, 6));
  const minLat = Math.max(-85, normalizeCoordinatePrecision(check.latitude - delta, 6));
  const maxLat = Math.min(85, normalizeCoordinatePrecision(check.latitude + delta, 6));
  return `https://www.openstreetmap.org/export/embed.html?bbox=${minLng},${minLat},${maxLng},${maxLat}&layer=mapnik&marker=${check.latitude},${check.longitude}`;
}

export function sanitizeGoogleMapsHref(
  rawUrl: string | undefined,
  fallbackLat?: number,
  fallbackLng?: number
): string {
  const trimmed = (rawUrl || '').trim();
  if (trimmed) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.toString();
      }
    } catch {
      // Fall through to coordinate link
    }
  }
  if (fallbackLat !== undefined && fallbackLng !== undefined) {
    return buildGoogleMapsPinUrl(fallbackLat, fallbackLng);
  }
  return '';
}

export function formatLatLngDisplay(latitude: number, longitude: number, decimals = 6): string {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return 'Coordinates unavailable';
  }
  const latHemisphere = latitude >= 0 ? 'N' : 'S';
  const lngHemisphere = longitude >= 0 ? 'E' : 'W';
  return `${Math.abs(latitude).toFixed(decimals)}° ${latHemisphere}, ${Math.abs(longitude).toFixed(decimals)}° ${lngHemisphere}`;
}

function isShortenedGoogleMapsUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host === 'maps.app.goo.gl') return true;
  if (host === 'goo.gl' && (path.startsWith('/maps') || path.length > 1)) return true;
  if (host === 'g.co' && (path.startsWith('/maps') || path.startsWith('/kgs'))) return true;
  return false;
}

function isSupportedGoogleMapsHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (/^maps\.google\.[a-z.]{2,}$/i.test(host)) return true;
  if (
    /^(?:www\.)?google\.[a-z.]{2,}$/i.test(host) &&
    (path === '/maps' || path.startsWith('/maps/'))
  ) {
    return true;
  }
  return false;
}

function extractPairFromText(text: string): {latStr: string; lngStr: string} | null {
  const cleaned = text.trim().replace(/^loc:\s*/i, '');
  const match = cleaned.match(
    /^([+-]?(?:\d+\.?\d*|\.\d+))\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+))(?:\s*(?:\(|$))/
  );
  if (!match) return null;
  return {latStr: match[1], lngStr: match[2]};
}

function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

export function parseGoogleMapsCoordinates(rawInput: string): ParsedGoogleMapsResult {
  const trimmed = (rawInput || '').trim();
  if (!trimmed) {
    return {
      ok: false,
      status: 'empty',
      message: 'Please paste a Google Maps link first.',
    };
  }

  const candidateUrl =
    /^(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps|maps\.google\.|(?:www\.)?google\.[^/]+\/maps)/i.test(
      trimmed
    )
      ? `https://${trimmed}`
      : trimmed;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(candidateUrl);
  } catch {
    return {
      ok: false,
      status: 'invalid_url',
      message: 'Unable to identify GPS coordinates from this Google Maps link.',
    };
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return {
      ok: false,
      status: 'invalid_url',
      message: 'Unable to identify GPS coordinates from this Google Maps link.',
    };
  }

  if (isShortenedGoogleMapsUrl(parsedUrl)) {
    return {
      ok: false,
      status: 'shortened',
      message:
        'This shortened Google Maps link cannot be resolved automatically. Please paste a full Google Maps URL or enter the coordinates manually.',
    };
  }

  if (!isSupportedGoogleMapsHost(parsedUrl)) {
    return {
      ok: false,
      status: 'invalid_url',
      message: 'Unable to identify GPS coordinates from this Google Maps link.',
    };
  }

  const decodedHref = safeDecode(parsedUrl.href);
  const decodedPathAndHash = `${safeDecode(parsedUrl.pathname)}${safeDecode(parsedUrl.hash)}`;

  // 1. Exact destination / place pin parameters (!3d<lat>!4d<lng>)
  // In /place/.../@viewLat,viewLng,zoom/data=...!3dPinLat!4dPinLng, !3d/!4d is the true pinned location.
  const dataPinMatches = Array.from(
    decodedHref.matchAll(/!3d([+-]?(?:\d+\.?\d*|\.\d+))!4d([+-]?(?:\d+\.?\d*|\.\d+))/g)
  );
  if (dataPinMatches.length > 0) {
    const lastPin = dataPinMatches[dataPinMatches.length - 1];
    const check = validateCoordinates(lastPin[1], lastPin[2]);
    if (!check.valid || check.latitude === undefined || check.longitude === undefined) {
      return {
        ok: false,
        status: 'invalid_range',
        message: check.error || 'Coordinates in Google Maps link are out of valid range.',
      };
    }
    return {
      ok: true,
      status: 'parsed',
      latitude: check.latitude,
      longitude: check.longitude,
      canonicalUrl: buildGoogleMapsPinUrl(check.latitude, check.longitude),
      source: 'place_data_pin',
      isViewportOnly: false,
      message: `GPS coordinates synchronized from Google Maps pin (${check.latitude}, ${check.longitude}).`,
    };
  }

  // 2. Explicit coordinate query parameters (destination / pin queries override viewport @lat,lng)
  const coordQueryKeys = ['query', 'q', 'destination', 'daddr', 'll', 'viewpoint', 'center', 'sll'];
  for (const key of coordQueryKeys) {
    const rawParam = parsedUrl.searchParams.get(key);
    if (!rawParam) continue;
    const pair = extractPairFromText(rawParam);
    if (!pair) continue;

    const check = validateCoordinates(pair.latStr, pair.lngStr);
    if (!check.valid || check.latitude === undefined || check.longitude === undefined) {
      return {
        ok: false,
        status: 'invalid_range',
        message: check.error || 'Coordinates in Google Maps link are out of valid range.',
      };
    }
    return {
      ok: true,
      status: 'parsed',
      latitude: check.latitude,
      longitude: check.longitude,
      canonicalUrl: buildGoogleMapsPinUrl(check.latitude, check.longitude),
      source: 'query_param',
      isViewportOnly: false,
      message: `GPS coordinates synchronized successfully (${check.latitude}, ${check.longitude}).`,
    };
  }

  // 3. Path-based explicit coordinates: /maps/place/14.1228,120.9856 or /maps/search/14.1228,120.9856
  // Also supports /maps/dir/<origin>/<destLat,destLng>/@viewportLat,viewportLng
  const placeOrSearchPathMatch = decodedPathAndHash.match(
    /\/maps\/(?:place|search)\/([+-]?(?:\d+\.?\d*|\.\d+))\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+))(?:\/|$|\?|@)/
  );
  if (placeOrSearchPathMatch) {
    const check = validateCoordinates(placeOrSearchPathMatch[1], placeOrSearchPathMatch[2]);
    if (!check.valid || check.latitude === undefined || check.longitude === undefined) {
      return {
        ok: false,
        status: 'invalid_range',
        message: check.error || 'Coordinates in Google Maps link are out of valid range.',
      };
    }
    return {
      ok: true,
      status: 'parsed',
      latitude: check.latitude,
      longitude: check.longitude,
      canonicalUrl: buildGoogleMapsPinUrl(check.latitude, check.longitude),
      source: 'path_coords',
      isViewportOnly: false,
      message: `GPS coordinates synchronized successfully (${check.latitude}, ${check.longitude}).`,
    };
  }

  // Check /maps/dir/.../<lat,lng> destination segment before @viewport
  if (decodedPathAndHash.includes('/maps/dir/')) {
    const beforeViewport = decodedPathAndHash.split('/@')[0];
    const dirSegments = beforeViewport.split('/').filter(Boolean);
    for (let i = dirSegments.length - 1; i >= 0; i--) {
      const pair = extractPairFromText(dirSegments[i]);
      if (pair) {
        const check = validateCoordinates(pair.latStr, pair.lngStr);
        if (!check.valid || check.latitude === undefined || check.longitude === undefined) {
          return {
            ok: false,
            status: 'invalid_range',
            message: check.error || 'Coordinates in Google Maps link are out of valid range.',
          };
        }
        return {
          ok: true,
          status: 'parsed',
          latitude: check.latitude,
          longitude: check.longitude,
          canonicalUrl: buildGoogleMapsPinUrl(check.latitude, check.longitude),
          source: 'path_coords',
          isViewportOnly: false,
          message: `GPS coordinates synchronized from directions destination (${check.latitude}, ${check.longitude}).`,
        };
      }
    }
  }

  // 4. Viewport coordinates fallback: /@lat,lng,zoom (or @lat,lng)
  const atMatch = decodedPathAndHash.match(
    /@([+-]?(?:\d+\.?\d*|\.\d+))\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+))(?:,|\/|\?|$)/
  );
  if (atMatch) {
    const check = validateCoordinates(atMatch[1], atMatch[2]);
    if (!check.valid || check.latitude === undefined || check.longitude === undefined) {
      return {
        ok: false,
        status: 'invalid_range',
        message: check.error || 'Coordinates in Google Maps link are out of valid range.',
      };
    }
    return {
      ok: true,
      status: 'parsed',
      latitude: check.latitude,
      longitude: check.longitude,
      canonicalUrl: buildGoogleMapsPinUrl(check.latitude, check.longitude),
      source: 'viewport_at',
      isViewportOnly: true,
      message: `GPS coordinates synchronized from map viewport (${check.latitude}, ${check.longitude}). Verify the pin marker below.`,
    };
  }

  return {
    ok: false,
    status: 'missing_coordinates',
    message: 'Unable to identify GPS coordinates from this Google Maps link.',
  };
}

export const LEGACY_PLACEHOLDER_COORDINATES = [
  {
    label: 'Legacy LOT-001 Tagaytay Sample Pin',
    latitude: 14.1228,
    longitude: 120.9856,
  },
] as const;

export function haversineDistanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

export function isLegacyPlaceholderCoordinate(
  latitude: number,
  longitude: number
): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  return LEGACY_PLACEHOLDER_COORDINATES.some(
    (sample) => haversineDistanceMeters(latitude, longitude, sample.latitude, sample.longitude) <= 150
  );
}

export interface CoordinateLocationConsistencyResult {
  consistent: boolean;
  isLegacyPlaceholder: boolean;
  warning?: string;
}

interface RegionalBoundingBox {
  name: string;
  keywords: RegExp;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const PHILIPPINE_REGIONAL_BOUNDS: RegionalBoundingBox[] = [
  {
    name: 'Zamboanga Peninsula / Mindanao',
    keywords: /\b(zamboanga|tetuan|davao|cagayan de oro|general santos|bukidnon|surigao|siargao|butuan|iligan|cotabato|pagadian|dipolog|mindanao|caraga|soccsksargen)\b/i,
    minLat: 4.3,
    maxLat: 10.6,
    minLng: 119.0,
    maxLng: 127.0,
  },
  {
    name: 'Visayas',
    keywords: /\b(cebu|bohol|iloilo|bacolod|negros|tacloban|leyte|samar|boracay|aklan|dumaguete|visayas)\b/i,
    minLat: 8.8,
    maxLat: 12.9,
    minLng: 121.6,
    maxLng: 126.2,
  },
  {
    name: 'Palawan / MIMAROPA',
    keywords: /\b(palawan|el nido|coron|puerto princesa|san vicente|mimaropa|mindoro)\b/i,
    minLat: 7.5,
    maxLat: 13.8,
    minLng: 116.5,
    maxLng: 122.3,
  },
  {
    name: 'Metro Manila / CALABARZON / Luzon',
    keywords: /\b(tagaytay|cavite|alfonso|batangas|laguna|calabarzon|metro manila|makati|bgc|taguig|quezon city|bulacan|pampanga|baguio|benguet|ilocos|pangasinan|tarlac|zambales|bataan)\b/i,
    minLat: 12.5,
    maxLat: 18.8,
    minLng: 119.5,
    maxLng: 124.5,
  },
];

export function assessCoordinateLocationConsistency(
  latitude: number | undefined,
  longitude: number | undefined,
  location: {city?: string; province?: string; region?: string; barangay?: string; title?: string}
): CoordinateLocationConsistencyResult {
  if (
    latitude === undefined ||
    longitude === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  ) {
    return {
      consistent: false,
      isLegacyPlaceholder: false,
      warning: 'GPS coordinates are missing or invalid. Verify the exact site pin in Google Maps.',
    };
  }

  const locationText = [
    location.barangay,
    location.city,
    location.province,
    location.region,
    location.title,
  ]
    .filter(Boolean)
    .join(' ');

  const isLegacySample = isLegacyPlaceholderCoordinate(latitude, longitude);
  const isTagaytayOrCavite = /\b(tagaytay|cavite|sungay|mendez|alfonso)\b/i.test(locationText);

  if (isLegacySample && locationText.trim() && !isTagaytayOrCavite) {
    return {
      consistent: false,
      isLegacyPlaceholder: true,
      warning: `Coordinates (${latitude.toFixed(6)}, ${longitude.toFixed(6)}) match legacy Tagaytay sample/placeholder coordinates and do not match "${[location.city, location.province].filter(Boolean).join(', ')}". Paste the verified site Google Maps link or confirm exact coordinates.`,
    };
  }

  if (locationText.trim()) {
    for (const regionBound of PHILIPPINE_REGIONAL_BOUNDS) {
      if (regionBound.keywords.test(locationText)) {
        const inside =
          latitude >= regionBound.minLat &&
          latitude <= regionBound.maxLat &&
          longitude >= regionBound.minLng &&
          longitude <= regionBound.maxLng;
        if (!inside) {
          return {
            consistent: false,
            isLegacyPlaceholder: isLegacySample,
            warning: `Coordinates (${latitude.toFixed(6)}, ${longitude.toFixed(6)}) fall outside the expected ${regionBound.name} region for "${[location.city, location.province].filter(Boolean).join(', ')}". Verify the exact property pin before saving.`,
          };
        }
        break;
      }
    }
  }

  return {
    consistent: true,
    isLegacyPlaceholder: isLegacySample && !isTagaytayOrCavite,
  };
}

export interface GpsSyncConfirmationDecision {
  requireConfirmation: boolean;
  reason: 'none' | 'viewport_only' | 'differs_from_verified';
  distanceMeters?: number;
  message?: string;
}

export function shouldRequireSyncConfirmation(
  existingLatitude: string | number | undefined,
  existingLongitude: string | number | undefined,
  parsed: ParsedGoogleMapsResult
): GpsSyncConfirmationDecision {
  if (!parsed.ok || parsed.latitude === undefined || parsed.longitude === undefined) {
    return {requireConfirmation: false, reason: 'none'};
  }

  const existingCheck = validateCoordinates(existingLatitude, existingLongitude);
  const hasExistingValid =
    existingCheck.valid &&
    existingCheck.latitude !== undefined &&
    existingCheck.longitude !== undefined;

  const distanceMeters = hasExistingValid
    ? haversineDistanceMeters(
        existingCheck.latitude!,
        existingCheck.longitude!,
        parsed.latitude,
        parsed.longitude
      )
    : undefined;

  if (parsed.isViewportOnly) {
    return {
      requireConfirmation: true,
      reason: 'viewport_only',
      distanceMeters,
      message: hasExistingValid
        ? 'This Google Maps URL only contains map viewport center coordinates (@lat,lng), not an exact dropped pin. Confirm before replacing existing saved coordinates.'
        : 'This Google Maps URL only contains map viewport center coordinates (@lat,lng), not an exact dropped pin. Confirm that the viewport pin marks the actual property.',
    };
  }

  if (hasExistingValid && distanceMeters !== undefined && distanceMeters > 25) {
    const distanceLabel =
      distanceMeters >= 1000
        ? `${(distanceMeters / 1000).toFixed(1)} km`
        : `${Math.round(distanceMeters)} m`;
    return {
      requireConfirmation: true,
      reason: 'differs_from_verified',
      distanceMeters,
      message: `Extracted coordinates differ from the existing saved coordinates by ${distanceLabel}. Confirm before overwriting existing coordinates.`,
    };
  }

  return {
    requireConfirmation: false,
    reason: 'none',
    distanceMeters,
  };
}
