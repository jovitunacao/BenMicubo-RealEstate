export interface OptimizedImageResult {
  blob: Blob;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  width: number;
  height: number;
  originalBytes: number;
  optimizedBytes: number;
}

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_DIMENSION = 1600;
const QUALITY = 0.82;

export function isSupportedImageFile(file: File): boolean {
  return ALLOWED_IMAGE_TYPES.has(file.type);
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
      el.onerror = () => reject(new Error('Unable to decode image file.'));
      el.src = objectUrl;
    });

    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context is unavailable.');
    }

    ctx.drawImage(img, 0, 0, width, height);

    const targetMime = file.type === 'image/png' ? 'image/webp' : file.type;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error('Image compression failed.'));
        },
        targetMime,
        QUALITY
      );
    });

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Failed to encode optimized image preview.'));
      };
      reader.onerror = () => reject(new Error('Failed to read optimized image blob.'));
      reader.readAsDataURL(blob);
    });

    const ext = targetMime === 'image/webp' ? 'webp' : targetMime === 'image/png' ? 'png' : 'jpg';
    const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-');

    return {
      blob,
      dataUrl,
      fileName: `${baseName}.${ext}`,
      mimeType: targetMime,
      width,
      height,
      originalBytes: file.size,
      optimizedBytes: blob.size,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
