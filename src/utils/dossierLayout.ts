import type {
  Property,
  PropertyDocumentItem,
  PropertyPresentationItem,
  PropertyStatus,
  PropertyVisibility,
} from '../types/property';
import {
  filterPublicDocuments,
  filterPublicPresentations,
  isPropertyPubliclyVisible,
} from '../services/propertyService';
import {
  buildMessengerLink,
  buildWhatsAppLink,
  formatDateShort,
  formatFileSize,
  formatFrontageLength,
  formatSqm,
  getPropertyPermalink,
  resolvePropertyPricingDisplay,
  type PropertyPricingDisplay,
} from './format';
import {buildPropertyGallerySlides, type GallerySlide} from './gallery';
import {
  buildGoogleMapsEmbedUrl,
  formatLatLngDisplay,
  sanitizeGoogleMapsHref,
  validateCoordinates,
} from './googleMaps';
import {buildDistributableQrUrl, validateCanonicalSiteUrl} from './siteUrl';
import {parsePropertyVideoUrl, type VideoProvider} from './video';

export const DOSSIER_PALETTE = {
  ivory: '#FAF8F4',
  alabaster: '#F4F0E8',
  charcoal: '#1C1B19',
  stone: '#6B665E',
  champagne: '#B89B6A',
  hairline: '#E2DDD3',
} as const;

export const DOSSIER_PAGE_TITLES = [
  'Cover & Executive Brief',
  'Spatial Narrative & Photo Portfolio',
  'Land, Legal & Public Document Ledger',
  'Site Geolocation & Aerial Visuals',
  'Private Advisory & Permanent Verification QR',
] as const;

export type DossierPortfolioGridMode =
  | 'none'
  | 'cover-only'
  | 'single-secondary'
  | 'two-up'
  | 'three-up'
  | 'four-to-six-grid';

export interface DossierPhotoPortfolio {
  totalApprovedPhotos: number;
  coverPhoto: GallerySlide | null;
  secondaryPhotos: GallerySlide[];
  additionalOnlinePhotoCount: number;
  gridMode: DossierPortfolioGridMode;
}

export interface DossierSpecItem {
  label: string;
  value: string;
  mono?: boolean;
  fullWidth?: boolean;
}

export interface DossierDocumentEntry {
  id: string;
  title: string;
  category: string;
  fileName: string;
  fileSizeLabel: string;
  rawDocument: PropertyDocumentItem;
}

export interface DossierPresentationEntry {
  id: string;
  title: string;
  description: string;
  slideCount: number | null;
  allowDownload: boolean;
  pdfSizeLabel: string;
  pptxSizeLabel: string;
  onlineUrl: string;
  rawPresentation: PropertyPresentationItem;
}

export interface DossierVideoEntry {
  id: string;
  title: string;
  description: string;
  providerLabel: string;
  provider: VideoProvider;
  watchUrl: string;
  thumbnailUrl?: string;
}

export interface DossierModel {
  accessible: true;
  lotId: string;
  title: string;
  status: PropertyStatus;
  visibility: PropertyVisibility;
  isPubliclyVisible: boolean;
  isPreviewMode: boolean;
  classification: string;
  locationLine: string;
  completeLocation: string;
  regionLine: string;
  pricing: PropertyPricingDisplay;
  priceTotalLabel: string;
  pricePerSqmLabel: string;
  priceHeadlineLabel: string;
  priceSubLabel: string;
  isPriceUponRequest: boolean;
  isNegotiable: boolean;
  lotAreaLabel: string;
  frontageLengthLabel: string;
  titleStatusLabel: string;
  updatedAtLabel: string;
  executiveMetrics: Array<{label: string; value: string; mono?: boolean}>;
  descriptionParagraphs: string[];
  useCompactTwoColumnNarrative: boolean;
  additionalRemarks: string;
  highlights: string[];
  portfolio: DossierPhotoPortfolio;
  specificationLedger: DossierSpecItem[];
  publicDocuments: DossierDocumentEntry[];
  publicPresentations: DossierPresentationEntry[];
  geolocation: {
    hasValidCoordinates: boolean;
    coordinatesDisplay: string;
    mapsPinUrl: string;
    mapsEmbedUrl: string;
    region: string;
    completeLocation: string;
  };
  videos: DossierVideoEntry[];
  advisor: {
    name: string;
    phone: string;
    whatsapp: string;
    whatsappUrl: string;
    messenger: string;
    messengerUrl: string;
    hasDirectContact: boolean;
  };
  qr: {
    canonicalValid: boolean;
    canonicalReason?: string;
    qrTargetUrl: string;
    permalinkDisplay: string;
  };
  pageTitles: readonly string[];
}

