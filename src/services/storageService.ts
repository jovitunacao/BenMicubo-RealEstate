import {isSupabaseConfigured, supabase} from '../lib/supabase';
import type {PropertyDocumentItem} from '../types/property';

export const PUBLIC_MEDIA_BUCKET = 'property-media-public';
export const PRIVATE_MEDIA_BUCKET = 'property-media-private';

export async function uploadOptimizedPropertyImage(
  lotId: string,
  blob: Blob,
  fileName: string,
  mimeType: string,
  isApprovedPublic: boolean,
  fallbackDataUrl: string
): Promise<{
  url: string;
  storageBucket: 'property-media-private' | 'property-media-public';
  storagePath: string;
}> {
  const bucket = isApprovedPublic ? PUBLIC_MEDIA_BUCKET : PRIVATE_MEDIA_BUCKET;
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

export async function uploadPropertyDocumentFile(
  lotId: string,
  file: File,
  visibility: 'Private' | 'Public'
): Promise<{
  storageBucket: 'property-media-private' | 'property-media-public';
  storagePath: string;
  publicUrl?: string;
  dataUrl?: string;
}> {
  const bucket = visibility === 'Public' ? PUBLIC_MEDIA_BUCKET : PRIVATE_MEDIA_BUCKET;
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
  const storagePath = `${lotId.toUpperCase()}/documents/${Date.now()}-${safeName}`;

  if (isSupabaseConfigured && supabase) {
    const {error} = await supabase.storage
      .from(bucket)
      .upload(storagePath, file, {contentType: file.type || 'application/octet-stream'});
    if (error) throw new Error(`Document upload failed: ${error.message}`);

    if (visibility === 'Public') {
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
    publicUrl: visibility === 'Public' ? dataUrl : undefined,
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
    if (doc.visibility === 'Private') {
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
