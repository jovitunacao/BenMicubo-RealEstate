import {useEffect, useState} from 'react';
import {Link, useParams, useSearchParams} from 'react-router-dom';
import {
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
  Send,
  X,
} from 'lucide-react';
import {usePropertyStore} from '../context/PropertyStoreContext';
import {PropertyImage} from '../components/PropertyImage';
import {StatusIndicator} from '../components/StatusIndicator';
import {YouTubePlayer} from '../components/YouTubePlayer';
import {QRCodeCanvas} from '../components/QRCodeCanvas';
import {InquiryForm} from '../components/InquiryForm';
import {ShareListingButton} from '../components/ShareListingButton';
import {filterPublicDocuments, isPropertyPubliclyVisible} from '../services/propertyService';
import {getAuthorizedDocumentDownloadUrl} from '../services/storageService';
import {
  buildMessengerLink,
  buildWhatsAppLink,
  computePricePerSqm,
  formatDateShort,
  formatFileSize,
  formatPhp,
  formatSqm,
  getPropertyPermalink,
} from '../utils/format';

export function PropertyDetailPage() {
  const {lotId = ''} = useParams();
  const [searchParams] = useSearchParams();
  const {
    getByLotId,
    isLoading,
    siteSettings,
    canonicalUrlValidation,
    session,
    isDemoMode,
  } = usePropertyStore();
  const property = getByLotId(lotId);

  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [docError, setDocError] = useState('');

  useEffect(() => {
    setActivePhotoIndex(0);
    setLightboxOpen(false);
    setDocError('');
    window.scrollTo({top: 0});
  }, [lotId]);

  if (isLoading) {
    return (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="h-8 w-48 bg-[#F8F8FC] rounded animate-pulse mb-6" />
        <div className="aspect-[16/9] w-full bg-[#F8F8FC] rounded-xl animate-pulse" />
      </main>
    );
  }

  const isPreviewAllowed =
    searchParams.get('preview') === '1' && (Boolean(session) || isDemoMode);
  const publiclyVisible = property ? isPropertyPubliclyVisible(property) : false;

  if (!property || (!publiclyVisible && !isPreviewAllowed)) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <p className="font-mono text-xs text-[#696B77]">
          {property && !publiclyVisible ? 'Unpublished / Archived Listing' : '404 · Property Not Found'}
        </p>
        <h1 className="mt-2 font-display text-2xl font-bold text-[#202124]">
          {property && !publiclyVisible
            ? `${property.lotId} is currently ${property.visibility.toLowerCase()}`
            : `No active listing found for ${decodeURIComponent(lotId).toUpperCase()}`}
        </h1>
        <p className="mt-2 text-sm text-[#4B4D57]">
          {property && !publiclyVisible
            ? 'This property is not publicly published right now. Only published BEN MICUBO REAL ESTATE SERVICES listings are open to buyers.'
            : 'The lot identifier may have been archived or removed from this BEN MICUBO REAL ESTATE SERVICES directory.'}
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098]"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to All Properties
        </Link>
      </main>
    );
  }

  const galleryImages =
    property.images && property.images.length > 0
      ? property.images
      : property.photos.map((url, idx) => ({
          id: `fallback-${idx}`,
          url,
          caption: '',
          isCover: idx === 0,
          sortOrder: idx,
          isApprovedPublic: true,
          storageBucket: 'property-media-public' as const,
        }));

  const currentImage = galleryImages[activePhotoIndex] || galleryImages[0];
  const currentPhoto = currentImage?.url || '';
  const pricePerSqm =
    property.pricePerSqm || computePricePerSqm(property.priceTotalPhp, property.lotAreaSqm);
  const permalink = getPropertyPermalink(property.lotId, siteSettings.canonicalSiteUrl);
  const shareUrl = canonicalUrlValidation.valid
    ? permalink
    : typeof window !== 'undefined'
      ? window.location.href
      : permalink;

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

  const handlePrevPhoto = () => {
    setActivePhotoIndex((prev) => (prev === 0 ? galleryImages.length - 1 : prev - 1));
  };

  const handleNextPhoto = () => {
    setActivePhotoIndex((prev) => (prev === galleryImages.length - 1 ? 0 : prev + 1));
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
    <main className="bg-white pb-16">
      {/* Admin Preview Banner when previewing Draft / Archived */}
      {!publiclyVisible && isPreviewAllowed && (
        <div className="bg-[#F3EEFA] border-b border-[#DCD0F0]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#311A4D]">
            <div className="flex items-center gap-2 font-medium">
              <Eye className="w-4 h-4 text-[#6500B5]" />
              <span>
                Admin Preview Mode · This listing is <strong>{property.visibility}</strong> and is hidden from public buyers.
              </span>
            </div>
            <Link to="/admin" className="font-semibold text-[#6500B5] hover:underline">
              Return to Admin Dashboard →
            </Link>
          </div>
        </div>
      )}

      {/* Breadcrumb bar */}
      <div className="border-b border-[#E6E6EF] bg-[#F8F8FC]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs text-[#4B4D57]">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 min-w-0 truncate">
            <Link to="/" className="hover:text-[#6500B5] inline-flex items-center gap-1 shrink-0">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>All Listings</span>
            </Link>
            <span aria-hidden="true">/</span>
            <span className="truncate">{property.province}</span>
            <span aria-hidden="true">/</span>
            <span className="font-mono font-semibold text-[#10169C] shrink-0">
              {property.lotId}
            </span>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <ShareListingButton
              lotId={property.lotId}
              title={property.title}
              shareUrl={shareUrl}
              messengerHandle={property.agentMessenger}
            />
            <Link
              to={`/signage/${encodeURIComponent(property.lotId)}`}
              className="inline-flex items-center gap-1.5 font-medium text-[#6500B5] hover:underline whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print QR Sign</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Prominent Sold Notice Banner — Permanent URL remains accessible */}
      {property.status === 'Sold' && (
        <div className="bg-[#F8F8FC] border-b border-[#E6E6EF]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#202124]">
            <p>
              <strong>Property Status: SOLD.</strong> This parcel ({property.lotId}) has already been sold. You may still browse specifications below or inquire with BEN MICUBO REAL ESTATE SERVICES for similar nearby lots.
            </p>
            <Link to="/" className="font-semibold text-[#6500B5] hover:underline">
              Browse Available Lots →
            </Link>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        {/* Photo Gallery */}
        <section aria-label="Property photos">
          <div className="relative aspect-[16/10] sm:aspect-[16/9] w-full rounded-xl overflow-hidden border border-[#E6E6EF] bg-[#F8F8FC]">
            <PropertyImage
              src={currentPhoto}
              alt={
                currentImage?.caption ||
                `${property.title} — photo ${activePhotoIndex + 1}`
              }
              fallbackTitle={property.title}
              className="w-full h-full object-cover"
            />

            {galleryImages.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={handlePrevPhoto}
                  aria-label="Previous photo"
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 text-[#202124] border border-[#E6E6EF] flex items-center justify-center hover:bg-white transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={handleNextPhoto}
                  aria-label="Next photo"
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/90 text-[#202124] border border-[#E6E6EF] flex items-center justify-center hover:bg-white transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </>
            )}

            <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-3">
              {currentImage?.caption ? (
                <p className="px-3 py-1.5 text-xs text-white bg-black/65 rounded max-w-xl">
                  {currentImage.caption}
                </p>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 text-xs font-mono text-white bg-black/65 rounded">
                  {activePhotoIndex + 1} / {galleryImages.length}
                </span>
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  aria-label="Expand photo gallery"
                  className="w-9 h-9 rounded bg-black/65 text-white flex items-center justify-center hover:bg-black/80 transition-colors cursor-pointer"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {galleryImages.length > 1 && (
            <div className="mt-3 flex items-center gap-2.5 overflow-x-auto pb-1">
              {galleryImages.map((img, index) => (
                <button
                  key={img.id || `${img.url}-${index}`}
                  type="button"
                  onClick={() => setActivePhotoIndex(index)}
                  aria-label={`Select photo ${index + 1}`}
                  className={`relative w-24 h-16 rounded-lg overflow-hidden border shrink-0 cursor-pointer transition-opacity ${
                    activePhotoIndex === index
                      ? 'border-[#6500B5] ring-2 ring-[#6500B5]/25 opacity-100'
                      : 'border-[#E6E6EF] opacity-70 hover:opacity-100'
                  }`}
                >
                  <PropertyImage
                    src={img.url}
                    alt={img.caption || `${property.title} thumbnail ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Main 2-column Dossier Layout */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
          {/* Left Property Dossier Column */}
          <div className="lg:col-span-7 space-y-10">
            {/* Title & Price Header */}
            <header className="pb-6 border-b border-[#E6E6EF]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs text-[#696B77]">
                  <span className="font-mono font-semibold text-[#10169C]">{property.lotId}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {property.barangay}, {property.city}, {property.province}
                  </span>
                </div>
                <StatusIndicator status={property.status} />
              </div>

              <h1 className="mt-3 font-display text-2xl sm:text-4xl font-bold tracking-tight text-[#202124] [text-wrap:balance]">
                {property.title}
              </h1>

              <div className="mt-5 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                <div>
                  <span className="text-xs text-[#696B77] block">Total Selling Price</span>
                  <span className="font-display text-2xl sm:text-3xl font-bold text-[#202124] tabular-nums">
                    {formatPhp(property.priceTotalPhp)}
                  </span>
                  {property.isNegotiable && (
                    <span className="ml-2 text-xs font-medium text-[#6500B5]">
                      Negotiable
                    </span>
                  )}
                </div>
                <div>
                  <span className="text-xs text-[#696B77] block">Rate per Square Meter</span>
                  <span className="font-mono text-base sm:text-lg font-semibold text-[#6500B5] tabular-nums">
                    {formatPhp(pricePerSqm)} / sqm
                  </span>
                </div>
                <div className="sm:ml-auto text-xs text-[#696B77]">
                  Updated {formatDateShort(property.updatedAt)}
                </div>
              </div>
            </header>

            {/* Key Specifications Grid */}
            <section aria-labelledby="specs-heading">
              <h2 id="specs-heading" className="font-display text-lg font-semibold text-[#202124]">
                Land, Boundary &amp; Title Specifications
              </h2>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 border border-[#E6E6EF] rounded-xl overflow-hidden bg-white">
                <div className="p-4 border-b border-[#E6E6EF] sm:border-r">
                  <p className="text-xs text-[#696B77]">Land Area</p>
                  <p className="mt-1 text-sm font-semibold text-[#202124] tabular-nums">
                    {formatSqm(property.lotAreaSqm)}
                  </p>
                </div>
                <div className="p-4 border-b border-[#E6E6EF]">
                  <p className="text-xs text-[#696B77]">Lot Dimensions</p>
                  <p className="mt-1 text-sm font-semibold text-[#202124] tabular-nums">
                    {property.dimensions}
                  </p>
                </div>
                <div className="p-4 border-b border-[#E6E6EF] sm:border-r">
                  <p className="text-xs text-[#696B77]">Classification</p>
                  <p className="mt-1 text-sm font-semibold text-[#202124]">
                    {property.classification}
                  </p>
                </div>
                <div className="p-4 border-b border-[#E6E6EF]">
                  <p className="text-xs text-[#696B77]">Title Status</p>
                  <p className="mt-1 text-sm font-semibold text-[#202124]">
                    {property.titleStatus}
                  </p>
                </div>
                <div className="p-4 border-b border-[#E6E6EF] sm:border-r">
                  <p className="text-xs text-[#696B77]">Tax Declaration Status</p>
                  <p className="mt-1 text-sm font-semibold text-[#202124]">
                    {property.taxDeclarationStatus || 'Available upon request'}
                  </p>
                </div>
                <div className="p-4 border-b border-[#E6E6EF]">
                  <p className="text-xs text-[#696B77]">Road Access</p>
                  <p className="mt-1 text-sm font-semibold text-[#202124]">
                    {property.roadAccess}
                  </p>
                </div>
                <div className="p-4 border-b border-[#E6E6EF] sm:border-r">
                  <p className="text-xs text-[#696B77]">Terrain &amp; Elevation</p>
                  <p className="mt-1 text-sm font-semibold text-[#202124]">
                    {property.terrain}
                  </p>
                </div>
                <div className="p-4 border-b border-[#E6E6EF]">
                  <p className="text-xs text-[#696B77]">Utilities</p>
                  <p className="mt-1 text-sm font-semibold text-[#202124]">
                    {property.utilities || 'Power & water line accessible'}
                  </p>
                </div>
                {property.boundaryDescription && (
                  <div className="p-4 border-b border-[#E6E6EF] sm:col-span-2">
                    <p className="text-xs text-[#696B77]">Lot Boundaries</p>
                    <p className="mt-1 text-sm font-medium text-[#202124]">
                      {property.boundaryDescription}
                    </p>
                  </div>
                )}
                {property.nearbyLandmarks && (
                  <div className="p-4 sm:col-span-2">
                    <p className="text-xs text-[#696B77]">Nearby Landmarks</p>
                    <p className="mt-1 text-sm font-medium text-[#202124]">
                      {property.nearbyLandmarks}
                    </p>
                  </div>
                )}
              </div>
            </section>

            {/* Description & Highlights */}
            <section aria-labelledby="about-heading">
              <h2 id="about-heading" className="font-display text-lg font-semibold text-[#202124]">
                Property Overview
              </h2>
              <p className="mt-3 text-sm sm:text-base text-[#4B4D57] leading-relaxed">
                {property.description}
              </p>

              {property.additionalRemarks && (
                <div className="mt-4 p-4 rounded-lg border border-[#E6E6EF] bg-[#F8F8FC] text-xs text-[#4B4D57] leading-relaxed">
                  <span className="font-semibold text-[#202124]">Remarks &amp; Terms: </span>
                  {property.additionalRemarks}
                </div>
              )}

              {property.highlights.length > 0 && (
                <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {property.highlights.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2.5 text-sm text-[#202124] bg-[#F8F8FC] border border-[#E6E6EF] rounded-lg p-3.5"
                    >
                      <Check className="w-4 h-4 text-[#6500B5] shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Multiple Videos Section */}
            <section aria-labelledby="video-heading" className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <h2 id="video-heading" className="font-display text-lg font-semibold text-[#202124]">
                  Aerial Drone &amp; Property Videos ({videos.length})
                </h2>
              </div>

              {videos.length === 0 ? (
                <YouTubePlayer url="" title={property.title} posterFallback={currentPhoto} />
              ) : (
                <div className="space-y-6">
                  {videos.map((vid) => (
                    <div key={vid.id} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold text-[#202124]">
                            {vid.title || `${property.title} Video`}
                          </h3>
                          {vid.description && (
                            <p className="text-xs text-[#696B77]">{vid.description}</p>
                          )}
                        </div>
                        <a
                          href={vid.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#6500B5] hover:underline shrink-0"
                        >
                          <span>YouTube</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <YouTubePlayer
                        url={vid.url}
                        title={vid.title || property.title}
                        posterFallback={currentPhoto}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Public Buyer-Downloadable Documents Only */}
            {publicDocuments.length > 0 && (
              <section aria-labelledby="docs-heading" className="space-y-3">
                <h2 id="docs-heading" className="font-display text-lg font-semibold text-[#202124]">
                  Approved Public Documents ({publicDocuments.length})
                </h2>
                {docError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
                    {docError}
                  </p>
                )}
                <div className="space-y-2.5">
                  {publicDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-4 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] flex items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <FileText className="w-5 h-5 text-[#6500B5] shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-[#202124] truncate">
                            {doc.title}
                          </p>
                          <p className="text-xs text-[#696B77]">
                            {doc.category} · {doc.fileName} · {formatFileSize(doc.fileSizeBytes)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDownloadPublicDoc(doc.id)}
                        className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-[#6500B5] bg-white border border-[#DCD0F0] rounded-lg hover:bg-[#F3EEFA] shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Google Maps Location */}
            <section aria-labelledby="map-heading">
              <h2 id="map-heading" className="font-display text-lg font-semibold text-[#202124]">
                Site Location &amp; Google Maps Pin
              </h2>
              <div className="mt-3 p-5 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white border border-[#DCD0F0] flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5 text-[#6500B5]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#202124]">
                      {property.completeLocation ||
                        `${property.barangay}, ${property.city}, ${property.province}`}
                    </p>
                    <p className="text-xs text-[#4B4D57] mt-0.5">{property.region}</p>
                    <p className="text-xs font-mono text-[#696B77] mt-1 tabular-nums">
                      GPS: {property.latitude.toFixed(4)}° N, {property.longitude.toFixed(4)}° E
                    </p>
                  </div>
                </div>

                <a
                  href={property.googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 h-11 px-5 text-sm font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] transition-colors whitespace-nowrap shrink-0"
                >
                  <span>Open in Google Maps</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </section>
          </div>

          {/* Right Action & QR Column */}
          <aside className="lg:col-span-5 space-y-6">
            {/* Direct Contact Channels */}
            <div className="p-6 rounded-xl border border-[#E6E6EF] bg-white space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-[#696B77]">
                    BEN MICUBO REAL ESTATE SERVICES · Advisor
                  </p>
                  <p className="mt-0.5 font-display text-lg font-semibold text-[#202124]">
                    {property.agentName}
                  </p>
                  <p className="text-xs font-mono text-[#4B4D57] mt-0.5">{property.agentPhone}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2.5">
                <a
                  href={buildWhatsAppLink(property.agentWhatsapp, property.lotId, property.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-11 px-4 rounded-lg bg-[#6500B5] text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#540098] transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>Message on WhatsApp</span>
                </a>
                <a
                  href={buildMessengerLink(property.agentMessenger)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-11 px-4 rounded-lg bg-white border border-[#D6D6E4] text-[#202124] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#F8F8FC] transition-colors"
                >
                  <Send className="w-4 h-4 text-[#10169C]" />
                  <span>Chat on Messenger</span>
                </a>
                <a
                  href={`tel:${property.agentPhone.replace(/\s+/g, '')}`}
                  className="h-11 px-4 rounded-lg bg-white border border-[#D6D6E4] text-[#202124] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#F8F8FC] transition-colors"
                >
                  <Phone className="w-4 h-4 text-[#6500B5]" />
                  <span>Call {property.agentPhone}</span>
                </a>
              </div>
            </div>

            {/* Buyer Inquiry Form */}
            <div className="p-6 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC]">
              <h2 className="font-display text-lg font-semibold text-[#202124]">
                Inquire About {property.lotId}
              </h2>
              <p className="mt-1 text-xs text-[#4B4D57] mb-4">
                Request the certified true copy of title, sample computation, or schedule a site tripping.
              </p>
              <InquiryForm propertyLotId={property.lotId} propertyTitle={property.title} />
            </div>

            {/* Permanent QR Code & Signage Card */}
            <div className="p-6 rounded-xl border border-[#E6E6EF] bg-white">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-[#202124]">
                    Permanent Property QR
                  </h2>
                  <p className="text-xs text-[#696B77]">
                    Links permanently to /property/{property.lotId}
                  </p>
                </div>
                <Link
                  to={`/signage/${encodeURIComponent(property.lotId)}`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#6500B5] bg-[#F3EEFA] rounded-md hover:bg-[#E8DDF7] transition-colors whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Printable Sign</span>
                </Link>
              </div>

              <div className="flex flex-col items-center py-2">
                <QRCodeCanvas
                  url={permalink}
                  lotId={property.lotId}
                  size={172}
                  canonicalValid={canonicalUrlValidation.valid}
                  blockedReason={canonicalUrlValidation.reason}
                />
              </div>

              <div className="mt-4 pt-4 border-t border-[#EFEFF6]">
                <div className="flex items-center justify-between gap-2 bg-[#F8F8FC] border border-[#E6E6EF] rounded-lg px-3 py-2">
                  <span className="text-xs font-mono text-[#4B4D57] truncate">
                    {canonicalUrlValidation.valid ? permalink : `/property/${property.lotId}`}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyPermalink}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#6500B5] hover:underline shrink-0 cursor-pointer"
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
          className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4"
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
              className="max-h-[80vh] w-auto object-contain rounded-lg"
            />
          </div>

          {currentImage?.caption && (
            <p className="mt-2 text-xs text-white/90 text-center max-w-2xl">
              {currentImage.caption}
            </p>
          )}

          {galleryImages.length > 1 && (
            <div className="mt-4 flex items-center gap-4 text-white">
              <button
                type="button"
                onClick={handlePrevPhoto}
                className="px-4 py-2 text-xs font-medium bg-white/15 rounded-md hover:bg-white/25 cursor-pointer"
              >
                Previous
              </button>
              <span className="text-xs font-mono">
                {activePhotoIndex + 1} / {galleryImages.length}
              </span>
              <button
                type="button"
                onClick={handleNextPhoto}
                className="px-4 py-2 text-xs font-medium bg-white/15 rounded-md hover:bg-white/25 cursor-pointer"
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
