import {isSupabaseConfigured, supabase} from '../lib/supabase';
import type {PropertyDocumentItem} from '../types/property';

export const PUBLIC_MEDIA_BUCKET = 'property-media-public';
export const PRIVATE_MEDIA_BUCKET = 'property-media-private';

export const MAX_PUBLIC_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PRIVATE_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

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
    // Only tolerate missing public object if a verified private backup already exists
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

  // Explicitly verify backup object exists in property-media-private before caller deletes public copy
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
    // If file is already present in public bucket (e.g., retry after partial failure), reuse it safely
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
  kind: 'image' | 'document',
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

  if (kind === 'image') {
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

  // Private documents and unpublished property documents NEVER upload to public Storage
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

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read file preview.'));
    };
    reader.onerror = () => reject(new Error('File read error.'));
    reader.readAsDataURL(file);
  });

  onProgress?.(100, 'Staged locally.');
  return {
    storageBucket: bucket,
    storagePath,
    publicUrl: bucket === PUBLIC_MEDIA_BUCKET ? dataUrl : undefined,
    dataUrl,
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
