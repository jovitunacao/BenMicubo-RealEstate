import {lazy, Suspense, useEffect, useRef, useState} from 'react';
import {Link, useParams, useSearchParams} from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Maximize2,
  MapPin,
  MessageCircle,
  Phone,
  Printer,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import {usePropertyStore} from '../context/PropertyStoreContext';
import {PropertyImage} from '../components/PropertyImage';
import {StatusIndicator} from '../components/StatusIndicator';
import {PropertyVideoPlayer} from '../components/PropertyVideoPlayer';
import {QRCodeCanvas} from '../components/QRCodeCanvas';
import {InquiryForm} from '../components/InquiryForm';
import {ShareListingButton} from '../components/ShareListingButton';
import {
  filterPublicDocuments,
  filterPublicPresentations,
  isPropertyPubliclyVisible,
} from '../services/propertyService';
import {
  getAuthorizedDocumentDownloadUrl,
  refreshPrivateImageSignedUrl,
} from '../services/storageService';
import {
  buildMessengerLink,
  buildWhatsAppLink,
  formatDateShort,
  formatFileSize,
  formatFrontageLength,
  formatSqm,
  getPropertyPermalink,
  hasVisibleFrontageLength,
  resolvePropertyPricingDisplay,
} from '../utils/format';
import {formatEditorialParagraphs} from '../utils/dossierLayout';
import {buildPropertyGallerySlides, resolveNextGalleryIndex} from '../utils/gallery';
import {formatLatLngDisplay, sanitizeGoogleMapsHref} from '../utils/googleMaps';
import {parsePropertyVideoUrl} from '../utils/video';
import {buildDistributableQrUrl} from '../utils/siteUrl';

const LazyPropertyPresentationViewer = lazy(() =>
  import('../components/PropertyPresentationViewer').then((m) => ({
    default: m.PropertyPresentationViewer,
  }))
);

