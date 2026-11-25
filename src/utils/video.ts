export type VideoProvider = 'youtube' | 'google_drive';

export interface ParsedPropertyVideo {
  provider: VideoProvider;
  videoId: string;
  canonicalUrl: string;
  embedUrl: string;
  thumbnailUrl: string | null;
  providerLabel: string;
}

const YOUTUBE_ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const GOOGLE_DRIVE_ALLOWED_HOSTS = new Set(['drive.google.com']);

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;
const GOOGLE_DRIVE_ID_REGEX = /^[a-zA-Z0-9_-]{10,128}$/;

export function extractYouTubeVideoId(rawUrl: string): string | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_ALLOWED_HOSTS.has(host)) {
    return null;
  }

  let candidate: string | null = null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    const seg = parsed.pathname.split('/').filter(Boolean)[0];
    candidate = seg || null;
  } else if (parsed.pathname === '/watch') {
    candidate = parsed.searchParams.get('v');
  } else {
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (
      segments.length >= 2 &&
      (segments[0] === 'embed' ||
        segments[0] === 'shorts' ||
        segments[0] === 'live' ||
        segments[0] === 'v')
    ) {
      candidate = segments[1];
    }
  }

  if (candidate && YOUTUBE_ID_REGEX.test(candidate)) {
    return candidate;
  }
  return null;
}

export function extractGoogleDriveFileId(rawUrl: string): string | null {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!GOOGLE_DRIVE_ALLOWED_HOSTS.has(host)) {
    return null;
  }

  const path = parsed.pathname;

  // Reject Drive folders or search links explicitly
  if (path.includes('/drive/folders') || path.includes('/folders/')) {
    return null;
  }

  let candidate: string | null = null;

  // Format: https://drive.google.com/file/d/<FILE_ID>/view?... or /preview or /edit
  const fileMatch = path.match(/^\/file\/d\/([^/]+)(?:\/(view|preview|edit))?\/?$/i);
  if (fileMatch && fileMatch[1]) {
    candidate = fileMatch[1];
  } else if (path === '/open' || path === '/uc') {
    // Format: https://drive.google.com/open?id=<FILE_ID> or /uc?id=<FILE_ID>
    candidate = parsed.searchParams.get('id');
  }

  if (candidate && GOOGLE_DRIVE_ID_REGEX.test(candidate)) {
    return candidate;
  }
  return null;
}

export function getYouTubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&rel=0&modestbranding=1`;
}

export function getYouTubeThumbnailUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function getGoogleDrivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
}

export function getGoogleDriveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

export function parsePropertyVideoUrl(rawUrl: string): ParsedPropertyVideo | null {
  const ytId = extractYouTubeVideoId(rawUrl);
  if (ytId) {
    return {
      provider: 'youtube',
      videoId: ytId,
      canonicalUrl: `https://www.youtube.com/watch?v=${ytId}`,
      embedUrl: getYouTubeEmbedUrl(ytId),
      thumbnailUrl: getYouTubeThumbnailUrl(ytId),
      providerLabel: 'YouTube',
    };
  }

  const driveId = extractGoogleDriveFileId(rawUrl);
  if (driveId) {
    return {
      provider: 'google_drive',
      videoId: driveId,
      canonicalUrl: getGoogleDriveViewUrl(driveId),
      embedUrl: getGoogleDrivePreviewUrl(driveId),
      thumbnailUrl: null,
      providerLabel: 'Google Drive',
    };
  }

  return null;
}

export function isValidPropertyVideoUrl(rawUrl: string): boolean {
  return parsePropertyVideoUrl(rawUrl) !== null;
}

export interface MobileDetectionEnvironment {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  coarsePointer?: boolean;
  userAgentDataMobile?: boolean;
}

export function detectMobilePlaybackEnvironment(
  env?: MobileDetectionEnvironment
): boolean {
  const resolved: MobileDetectionEnvironment = env ?? (() => {
    if (typeof window === 'undefined' && typeof navigator === 'undefined') {
      return {};
    }
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    const navAny = nav as (Navigator & {userAgentData?: {mobile?: boolean}}) | undefined;
    const coarse =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(pointer: coarse)').matches
        : false;
    return {
      userAgent: nav?.userAgent || '',
      platform: nav?.platform || '',
      maxTouchPoints: nav?.maxTouchPoints ?? 0,
      coarsePointer: coarse,
      userAgentDataMobile: navAny?.userAgentData?.mobile,
    };
  })();

  if (resolved.userAgentDataMobile === true) {
    return true;
  }

  const ua = resolved.userAgent || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
    return true;
  }

  const touchPoints = resolved.maxTouchPoints ?? 0;
  if ((/Macintosh/i.test(ua) || resolved.platform === 'MacIntel') && touchPoints > 1) {
    return true;
  }

  if (resolved.coarsePointer && touchPoints > 0) {
    return true;
  }

  return false;
}

/**
 * Keep both Google Drive and YouTube embedded in-page on mobile and desktop
 * (poster-first until user taps Play, never auto-redirecting visitors away).
 */
export function resolveVideoRenderMode(
  _provider: VideoProvider,
  _isMobileDevice: boolean
): 'inline_embed' {
  return 'inline_embed';
}
