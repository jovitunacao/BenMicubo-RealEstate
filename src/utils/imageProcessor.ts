export interface OptimizedImageResult {
  blob: Blob;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  originalBytes: number;
  optimizedBytes: number;
  contentHash: string;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_IMAGE_DIMENSION = 1920;
export const TARGET_MAX_IMAGE_BYTES = 500 * 1024; // ~500 KB ceiling for ordinary photos
const QUALITY_LADDER = [0.84, 0.78, 0.72, 0.68];

export function isSupportedImageFile(file: Pick<File, 'type'>): boolean {
  return ALLOWED_IMAGE_TYPES.has(file.type);
}

export function computeFileFingerprint(
  file: Pick<File, 'name' | 'size' | 'lastModified' | 'type'>
): string {
  return `${file.name.trim().toLowerCase()}::${file.size}::${file.lastModified || 0}::${file.type}`;
}

export async function computeBlobSha256(blob: Blob): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof blob.arrayBuffer === 'function') {
      const buffer = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch {
    // Fallback if subtle crypto is unavailable
  }
  return `size-${blob.size}-${blob.type}`;
}

export function detectCanvasWebpSupport(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const probe = document.createElement('canvas');
    probe.width = 2;
    probe.height = 2;
    return probe.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

export function selectTargetOutputMime(webpSupported: boolean): 'image/webp' | 'image/jpeg' {
  return webpSupported ? 'image/webp' : 'image/jpeg';
}

export function calculateScaledDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxDimension = MAX_IMAGE_DIMENSION
): {width: number; height: number} {
  const safeW = Math.max(1, naturalWidth);
  const safeH = Math.max(1, naturalHeight);
  const scale = Math.min(1, maxDimension / Math.max(safeW, safeH));
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
  };
}

async function encodeCanvas(
  canvas: HTMLCanvasElement,
  mimeType: 'image/webp' | 'image/jpeg',
  quality: number
): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result);
        else reject(new Error('Image compression failed.'));
      },
      mimeType,
      quality
    );
  });
}

export async function optimizePropertyImage(file: File): Promise<OptimizedImageResult> {
  if (!isSupportedImageFile(file)) {
    throw new Error('Only JPG, PNG, and WebP images are supported.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Unable to decode image file "${file.name}".`));
      el.src = objectUrl;
    });

    const {width, height} = calculateScaledDimensions(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is unavailable.');
    }

    ctx.drawImage(img, 0, 0, width, height);

    const preferredMime = selectTargetOutputMime(detectCanvasWebpSupport());
    let finalBlob = await encodeCanvas(canvas, preferredMime, QUALITY_LADDER[0]);
    let actualMime: 'image/webp' | 'image/jpeg' =
      finalBlob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';

    if (preferredMime === 'image/webp' && actualMime !== 'image/webp') {
      finalBlob = await encodeCanvas(canvas, 'image/jpeg', QUALITY_LADDER[0]);
      actualMime = 'image/jpeg';
    }

    // Step down quality smoothly within high-clarity bounds until <= 500 KB
    for (let i = 1; i < QUALITY_LADDER.length && finalBlob.size > TARGET_MAX_IMAGE_BYTES; i++) {
      const candidate = await encodeCanvas(canvas, actualMime, QUALITY_LADDER[i]);
      if (candidate.size < finalBlob.size) {
        finalBlob = candidate;
      }
    }

    const [dataUrl, contentHash] = await Promise.all([
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') resolve(reader.result);
          else reject(new Error('Failed to encode optimized image preview.'));
        };
        reader.onerror = () => reject(new Error('Failed to read optimized image blob.'));
        reader.readAsDataURL(finalBlob);
      }),
      computeBlobSha256(finalBlob),
    ]);

    const ext = actualMime === 'image/webp' ? 'webp' : 'jpg';
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-') || 'photo';

    return {
      blob: finalBlob,
      dataUrl,
      fileName: `${baseName}.${ext}`,
      mimeType: actualMime,
      width,
      height,
      originalBytes: file.size,
      optimizedBytes: finalBlob.size,
      contentHash,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