export function PropertyDetailPage() {
  const {lotId = ''} = useParams();
  const [searchParams] = useSearchParams();
  const {
    getByLotId,
    isLoading,
    effectiveCanonicalSiteUrl,
    canonicalUrlValidation,
    isAdminAuthorized,
    isDemoMode,
    isServiceUnavailable,
    refreshAll,
  } = usePropertyStore();
  const property = getByLotId(lotId);

  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [docError, setDocError] = useState('');
  const touchStartXRef = useRef<number | null>(null);

  const isPreviewAllowed =
    searchParams.get('preview') === '1' && (isAdminAuthorized || isDemoMode);
  const publiclyVisible = property ? isPropertyPubliclyVisible(property) : false;
  const galleryImages = property
    ? buildPropertyGallerySlides(property, {isPreviewAllowed})
    : [];

  useEffect(() => {
    setActivePhotoIndex(0);
    setLightboxOpen(false);
    setDocError('');
    window.scrollTo({top: 0});
  }, [lotId]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxOpen(false);
      else if (e.key === 'ArrowLeft') {
        setActivePhotoIndex((prev) => (prev <= 0 ? galleryImages.length - 1 : prev - 1));
      } else if (e.key === 'ArrowRight') {
        setActivePhotoIndex((prev) => (prev >= galleryImages.length - 1 ? 0 : prev + 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen, galleryImages.length]);

  if (isLoading) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#FAF8F4]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <div className="h-8 w-48 bg-[#F4F0E8] border border-[#E2DDD3] animate-pulse mb-6" />
          <div className="aspect-[16/9] w-full bg-[#F4F0E8] border border-[#E2DDD3] animate-pulse" />
        </div>
      </main>
    );
  }

  if (!property && isServiceUnavailable) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#FAF8F4] py-20 px-4 sm:px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <AlertTriangle className="w-8 h-8 text-amber-700 mx-auto mb-3" />
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#8A6D3B]">
            Temporary Service Interruption
          </p>
          <h1 className="mt-2 font-editorial text-3xl sm:text-4xl font-semibold text-[#1C1B19]">
            Property Dossier Temporarily Unavailable
          </h1>
          <p className="mt-3 text-sm text-[#6B665E] leading-relaxed">
            We are temporarily unable to retrieve live details for{' '}
            <span className="font-mono font-semibold text-[#1C1B19]">
              {decodeURIComponent(lotId).toUpperCase()}
            </span>{' '}
            from the database. Existing property records remain intact—please retry in a moment.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void refreshAll()}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D] cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Retry Connection</span>
            </button>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A]"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Listings</span>
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!property || (!publiclyVisible && !isPreviewAllowed)) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#FAF8F4] py-20 px-4 sm:px-6 text-center">
        <div className="max-w-2xl mx-auto">
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-[#8A6D3B]">
            {property && !publiclyVisible ? 'Unpublished / Archived Listing' : '404 · Property Not Found'}
          </p>
          <h1 className="mt-2 font-editorial text-3xl sm:text-4xl font-semibold text-[#1C1B19]">
            {property && !publiclyVisible
              ? `${property.lotId} is currently ${property.visibility.toLowerCase()}`
              : `No active listing found for ${decodeURIComponent(lotId).toUpperCase()}`}
          </h1>
          <p className="mt-3 text-sm text-[#6B665E] leading-relaxed">
            {property && !publiclyVisible
              ? 'This property is not publicly published right now. Only published BEN MICUBO REAL ESTATE SERVICES listings are open to buyers.'
              : 'The lot identifier may have been archived or removed from this BEN MICUBO REAL ESTATE SERVICES directory.'}
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to All Properties</span>
          </Link>
        </div>
      </main>
    );
  }

  const safeActiveIndex =
    galleryImages.length > 0 ? Math.min(activePhotoIndex, galleryImages.length - 1) : 0;
  const currentImage = galleryImages[safeActiveIndex] || galleryImages[0];
  const currentPhoto = currentImage?.url || '';
  const pricing = resolvePropertyPricingDisplay(property);
  const qrTargetUrl =
    buildDistributableQrUrl(effectiveCanonicalSiteUrl, property.lotId) || '';
  const permalink = getPropertyPermalink(property.lotId, effectiveCanonicalSiteUrl);
  const shareUrl = canonicalUrlValidation.valid
    ? qrTargetUrl || permalink
    : typeof window !== 'undefined'
      ? `${window.location.origin}/property/${encodeURIComponent(property.lotId)}`
      : permalink;

  const dossierRoute = `/dossier/${encodeURIComponent(property.lotId)}${
    !publiclyVisible && isPreviewAllowed ? '?preview=1' : ''
  }`;

  const videos =
    property.videos && property.videos.length > 0
      ? property.videos
      : property.youtubeUrl
        ? [
            {
              id: 'primary-video',
              sourceType: 'youtube' as const,
              url: property.youtubeUrl,
              title: 'Aerial Drone & Property Video',
              description: '',
              sortOrder: 0,
            },
          ]
        : [];

  // Strict privacy guard: NEVER display Private admin documents on public detail page
  const publicDocuments = filterPublicDocuments(property.documents || []);
  const visiblePresentations = isPreviewAllowed
    ? [...(property.presentations || [])].sort((a, b) => a.sortOrder - b.sortOrder)
    : filterPublicPresentations(property.presentations || []);
  const descriptionParagraphs = formatEditorialParagraphs(property.description || '');

  const handlePrevPhoto = () => {
    setActivePhotoIndex((prev) => (prev <= 0 ? galleryImages.length - 1 : prev - 1));
  };

  const handleNextPhoto = () => {
    setActivePhotoIndex((prev) => (prev >= galleryImages.length - 1 ? 0 : prev + 1));
  };

  const handleGalleryTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleGalleryTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || galleryImages.length <= 1) {
      touchStartXRef.current = null;
      return;
    }
    const endX = e.changedTouches[0]?.clientX;
    if (typeof endX === 'number') {
      const deltaX = endX - touchStartXRef.current;
      setActivePhotoIndex((prev) => resolveNextGalleryIndex(prev, galleryImages.length, deltaX));
    }
    touchStartXRef.current = null;
  };

  const handleCopyPermalink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Fallback ignored if clipboard permissions are blocked
    }
  };

  const handleDownloadPublicDoc = async (docId: string) => {
    setDocError('');
    const doc = publicDocuments.find((item) => item.id === docId);
    if (!doc) return;
    try {
      const url = await getAuthorizedDocumentDownloadUrl(doc, false);
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = doc.fileName;
      link.click();
    } catch (err) {
      setDocError(err instanceof Error ? err.message : 'Unable to download document.');
    }
  };

  return (
    <main className="bg-[#FAF8F4] text-[#1C1B19] pb-20">
      {/* Admin Preview Banner when previewing Draft / Archived */}
      {!publiclyVisible && isPreviewAllowed && (
        <div className="bg-[#F4F0E8] border-b border-[#B89B6A]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#1C1B19]">
            <div className="flex items-center gap-2 font-medium">
              <Eye className="w-4 h-4 text-[#8A6D3B]" />
              <span>
                Admin Preview Mode · This listing is <strong>{property.visibility}</strong> and is hidden from public buyers.
              </span>
            </div>
            <Link to="/admin" className="font-semibold text-[#8A6D3B] hover:underline">
              Return to Admin Dashboard →
            </Link>
          </div>
        </div>
      )}

      {/* Editorial Breadcrumb & Utility Bar */}
      <div className="border-b border-[#E2DDD3] bg-[#F4F0E8]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#6B665E]">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 min-w-0 truncate">
            <Link to="/" className="hover:text-[#1C1B19] inline-flex items-center gap-1.5 shrink-0">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All Listings</span>
            </Link>
            <span aria-hidden="true" className="text-[#B89B6A]">
              ·
            </span>
            <span className="truncate">{property.province}</span>
            <span aria-hidden="true" className="text-[#B89B6A]">
              ·
            </span>
            <span className="font-mono font-semibold text-[#1C1B19] shrink-0">
              {property.lotId}
            </span>
          </nav>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <ShareListingButton
              lotId={property.lotId}
              title={property.title}
              shareUrl={shareUrl}
              messengerHandle={property.agentMessenger}
            />
            <Link
              to={dossierRoute}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D] transition-colors whitespace-nowrap shrink-0"
            >
              <FileText className="w-3.5 h-3.5 text-[#B89B6A]" />
              <span>5-Page A4 Dossier (PDF)</span>
            </Link>
            {canonicalUrlValidation.valid ? (
              <Link
                to={`/signage/${encodeURIComponent(property.lotId)}`}
                className="inline-flex items-center gap-1.5 font-medium text-[#1C1B19] hover:text-[#8A6D3B] whitespace-nowrap shrink-0"
              >
                <Printer className="w-3.5 h-3.5 text-[#8A6D3B]" />
                <span>Print QR Sign</span>
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title="Configure VITE_PUBLIC_SITE_URL or a public HTTPS domain in Settings to enable printable QR signage."
                className="inline-flex items-center gap-1.5 font-medium text-[#6B665E] opacity-60 cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Sign Disabled</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Prominent Sold Notice Banner — Permanent URL remains accessible */}
      {property.status === 'Sold' && (
        <div className="bg-[#F4F0E8] border-b border-[#E2DDD3]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#1C1B19]">
            <p>
              <strong>Property Status: SOLD.</strong> This parcel ({property.lotId}) has already been sold. You may still review specifications below or inquire with BEN MICUBO REAL ESTATE SERVICES for comparable lots.
            </p>
            <Link to="/" className="font-semibold text-[#8A6D3B] hover:underline">
              Browse Available Lots →
            </Link>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-7 sm:pt-9">
        {/* Curated Gallery Frame */}
        <section aria-label="Property photos" className="min-w-0 max-w-full">
          <div
            onTouchStart={handleGalleryTouchStart}
            onTouchEnd={handleGalleryTouchEnd}
            className="relative aspect-[16/10] sm:aspect-[16/9] w-full overflow-hidden border border-[#E2DDD3] bg-[#F4F0E8] touch-pan-y"
          >
            <PropertyImage
              src={currentPhoto}
              alt={
                currentImage?.caption ||
                `${property.title} — photo ${safeActiveIndex + 1}`
              }
              fallbackTitle={property.title}
              loading="eager"
              onRecoverSignedUrl={
                isPreviewAllowed &&
                currentImage?.storageBucket === 'property-media-private' &&
                currentImage?.storagePath
                  ? () => refreshPrivateImageSignedUrl(currentImage.storagePath!)
                  : undefined
              }
              className="w-full h-full object-cover"
            />

            {galleryImages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={handlePrevPhoto}
                  aria-label="Previous photo"
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 bg-[#FAF8F4]/92 text-[#1C1B19] border border-[#E2DDD3] flex items-center justify-center hover:bg-white transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextPhoto}
                  aria-label="Next photo"
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 bg-[#FAF8F4]/92 text-[#1C1B19] border border-[#E2DDD3] flex items-center justify-center hover:bg-white transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}

            <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
              {currentImage?.caption ? (
                <p className="px-3 py-1.5 text-xs text-[#FAF8F4] bg-[#1C1B19]/80 max-w-xl font-editorial italic tracking-wide">
                  {currentImage.caption}
                </p>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 text-xs font-mono text-[#FAF8F4] bg-[#1C1B19]/80">
                  {galleryImages.length > 0 ? `${safeActiveIndex + 1} / ${galleryImages.length}` : '0 / 0'}
                </span>
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  aria-label="Expand photo gallery"
                  className="w-9 h-9 bg-[#1C1B19]/80 text-[#FAF8F4] flex items-center justify-center hover:bg-[#1C1B19] transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {galleryImages.length > 1 && (
            <div
              role="region"
              aria-label="Gallery thumbnails"
              className="mt-3 flex items-center gap-2.5 overflow-x-auto pb-1.5 max-w-full"
            >
              {galleryImages.map((img, index) => (
                <button
                  key={img.id || `${img.url}-${index}`}
                  type="button"
                  onClick={() => setActivePhotoIndex(index)}
                  aria-label={`Select photo ${index + 1}`}
                  aria-pressed={safeActiveIndex === index}
                  className={`relative block w-24 h-16 sm:w-28 sm:h-[72px] overflow-hidden border shrink-0 cursor-pointer transition-all bg-[#F4F0E8] ${
                    safeActiveIndex === index
                      ? 'border-[#B89B6A] ring-2 ring-[#B89B6A]/45 opacity-100'
                      : 'border-[#E2DDD3] opacity-80 hover:opacity-100'
                  }`}
                >
                  <PropertyImage
                    src={img.thumbUrl}
                    alt={img.caption || `${property.title} thumbnail ${index + 1}`}
                    loading="eager"
                    compact
                    onRecoverSignedUrl={
                      isPreviewAllowed &&
                      img.storageBucket === 'property-media-private' &&
                      img.storagePath
                        ? () => refreshPrivateImageSignedUrl(img.storagePath!)
                        : undefined
                    }
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Main 2-Column Editorial Dossier Canvas */}
        <div className="mt-9 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
          {/* Left Editorial Narrative & Technical Ledger Column */}
          <div className="lg:col-span-7 min-w-0 space-y-11">
            {/* Title & Valuation Header */}
            <header className="pb-7 border-b border-[#E2DDD3]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#6B665E]">
                  <span className="font-mono font-semibold text-[#1C1B19]">{property.lotId}</span>
                  <span aria-hidden="true" className="text-[#B89B6A]">
                    ·
                  </span>
                  <span>
                    {[property.barangay, property.city, property.province]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                  <span aria-hidden="true" className="text-[#B89B6A]">
                    ·
                  </span>
                  <span>{property.classification}</span>
                </div>
                <StatusIndicator status={property.status} compact />
              </div>

              <h1 className="mt-3 font-editorial text-3xl sm:text-5xl font-semibold leading-[1.08] tracking-tight text-[#1C1B19] [text-wrap:balance]">
                {property.title}
              </h1>

              <div className="mt-6 flex flex-wrap items-baseline gap-x-8 gap-y-3">
                <div>
                  <span className="text-[10px] tracking-[0.16em] uppercase text-[#6B665E] block">
                    {pricing.isPriceUponRequest
                      ? 'Valuation Inquiry'
                      : pricing.showSellingPrice
                        ? 'Total Selling Price'
                        : 'Rate per Square Meter'}
                  </span>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-editorial text-3xl sm:text-4xl font-semibold text-[#1C1B19] tabular-nums">
                      {pricing.primaryHeadlineLabel}
                    </span>
                    {property.isNegotiable && !pricing.isPriceUponRequest && (
                      <span className="text-[11px] font-medium tracking-[0.12em] uppercase text-[#8A6D3B]">
                        Negotiable
                      </span>
                    )}
                  </div>
                  {pricing.isPriceUponRequest && (
                    <a
                      href="#inquiry-card"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#8A6D3B] hover:underline"
                    >
                      <span>Request Pricing &amp; Terms via Inquiry Form →</span>
                    </a>
                  )}
                </div>
                {pricing.secondarySubLabel && (
                  <div>
                    <span className="text-[10px] tracking-[0.16em] uppercase text-[#6B665E] block">
                      Rate per Square Meter
                    </span>
                    <span className="font-mono text-base sm:text-lg font-medium text-[#1C1B19] tabular-nums">
                      {pricing.secondarySubLabel}
                    </span>
                  </div>
                )}
                <div className="sm:ml-auto text-xs text-[#6B665E] font-mono">
                  Updated {formatDateShort(property.updatedAt)}
                </div>
              </div>
            </header>

            {/* Hairline Architectural Specifications Ledger */}
            {(() => {
              const showFrontage = hasVisibleFrontageLength(property);
              const frontageLabel = showFrontage
                ? formatFrontageLength(property.frontageLengthM)
                : '';
              const coreSpecs: Array<{
                label: string;
                value: string;
                mono?: boolean;
                fullWidth?: boolean;
              }> = [
                {
                  label: 'Land Area',
                  value: formatSqm(property.lotAreaSqm),
                  mono: true,
                },
                ...(showFrontage && frontageLabel
                  ? [
                      {
                        label: 'Frontage Length',
                        value: frontageLabel,
                        mono: true,
                      },
                    ]
                  : []),
                {
                  label: 'Classification',
                  value: property.classification,
                },
                {
                  label: 'Title Status',
                  value: property.titleStatus || 'Available upon request',
                },
                {
                  label: 'Tax Declaration Status',
                  value: property.taxDeclarationStatus || 'Available upon request',
                },
                {
                  label: 'Road Access',
                  value: property.roadAccess || 'Subject to site verification',
                },
                {
                  label: 'Terrain & Elevation',
                  value: property.terrain || 'Standard grade',
                },
                {
                  label: 'Utilities',
                  value: property.utilities || 'Power & water line accessible',
                },
              ];

              // Balance the 2-column grid so omitting Frontage Length leaves zero blank space
              if (coreSpecs.length % 2 === 1 && coreSpecs.length > 0) {
                coreSpecs[0] = {...coreSpecs[0], fullWidth: true};
              }

              if (property.boundaryDescription) {
                coreSpecs.push({
                  label: 'Lot Boundaries',
                  value: property.boundaryDescription,
                  fullWidth: true,
                });
              }
              if (property.nearbyLandmarks) {
                coreSpecs.push({
                  label: 'Nearby Landmarks',
                  value: property.nearbyLandmarks,
                  fullWidth: true,
                });
              }

              return (
                <section aria-labelledby="specs-heading">
                  <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                    Technical Schedule
                  </p>
                  <h2 id="specs-heading" className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
                    Land, Boundary &amp; Title Specifications
                  </h2>
                  <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 border-t border-l border-[#E2DDD3] bg-[#FAF8F4]">
                    {coreSpecs.map((spec) => (
                      <div
                        key={spec.label}
                        className={`p-4 border-r border-b border-[#E2DDD3] ${
                          spec.fullWidth ? 'sm:col-span-2' : ''
                        }`}
                      >
                        <dt className="text-[10px] tracking-[0.14em] uppercase text-[#6B665E]">
                          {spec.label}
                        </dt>
                        <dd
                          className={`mt-1 text-sm text-[#1C1B19] ${
                            spec.mono ? 'font-mono font-semibold tabular-nums' : 'font-medium'
                          }`}
                        >
                          {spec.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })()}

            {/* Editorial Description & Distinguishing Highlights */}
            <section aria-labelledby="about-heading">
              <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                Spatial Narrative
              </p>
              <h2 id="about-heading" className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
                Property Overview
              </h2>
              <div className="mt-4 max-w-prose space-y-4 text-sm sm:text-[15px] text-[#35322D] leading-[1.75]">
                {descriptionParagraphs.map((para, idx) => (
                  <p
                    key={idx}
                    className={
                      idx === 0
                        ? 'first-letter:font-editorial first-letter:text-5xl first-letter:font-semibold first-letter:float-left first-letter:mr-2.5 first-letter:mt-0.5 first-letter:leading-none first-letter:text-[#1C1B19]'
                        : ''
                    }
                  >
                    {para}
                  </p>
                ))}
              </div>

              {property.additionalRemarks && (
                <div className="mt-5 p-4 border border-[#E2DDD3] bg-[#F4F0E8] text-xs text-[#35322D] leading-relaxed">
                  <span className="font-semibold uppercase tracking-[0.12em] text-[10px] text-[#1C1B19] block mb-1">
                    Remarks &amp; Terms
                  </span>
                  {property.additionalRemarks}
                </div>
              )}

              {property.highlights.length > 0 && (
                <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {property.highlights.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2.5 text-sm text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] p-3.5"
                    >
                      <Check className="w-4 h-4 text-[#8A6D3B] shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Multiple Videos Section */}
            <section aria-labelledby="video-heading" className="space-y-5 min-w-0 max-w-full">
              <div>
                <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                  Motion Documentation
                </p>
                <h2 id="video-heading" className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
                  Aerial Drone &amp; Property Videos ({videos.length})
                </h2>
              </div>

              {videos.length === 0 ? (
                <PropertyVideoPlayer
                  url=""
                  title={property.title}
                  posterFallback={galleryImages[0]?.url || currentPhoto}
                />
              ) : (
                <div className="space-y-6 min-w-0 max-w-full">
                  {videos.map((vid) => {
                    const parsed = parsePropertyVideoUrl(vid.url);
                    return (
                      <div key={vid.id} className="space-y-2 min-w-0 max-w-full">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-semibold text-[#1C1B19]">
                              {vid.title || `${property.title} Video`}
                            </h3>
                            {vid.description && (
                              <p className="text-xs text-[#6B665E]">{vid.description}</p>
                            )}
                          </div>
                          {parsed && (
                            <span className="font-mono text-[11px] text-[#6B665E] shrink-0">
                              {parsed.providerLabel}
                            </span>
                          )}
                        </div>
                        <PropertyVideoPlayer
                          url={vid.url}
                          title={vid.title || property.title}
                          posterFallback={galleryImages[0]?.url || currentPhoto}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Lazy-Loaded PowerPoint / PDF Presentation Viewer — Hidden when none exist */}
            {visiblePresentations.length > 0 && (
              <Suspense
                fallback={
                  <div className="p-6 border border-[#E2DDD3] bg-[#F4F0E8] text-xs text-[#6B665E]">
                    Preparing property presentation viewer...
                  </div>
                }
              >
                <LazyPropertyPresentationViewer
                  lotId={property.lotId}
                  propertyTitle={property.title}
                  presentations={visiblePresentations}
                  isPreviewAllowed={isPreviewAllowed}
                />
              </Suspense>
            )}

            {/* Public Buyer-Downloadable Documents Only */}
            {publicDocuments.length > 0 && (
              <section aria-labelledby="docs-heading" className="space-y-3">
                <div>
                  <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                    Public Due Diligence
                  </p>
                  <h2 id="docs-heading" className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
                    Approved Public Documents ({publicDocuments.length})
                  </h2>
                </div>
                {docError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 p-3">
                    {docError}
                  </p>
                )}
                <div className="border-t border-[#E2DDD3]">
                  {publicDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="py-3.5 border-b border-[#E2DDD3] flex items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <FileText className="w-5 h-5 text-[#8A6D3B] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#1C1B19] truncate">
                            {doc.title}
                          </p>
                          <p className="text-xs text-[#6B665E] font-mono">
                            {doc.category} · {doc.fileName} · {formatFileSize(doc.fileSizeBytes)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDownloadPublicDoc(doc.id)}
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A] shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-[#8A6D3B]" />
                        <span>Download</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Google Maps Location */}
            <section aria-labelledby="map-heading">
              <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                Geographic Pin
              </p>
              <h2 id="map-heading" className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
                Site Location &amp; Google Maps Pin
              </h2>
              <div className="mt-3 p-5 border border-[#E2DDD3] bg-[#F4F0E8] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-[#FAF8F4] border border-[#E2DDD3] flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-[#8A6D3B]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#1C1B19]">
                      {property.completeLocation ||
                        `${property.barangay}, ${property.city}, ${property.province}`}
                    </p>
                    <p className="text-xs text-[#6B665E] mt-0.5">{property.region}</p>
                    <p className="text-xs font-mono text-[#1C1B19] mt-1 tabular-nums">
                      GPS: {formatLatLngDisplay(property.latitude, property.longitude)}
                    </p>
                  </div>
                </div>

                {sanitizeGoogleMapsHref(
                  property.googleMapsUrl,
                  property.latitude,
                  property.longitude
                ) && (
                  <a
                    href={sanitizeGoogleMapsHref(
                      property.googleMapsUrl,
                      property.latitude,
                      property.longitude
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 h-10 px-5 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D] transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>Open in Google Maps</span>
                    <ExternalLink className="w-4 h-4 text-[#B89B6A]" />
                  </a>
                )}
              </div>
            </section>
          </div>

          {/* Right Advisory, Inquiry & Permanent QR Column */}
          <aside className="lg:col-span-5 space-y-6">
            {/* Direct Contact Channels */}
            <div className="p-6 border border-[#E2DDD3] bg-[#FAF8F4] space-y-4">
              <div>
                <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                  BEN MICUBO REAL ESTATE SERVICES · Advisor
                </p>
                <p className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
                  {property.agentName || 'BEN MICUBO REAL ESTATE SERVICES'}
                </p>
                {property.agentPhone && (
                  <p className="text-xs font-mono text-[#6B665E] mt-0.5">{property.agentPhone}</p>
                )}
              </div>

              {property.agentWhatsapp || property.agentMessenger || property.agentPhone ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2.5">
                  {property.agentWhatsapp && (
                    <a
                      href={buildWhatsAppLink(
                        property.agentWhatsapp,
                        property.lotId,
                        property.title
                      )}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-11 px-4 bg-[#1C1B19] text-[#FAF8F4] text-xs font-medium flex items-center justify-center gap-2 hover:bg-[#35322D] transition-colors"
                    >
                      <MessageCircle className="w-4 h-4 text-[#B89B6A]" />
                      <span>Message on WhatsApp</span>
                    </a>
                  )}
                  {property.agentMessenger && (
                    <a
                      href={buildMessengerLink(property.agentMessenger)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-11 px-4 bg-[#F4F0E8] border border-[#E2DDD3] text-[#1C1B19] text-xs font-medium flex items-center justify-center gap-2 hover:border-[#B89B6A] transition-colors"
                    >
                      <Send className="w-4 h-4 text-[#8A6D3B]" />
                      <span>Chat on Messenger</span>
                    </a>
                  )}
                  {property.agentPhone && (
                    <a
                      href={`tel:${property.agentPhone.replace(/\s+/g, '')}`}
                      className="h-11 px-4 bg-[#F4F0E8] border border-[#E2DDD3] text-[#1C1B19] text-xs font-medium flex items-center justify-center gap-2 hover:border-[#B89B6A] transition-colors"
                    >
                      <Phone className="w-4 h-4 text-[#8A6D3B]" />
                      <span>Call {property.agentPhone}</span>
                    </a>
                  )}
                </div>
              ) : (
                <p className="text-xs text-[#6B665E] bg-[#F4F0E8] border border-[#E2DDD3] px-3.5 py-2.5">
                  Direct phone/messaging contact has not been published for this preview listing yet. Please use the inquiry form below to contact BEN MICUBO REAL ESTATE SERVICES.
                </p>
              )}
            </div>

            {/* 5-Page Printable A4 Editorial Dossier Card */}
            <div className="p-6 border border-[#E2DDD3] bg-[#F4F0E8] space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                    Editorial Monograph
                  </p>
                  <h2 className="mt-0.5 font-editorial text-xl font-semibold text-[#1C1B19]">
                    5-Page Property Dossier
                  </h2>
                </div>
                <FileText className="w-5 h-5 text-[#8A6D3B] shrink-0" />
              </div>
              <p className="text-xs text-[#6B665E] leading-relaxed">
                Preview or export the complete 5-page A4 folio containing approved imagery, land specifications, public documents, coordinates, and QR verification.
              </p>
              <Link
                to={dossierRoute}
                className="inline-flex w-full items-center justify-center gap-2 h-10 px-4 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D] transition-colors"
              >
                <Printer className="w-4 h-4 text-[#B89B6A]" />
                <span>Preview &amp; Print A4 Dossier (PDF)</span>
              </Link>
            </div>

            {/* Buyer Inquiry Form */}
            <div id="inquiry-card" className="p-6 border border-[#E2DDD3] bg-white">
              <h2 className="font-editorial text-2xl font-semibold text-[#1C1B19]">
                Inquire About {property.lotId}
              </h2>
              <p className="mt-1 text-xs text-[#6B665E] mb-4">
                Request pricing terms, certified true copy of title, sample computation, or schedule a site tripping.
              </p>
              <InquiryForm propertyLotId={property.lotId} propertyTitle={property.title} />
            </div>

            {/* Permanent QR Code & Signage Card */}
            <div className="p-6 border border-[#E2DDD3] bg-[#FAF8F4]">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="font-editorial text-xl font-semibold text-[#1C1B19]">
                    Permanent Property QR
                  </h2>
                  <p className="text-xs text-[#6B665E]">
                    Links permanently to /property/{property.lotId}
                  </p>
                </div>
                {canonicalUrlValidation.valid ? (
                  <Link
                    to={`/signage/${encodeURIComponent(property.lotId)}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A] transition-colors whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5 text-[#8A6D3B]" />
                    <span>Printable Sign</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    disabled
                    title="Configure VITE_PUBLIC_SITE_URL or a public HTTPS domain in Settings to enable printable QR signage."
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6B665E] bg-[#F4F0E8] border border-[#E2DDD3] opacity-70 cursor-not-allowed whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    <span>Signage Disabled</span>
                  </button>
                )}
              </div>

              <div className="flex flex-col items-center py-2">
                <QRCodeCanvas
                  url={qrTargetUrl}
                  lotId={property.lotId}
                  size={172}
                  canonicalValid={canonicalUrlValidation.valid}
                  blockedReason={canonicalUrlValidation.reason}
                />
              </div>

              <div className="mt-4 pt-4 border-t border-[#E2DDD3]">
                <div className="flex items-center justify-between gap-2 bg-[#F4F0E8] border border-[#E2DDD3] px-3 py-2">
                  <span className="text-xs font-mono text-[#1C1B19] truncate">
                    {canonicalUrlValidation.valid ? qrTargetUrl : `/property/${property.lotId}`}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyPermalink}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#8A6D3B] hover:underline shrink-0 cursor-pointer"
                  >
                    {copiedUrl ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Fullscreen Lightbox Modal */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Expanded property photo"
          onTouchStart={handleGalleryTouchStart}
          onTouchEnd={handleGalleryTouchEnd}
          className="fixed inset-0 z-50 bg-black/92 flex flex-col items-center justify-center p-4 touch-pan-y"
        >
          <button
            type="button"
            onClick={() => setLightboxOpen(false)}
            aria-label="Close photo viewer"
            className="absolute top-4 right-4 w-11 h-11 rounded-full bg-white/15 text-white flex items-center justify-center hover:bg-white/25 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="max-w-5xl w-full aspect-[16/10] relative flex items-center justify-center">
            <PropertyImage
              src={currentPhoto}
              alt={currentImage?.caption || `${property.title} full view`}
              loading="eager"
              onRecoverSignedUrl={
                isPreviewAllowed &&
                currentImage?.storageBucket === 'property-media-private' &&
                currentImage?.storagePath
                  ? () => refreshPrivateImageSignedUrl(currentImage.storagePath!)
                  : undefined
              }
              className="max-h-[80vh] w-auto object-contain"
            />
          </div>

          {currentImage?.caption && (
            <p className="mt-2 text-xs text-white/90 text-center max-w-2xl font-editorial italic">
              {currentImage.caption}
            </p>
          )}

          {galleryImages.length > 1 && (
            <div className="mt-4 flex items-center gap-4 text-white">
              <button
                type="button"
                onClick={handlePrevPhoto}
                className="px-4 py-2 text-xs font-medium bg-white/15 hover:bg-white/25 cursor-pointer"
              >
                Previous
              </button>
              <span className="text-xs font-mono">
                {safeActiveIndex + 1} / {galleryImages.length}
              </span>
              <button
                type="button"
                onClick={handleNextPhoto}
                className="px-4 py-2 text-xs font-medium bg-white/15 hover:bg-white/25 cursor-pointer"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
