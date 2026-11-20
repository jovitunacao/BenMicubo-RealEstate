import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  GripVertical,
  HardDrive,
  Lock,
  MapPin,
  Play,
  RefreshCw,
  Send,
  Star,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import {isSupabaseConfigured} from '../lib/supabase';
import type {
  DocumentCategory,
  DocumentVisibility,
  Property,
  PropertyClassification,
  PropertyDocumentItem,
  PropertyImageItem,
  PropertyInput,
  PropertyStatus,
  PropertyVideoItem,
  PropertyVisibility,
  SiteSettings,
} from '../types/property';
import {
  computePricePerSqm,
  computeTotalPrice,
  formatFileSize,
  formatPhp,
  formatSqm,
  generateNextLotId,
} from '../utils/format';
import {parsePropertyVideoUrl} from '../utils/video';
import {computeFileFingerprint, optimizePropertyImage} from '../utils/imageProcessor';
import {
  getAuthorizedDocumentDownloadUrl,
  uploadOptimizedPropertyImage,
  uploadPropertyDocumentFile,
} from '../services/storageService';
import {
  sortImagesCoverFirst,
  validatePropertyForPublish,
} from '../services/propertyService';
import {
  getEffectiveCanonicalSiteUrl,
  validateCanonicalSiteUrl,
} from '../utils/siteUrl';
import {
  assessCoordinateLocationConsistency,
  buildGoogleMapsEmbedUrl,
  buildGoogleMapsPinUrl,
  buildOpenStreetMapEmbedUrl,
  formatLatLngDisplay,
  parseGoogleMapsCoordinates,
  shouldRequireSyncConfirmation,
  validateCoordinateStrings,
} from '../utils/googleMaps';
import {PropertyImage} from './PropertyImage';
import {StatusIndicator} from './StatusIndicator';
import {PropertyVideoPlayer} from './PropertyVideoPlayer';

interface AdminPropertyEditorProps {
  initialProperty: Property | null;
  existingProperties: Property[];
  siteSettings: SiteSettings;
  onSave: (input: PropertyInput, existingId?: string) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

const SAMPLE_IMAGE_CHOICES = [
  {label: 'Tagaytay Ridge', path: '/images/tagaytay_ridge.svg'},
  {label: 'Batangas Coast', path: '/images/batangas_coast.svg'},
  {label: 'Laguna Estate', path: '/images/laguna_estate.svg'},
  {label: 'Siargao Palms', path: '/images/siargao_palm.svg'},
  {label: 'Cebu Highland', path: '/images/cebu_highland.svg'},
  {label: 'Palawan Meadow', path: '/images/palawan_farm.svg'},
  {label: 'Survey Plan', path: '/images/survey_plan.svg'},
  {label: 'Road Frontage', path: '/images/road_frontage.svg'},
];

const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  'Survey Plan',
  'Lot Plan',
  'Technical Description',
  'Vicinity Map',
  'Tax Declaration',
  'Title Document',
  'PDF Brochure',
  'Other',
];