export interface BlockedDossierResult {
  accessible: false;
  reason: string;
}

export function formatEditorialParagraphs(rawDescription: string): string[] {
  const cleaned = (rawDescription || '').replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const explicitParagraphs = cleaned
    .split(/\n{2,}/)
    .map((block) => block.replace(/\n+/g, ' ').trim())
    .filter(Boolean);

  if (explicitParagraphs.length > 1) {
    return explicitParagraphs;
  }

  const singleBlock = explicitParagraphs[0];
  if (singleBlock.length <= 520) {
    return [singleBlock];
  }

  const sentences = singleBlock.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [singleBlock];
  const grouped: string[] = [];
  let buffer = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (buffer && buffer.length + trimmed.length + 1 > 460) {
      grouped.push(buffer);
      buffer = trimmed;
    } else {
      buffer = buffer ? `${buffer} ${trimmed}` : trimmed;
    }
  }
  if (buffer) {
    grouped.push(buffer);
  }

  return grouped.length > 0 ? grouped : [singleBlock];
}

export function resolvePhotoPortfolioLayout(
  slides: GallerySlide[]
): DossierPhotoPortfolio {
  const total = slides.length;
  if (total === 0) {
    return {
      totalApprovedPhotos: 0,
      coverPhoto: null,
      secondaryPhotos: [],
      additionalOnlinePhotoCount: 0,
      gridMode: 'none',
    };
  }

  const coverPhoto = slides[0];
  const remaining = slides.slice(1);
  const maxPageTwoSecondary = 6;
  const secondaryPhotos = remaining.slice(0, maxPageTwoSecondary);
  const additionalOnlinePhotoCount = Math.max(0, remaining.length - maxPageTwoSecondary);

  let gridMode: DossierPortfolioGridMode = 'four-to-six-grid';
  if (secondaryPhotos.length === 0) gridMode = 'cover-only';
  else if (secondaryPhotos.length === 1) gridMode = 'single-secondary';
  else if (secondaryPhotos.length === 2) gridMode = 'two-up';
  else if (secondaryPhotos.length === 3) gridMode = 'three-up';

  return {
    totalApprovedPhotos: total,
    coverPhoto,
    secondaryPhotos,
    additionalOnlinePhotoCount,
    gridMode,
  };
}

