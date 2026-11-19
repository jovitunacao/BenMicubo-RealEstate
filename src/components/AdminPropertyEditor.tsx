import React, {useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Eye,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Lock,
  Plus,
  RefreshCw,
  Send,
  Star,
  Trash2,
  Upload,
  Video,
  X,
} from 'lucide-react';
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
import {extractYouTubeVideoId, getYouTubeThumbnailUrl} from '../utils/youtube';
import {optimizePropertyImage} from '../utils/imageProcessor';
import {
  getAuthorizedDocumentDownloadUrl,
  uploadOptimizedPropertyImage,
  uploadPropertyDocumentFile,
} from '../services/storageService';
import {validatePropertyForPublish} from '../services/propertyService';
import {validateCanonicalSiteUrl} from '../utils/siteUrl';
import {PropertyImage} from './PropertyImage';
import {StatusIndicator} from './StatusIndicator';
import {YouTubePlayer} from './YouTubePlayer';

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
  const [latitude, setLatitude] = useState(String(initialProperty?.latitude ?? 14.1228));
  const [longitude, setLongitude] = useState(String(initialProperty?.longitude ?? 120.9856));
  const [googleMapsUrl, setGoogleMapsUrl] = useState(
    initialProperty?.googleMapsUrl ??
      'https://www.google.com/maps/search/?api=1&query=14.1228,120.9856'
  );

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
  const [dimensions, setDimensions] = useState(initialProperty?.dimensions ?? '20m × 25m');
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

  // Media: Photos
  const [images, setImages] = useState<PropertyImageItem[]>(() => {
    if (initialProperty?.images && initialProperty.images.length > 0) {
      return initialProperty.images;
    }
    return [
      {
        id: `img-init-${Date.now()}`,
        url: '/images/laguna_estate.svg',
        caption: 'Primary aerial site perspective',
        isCover: true,
        sortOrder: 0,
        isApprovedPublic: false,
        storageBucket: 'property-media-private',
      },
    ];
  });
  const [dragImageIndex, setDragImageIndex] = useState<number | null>(null);
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoFeedback, setPhotoFeedback] = useState('');
  const [previewPhoto, setPreviewPhoto] = useState<PropertyImageItem | null>(null);

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

  const canonicalCheck = validateCanonicalSiteUrl(siteSettings.canonicalSiteUrl);

  const buildPropertyInput = (targetVisibility: PropertyVisibility): PropertyInput => {
    const normalizedLotId = (isEditing && initialProperty ? initialProperty.lotId : lotId)
      .trim()
      .toUpperCase();

    const orderedImages = [...images]
      .sort((a, b) => {
        if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;
        return a.sortOrder - b.sortOrder;
      })
      .map((img, idx) => ({
        ...img,
        sortOrder: idx,
        isCover: idx === 0 || img.isCover,
        isApprovedPublic:
          targetVisibility === 'Published' ? img.isApprovedPublic !== false : false,
        storageBucket:
          targetVisibility === 'Published' && img.isApprovedPublic !== false
            ? ('property-media-public' as const)
            : ('property-media-private' as const),
      }));

    if (orderedImages.length > 0 && !orderedImages.some((img) => img.isCover)) {
      orderedImages[0].isCover = true;
    }

    const normalizedVideos = videos.map((v, idx) => ({
      ...v,
      sortOrder: idx,
    }));

    const resolvedCompleteLocation =
      completeLocation.trim() ||
      [barangay.trim(), city.trim(), province.trim()].filter(Boolean).join(', ');

    return {
      lotId: normalizedLotId,
      title: title.trim(),
      barangay: barangay.trim() || 'Brgy. Central',
      city: city.trim(),
      province: province.trim(),
      region: region.trim() || 'Philippines',
      completeLocation: resolvedCompleteLocation,
      lotAreaSqm: numericArea,
      dimensions: dimensions.trim() || 'Standard parcel',
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
      photos:
        orderedImages.length > 0
          ? orderedImages.map((img) => img.url)
          : ['/images/survey_plan.svg'],
      images: orderedImages,
      youtubeUrl: normalizedVideos[0]?.url || '',
      videos: normalizedVideos,
      documents,
      latitude: Number(latitude) || 14.5995,
      longitude: Number(longitude) || 120.9842,
      googleMapsUrl:
        googleMapsUrl.trim() ||
        `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
      agentName: agentName.trim() || siteSettings.defaultAgentName,
      agentPhone: agentPhone.trim() || siteSettings.defaultAgentPhone,
      agentWhatsapp: agentWhatsapp.trim() || siteSettings.defaultAgentWhatsapp,
      agentMessenger: agentMessenger.trim() || siteSettings.defaultAgentMessenger,
      publishedAt:
        targetVisibility === 'Published'
          ? initialProperty?.publishedAt || new Date().toISOString()
          : initialProperty?.publishedAt,
    };
  };

  const handleMultiPhotoUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploadingPhoto(true);
    setPhotoFeedback('');
    setError('');
    try {
      const targetLot = (isEditing && initialProperty ? initialProperty.lotId : lotId) || 'LOT-NEW';
      const approvedPublic = visibility === 'Published';
      const uploadedItems: PropertyImageItem[] = [];
      let totalSavedKb = 0;

      for (const file of Array.from(files)) {
        const optimized = await optimizePropertyImage(file);
        totalSavedKb += Math.max(
          0,
          Math.round((optimized.originalBytes - optimized.optimizedBytes) / 1024)
        );
        const uploaded = await uploadOptimizedPropertyImage(
          targetLot,
          optimized.blob,
          optimized.fileName,
          optimized.mimeType,
          approvedPublic,
          optimized.dataUrl
        );
        uploadedItems.push({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          url: uploaded.url,
          caption: '',
          isCover: images.length === 0 && uploadedItems.length === 0,
          sortOrder: images.length + uploadedItems.length,
          isApprovedPublic: approvedPublic,
          storageBucket: uploaded.storageBucket,
          storagePath: uploaded.storagePath,
        });
      }

      setImages((prev) => [...prev, ...uploadedItems]);
      setPhotoFeedback(
        `Optimized & attached ${uploadedItems.length} photo(s) (~${totalSavedKb} KB reduced).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload selected images.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleReplacePhoto = async (index: number, file: File | undefined) => {
    if (!file) return;
    setUploadingPhoto(true);
    setError('');
    try {
      const targetLot = (isEditing && initialProperty ? initialProperty.lotId : lotId) || 'LOT-NEW';
      const existing = images[index];
      const optimized = await optimizePropertyImage(file);
      const uploaded = await uploadOptimizedPropertyImage(
        targetLot,
        optimized.blob,
        optimized.fileName,
        optimized.mimeType,
        existing.isApprovedPublic,
        optimized.dataUrl
      );
      setImages((prev) =>
        prev.map((item, idx) =>
          idx === index
            ? {
                ...item,
                url: uploaded.url,
                storageBucket: uploaded.storageBucket,
                storagePath: uploaded.storagePath,
              }
            : item
        )
      );
      setPhotoFeedback(`Replaced image ${index + 1} (${optimized.width}×${optimized.height}px).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to replace photo.');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleSetCover = (index: number) => {
    setImages((prev) => {
      const target = prev[index];
      if (!target) return prev;
      const reordered = [target, ...prev.filter((_, i) => i !== index)];
      return reordered.map((item, idx) => ({
        ...item,
        isCover: idx === 0,
        sortOrder: idx,
      }));
    });
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

  const handleAddPhotoUrl = () => {
    const trimmed = newPhotoUrl.trim();
    if (!trimmed) return;
    setImages((prev) => [
      ...prev,
      {
        id: `img-${Date.now()}`,
        url: trimmed,
        caption: '',
        isCover: prev.length === 0,
        sortOrder: prev.length,
        isApprovedPublic: visibility === 'Published',
        storageBucket:
          visibility === 'Published' ? 'property-media-public' : 'property-media-private',
      },
    ]);
    setNewPhotoUrl('');
  };

  const handleAddVideo = () => {
    const trimmed = newVideoUrl.trim();
    if (!trimmed) return;
    const ytId = extractYouTubeVideoId(trimmed);
    if (!ytId) {
      setError('Enter a valid YouTube watch, share (youtu.be), unlisted, or embed URL.');
      return;
    }
    setError('');
    setVideos((prev) => [
      ...prev,
      {
        id: `vid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sourceType: 'youtube',
        url: trimmed,
        title: newVideoTitle.trim() || `Property Video ${prev.length + 1}`,
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
      const uploaded = await uploadPropertyDocumentFile(targetLot, file, chosenVis);
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

  const handleSyncMapsUrl = () => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      setGoogleMapsUrl(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
    }
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

    const input = buildPropertyInput(targetVisibility);

    if (targetVisibility === 'Published') {
      const publishErrors = validatePropertyForPublish(input, siteSettings.canonicalSiteUrl);
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
        <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p>
              <strong>Publishing Guardrail:</strong> {canonicalCheck.reason} You can save this property as a <strong>Draft</strong> now, then configure your HTTPS production domain in Settings before publishing.
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
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Latitude</label>
            <input
              type="number"
              step="any"
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              className="w-full h-10 px-3 font-mono text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Longitude</label>
            <input
              type="number"
              step="any"
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              className="w-full h-10 px-3 font-mono text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>
          <div className="sm:col-span-6 flex gap-2">
            <input
              type="url"
              value={googleMapsUrl}
              onChange={(e) => setGoogleMapsUrl(e.target.value)}
              placeholder="https://www.google.com/maps/..."
              aria-label="Google Maps URL"
              className="flex-1 h-10 px-3 text-xs border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
            <button
              type="button"
              onClick={handleSyncMapsUrl}
              className="h-10 px-3 text-xs font-medium text-[#202124] bg-[#F8F8FC] border border-[#D6D6E4] rounded-lg hover:bg-[#EFEFF7] whitespace-nowrap cursor-pointer"
            >
              Sync GPS Pin
            </button>
          </div>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Lot Dimensions
            </label>
            <input
              type="text"
              value={dimensions}
              onChange={(e) => setDimensions(e.target.value)}
              placeholder="25m frontage × 48m depth"
              className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
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

      {/* Section 4: Photo Gallery Management */}
      <section className="p-5 rounded-xl border border-[#E6E6EF] bg-white space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#EFEFF6]">
          <div>
            <h3 className="font-display text-sm font-bold text-[#202124]">
              4. Photo Gallery ({images.length}) · Auto-Optimized Web Display
            </h3>
            <p className="text-xs text-[#696B77] mt-0.5">
              Drag cards to reorder. Unpublished photos use private admin storage; approved photos move to public bucket upon Publish.
            </p>
          </div>
          <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>{uploadingPhoto ? 'Optimizing...' : 'Upload JPG / PNG / WebP'}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={uploadingPhoto}
              onChange={(e) => {
                void handleMultiPhotoUpload(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </label>
        </div>

        {photoFeedback && (
          <p className="text-xs text-[#6500B5] bg-[#F3EEFA] border border-[#DCD0F0] rounded-lg px-3 py-2">
            {photoFeedback}
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {images.map((img, index) => (
            <div
              key={img.id}
              draggable
              onDragStart={() => setDragImageIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDropImage(index)}
              className={`p-3 rounded-xl border bg-[#F8F8FC] flex gap-3 items-start transition-colors ${
                dragImageIndex === index ? 'border-[#6500B5] bg-[#F3EEFA]' : 'border-[#E6E6EF]'
              }`}
            >
              <div className="pt-1 text-[#696B77] cursor-grab" title="Drag to reorder">
                <GripVertical className="w-4 h-4" />
              </div>

              <button
                type="button"
                onClick={() => setPreviewPhoto(img)}
                title="Preview full image"
                className="relative w-24 h-20 rounded-lg overflow-hidden border border-[#D6D6E4] bg-white shrink-0 cursor-pointer"
              >
                <PropertyImage
                  src={img.url}
                  alt={img.caption || `Property photo ${index + 1}`}
                  className="w-full h-full object-cover"
                />
                {img.isCover && (
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] font-semibold bg-[#6500B5] text-white rounded">
                    Cover
                  </span>
                )}
              </button>

              <div className="flex-1 min-w-0 space-y-2">
                <input
                  type="text"
                  value={img.caption}
                  onChange={(e) => {
                    const val = e.target.value;
                    setImages((prev) =>
                      prev.map((item, idx) => (idx === index ? {...item, caption: val} : item))
                    );
                  }}
                  placeholder="Photo caption (e.g., 25m concrete road frontage)..."
                  className="w-full h-8 px-2.5 text-xs bg-white border border-[#D6D6E4] rounded focus:outline-none focus:border-[#6500B5]"
                />

                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  {!img.isCover && (
                    <button
                      type="button"
                      onClick={() => handleSetCover(index)}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-[#D6D6E4] rounded hover:border-[#6500B5] hover:text-[#6500B5] cursor-pointer"
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
                      onChange={(e) => {
                        void handleReplacePhoto(index, e.target.files?.[0]);
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
                    onClick={() =>
                      setImages((prev) =>
                        prev
                          .filter((_, idx) => idx !== index)
                          .map((it, i) => ({...it, isCover: i === 0, sortOrder: i}))
                      )
                    }
                    aria-label="Delete photo"
                    className="w-6 h-6 bg-white border border-[#D6D6E4] rounded inline-flex items-center justify-center text-red-700 hover:bg-red-50 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            type="url"
            value={newPhotoUrl}
            onChange={(e) => setNewPhotoUrl(e.target.value)}
            placeholder="Paste HTTPS image URL..."
            className="flex-1 h-9 px-3 text-xs border border-[#D6D6E4] rounded-md focus:outline-none focus:border-[#6500B5]"
          />
          <button
            type="button"
            onClick={handleAddPhotoUrl}
            className="inline-flex items-center gap-1 px-3 h-9 text-xs font-medium text-[#202124] bg-[#F8F8FC] border border-[#D6D6E4] rounded-md hover:border-[#6500B5] cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-[#6500B5]" />
            <span>Add URL</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#696B77]">
          <span>Sample architectural visuals:</span>
          {SAMPLE_IMAGE_CHOICES.map((sample) => (
            <button
              key={sample.path}
              type="button"
              onClick={() =>
                setImages((prev) => [
                  ...prev,
                  {
                    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
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
              }
              className="px-2 py-0.5 bg-[#F8F8FC] border border-[#E6E6EF] rounded text-[#4B4D57] hover:text-[#6500B5] cursor-pointer"
            >
              + {sample.label}
            </button>
          ))}
        </div>
      </section>

      {/* Section 5: Multiple Property Videos */}
      <section className="p-5 rounded-xl border border-[#E6E6EF] bg-white space-y-4">
        <div className="pb-3 border-b border-[#EFEFF6]">
          <h3 className="font-display text-sm font-bold text-[#202124]">
            5. Property Videos ({videos.length}) · Public &amp; Unlisted YouTube Links
          </h3>
          <p className="text-xs text-[#696B77] mt-0.5">
            Attach multiple drone flights, road access tours, or neighborhood walkthroughs with lazy-loaded playback.
          </p>
        </div>

        {videos.length > 0 && (
          <div className="space-y-2.5">
            {videos.map((vid, idx) => {
              const ytId = extractYouTubeVideoId(vid.url);
              return (
                <div
                  key={vid.id}
                  className="p-3 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] flex flex-col sm:flex-row gap-3 items-start"
                >
                  <div className="w-32 aspect-video rounded-md overflow-hidden bg-[#202124] shrink-0">
                    {ytId ? (
                      <img
                        src={getYouTubeThumbnailUrl(ytId)}
                        alt={vid.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-white">
                        <Video className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <input
                      type="text"
                      value={vid.title}
                      onChange={(e) => {
                        const val = e.target.value;
                        setVideos((prev) =>
                          prev.map((item, i) => (i === idx ? {...item, title: val} : item))
                        );
                      }}
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
                    <p className="text-[11px] font-mono text-[#696B77] truncate">{vid.url}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
          <input
            type="url"
            value={newVideoUrl}
            onChange={(e) => setNewVideoUrl(e.target.value)}
            placeholder="YouTube or unlisted YouTube URL (https://youtu.be/...)"
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
                      setDocuments((prev) =>
                        prev.map((item) =>
                          item.id === doc.id
                            ? {
                                ...item,
                                visibility: nextVis,
                                storageBucket:
                                  nextVis === 'Public'
                                    ? 'property-media-public'
                                    : 'property-media-private',
                              }
                            : item
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
        <h3 className="font-display text-sm font-bold text-[#202124] pb-2 border-b border-[#EFEFF6]">
          7. Assigned Property Advisor
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Name</label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              className="w-full h-9 px-3 text-xs border border-[#D6D6E4] rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Phone</label>
            <input
              type="text"
              value={agentPhone}
              onChange={(e) => setAgentPhone(e.target.value)}
              className="w-full h-9 px-3 text-xs border border-[#D6D6E4] rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              WhatsApp Digits
            </label>
            <input
              type="text"
              value={agentWhatsapp}
              onChange={(e) => setAgentWhatsapp(e.target.value)}
              className="w-full h-9 px-3 font-mono text-xs border border-[#D6D6E4] rounded-md"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Messenger Handle
            </label>
            <input
              type="text"
              value={agentMessenger}
              onChange={(e) => setAgentMessenger(e.target.value)}
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
              <button
                type="button"
                onClick={() => setPreviewOpen(false)}
                className="w-8 h-8 rounded bg-white border border-[#DCD0F0] flex items-center justify-center text-[#202124] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
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
                <div className="space-y-3">
                  <h4 className="font-display text-sm font-bold text-[#202124]">
                    Attached Videos ({previewData.videos.length})
                  </h4>
                  <YouTubePlayer
                    url={previewData.videos[0].url}
                    title={previewData.videos[0].title}
                  />
                </div>
              )}

              <div className="text-xs text-[#696B77]">
                Public buyer documents shown on live page:{' '}
                <strong>{previewData.documents.filter((d) => d.visibility === 'Public').length}</strong>{' '}
                (Private admin-only docs:{' '}
                <strong>{previewData.documents.filter((d) => d.visibility === 'Private').length}</strong>
                )
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
