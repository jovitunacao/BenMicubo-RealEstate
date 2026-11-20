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