export function AdminPropertyEditor({
  initialProperty,
  existingProperties,
  siteSettings,
  onSave,
  onCancel,
}: AdminPropertyEditorProps) {
  const isEditing = Boolean(initialProperty);
  const suggestedLotId = useMemo(
    () => initialProperty?.lotId ?? generateNextLotId(existingProperties),
    [initialProperty?.lotId, existingProperties]
  );

  const [lotId, setLotId] = useState(suggestedLotId);
  const [title, setTitle] = useState(initialProperty?.title ?? '');
  const [classification, setClassification] = useState<PropertyClassification>(
    initialProperty?.classification ?? 'Residential'
  );
  const [status, setStatus] = useState<PropertyStatus>(
    initialProperty?.status ?? 'Available'
  );
  const [visibility, setVisibility] = useState<PropertyVisibility>(
    initialProperty?.visibility ?? 'Draft'
  );
  const [isFeatured, setIsFeatured] = useState(initialProperty?.isFeatured ?? false);

  const [barangay, setBarangay] = useState(initialProperty?.barangay ?? '');
  const [city, setCity] = useState(initialProperty?.city ?? '');
  const [province, setProvince] = useState(initialProperty?.province ?? '');
  const [region, setRegion] = useState(initialProperty?.region ?? 'CALABARZON (Region IV-A)');
  const [completeLocation, setCompleteLocation] = useState(
    initialProperty?.completeLocation ?? ''
  );
  const [latitude, setLatitude] = useState(() =>
    initialProperty && Number.isFinite(initialProperty.latitude)
      ? String(initialProperty.latitude)
      : ''
  );
  const [longitude, setLongitude] = useState(() =>
    initialProperty && Number.isFinite(initialProperty.longitude)
      ? String(initialProperty.longitude)
      : ''
  );
  const [googleMapsUrl, setGoogleMapsUrl] = useState(
    () => initialProperty?.googleMapsUrl ?? ''
  );
  const [gpsFeedback, setGpsFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [pendingGpsSync, setPendingGpsSync] = useState<{
    latitude: number;
    longitude: number;
    reason: 'viewport_only' | 'differs_from_verified';
    message: string;
    sourceMessage: string;
  } | null>(null);
  const [mapPreviewProvider, setMapPreviewProvider] = useState<'google' | 'osm'>('google');

  useEffect(() => {
    if (!initialProperty) return;
    setLatitude(
      Number.isFinite(initialProperty.latitude) ? String(initialProperty.latitude) : ''
    );
    setLongitude(
      Number.isFinite(initialProperty.longitude) ? String(initialProperty.longitude) : ''
    );
    setGoogleMapsUrl(initialProperty.googleMapsUrl ?? '');
    setGpsFeedback(null);
    setPendingGpsSync(null);
  }, [
    initialProperty?.id,
    initialProperty?.latitude,
    initialProperty?.longitude,
    initialProperty?.googleMapsUrl,
  ]);

  const [lotAreaSqm, setLotAreaSqm] = useState(String(initialProperty?.lotAreaSqm ?? 500));
  const [pricePerSqm, setPricePerSqm] = useState(
    String(
      initialProperty?.pricePerSqm ??
        computePricePerSqm(initialProperty?.priceTotalPhp ?? 10000000, initialProperty?.lotAreaSqm ?? 500)
    )
  );
  const [isPriceManualOverride, setIsPriceManualOverride] = useState(
    initialProperty?.isPriceManualOverride ?? false
  );
  const [manualTotalPrice, setManualTotalPrice] = useState(
    String(initialProperty?.priceTotalPhp ?? 10000000)
  );
  const [isNegotiable, setIsNegotiable] = useState(initialProperty?.isNegotiable ?? false);
  const [dimensions, setDimensions] = useState(initialProperty?.dimensions ?? '');
  const [showLotDimensions, setShowLotDimensions] = useState<boolean>(
    initialProperty?.showLotDimensions ?? true
  );
  const [boundaryDescription, setBoundaryDescription] = useState(
    initialProperty?.boundaryDescription ?? ''
  );

  const [roadAccess, setRoadAccess] = useState(
    initialProperty?.roadAccess ?? '10m concrete barangay road'
  );
  const [utilities, setUtilities] = useState(
    initialProperty?.utilities ?? '3-phase electricity line and municipal water main along frontage'
  );
  const [terrain, setTerrain] = useState(initialProperty?.terrain ?? 'Flat graded elevation');
  const [nearbyLandmarks, setNearbyLandmarks] = useState(
    initialProperty?.nearbyLandmarks ?? ''
  );
  const [titleStatus, setTitleStatus] = useState(
    initialProperty?.titleStatus ?? 'Clean TCT · Updated Real Property Tax'
  );
  const [taxDeclarationStatus, setTaxDeclarationStatus] = useState(
    initialProperty?.taxDeclarationStatus ?? 'Updated Real Property Tax Declaration'
  );
  const [additionalRemarks, setAdditionalRemarks] = useState(
    initialProperty?.additionalRemarks ?? ''
  );
  const [description, setDescription] = useState(initialProperty?.description ?? '');
  const [highlightsText, setHighlightsText] = useState(
    initialProperty?.highlights.join('\n') ?? ''
  );

  // Media: Property Photo Gallery — Supabase Storage (Cover first + Gallery)
  const [images, setImages] = useState<PropertyImageItem[]>(() =>
    initialProperty?.images ? sortImagesCoverFirst(initialProperty.images) : []
  );
  const [explicitlyLockedImageIds, setExplicitlyLockedImageIds] = useState<Set<string>>(
    () => new Set()
  );
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    current: number;
    total: number;
    percent: number;
    stage: string;
  } | null>(null);
  const [photoFeedback, setPhotoFeedback] = useState('');
  const [photoUploadErrors, setPhotoUploadErrors] = useState<string[]>([]);
  const [isPhotoDragOver, setIsPhotoDragOver] = useState(false);
  const [dragImageIndex, setDragImageIndex] = useState<number | null>(null);
  const [imageOptimizationStats, setImageOptimizationStats] = useState<
    Record<
      string,
      {originalBytes: number; optimizedBytes: number; width: number; height: number; mimeType: string}
    >
  >({});
  const imageFingerprintsRef = useRef<Map<string, string>>(new Map());
  const imageContentHashesRef = useRef<Map<string, string>>(new Map());

  const [previewPhoto, setPreviewPhoto] = useState<{url: string; caption: string} | null>(null);

  // Media: Multiple Videos
  const [videos, setVideos] = useState<PropertyVideoItem[]>(() => {
    if (initialProperty?.videos && initialProperty.videos.length > 0) {
      return initialProperty.videos;
    }
    if (initialProperty?.youtubeUrl) {
      return [
        {
          id: `vid-init-${Date.now()}`,
          sourceType: 'youtube',
          url: initialProperty.youtubeUrl,
          title: 'Aerial Drone Tour',
          description: 'Site boundaries, road frontage, and neighborhood orientation.',
          sortOrder: 0,
        },
      ];
    }
    return [];
  });
  const [newVideoUrl, setNewVideoUrl] = useState('');
  const [newVideoTitle, setNewVideoTitle] = useState('');
  const [newVideoDesc, setNewVideoDesc] = useState('');

  // Files & Documents (STRICT DEFAULT: Private)
  const [documents, setDocuments] = useState<PropertyDocumentItem[]>(
    initialProperty?.documents ?? []
  );
  const [docCategory, setDocCategory] = useState<DocumentCategory>('Survey Plan');
  const [docTitle, setDocTitle] = useState('');
  const [docVisibility, setDocVisibility] = useState<DocumentVisibility>('Private');
  const [uploadingDoc, setUploadingDoc] = useState(false);

  // Agent Defaults
  const [agentName, setAgentName] = useState(
    initialProperty?.agentName ?? siteSettings.defaultAgentName
  );
  const [agentPhone, setAgentPhone] = useState(
    initialProperty?.agentPhone ?? siteSettings.defaultAgentPhone
  );
  const [agentWhatsapp, setAgentWhatsapp] = useState(
    initialProperty?.agentWhatsapp ?? siteSettings.defaultAgentWhatsapp
  );
  const [agentMessenger, setAgentMessenger] = useState(
    initialProperty?.agentMessenger ?? siteSettings.defaultAgentMessenger
  );

  // Workflow UI State
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const numericArea = Number(lotAreaSqm) || 0;
  const numericRatePerSqm = Number(pricePerSqm) || 0;
  const autoCalculatedTotal = computeTotalPrice(numericArea, numericRatePerSqm);
  const effectiveTotalPrice = isPriceManualOverride
    ? Math.max(0, Number(manualTotalPrice) || 0)
    : autoCalculatedTotal;
  const effectiveRatePerSqm = isPriceManualOverride
    ? computePricePerSqm(effectiveTotalPrice, numericArea)
    : numericRatePerSqm;

  const canonicalCheck = validateCanonicalSiteUrl(
    getEffectiveCanonicalSiteUrl(siteSettings.canonicalSiteUrl)
  );

  const buildPropertyInput = (targetVisibility: PropertyVisibility): PropertyInput => {
    const normalizedLotId = (isEditing && initialProperty ? initialProperty.lotId : lotId)
      .trim()
      .toUpperCase();

    const isComingFromUnpublished =
      Boolean(initialProperty) && initialProperty?.visibility !== 'Published';

    const orderedImages = sortImagesCoverFirst(images).map((img, idx) => {
      const approvedForPublic =
        targetVisibility === 'Published'
          ? img.isApprovedPublic ||
            (isComingFromUnpublished && !explicitlyLockedImageIds.has(img.id))
          : false;
      return {
        ...img,
        sortOrder: idx,
        isCover: idx === 0,
        isApprovedPublic: approvedForPublic,
      };
    });

    const normalizedVideos = videos.map((v, idx) => ({
      ...v,
      sortOrder: idx,
    }));

    const resolvedCompleteLocation =
      completeLocation.trim() ||
      [barangay.trim(), city.trim(), province.trim()].filter(Boolean).join(', ');
    const coordCheck = validateCoordinateStrings(latitude, longitude);
    const resolvedLat =
      coordCheck.valid && coordCheck.latitude !== undefined ? coordCheck.latitude : Number.NaN;
    const resolvedLng =
      coordCheck.valid && coordCheck.longitude !== undefined ? coordCheck.longitude : Number.NaN;
    const resolvedMapsUrl =
      googleMapsUrl.trim() ||
      (coordCheck.valid && coordCheck.latitude !== undefined && coordCheck.longitude !== undefined
        ? buildGoogleMapsPinUrl(coordCheck.latitude, coordCheck.longitude)
        : '');

    return {
      lotId: normalizedLotId,
      title: title.trim(),
      barangay: barangay.trim() || 'Brgy. Central',
      city: city.trim(),
      province: province.trim(),
      region: region.trim() || 'Philippines',
      completeLocation: resolvedCompleteLocation,
      lotAreaSqm: numericArea,
      dimensions: dimensions.trim(),
      showLotDimensions,
      boundaryDescription: boundaryDescription.trim(),
      pricePerSqm: effectiveRatePerSqm,
      priceTotalPhp: effectiveTotalPrice,
      isPriceManualOverride,
      isNegotiable,
      classification,
      status,
      visibility: targetVisibility,
      isArchived: targetVisibility === 'Archived',
      isFeatured,
      roadAccess: roadAccess.trim() || 'Paved barangay road',
      utilities: utilities.trim(),
      terrain: terrain.trim() || 'Level',
      nearbyLandmarks: nearbyLandmarks.trim(),
      titleStatus: titleStatus.trim() || 'Clean TCT',
      taxDeclarationStatus: taxDeclarationStatus.trim(),
      additionalRemarks: additionalRemarks.trim(),
      description: description.trim() || 'Verified land parcel ready for viewing.',
      highlights: highlightsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      photos: orderedImages.map((img) => img.url),
      images: orderedImages,
      youtubeUrl: normalizedVideos[0]?.url || '',
      videos: normalizedVideos,
      documents,
      latitude: resolvedLat,
      longitude: resolvedLng,
      googleMapsUrl: resolvedMapsUrl,
      agentName: agentName.trim() || siteSettings.defaultAgentName,
      agentPhone: agentPhone.trim() || siteSettings.defaultAgentPhone,
      agentWhatsapp: agentWhatsapp.trim() || siteSettings.defaultAgentWhatsapp,
      agentMessenger: agentMessenger.trim() || siteSettings.defaultAgentMessenger,
      publishedAt:
        targetVisibility === 'Published'
          ? initialProperty?.publishedAt || new Date().toISOString()
          : initialProperty?.publishedAt,
      expectedUpdatedAt: initialProperty?.updatedAt,
    };
  };

  const handleGalleryUpload = async (fileList: FileList | File[] | null | undefined) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setUploadingPhoto(true);
    setPhotoFeedback('');
    setPhotoUploadErrors([]);
    setError('');

    const targetLot = (isEditing && initialProperty ? initialProperty.lotId : lotId) || 'LOT-NEW';
    const approvedPublicIntent = visibility === 'Published';
    const errors: string[] = [];
    const addedImages: PropertyImageItem[] = [];
    let skippedDuplicates = 0;

    try {
      for (let idx = 0; idx < files.length; idx++) {
        const file = files[idx];
        const fingerprint = computeFileFingerprint(file);
        if (Array.from(imageFingerprintsRef.current.values()).includes(fingerprint)) {
          skippedDuplicates += 1;
          continue;
        }

        setUploadProgress({
          current: idx + 1,
          total: files.length,
          percent: 10,
          stage: `Optimizing ${file.name}...`,
        });

        try {
          const optimized = await optimizePropertyImage(file);
          if (Array.from(imageContentHashesRef.current.values()).includes(optimized.contentHash)) {
            skippedDuplicates += 1;
            continue;
          }

          // Always stage new uploads in private Storage until property is saved & published
          const uploaded = await uploadOptimizedPropertyImage(
            targetLot,
            optimized.blob,
            optimized.fileName,
            optimized.mimeType,
            approvedPublicIntent,
            optimized.dataUrl,
            false,
            (percent, stage) => {
              setUploadProgress({
                current: idx + 1,
                total: files.length,
                percent,
                stage: `${file.name}: ${stage}`,
              });
            }
          );

          const newId = `img-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
          imageFingerprintsRef.current.set(newId, fingerprint);
          imageContentHashesRef.current.set(newId, optimized.contentHash);
          setImageOptimizationStats((prev) => ({
            ...prev,
            [newId]: {
              originalBytes: optimized.originalBytes,
              optimizedBytes: optimized.optimizedBytes,
              width: optimized.width,
              height: optimized.height,
              mimeType: optimized.mimeType,
            },
          }));

          addedImages.push({
            id: newId,
            url: uploaded.url,
            caption: '',
            isCover: false,
            sortOrder: images.length + addedImages.length,
            isApprovedPublic: approvedPublicIntent,
            storageBucket: uploaded.storageBucket,
            storagePath: uploaded.storagePath,
          });
        } catch (err) {
          errors.push(
            `${file.name}: ${err instanceof Error ? err.message : 'Unable to upload photo.'}`
          );
        }
      }

      if (addedImages.length > 0) {
        setImages((prev) => sortImagesCoverFirst([...prev, ...addedImages]));
      }

      const feedbackParts: string[] = [];
      if (addedImages.length > 0) {
        feedbackParts.push(
          `Optimized & staged ${addedImages.length} photo(s) in private storage. Save listing to sync.`
        );
      }
      if (skippedDuplicates > 0) {
        feedbackParts.push(`Skipped ${skippedDuplicates} duplicate image(s).`);
      }
      if (feedbackParts.length > 0) {
        setPhotoFeedback(feedbackParts.join(' '));
      }
      if (errors.length > 0) {
        setPhotoUploadErrors(errors);
      }
    } finally {
      setUploadingPhoto(false);
      setUploadProgress(null);
    }
  };

  const handleReplaceSinglePhoto = async (targetId: string, file: File | undefined) => {
    if (!file) return;
    const targetImg = images.find((i) => i.id === targetId);
    if (!targetImg) return;

    setUploadingPhoto(true);
    setPhotoFeedback('');
    setPhotoUploadErrors([]);
    setError('');
    try {
      const targetLot = (isEditing && initialProperty ? initialProperty.lotId : lotId) || 'LOT-NEW';
      const approvedIntent = targetImg.isApprovedPublic;
      setUploadProgress({
        current: 1,
        total: 1,
        percent: 15,
        stage: `Optimizing replacement ${file.name}...`,
      });
      const optimized = await optimizePropertyImage(file);
      const uploaded = await uploadOptimizedPropertyImage(
        targetLot,
        optimized.blob,
        optimized.fileName,
        optimized.mimeType,
        approvedIntent,
        optimized.dataUrl,
        false,
        (percent, stage) => {
          setUploadProgress({
            current: 1,
            total: 1,
            percent,
            stage: `${file.name}: ${stage}`,
          });
        }
      );

      imageFingerprintsRef.current.set(targetId, computeFileFingerprint(file));
      imageContentHashesRef.current.set(targetId, optimized.contentHash);
      setImageOptimizationStats((prev) => ({
        ...prev,
        [targetId]: {
          originalBytes: optimized.originalBytes,
          optimizedBytes: optimized.optimizedBytes,
          width: optimized.width,
          height: optimized.height,
          mimeType: optimized.mimeType,
        },
      }));

      setImages((prev) =>
        sortImagesCoverFirst(
          prev.map((item) =>
            item.id === targetId
              ? {
                  ...item,
                  url: uploaded.url,
                  storageBucket: uploaded.storageBucket,
                  storagePath: uploaded.storagePath,
                  isApprovedPublic: approvedIntent,
                }
              : item
          )
        )
      );
      setPhotoFeedback(
        `Replaced photo (${optimized.width}×${optimized.height}px, ${formatFileSize(
          optimized.optimizedBytes
        )}) and staged in private storage. Save listing to sync.`
      );
    } catch (err) {
      setPhotoUploadErrors([
        err instanceof Error ? err.message : 'Unable to replace property photo.',
      ]);
    } finally {
      setUploadingPhoto(false);
      setUploadProgress(null);
    }
  };

  const handleSetCoverPhoto = (targetId: string) => {
    setImages((prev) => {
      const target = prev.find((i) => i.id === targetId);
      if (!target) return prev;
      const others = prev.filter((i) => i.id !== targetId);
      return [
        {...target, isCover: true, sortOrder: 0},
        ...others.map((item, idx) => ({...item, isCover: false, sortOrder: idx + 1})),
      ];
    });
  };

  const handleRemoveImage = (targetId: string) => {
    imageFingerprintsRef.current.delete(targetId);
    imageContentHashesRef.current.delete(targetId);
    setImages((prev) => sortImagesCoverFirst(prev.filter((item) => item.id !== targetId)));
    setPhotoFeedback('Photo removed from editor. Save listing to clean up storage.');
  };

  const handleMoveImage = (index: number, direction: -1 | 1) => {
    const nextIdx = index + direction;
    if (nextIdx < 0 || nextIdx >= images.length) return;
    setImages((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIdx, 0, moved);
      return copy.map((img, i) => ({...img, isCover: i === 0, sortOrder: i}));
    });
  };

  const handleDropImage = (dropIndex: number) => {
    if (dragImageIndex === null || dragImageIndex === dropIndex) {
      setDragImageIndex(null);
      return;
    }
    setImages((prev) => {
      const copy = [...prev];
      const [dragged] = copy.splice(dragImageIndex, 1);
      copy.splice(dropIndex, 0, dragged);
      return copy.map((img, i) => ({...img, isCover: i === 0, sortOrder: i}));
    });
    setDragImageIndex(null);
  };

  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const parsedNewVideo = newVideoUrl.trim() ? parsePropertyVideoUrl(newVideoUrl) : null;

  const handleAddVideo = () => {
    const trimmed = newVideoUrl.trim();
    if (!trimmed) return;
    const parsed = parsePropertyVideoUrl(trimmed);
    if (!parsed) {
      setError(
        'Enter a valid YouTube link (watch, youtu.be, shorts, unlisted) or Google Drive file sharing link (https://drive.google.com/file/d/.../view).'
      );
      return;
    }
    setError('');
    setVideos((prev) => [
      ...prev,
      {
        id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sourceType: parsed.provider,
        url: trimmed,
        title:
          newVideoTitle.trim() ||
          `${parsed.providerLabel} Tour ${prev.length + 1}`,
        description: newVideoDesc.trim(),
        sortOrder: prev.length,
      },
    ]);
    setNewVideoUrl('');
    setNewVideoTitle('');
    setNewVideoDesc('');
  };

  const handleMoveVideo = (index: number, direction: -1 | 1) => {
    const nextIdx = index + direction;
    if (nextIdx < 0 || nextIdx >= videos.length) return;
    setVideos((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(nextIdx, 0, moved);
      return copy.map((v, i) => ({...v, sortOrder: i}));
    });
  };

  const handleUploadDocument = async (file: File | undefined) => {
    if (!file) return;
    setUploadingDoc(true);
    setError('');
    try {
      const targetLot = (isEditing && initialProperty ? initialProperty.lotId : lotId) || 'LOT-NEW';
      const chosenVis: DocumentVisibility = docVisibility || 'Private';
      // Always stage new uploads in private Storage; public docs are promoted only on Published save
      const uploaded = await uploadPropertyDocumentFile(targetLot, file, chosenVis, false);
      const item: PropertyDocumentItem = {
        id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title: docTitle.trim() || file.name.replace(/\.[^.]+$/, ''),
        category: docCategory,
        visibility: chosenVis,
        storageBucket: uploaded.storageBucket,
        storagePath: uploaded.storagePath,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSizeBytes: file.size,
        publicUrl: uploaded.publicUrl,
        dataUrl: uploaded.dataUrl,
        uploadedAt: new Date().toISOString(),
      };
      setDocuments((prev) => [...prev, item]);
      setDocTitle('');
      // Reset back to strict default 'Private' after upload
      setDocVisibility('Private');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload document.');
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleOpenAdminDoc = async (doc: PropertyDocumentItem) => {
    try {
      const url = await getAuthorizedDocumentDownloadUrl(doc, true);
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = doc.fileName;
      link.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to preview private document.');
    }
  };

  const handleManualCoordinateChange = (nextLat: string, nextLng: string) => {
    setLatitude(nextLat);
    setLongitude(nextLng);
    setPendingGpsSync(null);
    const check = validateCoordinateStrings(nextLat, nextLng);
    if (check.valid && check.latitude !== undefined && check.longitude !== undefined) {
      const trimmedUrl = googleMapsUrl.trim();
      const isAutoPinUrl =
        !trimmedUrl ||
        /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=[^&]+$/i.test(trimmedUrl);
      if (isAutoPinUrl) {
        setGoogleMapsUrl(buildGoogleMapsPinUrl(check.latitude, check.longitude));
      }
      setGpsFeedback(null);
    }
  };

  const handleSyncMapsUrl = () => {
    const parsed = parseGoogleMapsCoordinates(googleMapsUrl);
    if (!parsed.ok || parsed.latitude === undefined || parsed.longitude === undefined) {
      setPendingGpsSync(null);
      setGpsFeedback({
        type: 'error',
        message: parsed.message,
      });
      return;
    }

    const decision = shouldRequireSyncConfirmation(latitude, longitude, parsed);
    if (decision.requireConfirmation && decision.reason !== 'none') {
      setGpsFeedback(null);
      setPendingGpsSync({
        latitude: parsed.latitude,
        longitude: parsed.longitude,
        reason: decision.reason,
        message: decision.message || 'Confirm before applying extracted GPS coordinates.',
        sourceMessage: parsed.message,
      });
      return;
    }

    setPendingGpsSync(null);
    setLatitude(String(parsed.latitude));
    setLongitude(String(parsed.longitude));
    setGpsFeedback({
      type: 'success',
      message: parsed.message,
    });
  };

  const handleConfirmPendingGpsSync = () => {
    if (!pendingGpsSync) return;
    setLatitude(String(pendingGpsSync.latitude));
    setLongitude(String(pendingGpsSync.longitude));
    setGpsFeedback({
      type: 'success',
      message: `Administrator confirmed GPS update (${pendingGpsSync.latitude}, ${pendingGpsSync.longitude}). Save the property to persist.`,
    });
    setPendingGpsSync(null);
  };

  const handleCancelPendingGpsSync = () => {
    setPendingGpsSync(null);
    setGpsFeedback({
      type: 'success',
      message: 'Existing saved coordinates were preserved.',
    });
  };

  const submitWithVisibility = async (targetVisibility: PropertyVisibility) => {
    setError('');

    if (!lotId.trim() || !title.trim() || !city.trim() || !province.trim()) {
      setError('Lot ID, Property Title, City, and Province are required.');
      return;
    }
    if (numericArea <= 0) {
      setError('Lot area (sqm) must be greater than 0.');
      return;
    }
    if (effectiveTotalPrice < 0) {
      setError('Total selling price cannot be negative.');
      return;
    }
    const coordCheck = validateCoordinateStrings(latitude, longitude);
    if (!coordCheck.valid) {
      setError(
        coordCheck.error ||
          'Enter valid GPS coordinates (Latitude -90 to 90, Longitude -180 to 180) or sync a Google Maps pin before saving.'
      );
      return;
    }
    for (const vid of videos) {
      if (!parsePropertyVideoUrl(vid.url)) {
        setError(
          `Invalid video URL "${vid.url}". Remove or replace it with a valid YouTube or Google Drive sharing URL.`
        );
        return;
      }
    }

    const input = buildPropertyInput(targetVisibility);

    if (targetVisibility === 'Published') {
      const publishErrors = validatePropertyForPublish(input);
      if (publishErrors.length > 0) {
        setError(publishErrors.join(' '));
        return;
      }
    }

    setSaving(true);
    try {
      setVisibility(targetVisibility);
      await onSave(input, initialProperty?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save property.');
    } finally {
      setSaving(false);
    }
  };

  const previewData = buildPropertyInput(visibility);
  const manualCoordCheck = validateCoordinateStrings(latitude, longitude);
  const hasAnyCoordInput = Boolean(latitude.trim() || longitude.trim());
  const coordinateConsistency =
    manualCoordCheck.valid &&
    manualCoordCheck.latitude !== undefined &&
    manualCoordCheck.longitude !== undefined
      ? assessCoordinateLocationConsistency(manualCoordCheck.latitude, manualCoordCheck.longitude, {
          barangay,
          city,
          province,
          region,
          title,
        })
      : null;
  const activePreviewPinUrl =
    manualCoordCheck.valid &&
    manualCoordCheck.latitude !== undefined &&
    manualCoordCheck.longitude !== undefined
      ? buildGoogleMapsPinUrl(manualCoordCheck.latitude, manualCoordCheck.longitude)
      : '';
  const activePreviewEmbedUrl =
    manualCoordCheck.valid &&
    manualCoordCheck.latitude !== undefined &&
    manualCoordCheck.longitude !== undefined
      ? mapPreviewProvider === 'osm'
        ? buildOpenStreetMapEmbedUrl(manualCoordCheck.latitude, manualCoordCheck.longitude)
        : buildGoogleMapsEmbedUrl(manualCoordCheck.latitude, manualCoordCheck.longitude)
      : '';

  return (
    <div className="space-y-6">
      {error && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-xs text-red-900 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Action could not be completed</p>
            <p>{error}</p>
          </div>
        </div>
      )}

      {!canonicalCheck.valid && (
        <div className="p-3.5 rounded-xl border border-[#DCD0F0] bg-[#F3EEFA] text-xs text-[#311A4D] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#6500B5] shrink-0 mt-0.5" />
            <p>
              <strong>Development / Preview Mode:</strong> Creating, editing, publishing, photos, and videos work normally without <code className="font-mono">VITE_PUBLIC_SITE_URL</code>. Production QR downloads and printable QR signage remain disabled until a public HTTPS website URL is configured.
            </p>
          </div>
          <Link
            to="/admin?tab=settings"
            className="text-xs font-semibold text-[#6500B5] hover:underline whitespace-nowrap shrink-0"
          >
            Open Settings →
          </Link>
        </div>
      )}

      {/* Section 1: Core Identity & Workflow State */}
      <section className="p-5 rounded-xl border border-[#E6E6EF] bg-white space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#EFEFF6]">
          <h3 className="font-display text-sm font-bold text-[#202124]">
            1. Listing Identity &amp; Publishing Status
          </h3>
          <span className="font-mono text-xs text-[#10169C]">
            Permanent Route: /property/{(isEditing && initialProperty ? initialProperty.lotId : lotId).trim().toUpperCase() || 'LOT-XXX'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-[#4B4D57] mb-1">
              <span>Permanent Lot ID</span>
              {isEditing && <Lock className="w-3 h-3 text-[#6500B5]" />}
            </label>
            <input
              type="text"
              required
              readOnly={isEditing}
              value={isEditing && initialProperty ? initialProperty.lotId : lotId}
              onChange={(e) => {
                if (!isEditing) setLotId(e.target.value.toUpperCase());
              }}
              className={`w-full h-10 px-3 font-mono text-sm border rounded-lg focus:outline-none ${
                isEditing
                  ? 'bg-[#F8F8FC] border-[#E6E6EF] text-[#696B77] cursor-not-allowed'
                  : 'bg-white border-[#D6D6E4] focus:border-[#6500B5]'
              }`}
            />
            <p className="mt-1 text-[11px] text-[#696B77]">
              {isEditing
                ? 'Locked on edit so printed QR boards stay valid.'
                : 'Auto-generated unique ID (editable before save).'}
            </p>
          </div>

          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Property Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Alfonso Pine Ridge Corner Lot with Taal Horizon View"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Classification
            </label>
            <select
              value={classification}
              onChange={(e) => setClassification(e.target.value as PropertyClassification)}
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg bg-white focus:outline-none focus:border-[#6500B5]"
            >
              <option value="Residential">Residential</option>
              <option value="Commercial">Commercial</option>
              <option value="Agricultural">Agricultural</option>
              <option value="Beachfront">Beachfront</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Availability Status
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as PropertyStatus)}
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg bg-white focus:outline-none focus:border-[#6500B5]"
            >
              <option value="Available">Available</option>
              <option value="Reserved">Reserved</option>
              <option value="Sold">Sold</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Visibility State
            </label>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as PropertyVisibility)}
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg bg-white focus:outline-none focus:border-[#6500B5]"
            >
              <option value="Draft">Draft (Admin Only)</option>
              <option value="Published">Published (Public Live)</option>
              <option value="Archived">Archived (Hidden)</option>
            </select>
          </div>

          <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-[#E6E6EF] bg-[#F8F8FC] text-xs font-medium text-[#202124] cursor-pointer">
            <input
              type="checkbox"
              checked={isFeatured}
              onChange={(e) => setIsFeatured(e.target.checked)}
              className="accent-[#6500B5]"
            />
            <span>Feature on Homepage</span>
          </label>
        </div>
      </section>

      {/* Section 2: Location & GPS */}
      <section className="p-5 rounded-xl border border-[#E6E6EF] bg-white space-y-4">
        <h3 className="font-display text-sm font-bold text-[#202124] pb-3 border-b border-[#EFEFF6]">
          2. Location &amp; Google Maps Coordinates
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Barangay</label>
            <input
              type="text"
              value={barangay}
              onChange={(e) => setBarangay(e.target.value)}
              placeholder="Brgy. Luksuhin"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              City / Municipality *
            </label>
            <input
              type="text"
              required
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Alfonso"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Province *</label>
            <input
              type="text"
              required
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              placeholder="Cavite"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Region</label>
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="CALABARZON (Region IV-A)"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#4B4D57] mb-1">
            Complete Street / Sitio Location Address
          </label>
          <input
            type="text"
            value={completeLocation}
            onChange={(e) => setCompleteLocation(e.target.value)}
            placeholder="Sitio Pine Crest, Brgy. Luksuhin Ibaba, Alfonso, Cavite (2 mins off Tagaytay-Nasugbu Highway)"
            className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-end">
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Latitude (-90 to 90) *
            </label>
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => handleManualCoordinateChange(e.target.value, longitude)}
              placeholder="Decimal latitude"
              aria-label="Latitude"
              className={`w-full h-10 px-3 font-mono text-sm border rounded-lg focus:outline-none ${
                hasAnyCoordInput && !manualCoordCheck.valid
                  ? 'border-red-300 focus:border-red-500'
                  : 'border-[#D6D6E4] focus:border-[#6500B5]'
              }`}
            />
          </div>
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Longitude (-180 to 180) *
            </label>
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => handleManualCoordinateChange(latitude, e.target.value)}
              placeholder="Decimal longitude"
              aria-label="Longitude"
              className={`w-full h-10 px-3 font-mono text-sm border rounded-lg focus:outline-none ${
                hasAnyCoordInput && !manualCoordCheck.valid
                  ? 'border-red-300 focus:border-red-500'
                  : 'border-[#D6D6E4] focus:border-[#6500B5]'
              }`}
            />
          </div>
          <div className="sm:col-span-6">
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Google Maps Link (paste full URL &amp; click Sync GPS Pin)
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={googleMapsUrl}
                onChange={(e) => {
                  setGoogleMapsUrl(e.target.value);
                  if (gpsFeedback) setGpsFeedback(null);
                  if (pendingGpsSync) setPendingGpsSync(null);
                }}
                placeholder="Paste full Google Maps URL with pin or coordinates"
                aria-label="Google Maps URL"
                className="flex-1 h-10 px-3 text-xs border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
              <button
                type="button"
                onClick={handleSyncMapsUrl}
                className="h-10 px-3 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] whitespace-nowrap cursor-pointer"
              >
                Sync GPS Pin
              </button>
            </div>
          </div>
        </div>

        {hasAnyCoordInput && !manualCoordCheck.valid && manualCoordCheck.error && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{manualCoordCheck.error}</span>
          </p>
        )}

        {pendingGpsSync && (
          <div
            role="alert"
            className="text-xs rounded-xl p-4 border border-amber-300 bg-amber-50 text-amber-950 space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">
                  Administrator Confirmation Required Before Updating GPS Coordinates
                </p>
                <p className="leading-relaxed">{pendingGpsSync.message}</p>
                <div className="pt-1 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px]">
                  <span>
                    Current:{' '}
                    {manualCoordCheck.valid &&
                    manualCoordCheck.latitude !== undefined &&
                    manualCoordCheck.longitude !== undefined
                      ? `${manualCoordCheck.latitude}, ${manualCoordCheck.longitude}`
                      : 'Unset'}
                  </span>
                  <span>
                    Extracted: {pendingGpsSync.latitude}, {pendingGpsSync.longitude}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmPendingGpsSync}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] cursor-pointer"
              >
                Confirm &amp; Apply Coordinates
              </button>
              <button
                type="button"
                onClick={handleCancelPendingGpsSync}
                className="px-3 py-1.5 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-lg hover:bg-[#F8F8FC] cursor-pointer"
              >
                Keep Existing Coordinates
              </button>
            </div>
          </div>
        )}

        {coordinateConsistency && !coordinateConsistency.consistent && (
          <div
            role="alert"
            className="text-xs rounded-lg px-3.5 py-2.5 border border-amber-300 bg-amber-50 text-amber-950 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold">
                {coordinateConsistency.isLegacyPlaceholder
                  ? 'Legacy Sample Coordinates Detected — Verification Required'
                  : 'Regional Location Mismatch Detected'}
              </p>
              <p className="leading-relaxed">{coordinateConsistency.warning}</p>
            </div>
          </div>
        )}

        {gpsFeedback && (
          <div
            role="status"
            className={`text-xs rounded-lg px-3.5 py-2.5 border flex items-start gap-2 ${
              gpsFeedback.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-red-50 border-red-200 text-red-900'
            }`}
          >
            {gpsFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
            )}
            <span>{gpsFeedback.message}</span>
          </div>
        )}

        {/* Map Marker Preview */}
        <div className="rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] overflow-hidden">
          <div className="px-4 py-2.5 bg-white border-b border-[#E6E6EF] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs">
              <MapPin className="w-4 h-4 text-[#6500B5] shrink-0" />
              <span className="font-semibold text-[#202124]">Map Marker Preview</span>
              {manualCoordCheck.valid &&
                manualCoordCheck.latitude !== undefined &&
                manualCoordCheck.longitude !== undefined && (
                  <span className="font-mono text-[11px] text-[#10169C] bg-[#F3EEFA] px-2 py-0.5 rounded tabular-nums">
                    {formatLatLngDisplay(manualCoordCheck.latitude, manualCoordCheck.longitude)}
                  </span>
                )}
            </div>

            {manualCoordCheck.valid && activePreviewPinUrl && (
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-[#D6D6E4] bg-white overflow-hidden text-[11px]">
                  <button
                    type="button"
                    onClick={() => setMapPreviewProvider('google')}
                    className={`px-2.5 py-1 font-medium cursor-pointer ${
                      mapPreviewProvider === 'google'
                        ? 'bg-[#6500B5] text-white'
                        : 'text-[#4B4D57] hover:bg-[#F8F8FC]'
                    }`}
                  >
                    Google Pin
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapPreviewProvider('osm')}
                    className={`px-2.5 py-1 font-medium cursor-pointer ${
                      mapPreviewProvider === 'osm'
                        ? 'bg-[#6500B5] text-white'
                        : 'text-[#4B4D57] hover:bg-[#F8F8FC]'
                    }`}
                  >
                    Street Map
                  </button>
                </div>
                <a
                  href={activePreviewPinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[#6500B5] hover:underline whitespace-nowrap"
                >
                  <span>Verify in Google Maps</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </div>

          {activePreviewEmbedUrl ? (
            <div className="relative h-56 w-full bg-[#EFEFF7]">
              <iframe
                key={activePreviewEmbedUrl}
                src={activePreviewEmbedUrl}
                title={`Map marker preview at ${manualCoordCheck.latitude}, ${manualCoordCheck.longitude}`}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="w-full h-full border-0"
              />
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-xs text-[#696B77]">
              Paste a full Google Maps URL and click <strong>Sync GPS Pin</strong>, or enter valid Latitude and Longitude manually to preview the exact site marker.
            </div>
          )}
        </div>
      </section>

      {/* Section 3: Area, Pricing & Legal Specifications */}
      <section className="p-5 rounded-xl border border-[#E6E6EF] bg-white space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#EFEFF6]">
          <h3 className="font-display text-sm font-bold text-[#202124]">
            3. Lot Area, Auto-Calculated Pricing &amp; Title Details
          </h3>
          <span className="text-xs font-mono text-[#6500B5] tabular-nums">
            Effective Total: {formatPhp(effectiveTotalPrice)} ({formatPhp(effectiveRatePerSqm)}/sqm)
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Land Area (sqm) *
            </label>
            <input
              type="number"
              min={1}
              step="any"
              required
              value={lotAreaSqm}
              onChange={(e) => setLotAreaSqm(e.target.value)}
              className="w-full h-10 px-3 font-mono text-sm tabular-nums border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Price per sqm (PHP)
            </label>
            <input
              type="number"
              min={0}
              step="any"
              disabled={isPriceManualOverride}
              value={isPriceManualOverride ? effectiveRatePerSqm : pricePerSqm}
              onChange={(e) => setPricePerSqm(e.target.value)}
              className={`w-full h-10 px-3 font-mono text-sm tabular-nums border rounded-lg focus:outline-none ${
                isPriceManualOverride
                  ? 'bg-[#F8F8FC] border-[#E6E6EF] text-[#696B77]'
                  : 'bg-white border-[#D6D6E4] focus:border-[#6500B5]'
              }`}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Total Selling Price (PHP)
            </label>
            <input
              type="number"
              min={0}
              readOnly={!isPriceManualOverride}
              value={isPriceManualOverride ? manualTotalPrice : String(autoCalculatedTotal)}
              onChange={(e) => setManualTotalPrice(e.target.value)}
              className={`w-full h-10 px-3 font-mono text-sm tabular-nums border rounded-lg focus:outline-none ${
                isPriceManualOverride
                  ? 'bg-white border-[#6500B5] text-[#202124]'
                  : 'bg-[#F8F8FC] border-[#E6E6EF] text-[#202124]'
              }`}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 text-xs">
          <label className="inline-flex items-center gap-2 text-[#202124] cursor-pointer">
            <input
              type="checkbox"
              checked={isPriceManualOverride}
              onChange={(e) => {
                const next = e.target.checked;
                setIsPriceManualOverride(next);
                if (next) {
                  setManualTotalPrice(String(autoCalculatedTotal));
                } else {
                  setPricePerSqm(
                    String(computePricePerSqm(Number(manualTotalPrice) || 0, numericArea))
                  );
                }
              }}
              className="accent-[#6500B5]"
            />
            <span>Authorized Manual Total Price Override</span>
          </label>

          <label className="inline-flex items-center gap-2 text-[#202124] cursor-pointer">
            <input
              type="checkbox"
              checked={isNegotiable}
              onChange={(e) => setIsNegotiable(e.target.checked)}
              className="accent-[#6500B5]"
            />
            <span>Price is Negotiable</span>
          </label>
        </div>

        <div className="p-3.5 rounded-lg border border-[#E6E6EF] bg-[#F8F8FC] space-y-1.5">
          <label className="inline-flex items-center gap-2.5 text-xs font-semibold text-[#202124] cursor-pointer">
            <input
              type="checkbox"
              checked={showLotDimensions}
              onChange={(e) => setShowLotDimensions(e.target.checked)}
              className="accent-[#6500B5] w-4 h-4"
            />
            <span>Show Lot Dimensions on Public Listing</span>
          </label>
          <p className="text-[11px] text-[#4B4D57] pl-6 leading-relaxed">
            Disable for irregularly shaped lots or properties where simple length × width measurements are not applicable.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Lot Dimensions {showLotDimensions ? '(Optional)' : '(Hidden on Public Listing)'}
            </label>
            <input
              type="text"
              value={dimensions}
              onChange={(e) => setDimensions(e.target.value)}
              placeholder="e.g., 25m frontage × 48m depth"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
            {!showLotDimensions && (
              <p className="mt-1 text-[11px] text-[#696B77]">
                Saved value is preserved for admin reference and completely omitted from public listings, A4 dossiers, and QR signage.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Boundary Descriptions
            </label>
            <input
              type="text"
              value={boundaryDescription}
              onChange={(e) => setBoundaryDescription(e.target.value)}
              placeholder="North: 10m Road; East: Lot 12; South: Creek Buffer; West: Lot 10"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Road Access</label>
            <input
              type="text"
              value={roadAccess}
              onChange={(e) => setRoadAccess(e.target.value)}
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Utilities</label>
            <input
              type="text"
              value={utilities}
              onChange={(e) => setUtilities(e.target.value)}
              placeholder="Electricity, water main, fiber internet"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Terrain</label>
            <input
              type="text"
              value={terrain}
              onChange={(e) => setTerrain(e.target.value)}
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Title Status</label>
            <input
              type="text"
              value={titleStatus}
              onChange={(e) => setTitleStatus(e.target.value)}
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Tax Declaration Status
            </label>
            <input
              type="text"
              value={taxDeclarationStatus}
              onChange={(e) => setTaxDeclarationStatus(e.target.value)}
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Nearby Landmarks
            </label>
            <input
              type="text"
              value={nearbyLandmarks}
              onChange={(e) => setNearbyLandmarks(e.target.value)}
              placeholder="Twin Lakes, CALAX Exit, Public Market"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#4B4D57] mb-1">
            Detailed Property Description *
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe elevation, sun orientation, nearby developments, investment potential, and buyer terms..."
            className="w-full px-3 py-2 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Key Highlights (one per line)
            </label>
            <textarea
              rows={3}
              value={highlightsText}
              onChange={(e) => setHighlightsText(e.target.value)}
              placeholder="25m concrete road frontage&#10;Clean individual TCT&#10;Cool ridge elevation"
              className="w-full px-3 py-2 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Additional Remarks / Terms
            </label>
            <textarea
              rows={3}
              value={additionalRemarks}
              onChange={(e) => setAdditionalRemarks(e.target.value)}
              placeholder="Capital gains tax and documentary stamps terms, earnest money guidelines, viewing schedule notes..."
              className="w-full px-3 py-2 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
        </div>
      </section>

      {/* Section 4: Property Photo Gallery (Supabase Storage) */}
      <section className="p-5 rounded-xl border border-[#E6E6EF] bg-white space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#EFEFF6]">
          <div>
            <h3 className="font-display text-sm font-bold text-[#202124]">
              4. Property Photo Gallery ({images.length}) · Supabase Storage
            </h3>
            <p className="text-xs text-[#696B77] mt-0.5">
              Upload one or more photos (auto-compressed WebP, max 1920px). Uploads stage securely in{' '}
              <code className="font-mono">property-media-private</code> and promote to{' '}
              <code className="font-mono">property-media-public</code> only when approved and published.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] cursor-pointer shrink-0">
            <Upload className="w-3.5 h-3.5" />
            <span>{uploadingPhoto ? 'Uploading...' : 'Upload Photos'}</span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={uploadingPhoto}
              onChange={(e) => {
                void handleGalleryUpload(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>
        </div>

        {/* Drag-and-Drop Multi-Photo Upload Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsPhotoDragOver(true);
          }}
          onDragLeave={() => setIsPhotoDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsPhotoDragOver(false);
            if (!uploadingPhoto && e.dataTransfer.files?.length) {
              void handleGalleryUpload(e.dataTransfer.files);
            }
          }}
          className={`p-4 rounded-xl border border-dashed text-center transition-colors ${
            isPhotoDragOver
              ? 'border-[#6500B5] bg-[#F3EEFA]'
              : 'border-[#C5B3E6] bg-[#F8F8FC]'
          }`}
        >
          <p className="text-xs text-[#4B4D57]">
            Drag and drop JPG, PNG, or WebP property photos here, or click{' '}
            <strong className="text-[#6500B5]">Upload Photos</strong> above. Photo #1 is always your designated Cover Photo.
          </p>

          {!isSupabaseConfigured && (
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-[11px] text-[#696B77] pt-2.5">
              <span>Demo preview samples:</span>
              {SAMPLE_IMAGE_CHOICES.slice(0, 4).map((sample) => (
                <button
                  key={sample.path}
                  type="button"
                  onClick={() => {
                    setImages((prev) =>
                      sortImagesCoverFirst([
                        ...prev,
                        {
                          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                          url: sample.path,
                          caption: sample.label,
                          isCover: prev.length === 0,
                          sortOrder: prev.length,
                          isApprovedPublic: visibility === 'Published',
                          storageBucket:
                            visibility === 'Published'
                              ? 'property-media-public'
                              : 'property-media-private',
                        },
                      ])
                    );
                  }}
                  className="px-2 py-0.5 bg-white border border-[#E6E6EF] rounded text-[#4B4D57] hover:text-[#6500B5] cursor-pointer"
                >
                  + {sample.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {uploadProgress && (
          <div className="p-3 rounded-lg border border-[#DCD0F0] bg-[#F3EEFA] space-y-1.5">
            <div className="flex items-center justify-between text-xs text-[#311A4D]">
              <span className="font-medium truncate">
                Photo {uploadProgress.current} of {uploadProgress.total} · {uploadProgress.stage}
              </span>
              <span className="font-mono font-semibold shrink-0">{uploadProgress.percent}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white overflow-hidden">
              <div
                className="h-full bg-[#6500B5] transition-all duration-150"
                style={{width: `${uploadProgress.percent}%`}}
              />
            </div>
          </div>
        )}

        {photoFeedback && (
          <p className="text-xs text-[#6500B5] bg-[#F3EEFA] border border-[#DCD0F0] rounded-lg px-3 py-2">
            {photoFeedback}
          </p>
        )}

        {photoUploadErrors.length > 0 && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 space-y-1">
            {photoUploadErrors.map((msg, i) => (
              <p key={i} className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                <span>{msg}</span>
              </p>
            ))}
          </div>
        )}

        {images.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {images.map((img, index) => {
              const stats = imageOptimizationStats[img.id];
              const isCover = index === 0 || img.isCover;
              return (
                <div
                  key={img.id}
                  draggable
                  onDragStart={() => setDragImageIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropImage(index)}
                  className={`p-3 rounded-xl border bg-[#F8F8FC] flex gap-3 items-start transition-colors ${
                    dragImageIndex === index
                      ? 'border-[#6500B5] bg-[#F3EEFA]'
                      : isCover
                        ? 'border-[#6500B5]/50'
                        : 'border-[#E6E6EF]'
                  }`}
                >
                  <div className="pt-1 text-[#696B77] cursor-grab" title="Drag to reorder">
                    <GripVertical className="w-4 h-4" />
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setPreviewPhoto({
                        url: img.url,
                        caption: img.caption || (isCover ? 'Cover Photo' : `Gallery Photo #${index + 1}`),
                      })
                    }
                    title="Preview photo"
                    className="relative w-28 h-22 rounded-lg overflow-hidden border border-[#D6D6E4] bg-white shrink-0 cursor-pointer"
                  >
                    <PropertyImage
                      src={img.url}
                      alt={img.caption || `Property photo ${index + 1}`}
                      loading="eager"
                      compact
                      className="w-full h-full object-cover"
                    />
                    <span
                      className={`absolute top-1 left-1 px-1.5 py-0.5 text-[10px] font-semibold rounded text-white ${
                        isCover ? 'bg-[#6500B5]' : 'bg-[#10169C]'
                      }`}
                    >
                      {isCover ? 'Cover #1' : `#${index + 1}`}
                    </span>
                  </button>

                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      type="text"
                      value={img.caption}
                      onChange={(e) => {
                        const val = e.target.value;
                        setImages((prev) =>
                          prev.map((item) => (item.id === img.id ? {...item, caption: val} : item))
                        );
                      }}
                      placeholder="Photo caption (e.g., Road frontage view)..."
                      className="w-full h-8 px-2.5 text-xs bg-white border border-[#D6D6E4] rounded focus:outline-none focus:border-[#6500B5]"
                    />

                    {stats ? (
                      <p className="text-[11px] font-mono text-[#4B4D57] truncate">
                        {formatFileSize(stats.originalBytes)} → {formatFileSize(stats.optimizedBytes)} ({stats.width}×{stats.height}px)
                      </p>
                    ) : (
                      <p className="text-[11px] font-mono text-[#696B77] truncate">
                        {img.storageBucket}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      <button
                        type="button"
                        onClick={() => {
                          const nextApproved = !img.isApprovedPublic;
                          setExplicitlyLockedImageIds((prev) => {
                            const next = new Set(prev);
                            if (nextApproved) next.delete(img.id);
                            else next.add(img.id);
                            return next;
                          });
                          setImages((prev) =>
                            prev.map((item) =>
                              item.id === img.id
                                ? {...item, isApprovedPublic: nextApproved}
                                : item
                            )
                          );
                        }}
                        className={`inline-flex items-center gap-1 px-2 py-1 border rounded cursor-pointer ${
                          img.isApprovedPublic
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-amber-50 border-amber-200 text-amber-900'
                        }`}
                      >
                        {img.isApprovedPublic ? (
                          <>
                            <Eye className="w-3 h-3" />
                            <span>Public</span>
                          </>
                        ) : (
                          <>
                            <Lock className="w-3 h-3" />
                            <span>Private</span>
                          </>
                        )}
                      </button>

                      {!isCover && (
                        <button
                          type="button"
                          onClick={() => handleSetCoverPhoto(img.id)}
                          className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-[#D6D6E4] rounded text-[#6500B5] hover:bg-[#F3EEFA] cursor-pointer"
                        >
                          <Star className="w-3 h-3" />
                          <span>Set Cover</span>
                        </button>
                      )}

                      <label className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-[#D6D6E4] rounded hover:border-[#6500B5] hover:text-[#6500B5] cursor-pointer">
                        <RefreshCw className="w-3 h-3" />
                        <span>Replace</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          disabled={uploadingPhoto}
                          onChange={(e) => {
                            void handleReplaceSinglePhoto(img.id, e.target.files?.[0]);
                            e.target.value = '';
                          }}
                          className="hidden"
                        />
                      </label>

                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => handleMoveImage(index, -1)}
                        aria-label="Move photo up"
                        className="w-6 h-6 bg-white border border-[#D6D6E4] rounded inline-flex items-center justify-center disabled:opacity-40 cursor-pointer"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={index === images.length - 1}
                        onClick={() => handleMoveImage(index, 1)}
                        aria-label="Move photo down"
                        className="w-6 h-6 bg-white border border-[#D6D6E4] rounded inline-flex items-center justify-center disabled:opacity-40 cursor-pointer"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRemoveImage(img.id)}
                        aria-label="Remove photo"
                        className="w-6 h-6 bg-white border border-[#D6D6E4] rounded inline-flex items-center justify-center text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {images.length === 0 && (
          <p className="text-xs text-[#696B77] text-center py-2">
            No property photos uploaded yet. Upload at least one approved photo before publishing.
          </p>
        )}
      </section>

      {/* Section 5: Multiple Property Videos (YouTube & Google Drive) */}
      <section className="p-5 rounded-xl border border-[#E6E6EF] bg-white space-y-4">
        <div className="pb-3 border-b border-[#EFEFF6]">
          <h3 className="font-display text-sm font-bold text-[#202124]">
            5. Property Videos ({videos.length}) · YouTube &amp; Google Drive Links
          </h3>
          <p className="text-xs text-[#696B77] mt-0.5">
            Paste public or unlisted YouTube links or Google Drive video sharing links. Providers are detected automatically and rendered via lazy-loaded iframes.
          </p>
        </div>

        <div className="p-3 rounded-lg border border-[#DCD0F0] bg-[#F8F8FC] text-[11px] text-[#311A4D]">
          <strong>Google Drive sharing notice:</strong> Set the video file access in Google Drive to{' '}
          <span className="font-semibold">&ldquo;Anyone with the link · Viewer&rdquo;</span> so buyers can play the embedded preview. Videos are never downloaded or duplicated onto this server.
        </div>

        {videos.length > 0 && (
          <div className="space-y-3">
            {videos.map((vid, idx) => {
              const parsed = parsePropertyVideoUrl(vid.url);
              const isDrive = parsed?.provider === 'google_drive';
              const isPreviewing = previewVideoId === vid.id;
              return (
                <div
                  key={vid.id}
                  className="p-3 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] space-y-3"
                >
                  <div className="flex flex-col sm:flex-row gap-3 items-start">
                    <div className="w-36 aspect-video rounded-md overflow-hidden bg-[#202124] shrink-0 relative">
                      {parsed?.thumbnailUrl ? (
                        <img
                          src={parsed.thumbnailUrl}
                          alt={vid.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#241A3B] to-[#10169C] flex flex-col items-center justify-center text-white p-2 text-center">
                          {isDrive ? (
                            <HardDrive className="w-4 h-4 text-[#C5B3E6] mb-1" />
                          ) : (
                            <Video className="w-4 h-4 text-[#C5B3E6] mb-1" />
                          )}
                          <span className="text-[10px] font-mono leading-tight">
                            {parsed ? parsed.providerLabel : 'Invalid URL'}
                          </span>
                        </div>
                      )}
                      {parsed && (
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 text-[10px] font-medium bg-black/75 text-white rounded">
                          {parsed.providerLabel}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5 w-full">
                      <input
                        type="text"
                        value={vid.title}
                        onChange={(e) => {
                          const val = e.target.value;
                          setVideos((prev) =>
                            prev.map((item, i) => (i === idx ? {...item, title: val} : item))
                          );
                        }}
                        placeholder="Video title..."
                        className="w-full h-8 px-2.5 text-xs font-semibold bg-white border border-[#D6D6E4] rounded focus:outline-none focus:border-[#6500B5]"
                      />
                      <input
                        type="text"
                        value={vid.description}
                        onChange={(e) => {
                          const val = e.target.value;
                          setVideos((prev) =>
                            prev.map((item, i) => (i === idx ? {...item, description: val} : item))
                          );
                        }}
                        placeholder="Short video description..."
                        className="w-full h-8 px-2.5 text-xs bg-white border border-[#D6D6E4] rounded focus:outline-none focus:border-[#6500B5]"
                      />
                      <p className="text-[11px] font-mono text-[#696B77] truncate">
                        {parsed
                          ? `${parsed.providerLabel} ID: ${parsed.videoId} · ${parsed.embedUrl}`
                          : `Invalid URL: ${vid.url}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewVideoId((curr) => (curr === vid.id ? null : vid.id))
                        }
                        className="h-7 px-2 bg-white border border-[#D6D6E4] rounded inline-flex items-center gap-1 text-[11px] font-medium text-[#6500B5] hover:border-[#6500B5] cursor-pointer"
                      >
                        <Play className="w-3 h-3" />
                        <span>{isPreviewing ? 'Hide' : 'Preview'}</span>
                      </button>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMoveVideo(idx, -1)}
                        aria-label="Move video up"
                        className="w-7 h-7 bg-white border border-[#D6D6E4] rounded inline-flex items-center justify-center disabled:opacity-40 cursor-pointer"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === videos.length - 1}
                        onClick={() => handleMoveVideo(idx, 1)}
                        aria-label="Move video down"
                        className="w-7 h-7 bg-white border border-[#D6D6E4] rounded inline-flex items-center justify-center disabled:opacity-40 cursor-pointer"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setVideos((prev) => prev.filter((_, i) => i !== idx))}
                        aria-label="Remove video"
                        className="w-7 h-7 bg-white border border-[#D6D6E4] rounded inline-flex items-center justify-center text-red-700 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isPreviewing && (
                    <div className="pt-2 border-t border-[#E6E6EF]">
                      <PropertyVideoPlayer url={vid.url} title={vid.title} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <input
              type="url"
              value={newVideoUrl}
              onChange={(e) => setNewVideoUrl(e.target.value)}
              placeholder="YouTube or Google Drive link (https://drive.google.com/file/d/.../view)"
              className="sm:col-span-5 h-9 px-3 text-xs border border-[#D6D6E4] rounded-md focus:outline-none focus:border-[#6500B5]"
            />
            <input
              type="text"
              value={newVideoTitle}
              onChange={(e) => setNewVideoTitle(e.target.value)}
              placeholder="Video title (e.g., Drone Boundary Flyover)"
              className="sm:col-span-3 h-9 px-3 text-xs border border-[#D6D6E4] rounded-md focus:outline-none focus:border-[#6500B5]"
            />
            <input
              type="text"
              value={newVideoDesc}
              onChange={(e) => setNewVideoDesc(e.target.value)}
              placeholder="Brief description"
              className="sm:col-span-2 h-9 px-3 text-xs border border-[#D6D6E4] rounded-md focus:outline-none focus:border-[#6500B5]"
            />
            <button
              type="button"
              onClick={handleAddVideo}
              className="sm:col-span-2 h-9 px-3 text-xs font-medium text-white bg-[#6500B5] rounded-md hover:bg-[#540098] cursor-pointer"
            >
              + Add Video
            </button>
          </div>

          {newVideoUrl.trim() && (
            <p
              className={`text-[11px] font-mono ${
                parsedNewVideo ? 'text-[#6500B5]' : 'text-red-700'
              }`}
            >
              {parsedNewVideo
                ? `Detected ${parsedNewVideo.providerLabel} (${parsedNewVideo.videoId}) → Embed: ${parsedNewVideo.embedUrl}`
                : 'Unrecognized or unsupported video URL. Use a valid YouTube link or Google Drive /file/d/<ID>/view sharing link.'}
            </p>
          )}
        </div>

        {/* Disabled Direct Video Upload Placeholder */}
        <div className="p-3 rounded-lg border border-dashed border-[#D6D6E4] bg-[#F8F8FC] flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-[#4B4D57]">
              Direct Video File Upload (Disabled)
            </p>
            <p className="text-[11px] text-[#696B77]">
              Architecture supports direct MP4/MOV storage (`property_videos.source_type = &apos;direct&apos;`), paused until Supabase Storage bandwidth limits and costs are approved.
            </p>
          </div>
          <button
            type="button"
            disabled
            className="px-3 py-1.5 text-xs font-medium text-[#696B77] bg-white border border-[#E6E6EF] rounded-md opacity-60 cursor-not-allowed whitespace-nowrap"
          >
            Upload Video (Locked)
          </button>
        </div>
      </section>

      {/* Section 6: Property Files & Documents (Private by default) */}
      <section className="p-5 rounded-xl border border-[#E6E6EF] bg-white space-y-4">
        <div className="pb-3 border-b border-[#EFEFF6]">
          <h3 className="font-display text-sm font-bold text-[#202124]">
            6. Property Files &amp; Documents ({documents.length})
          </h3>
          <p className="text-xs text-[#696B77] mt-0.5">
            New uploads strictly default to <strong>Private (Admin Only)</strong> inside <code className="font-mono">property-media-private</code> using short-lived signed URLs. Only files explicitly marked <strong>Public</strong> appear to buyers.
          </p>
        </div>

        {documents.length > 0 && (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="p-3 rounded-lg border border-[#E6E6EF] bg-[#F8F8FC] flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <FileText className="w-4 h-4 text-[#6500B5] shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#202124] truncate">
                      {doc.title}
                    </p>
                    <p className="text-[11px] text-[#696B77]">
                      {doc.category} · {doc.fileName} · {formatFileSize(doc.fileSizeBytes)} ·{' '}
                      <span className="font-mono">{doc.storageBucket}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <select
                    aria-label={`Visibility for ${doc.title}`}
                    value={doc.visibility}
                    onChange={(e) => {
                      const nextVis = e.target.value as DocumentVisibility;
                      // Keep existing storageBucket untouched until Save so prepareDocumentsForVisibility
                      // cleanly promotes or demotes+deletes from public Storage.
                      setDocuments((prev) =>
                        prev.map((item) =>
                          item.id === doc.id ? {...item, visibility: nextVis} : item
                        )
                      );
                    }}
                    className={`h-8 px-2 text-xs font-medium rounded border focus:outline-none ${
                      doc.visibility === 'Private'
                        ? 'bg-amber-50 border-amber-200 text-amber-900'
                        : 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    }`}
                  >
                    <option value="Private">Private (Admin Only)</option>
                    <option value="Public">Public (Buyer Download)</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => void handleOpenAdminDoc(doc)}
                    className="h-8 px-2.5 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded hover:border-[#6500B5] cursor-pointer"
                  >
                    Open
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setDocuments((prev) => prev.filter((item) => item.id !== doc.id))
                    }
                    aria-label={`Delete ${doc.title}`}
                    className="w-8 h-8 bg-white border border-[#D6D6E4] rounded inline-flex items-center justify-center text-red-700 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
          <div className="sm:col-span-3">
            <label className="block text-[11px] font-medium text-[#4B4D57] mb-1">Category</label>
            <select
              value={docCategory}
              onChange={(e) => setDocCategory(e.target.value as DocumentCategory)}
              className="w-full h-9 px-2.5 text-xs bg-white border border-[#D6D6E4] rounded-md"
            >
              {DOCUMENT_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-4">
            <label className="block text-[11px] font-medium text-[#4B4D57] mb-1">
              Document Title
            </label>
            <input
              type="text"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="e.g., Certified Survey Plan (PSD-04-2026)"
              className="w-full h-9 px-2.5 text-xs border border-[#D6D6E4] rounded-md"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="block text-[11px] font-medium text-[#4B4D57] mb-1">
              Access Policy
            </label>
            <select
              value={docVisibility}
              onChange={(e) => setDocVisibility(e.target.value as DocumentVisibility)}
              className="w-full h-9 px-2.5 text-xs bg-white border border-[#D6D6E4] rounded-md"
            >
              <option value="Private">Private (Admin Only · Default)</option>
              <option value="Public">Public (Buyer Downloadable)</option>
            </select>
          </div>
          <label className="sm:col-span-2 h-9 px-3 inline-flex items-center justify-center gap-1.5 text-xs font-medium text-white bg-[#10169C] rounded-md hover:opacity-95 cursor-pointer whitespace-nowrap">
            <Upload className="w-3.5 h-3.5" />
            <span>{uploadingDoc ? 'Uploading...' : 'Attach File'}</span>
            <input
              type="file"
              accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp"
              disabled={uploadingDoc}
              onChange={(e) => {
                void handleUploadDocument(e.target.files?.[0]);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>
        </div>
      </section>

      {/* Section 7: Assigned Advisor */}
      <section className="p-5 rounded-xl border border-[#E6E6EF] bg-white space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#EFEFF6]">
          <h3 className="font-display text-sm font-bold text-[#202124]">
            7. Assigned Property Advisor
          </h3>
          <span className="text-[11px] text-[#696B77]">
            Required before publishing (no placeholder defaults are used)
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Advisor / Agency Name *
            </label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g., Ben Micubo"
              className="w-full h-9 px-3 text-xs border border-[#D6D6E4] rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Phone Number *
            </label>
            <input
              type="text"
              value={agentPhone}
              onChange={(e) => setAgentPhone(e.target.value)}
              placeholder="+63 9XX XXX XXXX"
              className="w-full h-9 px-3 text-xs border border-[#D6D6E4] rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              WhatsApp Digits *
            </label>
            <input
              type="text"
              value={agentWhatsapp}
              onChange={(e) => setAgentWhatsapp(e.target.value)}
              placeholder="639XXXXXXXXX"
              className="w-full h-9 px-3 font-mono text-xs border border-[#D6D6E4] rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Messenger Handle (or WhatsApp)
            </label>
            <input
              type="text"
              value={agentMessenger}
              onChange={(e) => setAgentMessenger(e.target.value)}
              placeholder="facebook.page.handle"
              className="w-full h-9 px-3 text-xs border border-[#D6D6E4] rounded-md"
            />
          </div>
        </div>
      </section>

      {/* Workflow Action Bar: Draft -> Preview -> Publish -> Update -> Archive */}
      <div className="p-4 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="h-10 px-4 text-xs font-medium text-[#4B4D57] bg-white border border-[#D6D6E4] rounded-lg hover:text-[#202124] cursor-pointer"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-1.5 h-10 px-4 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-lg hover:border-[#6500B5] cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-[#6500B5]" />
            <span>Preview Dossier</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {isEditing && visibility !== 'Archived' && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void submitWithVisibility('Archived')}
              className="inline-flex items-center gap-1.5 h-10 px-4 text-xs font-medium text-[#4B4D57] bg-white border border-[#D6D6E4] rounded-lg hover:text-[#202124] disabled:opacity-60 cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Archive</span>
            </button>
          )}

          <button
            type="button"
            disabled={saving}
            onClick={() => void submitWithVisibility('Draft')}
            className="inline-flex items-center gap-1.5 h-10 px-4 text-xs font-medium text-[#202124] bg-white border border-[#6500B5] rounded-lg hover:bg-[#F3EEFA] disabled:opacity-60 cursor-pointer"
          >
            <span>{saving ? 'Saving...' : 'Save as Draft'}</span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => void submitWithVisibility('Published')}
            className="inline-flex items-center gap-1.5 h-10 px-5 text-xs font-medium text-white bg-gradient-to-r from-[#6500B5] to-[#10169C] rounded-lg hover:opacity-95 disabled:opacity-60 cursor-pointer"
          >
            {visibility === 'Published' && isEditing ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{saving ? 'Updating...' : 'Update Published Listing'}</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>{saving ? 'Publishing...' : 'Publish Property'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Inline Photo Fullscreen Preview */}
      {previewPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] bg-black/85 flex flex-col items-center justify-center p-4"
        >
          <button
            type="button"
            onClick={() => setPreviewPhoto(null)}
            aria-label="Close photo preview"
            className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
          <PropertyImage
            src={previewPhoto.url}
            alt={previewPhoto.caption || 'Preview'}
            className="max-h-[80vh] w-auto object-contain rounded-lg"
          />
          {previewPhoto.caption && (
            <p className="mt-3 text-xs text-white/90">{previewPhoto.caption}</p>
          )}
        </div>
      )}

      {/* Pre-Publish Full Property Dossier Preview Modal */}
      {previewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Listing Preview"
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
        >
          <div className="bg-white border border-[#E6E6EF] rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#E6E6EF] bg-[#F3EEFA] flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#6500B5]">
                <Eye className="w-4 h-4" />
                <span>Pre-Publish Dossier Preview · {previewData.lotId}</span>
              </div>
              <div className="flex items-center gap-2">
                {isEditing && initialProperty && (
                  <Link
                    to={`/dossier/${encodeURIComponent(initialProperty.lotId)}${
                      initialProperty.visibility !== 'Published' ? '?preview=1' : ''
                    }`}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-white bg-[#1C1B19] rounded hover:bg-[#35322D] whitespace-nowrap"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#B89B6A]" />
                    <span>Open 5-Page A4 PDF</span>
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewOpen(false)}
                  className="w-8 h-8 rounded bg-white border border-[#DCD0F0] flex items-center justify-center text-[#202124] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto space-y-6">
              {previewData.photos[0] && (
                <div className="aspect-[16/9] w-full rounded-xl overflow-hidden border border-[#E6E6EF]">
                  <PropertyImage
                    src={previewData.photos[0]}
                    alt={previewData.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-mono text-[#10169C]">
                    {previewData.lotId} · {previewData.completeLocation || `${previewData.city}, ${previewData.province}`}
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold text-[#202124]">
                    {previewData.title || 'Untitled Property Listing'}
                  </h2>
                </div>
                <StatusIndicator status={previewData.status} />
              </div>

              <div className="flex flex-wrap items-baseline gap-6 border-y border-[#EFEFF6] py-4">
                <div>
                  <span className="text-xs text-[#696B77] block">Total Price</span>
                  <span className="font-display text-2xl font-bold text-[#202124] tabular-nums">
                    {formatPhp(previewData.priceTotalPhp)}
                  </span>
                  {previewData.isNegotiable && (
                    <span className="ml-2 text-xs text-[#6500B5] font-medium">Negotiable</span>
                  )}
                </div>
                <div>
                  <span className="text-xs text-[#696B77] block">Price / sqm</span>
                  <span className="font-mono text-base font-semibold text-[#6500B5] tabular-nums">
                    {formatPhp(previewData.pricePerSqm)} / sqm
                  </span>
                </div>
                <div>
                  <span className="text-xs text-[#696B77] block">Lot Area</span>
                  <span className="font-mono text-base font-semibold text-[#202124] tabular-nums">
                    {formatSqm(previewData.lotAreaSqm)}
                  </span>
                </div>
              </div>

              <p className="text-sm text-[#4B4D57] leading-relaxed">{previewData.description}</p>

              {previewData.videos.length > 0 && (
                <div className="space-y-4">
                  <h4 className="font-display text-sm font-bold text-[#202124]">
                    Attached Videos ({previewData.videos.length})
                  </h4>
                  {previewData.videos.map((v) => (
                    <div key={v.id} className="space-y-1.5">
                      <p className="text-xs font-semibold text-[#202124]">{v.title}</p>
                      <PropertyVideoPlayer url={v.url} title={v.title} />
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-[#696B77] space-y-1">
                <p>
                  Gallery photos: <strong>{previewData.images.filter((i) => i.isApprovedPublic).length}</strong>{' '}
                  approved public photo(s) ·{' '}
                  <strong>{previewData.images.filter((i) => !i.isApprovedPublic).length}</strong> private-only photo(s).
                </p>
                <p>
                  Public buyer documents shown on live page:{' '}
                  <strong>{previewData.documents.filter((d) => d.visibility === 'Public').length}</strong>{' '}
                  (Private admin-only docs:{' '}
                  <strong>{previewData.documents.filter((d) => d.visibility === 'Private').length}</strong>
                  )
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
