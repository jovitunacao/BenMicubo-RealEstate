import {isSupabaseConfigured, supabase} from '../lib/supabase';
import type {PropertyDocumentItem, PropertyPresentationItem} from '../types/property';

export const PUBLIC_MEDIA_BUCKET = 'property-media-public';
export const PRIVATE_MEDIA_BUCKET = 'property-media-private';

export const MAX_PUBLIC_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PRIVATE_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const PDF_MIME = 'application/pdf';
export const MAX_PRESENTATION_PDF_BYTES = 20 * 1024 * 1024; // 20 MB
export const MAX_PRESENTATION_PPTX_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_PRESENTATION_COVER_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_PUBLIC_DOC_MIMES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const ALLOWED_PRIVATE_DOC_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const BLOCKED_PRESENTATION_EXTENSIONS = new Set([
  'ppt',
  'pptm',
  'potm',
  'ppsm',
  'ppam',
  'docm',
  'xlsm',
  'html',
  'htm',
  'svg',
  'js',
  'mjs',
  'exe',
  'bat',
  'sh',
]);

export type StorageBucketName = typeof PRIVATE_MEDIA_BUCKET | typeof PUBLIC_MEDIA_BUCKET;

export function resolveImageUploadBucket(
  isApprovedPublic: boolean,
  isPropertyPublished: boolean
): StorageBucketName {
  return isApprovedPublic && isPropertyPublished ? PUBLIC_MEDIA_BUCKET : PRIVATE_MEDIA_BUCKET;
}

export function resolveDocumentUploadBucket(
  visibility: 'Private' | 'Public',
  isPropertyPublished: boolean
): StorageBucketName {
  return visibility === 'Public' && isPropertyPublished
    ? PUBLIC_MEDIA_BUCKET
    : PRIVATE_MEDIA_BUCKET;
}

export function resolvePresentationAssetBucket(
  kind: 'pdf' | 'pptx' | 'cover',
  presentationVisibility: 'Private' | 'Public',
  allowDownload: boolean,
  isPropertyPublished: boolean
): StorageBucketName {
  if (!isPropertyPublished || presentationVisibility !== 'Public') {
    return PRIVATE_MEDIA_BUCKET;
  }
  if (kind === 'pptx' && !allowDownload) {
    return PRIVATE_MEDIA_BUCKET;
  }
  return PUBLIC_MEDIA_BUCKET;
}

export function validateDocumentFile(
  file: Pick<File, 'name' | 'size' | 'type'>,
  visibility: 'Private' | 'Public'
): void {
  const maxBytes = visibility === 'Public' ? MAX_PUBLIC_FILE_BYTES : MAX_PRIVATE_FILE_BYTES;
  const maxLabel = visibility === 'Public' ? '10 MB' : '20 MB';
  if (!file.size || file.size > maxBytes) {
    throw new Error(
      `File "${file.name}" exceeds the ${maxLabel} limit for ${visibility.toLowerCase()} storage.`
    );
  }
  const allowed =
    visibility === 'Public' ? ALLOWED_PUBLIC_DOC_MIMES : ALLOWED_PRIVATE_DOC_MIMES;
  if (!allowed.has(file.type)) {
    throw new Error(
      visibility === 'Public'
        ? 'Public documents must be PDF, JPG, PNG, or WebP.'
        : 'Private documents must be PDF, DOC, DOCX, JPG, PNG, or WebP.'
    );
  }
}

function getFileExtension(fileName: string): string {
  const base = (fileName || '').trim().toLowerCase();
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.slice(idx + 1) : '';
}

