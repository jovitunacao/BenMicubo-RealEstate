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

export function resolveImageUploadBucket(
  isApprovedPublic: boolean,
  isPropertyPublished: boolean
): 'property-media-private' | 'property-media-public' {
  return isApprovedPublic && isPropertyPublished ? PUBLIC_MEDIA_BUCKET : PRIVATE_MEDIA_BUCKET;
}

export function resolveDocumentUploadBucket(
  visibility: 'Private' | 'Public',
  isPropertyPublished: boolean
): 'property-media-private' | 'property-media-public' {
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

export async function uploadOptimizedPropertyImage(
  lotId: string,
  blob: Blob,
  fileName: string,
  mimeType: string,
  isApprovedPublic: boolean,
  fallbackDataUrl: string,
  isPropertyPublished = false
): Promise<{
  url: string;
  storageBucket: 'property-media-private' | 'property-media-public';
  storagePath: string;
}> {
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw new Error('Only JPG, PNG, and WebP images are supported.');
  }
  if (blob.size > MAX_PUBLIC_FILE_BYTES) {
    throw new Error('Optimized image exceeds the 10 MB upload limit.');
  }

  // Unapproved images or uploads on unpublished/staged listings NEVER go to public Storage
  const bucket = resolveImageUploadBucket(isApprovedPublic, isPropertyPublished);
  const storagePath = `${lotId.toUpperCase()}/images/${Date.now()}-${fileName}`;

  if (isSupabaseConfigured && supabase) {
    const {error} = await supabase.storage
      .from(bucket)
      .upload(storagePath, blob, {contentType: mimeType, upsert: false});
    if (error) throw new Error(`Image upload failed: ${error.message}`);

    if (bucket === PUBLIC_MEDIA_BUCKET) {
      const {data} = supabase.storage.from(bucket).getPublicUrl(storagePath);
      return {url: data.publicUrl, storageBucket: bucket, storagePath};
    }

    const {data: signed, error: signError} = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 3600);
    if (signError) throw new Error(signError.message);
    return {url: signed.signedUrl, storageBucket: bucket, storagePath};
  }

  return {
    url: fallbackDataUrl,
    storageBucket: bucket,
    storagePath,
  };
}

export async function promoteFileToPublicBucket(
  storagePath: string,
  fallbackContentType = 'application/octet-stream'
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase || !storagePath) return null;

  const {data: fileBlob, error: downloadErr} = await supabase.storage
    .from(PRIVATE_MEDIA_BUCKET)
    .download(storagePath);
  if (downloadErr || !fileBlob) return null;

  const {error: uploadErr} = await supabase.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .upload(storagePath, fileBlob, {
      contentType: fileBlob.type || fallbackContentType,
      upsert: true,
    });
  if (uploadErr) return null;

  const {data} = supabase.storage.from(PUBLIC_MEDIA_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

export async function promoteImageToPublicBucket(
  storagePath: string
): Promise<string | null> {
  return promoteFileToPublicBucket(storagePath, 'image/webp');
}

export async function demoteFileFromPublicBucket(
  storagePath: string,
  kind: 'image' | 'document'
): Promise<{signedUrl: string | null}> {
  if (!isSupabaseConfigured || !supabase || !storagePath) {
    return {signedUrl: null};
  }

  const {data: publicBlob, error: dlErr} = await supabase.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .download(storagePath);
  if (!dlErr && publicBlob) {
    const {error: backupErr} = await supabase.storage
      .from(PRIVATE_MEDIA_BUCKET)
      .upload(storagePath, publicBlob, {
        contentType: publicBlob.type || 'application/octet-stream',
        upsert: true,
      });
    if (backupErr) {
      throw new Error(`Failed to archive confidential file to private storage: ${backupErr.message}`);
    }
  }

  const {error: removeErr} = await supabase.storage
    .from(PUBLIC_MEDIA_BUCKET)
    .remove([storagePath]);
  if (removeErr) {
    throw new Error(`Failed to remove confidential file from public storage: ${removeErr.message}`);
  }

  if (kind === 'image') {
    const {data: signed} = await supabase.storage
      .from(PRIVATE_MEDIA_BUCKET)
      .createSignedUrl(storagePath, 3600);
    return {signedUrl: signed?.signedUrl || null};
  }
  return {signedUrl: null};
}

export async function removeStoragePathsFromBucket(
  bucket: 'property-media-private' | 'property-media-public',
  paths: string[]
): Promise<void> {
  const cleanPaths = paths.filter((p) => Boolean(p && !p.includes('..')));
  if (!isSupabaseConfigured || !supabase || cleanPaths.length === 0) return;
  const {error} = await supabase.storage.from(bucket).remove(cleanPaths);
  if (error) {
    throw new Error(`Failed to remove storage files from ${bucket}: ${error.message}`);
  }
}

export async function refreshPrivateImageSignedUrl(
  storagePath: string
): Promise<string | null> {
  if (!isSupabaseConfigured || !supabase || !storagePath) return null;
  const {data, error} = await supabase.storage
    .from(PRIVATE_MEDIA_BUCKET)
    .createSignedUrl(storagePath, 3600);
  if (error || !data) return null;
  return data.signedUrl;
}

export async function uploadPropertyDocumentFile(
  lotId: string,
  file: File,
  visibility: 'Private' | 'Public',
  isPropertyPublished = false
): Promise<{
  storageBucket: 'property-media-private' | 'property-media-public';
  storagePath: string;
  publicUrl?: string;
  dataUrl?: string;
}> {
  validateDocumentFile(file, visibility);

  // Private documents and unpublished property documents NEVER upload to public Storage
  const bucket = resolveDocumentUploadBucket(visibility, isPropertyPublished);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const storagePath = `${lotId.toUpperCase()}/documents/${Date.now()}-${safeName}`;

  if (isSupabaseConfigured && supabase) {
    const {error} = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {contentType: file.type || 'application/octet-stream'});
    if (error) throw new Error(`Document upload failed: ${error.message}`);

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