export function buildPropertyDossierModel(
  property: Property,
  options: {
    isPreviewAllowed: boolean;
    effectiveCanonicalSiteUrl: string;
  }
): DossierModel | BlockedDossierResult {
  const publiclyVisible = isPropertyPubliclyVisible(property);
  if (!publiclyVisible && !options.isPreviewAllowed) {
    return {
      accessible: false,
      reason: `${property.lotId} is currently ${property.visibility.toLowerCase()} and restricted from public dossier access.`,
    };
  }

  const slides = buildPropertyGallerySlides(property, {
    isPreviewAllowed: options.isPreviewAllowed,
  });
  const portfolio = resolvePhotoPortfolioLayout(slides);

  // Strictly exclude Private admin documents from all buyer/printable dossiers
  const publicDocuments: DossierDocumentEntry[] = filterPublicDocuments(
    property.documents || []
  ).map((doc) => ({
    id: doc.id,
    title: doc.title || doc.fileName,
    category: doc.category,
    fileName: doc.fileName,
    fileSizeLabel: formatFileSize(doc.fileSizeBytes || 0),
    rawDocument: doc,
  }));

  const canonicalValidation = validateCanonicalSiteUrl(options.effectiveCanonicalSiteUrl);
  const qrTargetUrl = canonicalValidation.valid
    ? buildDistributableQrUrl(options.effectiveCanonicalSiteUrl, property.lotId) || ''
    : '';
  const permalinkDisplay =
    qrTargetUrl || getPropertyPermalink(property.lotId, options.effectiveCanonicalSiteUrl);

  // Strictly exclude Private presentations from dossiers; reference Public decks via link/QR only
  const publicPresentations: DossierPresentationEntry[] = filterPublicPresentations(
    property.presentations || []
  ).map((pres) => ({
    id: pres.id,
    title: pres.title,
    description: pres.description || '',
    slideCount: pres.slideCount ?? null,
    allowDownload: Boolean(pres.allowDownload),
    pdfSizeLabel: pres.pdfFileSizeBytes ? formatFileSize(pres.pdfFileSizeBytes) : '',
    pptxSizeLabel:
      pres.allowDownload && pres.pptxFileSizeBytes
        ? formatFileSize(pres.pptxFileSizeBytes)
        : '',
    onlineUrl: qrTargetUrl ? `${qrTargetUrl}#presentations` : `${permalinkDisplay}#presentations`,
    rawPresentation: pres,
  }));

  const pricing = resolvePropertyPricingDisplay(property);
  const locationParts = [property.barangay, property.city, property.province]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  const locationLine = locationParts.join(', ') || 'Philippines';
  const completeLocation = (property.completeLocation || '').trim() || locationLine;
  const regionLine = (property.region || '').trim();

  const descriptionParagraphs = formatEditorialParagraphs(property.description || '');
  const totalDescChars = (property.description || '').trim().length;
  const useCompactTwoColumnNarrative =
    totalDescChars > 950 || descriptionParagraphs.length >= 4;

  const frontageLengthLabel = formatFrontageLength(property.frontageLengthM);
  const halfWidthSpecs: DossierSpecItem[] = [
    {
      label: 'Lot Area',
      value: formatSqm(property.lotAreaSqm),
      mono: true,
    },
    ...(frontageLengthLabel
      ? [
          {
            label: 'Frontage Length',
            value: frontageLengthLabel,
            mono: true,
          },
        ]
      : []),
    {
      label: 'Land Classification',
      value: property.classification,
    },
    {
      label: 'Title Status',
      value: (property.titleStatus || '').trim() || 'Available upon verified inquiry',
    },
    {
      label: 'Tax Declaration Status',
      value:
        (property.taxDeclarationStatus || '').trim() ||
        'Available upon verified inquiry',
    },
    {
      label: 'Road Frontage & Access',
      value: (property.roadAccess || '').trim() || 'Subject to site inspection',
    },
    {
      label: 'Terrain & Elevation',
      value: (property.terrain || '').trim() || 'Standard parcel grade',
    },
    {
      label: 'Utilities & Infrastructure',
      value: (property.utilities || '').trim() || 'Subject to municipal connection verification',
    },
  ];

  // Auto-balance 2-column grid so omitting optional Frontage Length never leaves an orphan blank cell
  if (halfWidthSpecs.length % 2 === 1 && halfWidthSpecs.length > 0) {
    halfWidthSpecs[0] = {...halfWidthSpecs[0], fullWidth: true};
  }

  const specificationLedger: DossierSpecItem[] = [
    {
      label: 'Property Location',
      value: completeLocation,
      fullWidth: true,
    },
    ...halfWidthSpecs,
  ];

  if ((property.boundaryDescription || '').trim()) {
    specificationLedger.push({
      label: 'Perimeter & Boundary Notes',
      value: property.boundaryDescription.trim(),
      fullWidth: true,
    });
  }

  if ((property.nearbyLandmarks || '').trim()) {
    specificationLedger.push({
      label: 'Vicinity & Key Landmarks',
      value: property.nearbyLandmarks.trim(),
      fullWidth: true,
    });
  }

  const coordCheck = validateCoordinates(property.latitude, property.longitude);
  const hasValidCoordinates =
    coordCheck.valid &&
    coordCheck.latitude !== undefined &&
    coordCheck.longitude !== undefined;
  const mapsPinUrl = hasValidCoordinates
    ? sanitizeGoogleMapsHref(property.googleMapsUrl, property.latitude, property.longitude)
    : '';
  const mapsEmbedUrl = hasValidCoordinates
    ? buildGoogleMapsEmbedUrl(coordCheck.latitude!, coordCheck.longitude!)
    : '';

  const rawVideos =
    property.videos && property.videos.length > 0
      ? property.videos
      : property.youtubeUrl
        ? [
            {
              id: 'primary-video',
              sourceType: 'youtube' as const,
              url: property.youtubeUrl,
              title: 'Aerial Drone & Site Orientation',
              description: '',
              sortOrder: 0,
            },
          ]
        : [];

  const videos: DossierVideoEntry[] = rawVideos
    .map((vid, idx): DossierVideoEntry | null => {
      const parsed = parsePropertyVideoUrl(vid.url);
      if (!parsed) return null;
      return {
        id: vid.id || `vid-${idx}`,
        title: (vid.title || '').trim() || `${property.title} Visual Tour ${idx + 1}`,
        description: (vid.description || '').trim(),
        providerLabel: parsed.providerLabel,
        provider: parsed.provider,
        watchUrl: parsed.canonicalUrl,
        thumbnailUrl: parsed.thumbnailUrl || undefined,
      };
    })
    .filter((v): v is DossierVideoEntry => v !== null);

  const agentName = (property.agentName || '').trim();
  const agentPhone = (property.agentPhone || '').trim();
  const agentWhatsapp = (property.agentWhatsapp || '').trim();
  const agentMessenger = (property.agentMessenger || '').trim();

  return {
    accessible: true,
    lotId: property.lotId,
    title: (property.title || '').trim() || `Parcel ${property.lotId}`,
    status: property.status,
    visibility: property.visibility,
    isPubliclyVisible: publiclyVisible,
    isPreviewMode: !publiclyVisible && options.isPreviewAllowed,
    classification: property.classification,
    locationLine,
    completeLocation,
    regionLine,
    pricing,
    priceTotalLabel: pricing.totalPriceLabel,
    pricePerSqmLabel: pricing.pricePerSqmLabel,
    priceHeadlineLabel: pricing.primaryHeadlineLabel,
    priceSubLabel: pricing.secondarySubLabel,
    isPriceUponRequest: pricing.isPriceUponRequest,
    isNegotiable: property.isNegotiable,
    lotAreaLabel: formatSqm(property.lotAreaSqm),
    frontageLengthLabel,
    titleStatusLabel: (property.titleStatus || '').trim() || 'Upon verification',
    updatedAtLabel: formatDateShort(property.updatedAt),
    executiveMetrics: [
      {label: 'Lot Area', value: formatSqm(property.lotAreaSqm), mono: true},
      ...(frontageLengthLabel
        ? [
            {
              label: 'Frontage Length',
              value: frontageLengthLabel,
              mono: true,
            },
          ]
        : []),
      {label: 'Classification', value: property.classification},
      {
        label: 'Title Status',
        value: (property.titleStatus || '').trim() || 'Upon inquiry',
      },
    ],
    descriptionParagraphs,
    useCompactTwoColumnNarrative,
    additionalRemarks: (property.additionalRemarks || '').trim(),
    highlights: (property.highlights || []).map((h) => h.trim()).filter(Boolean),
    portfolio,
    specificationLedger,
    publicDocuments,
    publicPresentations,
    geolocation: {
      hasValidCoordinates,
      coordinatesDisplay: hasValidCoordinates
        ? formatLatLngDisplay(property.latitude, property.longitude)
        : 'Coordinates unavailable',
      mapsPinUrl,
      mapsEmbedUrl,
      region: regionLine,
      completeLocation,
    },
    videos,
    advisor: {
      name: agentName || 'BEN MICUBO REAL ESTATE SERVICES',
      phone: agentPhone,
      whatsapp: agentWhatsapp,
      whatsappUrl: agentWhatsapp
        ? buildWhatsAppLink(agentWhatsapp, property.lotId, property.title)
        : '',
      messenger: agentMessenger,
      messengerUrl: agentMessenger ? buildMessengerLink(agentMessenger) : '',
      hasDirectContact: Boolean(agentPhone || agentWhatsapp || agentMessenger),
    },
    qr: {
      canonicalValid: canonicalValidation.valid,
      canonicalReason: canonicalValidation.reason,
      qrTargetUrl,
      permalinkDisplay,
    },
    pageTitles: DOSSIER_PAGE_TITLES,
  };
}
