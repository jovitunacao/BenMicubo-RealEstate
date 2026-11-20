import type {Property} from '../types/property';

export interface GallerySlide {
  id: string;
  url: string;
  thumbUrl: string;
  caption: string;
  source: 'supabase';
}

export function buildPropertyGallerySlides(
  property: Property,
  options: {
    isPreviewAllowed: boolean;
  }
): GallerySlide[] {
  const isPublished = property.visibility === 'Published' && !property.isArchived;
  if (!isPublished && !options.isPreviewAllowed) {
    return [];
  }

  const supabaseItems =
    property.images && property.images.length > 0
      ? options.isPreviewAllowed
        ? property.images
        : property.images.filter((img) => img.isApprovedPublic)
      : (property.photos || []).map((url, idx) => ({
          id: `fallback-${idx}`,
          url,
          caption: '',
          isCover: idx === 0,
          sortOrder: idx,
          isApprovedPublic: true,
          storageBucket: 'property-media-public' as const,
        }));

  const sortedSupabase = [...supabaseItems].sort((a, b) => {
    if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });

  return sortedSupabase.map((img) => ({
    id: img.id,
    url: img.url,
    thumbUrl: img.url,
    caption: img.caption || '',
    source: 'supabase',
  }));
}

export function resolveNextGalleryIndex(
  currentIndex: number,
  totalSlides: number,
  swipeDeltaX: number,
  thresholdPx = 40
): number {
  if (totalSlides <= 1) return 0;
  if (Math.abs(swipeDeltaX) < thresholdPx) return currentIndex;
  if (swipeDeltaX < 0) {
    return currentIndex >= totalSlides - 1 ? 0 : currentIndex + 1;
  }
  return currentIndex <= 0 ? totalSlides - 1 : currentIndex - 1;
}