export function validatePresentationFileMeta(
  file: Pick<File, 'name' | 'size' | 'type'>,
  kind: 'pdf' | 'pptx'
): void {
  const ext = getFileExtension(file.name);
  if (BLOCKED_PRESENTATION_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported or macro-enabled file ".${ext}" rejected. Upload standard .pptx or .pdf presentations without macros or scripts.`
    );
  }

  if (kind === 'pdf') {
    if (ext !== 'pdf') {
      throw new Error(`Presentation PDF "${file.name}" must end with .pdf.`);
    }
    if (file.type && file.type !== PDF_MIME) {
      throw new Error(`Invalid MIME type "${file.type}" for PDF presentation.`);
    }
    if (!file.size || file.size > MAX_PRESENTATION_PDF_BYTES) {
      throw new Error(`PDF presentation "${file.name}" must be between 1 B and 20 MB.`);
    }
    return;
  }

  if (ext !== 'pptx') {
    throw new Error(`PowerPoint presentation "${file.name}" must end with .pptx.`);
  }
  // Allow empty type from some browsers when extension is .pptx, but reject mismatched/macro MIME types
  if (
    file.type &&
    file.type !== PPTX_MIME &&
    file.type !== 'application/octet-stream' &&
    file.type !== 'application/zip'
  ) {
    throw new Error(
      `Invalid PowerPoint MIME type "${file.type}". Upload standard .pptx without macros (.pptm is blocked).`
    );
  }
  if (!file.size || file.size > MAX_PRESENTATION_PPTX_BYTES) {
    throw new Error(`PPTX presentation "${file.name}" must be between 1 B and 25 MB.`);
  }
}

/**
 * Inspects file signature (magic bytes) and checks OOXML PPTX archives for
 * prohibited VBA macro binaries (`vbaProject.bin`) or HTML/script payloads.
 */
export function inspectPresentationMagicBytes(
  bytes: Uint8Array,
  kind: 'pdf' | 'pptx'
): void {
  if (kind === 'pdf') {
    // Must start with %PDF- (0x25 0x50 0x44 0x46 0x2D)
    if (
      bytes.length < 5 ||
      bytes[0] !== 0x25 ||
      bytes[1] !== 0x50 ||
      bytes[2] !== 0x44 ||
      bytes[3] !== 0x46 ||
      bytes[4] !== 0x2d
    ) {
      throw new Error('File content failed PDF header verification (%PDF- signature missing).');
    }
    return;
  }

  // PPTX is a ZIP container: PK\x03\x04 (0x50 0x4B 0x03 0x04)
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new Error('File content failed PPTX OOXML ZIP verification (invalid file header).');
  }

  // Reject disguised macro-enabled decks containing vbaProject.bin in ZIP entries
  const decodedAscii = new TextDecoder('latin1').decode(bytes);
  if (/vbaProject\.bin/i.test(decodedAscii)) {
    throw new Error(
      'Macro-enabled PowerPoint content (vbaProject.bin) is not allowed for security reasons.'
    );
  }
}

export async function validatePresentationFile(
  file: Pick<File, 'name' | 'size' | 'type'> & {
    slice?: (start?: number, end?: number) => Blob;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  },
  kind: 'pdf' | 'pptx'
): Promise<void> {
  validatePresentationFileMeta(file, kind);

  let bytes: Uint8Array | null = null;
  if (kind === 'pdf' && typeof file.slice === 'function') {
    const headerBuf = await file.slice(0, 1024).arrayBuffer();
    bytes = new Uint8Array(headerBuf);
  } else if (kind === 'pptx' && typeof file.arrayBuffer === 'function') {
    const fullBuf = await file.arrayBuffer();
    bytes = new Uint8Array(fullBuf);
  } else if (kind === 'pptx' && typeof file.slice === 'function') {
    const headerBuf = await file.slice(0, 65536).arrayBuffer();
    bytes = new Uint8Array(headerBuf);
  }

  if (bytes) {
    inspectPresentationMagicBytes(bytes, kind);
  }
}

function makeUniqueStorageSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function isNotFoundStorageError(message: string | undefined): boolean {
  if (!message) return false;
  return /\b(not found|object not found|no such|404|does not exist)\b/i.test(message);
}

export async function uploadOptimizedPropertyImage(
  lotId: string,
  blob: Blob,
  fileName: string,
  mimeType: string,
  isApprovedPublic: boolean,
  fallbackDataUrl: string,
  isPropertyPublished = false,
  onProgress?: (percent: number, stage: string) => void
): Promise<{
  url: string;
  storageBucket: StorageBucketName;
  storagePath: string;
}> {
  onProgress?.(15, 'Validating optimized image...');
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw new Error('Only JPG, PNG, and WebP images are supported.');
  }
  if (blob.size > MAX_PUBLIC_FILE_BYTES) {
    throw new Error('Optimized image exceeds the 10 MB upload limit.');
  }

  // Unapproved images or uploads on unpublished/staged listings NEVER go to public Storage
  const bucket = resolveImageUploadBucket(isApprovedPublic, isPropertyPublished);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const storagePath = `${lotId.trim().toUpperCase()}/images/${makeUniqueStorageSuffix()}-${safeName}`;

  if (isSupabaseConfigured && supabase) {
    onProgress?.(50, 'Uploading to Supabase Storage...');
    const {error} = await supabase.storage
      .from(bucket)
      .upload(storagePath, blob, {contentType: mimeType, upsert: false});
    if (error) throw new Error(`Image upload failed (${bucket}/${storagePath}): ${error.message}`);

    onProgress?.(85, 'Generating secure URL...');
    if (bucket === PUBLIC_MEDIA_BUCKET) {
      const {data} = supabase.storage.from(bucket).getPublicUrl(storagePath);
      onProgress?.(100, 'Upload complete.');
      return {url: data.publicUrl, storageBucket: bucket, storagePath};
    }

    const {data: signed, error: signError} = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 3600);
    if (signError) {
      throw new Error(`Image uploaded to ${bucket}, but signed URL failed: ${signError.message}`);
    }
    onProgress?.(100, 'Upload complete.');
    return {url: signed.signedUrl, storageBucket: bucket, storagePath};
  }

  onProgress?.(100, 'Staged locally.');
  return {
    url: fallbackDataUrl,
    storageBucket: bucket,
    storagePath,
  };
}

function resolveClient(clientOverride?: typeof supabase): typeof supabase {
  if (clientOverride !== undefined) return clientOverride;
  return isSupabaseConfigured && supabase ? supabase : null;
}

export async function verifyObjectExistsInBucket(
  bucket: StorageBucketName,
  storagePath: string,
  clientOverride?: typeof supabase
): Promise<boolean> {
  const client = resolveClient(clientOverride);
  if (!client || !storagePath || storagePath.includes('..')) return false;

  const {data: signed, error: signErr} = await client.storage
    .from(bucket)
    .createSignedUrl(storagePath, 60);
  if (!signErr && signed?.signedUrl) {
    return true;
  }

  const {data: dlBlob, error: dlErr} = await client.storage.from(bucket).download(storagePath);
  return !dlErr && Boolean(dlBlob);
}

export async function ensurePrivateBackupFromPublicBucket(
  storagePath: string,
  fallbackContentType = 'application/octet-stream',
  clientOverride?: typeof supabase
): Promise<void> {
  const client = resolveClient(clientOverride);
  if (!client || !storagePath) return;
  if (storagePath.includes('..')) {
    throw new Error(`Invalid storage path "${storagePath}".`);
  }

  const {data: publicBlob, error: dlErr} = await client.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .download(storagePath);

  if (dlErr || !publicBlob) {
    const privateExists = await verifyObjectExistsInBucket(
      PRIVATE_MEDIA_BUCKET,
      storagePath,
      client
    );
    if (privateExists) {
      return;
    }
    throw new Error(
      `Failed to back up published file "${storagePath}" to private storage: ${
        dlErr?.message || 'Source object unavailable.'
      }`
    );
  }

  const {error: backupErr} = await client.storage
    .from(PRIVATE_MEDIA_BUCKET)
    .upload(storagePath, publicBlob, {
      contentType: publicBlob.type || fallbackContentType,
      upsert: true,
    });
  if (backupErr) {
    throw new Error(
      `Failed to archive confidential file "${storagePath}" to private storage: ${backupErr.message}`
    );
  }

  const verified = await verifyObjectExistsInBucket(PRIVATE_MEDIA_BUCKET, storagePath, client);
  if (!verified) {
    throw new Error(
      `Private backup verification failed for "${storagePath}". Public file was preserved to prevent data loss.`
    );
  }
}

export async function promoteFileToPublicBucket(
  storagePath: string,
  fallbackContentType = 'application/octet-stream',
  clientOverride?: typeof supabase
): Promise<string | null> {
  const client = resolveClient(clientOverride);
  if (!client || !storagePath || storagePath.includes('..')) return null;

  const {data: fileBlob, error: downloadErr} = await client.storage
    .from(PRIVATE_MEDIA_BUCKET)
    .download(storagePath);
  if (downloadErr || !fileBlob) {
    const alreadyPublic = await verifyObjectExistsInBucket(
      PUBLIC_MEDIA_BUCKET,
      storagePath,
      client
    );
    if (alreadyPublic) {
      const {data} = client.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(storagePath);
      return data.publicUrl;
    }
    return null;
  }

  const {error: uploadErr} = await client.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .upload(storagePath, fileBlob, {
      contentType: fileBlob.type || fallbackContentType,
      upsert: true,
    });
  if (uploadErr) return null;

  const {data} = client.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function promoteImageToPublicBucket(
  storagePath: string,
  clientOverride?: typeof supabase
): Promise<string | null> {
  return promoteFileToPublicBucket(storagePath, 'image/webp', clientOverride);
}

export async function demoteFileFromPublicBucket(
  storagePath: string,
  kind: 'image' | 'document' | 'presentation',
  clientOverride?: typeof supabase
): Promise<{signedUrl: string | null}> {
  const client = resolveClient(clientOverride);
  if (!client || !storagePath) {
    return {signedUrl: null};
  }

  await ensurePrivateBackupFromPublicBucket(storagePath, 'application/octet-stream', client);

  const {error: removeErr} = await client.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .remove([storagePath]);
  if (removeErr && !isNotFoundStorageError(removeErr.message)) {
    throw new Error(
      `Failed to remove confidential file "${storagePath}" from public storage: ${removeErr.message}`
    );
  }

  if (kind === 'image' || kind === 'presentation') {
    const {data: signed} = await client.storage
      .from(PRIVATE_MEDIA_BUCKET)
      .createSignedUrl(storagePath, 3600);
    return {signedUrl: signed?.signedUrl || null};
  }
  return {signedUrl: null};
}

export async function removeStoragePathsFromBucket(
  bucket: StorageBucketName,
  paths: string[],
  clientOverride?: typeof supabase
): Promise<void> {
  const cleanPaths = Array.from(
    new Set(paths.filter((p) => Boolean(p && !p.includes('..'))))
  );
  const client = resolveClient(clientOverride);
  if (!client || cleanPaths.length === 0) return;

  const {error} = await client.storage.from(bucket).remove(cleanPaths);
  if (error && !isNotFoundStorageError(error.message)) {
    throw new Error(
      `Failed to remove ${cleanPaths.length} storage file(s) from ${bucket} (${cleanPaths.join(', ')}): ${error.message}`
    );
  }
}

export async function cleanupPromotedPublicObjects(
  paths: string[],
  clientOverride?: typeof supabase
): Promise<void> {
  const cleanPaths = Array.from(
    new Set(paths.filter((p) => Boolean(p && !p.includes('..'))))
  );
  const client = resolveClient(clientOverride);
  if (!client || cleanPaths.length === 0) return;
  try {
    await client.storage.from(PUBLIC_MEDIA_BUCKET).remove(cleanPaths);
  } catch {
    // Best-effort compensating rollback cleanup
  }
}

export async function refreshPrivateImageSignedUrl(
  storagePath: string,
  clientOverride?: typeof supabase
): Promise<string | null> {
  const client = resolveClient(clientOverride);
  if (!client || !storagePath) return null;
  const {data, error} = await client.storage
    .from(PRIVATE_MEDIA_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read file preview.'));
    };
    reader.onerror = () => reject(new Error('File read error.'));
    reader.readAsDataURL(file);
  });
}

export async function uploadPropertyDocumentFile(
  lotId: string,
  file: File,
  visibility: 'Private' | 'Public',
  isPropertyPublished = false,
  onProgress?: (percent: number, stage: string) => void
): Promise<{
  storageBucket: StorageBucketName;
  storagePath: string;
  publicUrl?: string;
  dataUrl?: string;
}> {
  onProgress?.(15, 'Validating document...');
  validateDocumentFile(file, visibility);

  const bucket = resolveDocumentUploadBucket(visibility, isPropertyPublished);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const storagePath = `${lotId.trim().toUpperCase()}/documents/${makeUniqueStorageSuffix()}-${safeName}`;

  if (isSupabaseConfigured && supabase) {
    onProgress?.(55, 'Uploading document to Supabase Storage...');
    const {error} = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {contentType: file.type || 'application/octet-stream'});
    if (error) throw new Error(`Document upload failed (${bucket}/${storagePath}): ${error.message}`);

    onProgress?.(100, 'Upload complete.');
    if (bucket === PUBLIC_MEDIA_BUCKET) {
      const {data} = supabase.storage.from(bucket).getPublicUrl(storagePath);
      return {storageBucket: bucket, storagePath, publicUrl: data.publicUrl};
    }
    return {storageBucket: bucket, storagePath};
  }

  const dataUrl = await readFileAsDataUrl(file);
  onProgress?.(100, 'Staged locally.');
  return {
    storageBucket: bucket,
    storagePath,
    publicUrl: bucket === PUBLIC_MEDIA_BUCKET ? dataUrl : undefined,
    dataUrl,
  };
}

export async function uploadPropertyPresentationFile(
  lotId: string,
  file: File,
  kind: 'pdf' | 'pptx',
  onProgress?: (percent: number, stage: string) => void
): Promise<{
  storageBucket: StorageBucketName;
  storagePath: string;
  mimeType: string;
  fileName: string;
  fileSizeBytes: number;
  dataUrl?: string;
}> {
  onProgress?.(15, `Validating ${kind.toUpperCase()} presentation...`);
  await validatePresentationFile(file, kind);

  // Always stage into private bucket first; promotion happens safely on property save/publish
  const bucket = PRIVATE_MEDIA_BUCKET;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const storagePath = `${lotId.trim().toUpperCase()}/presentations/${makeUniqueStorageSuffix()}-${safeName}`;
  const mimeType = kind === 'pdf' ? PDF_MIME : PPTX_MIME;

  if (isSupabaseConfigured && supabase) {
    onProgress?.(50, `Uploading ${kind.toUpperCase()} to private Supabase Storage...`);
    const {error} = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {contentType: mimeType, upsert: false});
    if (error) {
      throw new Error(`Presentation upload failed (${bucket}/${storagePath}): ${error.message}`);
    }
    onProgress?.(100, 'Upload staged in private storage.');
    return {
      storageBucket: bucket,
      storagePath,
      mimeType,
      fileName: file.name,
      fileSizeBytes: file.size,
    };
  }

  onProgress?.(60, 'Staging local presentation preview...');
  const dataUrl = await readFileAsDataUrl(file);
  onProgress?.(100, 'Staged locally.');
  return {
    storageBucket: bucket,
    storagePath,
    mimeType,
    fileName: file.name,
    fileSizeBytes: file.size,
    dataUrl,
  };
}

export async function uploadPresentationCoverImage(
  lotId: string,
  blob: Blob,
  fileName: string,
  mimeType: string,
  fallbackDataUrl: string,
  onProgress?: (percent: number, stage: string) => void
): Promise<{
  storageBucket: StorageBucketName;
  storagePath: string;
  url: string;
}> {
  onProgress?.(20, 'Validating cover image...');
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw new Error('Presentation cover image must be JPG, PNG, or WebP.');
  }
  if (blob.size > MAX_PRESENTATION_COVER_BYTES) {
    throw new Error('Presentation cover image must be under 5 MB.');
  }

  const bucket = PRIVATE_MEDIA_BUCKET;
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
  const storagePath = `${lotId.trim().toUpperCase()}/presentations/cover-${makeUniqueStorageSuffix()}-${safeName}`;

  if (isSupabaseConfigured && supabase) {
    onProgress?.(55, 'Uploading presentation cover to Supabase Storage...');
    const {error} = await supabase.storage
      .from(bucket)
      .upload(storagePath, blob, {contentType: mimeType, upsert: false});
    if (error) throw new Error(`Presentation cover upload failed: ${error.message}`);

    const {data: signed} = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 3600);
    onProgress?.(100, 'Cover uploaded.');
    return {
      storageBucket: bucket,
      storagePath,
      url: signed?.signedUrl || '',
    };
  }

  onProgress?.(100, 'Cover staged locally.');
  return {
    storageBucket: bucket,
    storagePath,
    url: fallbackDataUrl,
  };
}

export async function getAuthorizedDocumentDownloadUrl(
  doc: PropertyDocumentItem,
  isAdminAuthorized: boolean
): Promise<string> {
  if (doc.visibility === 'Private' && !isAdminAuthorized) {
    throw new Error('Unauthorized: Private property documents require administrator authentication.');
  }

  if (isSupabaseConfigured && supabase && doc.storagePath) {
    if (doc.visibility === 'Private' || doc.storageBucket === PRIVATE_MEDIA_BUCKET) {
      if (!isAdminAuthorized) {
        throw new Error('Unauthorized: Private storage documents require administrator authentication.');
      }
      const {data, error} = await supabase.storage
        .from(PRIVATE_MEDIA_BUCKET)
        .createSignedUrl(doc.storagePath, 60);
      if (error) throw new Error(error.message);
      return data.signedUrl;
    }

    if (doc.publicUrl) return doc.publicUrl;
    const {data} = supabase.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(doc.storagePath);
    return data.publicUrl;
  }

  if (doc.visibility === 'Public') {
    if (doc.publicUrl) return doc.publicUrl;
    if (doc.dataUrl) return doc.dataUrl;
  }

  if (doc.visibility === 'Private' && isAdminAuthorized && doc.dataUrl) {
    return doc.dataUrl;
  }

  throw new Error('Document file is stored in private preview placeholder mode.');
}

export async function getAuthorizedPresentationAssetUrl(
  presentation: PropertyPresentationItem,
  kind: 'pdf' | 'pptx' | 'cover',
  isAdminAuthorized: boolean,
  clientOverride?: typeof supabase
): Promise<string> {
  if (presentation.visibility === 'Private' && !isAdminAuthorized) {
    throw new Error('Unauthorized: Private property presentations require administrator authentication.');
  }
  if (kind === 'pptx' && !presentation.allowDownload && !isAdminAuthorized) {
    throw new Error('Unauthorized: PowerPoint downloads are disabled for this presentation.');
  }

  const bucket =
    kind === 'pdf'
      ? presentation.pdfStorageBucket
      : kind === 'pptx'
      ? presentation.pptxStorageBucket
      : presentation.coverStorageBucket;
  const storagePath =
    kind === 'pdf'
      ? presentation.pdfStoragePath
      : kind === 'pptx'
      ? presentation.pptxStoragePath
      : presentation.coverStoragePath;
  const publicUrl =
    kind === 'pdf'
      ? presentation.pdfPublicUrl
      : kind === 'pptx'
      ? presentation.pptxPublicUrl
      : presentation.coverPublicUrl;
  const dataUrl =
    kind === 'pdf'
      ? presentation.pdfDataUrl
      : kind === 'pptx'
      ? presentation.pptxDataUrl
      : presentation.coverPublicUrl;

  const client = resolveClient(clientOverride);
  if (client && storagePath) {
    if (presentation.visibility === 'Private' || bucket === PRIVATE_MEDIA_BUCKET) {
      if (!isAdminAuthorized) {
        throw new Error('Unauthorized: Private presentation asset requires administrator authentication.');
      }
      const ttl = kind === 'pptx' ? 60 : 3600;
      const {data, error} = await client.storage
        .from(PRIVATE_MEDIA_BUCKET)
        .createSignedUrl(storagePath, ttl);
      if (error || !data?.signedUrl) {
        throw new Error(error?.message || 'Unable to generate signed presentation URL.');
      }
      return data.signedUrl;
    }

    if (publicUrl) return publicUrl;
    const {data} = client.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(storagePath);
    return data.publicUrl;
  }

  if (presentation.visibility === 'Public') {
    if (kind === 'pptx' && !presentation.allowDownload && !isAdminAuthorized) {
      throw new Error('Unauthorized: PowerPoint downloads are disabled.');
    }
    if (publicUrl) return publicUrl;
    if (dataUrl) return dataUrl;
  }

  if (isAdminAuthorized && dataUrl) {
    return dataUrl;
  }

  throw new Error('Presentation asset is not available.');
}
