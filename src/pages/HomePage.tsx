import {useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {ArrowRight, MapPin, QrCode, Search, SlidersHorizontal} from 'lucide-react';
import {usePropertyStore} from '../context/PropertyStoreContext';
import {CompanyLogo} from '../components/CompanyLogo';
import {PropertyCard} from '../components/PropertyCard';
import {PropertyImage} from '../components/PropertyImage';
import {QRCodeCanvas} from '../components/QRCodeCanvas';
import {InquiryForm} from '../components/InquiryForm';
import {StatusIndicator} from '../components/StatusIndicator';
import {formatSqm, resolvePropertyPricingDisplay} from '../utils/format';
import {buildDistributableQrUrl} from '../utils/siteUrl';
import type {PropertyClassification, PropertyStatus} from '../types/property';

type StatusFilter = 'All' | PropertyStatus;
type ClassificationFilter = 'All' | PropertyClassification;
type SortOption = 'lot' | 'price-asc' | 'price-desc' | 'area-desc';

export function HomePage() {
  const {
    activeProperties,
    effectiveCanonicalSiteUrl,
    canonicalUrlValidation,
    isLoading,
    isDemoMode,
    isUsingDemoFallback,
    supabaseError,
  } = usePropertyStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [classificationFilter, setClassificationFilter] =
    useState<ClassificationFilter>('All');
  const [sortBy, setSortBy] = useState<SortOption>('lot');

  const featuredProperty = useMemo(() => {
    return (
      activeProperties.find((p) => p.isFeatured && p.status === 'Available') ||
      activeProperties.find((p) => p.isFeatured) ||
      activeProperties[0]
    );
  }, [activeProperties]);

  const filteredProperties = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = activeProperties.filter((prop) => {
      if (statusFilter !== 'All' && prop.status !== statusFilter) return false;
      if (classificationFilter !== 'All' && prop.classification !== classificationFilter)
        return false;
      if (!q) return true;
      return (
        prop.lotId.toLowerCase().includes(q) ||
        prop.title.toLowerCase().includes(q) ||
        prop.city.toLowerCase().includes(q) ||
        prop.province.toLowerCase().includes(q) ||
        prop.barangay.toLowerCase().includes(q) ||
        prop.classification.toLowerCase().includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'price-asc' || sortBy === 'price-desc') {
        const aVisible = a.showSellingPrice !== false && a.priceTotalPhp !== null && Number.isFinite(a.priceTotalPhp);
        const bVisible = b.showSellingPrice !== false && b.priceTotalPhp !== null && Number.isFinite(b.priceTotalPhp);
        if (aVisible && !bVisible) return -1;
        if (!aVisible && bVisible) return 1;
        if (!aVisible && !bVisible) return a.lotId.localeCompare(b.lotId);
        return sortBy === 'price-asc'
          ? (a.priceTotalPhp as number) - (b.priceTotalPhp as number)
          : (b.priceTotalPhp as number) - (a.priceTotalPhp as number);
      }
      if (sortBy === 'area-desc') return b.lotAreaSqm - a.lotAreaSqm;
      return a.lotId.localeCompare(b.lotId);
    });
  }, [activeProperties, searchQuery, statusFilter, classificationFilter, sortBy]);

  const totalSqm = useMemo(
    () => activeProperties.reduce((acc, item) => acc + item.lotAreaSqm, 0),
    [activeProperties]
  );

  const availableCount = useMemo(
    () => activeProperties.filter((item) => item.status === 'Available').length,
    [activeProperties]
  );

  const provinceCount = useMemo(
    () => new Set(activeProperties.map((item) => item.province)).size,
    [activeProperties]
  );

  const resetFilters = () => {
    setSearchQuery('');
    setStatusFilter('All');
    setClassificationFilter('All');
    setSortBy('lot');
  };

  const scrollToListings = () => {
    document.getElementById('listings-section')?.scrollIntoView({behavior: 'smooth'});
  };

  return (
    <main>
      {isDemoMode && (
        <div className="bg-[#F8F8FC] border-b border-[#E6E6EF]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-[#4B4D57]">
            <p>
              <span className="font-semibold text-[#202124]">Stage 1 Sample Data:</span>{' '}
              {isUsingDemoFallback && supabaseError
                ? `Supabase tables are not ready (${supabaseError}). Temporarily showing Philippine demo listings.`
                : 'Displaying Philippine demo listings stored in your browser. Ready for Stage 2 Supabase connection.'}
            </p>
            <Link
              to="/admin"
              className="font-medium text-[#6500B5] hover:underline whitespace-nowrap shrink-0"
            >
              Open Admin Demo →
            </Link>
          </div>
        </div>
      )}

      {/* Hero Section */}
      <section className="border-b border-[#E6E6EF] bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-between gap-6">
              <div>
                <div className="mb-4">
                  <CompanyLogo size="lg" className="border border-[#E6E6EF] px-2 py-1" />
                </div>
                <p className="text-xs font-semibold tracking-wide text-[#10169C]">
                  BEN MICUBO REAL ESTATE SERVICES
                </p>
                <h1 className="mt-4 font-display text-[clamp(2rem,3.8vw,3.25rem)] font-bold tracking-tight text-[#202124] leading-[1.08] [text-wrap:balance]">
                  Verified Philippine lots with instant QR property dossiers.
                </h1>
                <p className="mt-4 text-base text-[#4B4D57] leading-relaxed max-w-xl">
                  Scan any on-site signage board or browse below for verified titles, land area specifications, drone walkthroughs, and pinned Google Maps coordinates across Luzon and Visayas.
                </p>
              </div>

              {/* Search & Quick Entry */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Search
                      className="w-4 h-4 text-[#696B77] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                    <input
                      type="search"
                      aria-label="Search by Lot ID, city, province, or property type"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search Tagaytay, Batangas, Siargao, or LOT-001..."
                      className="w-full h-11 pl-10 pr-4 text-sm text-[#202124] bg-white border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={scrollToListings}
                    className="h-11 px-5 text-sm font-medium text-white bg-gradient-to-r from-[#6500B5] to-[#10169C] rounded-lg hover:opacity-95 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Browse Listings
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[#696B77]">
                  <span>Popular locations:</span>
                  {['Tagaytay', 'Nasugbu', 'Sta. Rosa', 'Siargao', 'Cebu'].map((city) => (
                    <button
                      key={city}
                      type="button"
                      onClick={() => {
                        setSearchQuery(city);
                        scrollToListings();
                      }}
                      className="text-[#4B4D57] hover:text-[#6500B5] underline underline-offset-4 cursor-pointer"
                    >
                      {city}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Featured Property Carrier */}
            <div className="lg:col-span-6">
              {featuredProperty ? (
                <Link
                  to={`/property/${encodeURIComponent(featuredProperty.lotId)}`}
                  className="group block h-full border border-[#E6E6EF] rounded-xl overflow-hidden bg-[#F8F8FC] hover:border-[#B9A7DE] transition-colors"
                >
                  <div className="relative aspect-[16/10] lg:h-[calc(100%-96px)] w-full overflow-hidden">
                    <PropertyImage
                      src={featuredProperty.photos[0]}
                      alt={featuredProperty.title}
                      fallbackTitle={featuredProperty.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                    <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent flex items-end p-5">
                      <p className="text-xs font-mono text-white/95">
                        Featured · {featuredProperty.lotId} · {featuredProperty.city},{' '}
                        {featuredProperty.province}
                      </p>
                    </div>
                  </div>
                  {(() => {
                    const featuredPricing = resolvePropertyPricingDisplay(featuredProperty);
                    return (
                      <div className="p-4 sm:p-5 bg-white flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <h2 className="font-display text-base sm:text-lg font-semibold text-[#202124] truncate">
                            {featuredProperty.title}
                          </h2>
                          <p className="text-xs text-[#4B4D57] mt-0.5 tabular-nums">
                            {formatSqm(featuredProperty.lotAreaSqm)} · {featuredProperty.classification}
                            {featuredPricing.secondarySubLabel
                              ? ` · ${featuredPricing.secondarySubLabel}`
                              : ''}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-display text-base sm:text-lg font-bold text-[#202124] tabular-nums">
                            {featuredPricing.primaryHeadlineLabel}
                          </p>
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-[#6500B5]">
                            Open Dossier <ArrowRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </Link>
              ) : null}
            </div>
          </div>

          {/* 4-column summary strip */}
          <div className="mt-10 pt-8 border-t border-[#EFEFF6] grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-[#696B77]">Active Listings</p>
              <p className="mt-1 font-display text-2xl font-bold text-[#202124] tabular-nums">
                {activeProperties.length}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#696B77]">Ready for Purchase</p>
              <p className="mt-1 font-display text-2xl font-bold text-[#6500B5] tabular-nums">
                {availableCount} Available
              </p>
            </div>
            <div>
              <p className="text-xs text-[#696B77]">Total Land Inventory</p>
              <p className="mt-1 font-display text-2xl font-bold text-[#202124] tabular-nums">
                {formatSqm(totalSqm)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[#696B77]">Provinces Covered</p>
              <p className="mt-1 font-display text-2xl font-bold text-[#10169C] tabular-nums">
                {provinceCount} Regions
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Listings Grid Section */}
      <section id="listings-section" className="py-12 sm:py-16 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#E6E6EF]">
            <div>
              <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#202124]">
                Property Listings
              </h2>
              <p className="mt-1 text-sm text-[#4B4D57]">
                Each listing carries a permanent URL and downloadable QR code for field signage.
              </p>
            </div>
            <p className="text-xs text-[#696B77] font-mono tabular-nums">
              Showing {filteredProperties.length} of {activeProperties.length} properties
            </p>
          </div>

          {/* Filter & Sort Controls */}
          <div className="py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Segmented status filter */}
            <div
              role="group"
              aria-label="Filter by availability status"
              className="inline-flex items-center gap-1 p-1 bg-[#F8F8FC] border border-[#E6E6EF] rounded-lg self-start overflow-x-auto max-w-full"
            >
              {(['All', 'Available', 'Reserved', 'Sold'] as StatusFilter[]).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    statusFilter === status
                      ? 'bg-[#6500B5] text-white'
                      : 'text-[#4B4D57] hover:text-[#202124]'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-[#696B77]" aria-hidden="true" />
                <select
                  aria-label="Filter by property classification"
                  value={classificationFilter}
                  onChange={(e) =>
                    setClassificationFilter(e.target.value as ClassificationFilter)
                  }
                  className="h-10 px-3 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
                >
                  <option value="All">All Classifications</option>
                  <option value="Residential">Residential</option>
                  <option value="Beachfront">Beachfront</option>
                  <option value="Commercial">Commercial</option>
                  <option value="Agricultural">Agricultural</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <select
                aria-label="Sort property listings"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="h-10 px-3 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              >
                <option value="lot">Sort: Lot ID</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="area-desc">Lot Area: Largest First</option>
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-2">
              {[1, 2, 3].map((n) => (
                <div
                  key={n}
                  className="h-96 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] animate-pulse"
                />
              ))}
            </div>
          ) : filteredProperties.length === 0 ? (
            <div className="mt-4 p-10 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] text-center">
              <MapPin className="w-7 h-7 text-[#6500B5] mx-auto mb-3" />
              <h3 className="font-display text-lg font-semibold text-[#202124]">
                No matching properties found
              </h3>
              <p className="mt-1 text-sm text-[#4B4D57]">
                Try clearing your location search or switching availability filters.
              </p>
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 px-4 py-2 text-xs font-medium text-white bg-[#6500B5] rounded-md hover:bg-[#540098] cursor-pointer"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-2">
              {filteredProperties.map((property) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* QR Signage Workflow Section */}
      <section id="qr-workflow" className="py-12 sm:py-16 bg-[#F8F8FC] border-y border-[#E6E6EF]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-7 space-y-6">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#10169C]">
                Built for Field Tarpaulins &amp; Site Boards
              </p>
              <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#202124] [text-wrap:balance]">
                One permanent QR code per parcel. Never reprint signs when prices change.
              </h2>
            </div>

            <div className="space-y-5">
              <div className="pt-4 border-t border-[#E6E6EF]">
                <h3 className="font-display text-base font-semibold text-[#202124]">
                  01. Permanent Lot URLs
                </h3>
                <p className="mt-1 text-sm text-[#4B4D57] leading-relaxed">
                  Every lot is assigned a stable route such as{' '}
                  <code className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border border-[#E6E6EF]">
                    /property/LOT-001
                  </code>
                  . Even if the selling price, status, or photos are updated later, installed QR signboards remain valid.
                </p>
              </div>
              <div className="pt-4 border-t border-[#E6E6EF]">
                <h3 className="font-display text-base font-semibold text-[#202124]">
                  02. Mobile-First Buyer Experience
                </h3>
                <p className="mt-1 text-sm text-[#4B4D57] leading-relaxed">
                  Scanning from a phone opens photos, land area and frontage details, road access, lazy-loaded YouTube and Google Drive drone footage, Google Maps pin links, and one-tap WhatsApp or Messenger contact.
                </p>
              </div>
              <div className="pt-4 border-t border-[#E6E6EF]">
                <h3 className="font-display text-base font-semibold text-[#202124]">
                  03. Print-Ready Signage Sheet
                </h3>
                <p className="mt-1 text-sm text-[#4B4D57] leading-relaxed">
                  Export high-resolution PNG or vector SVG QR codes directly from any property page or print a clean A4 site signboard layout with BEN MICUBO REAL ESTATE SERVICES branding.
                </p>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5">
            {featuredProperty && (
              <div className="bg-white border border-[#E6E6EF] rounded-xl p-6 sm:p-8 flex flex-col items-center text-center">
                <div className="flex items-center gap-2 text-xs font-mono text-[#10169C] mb-4">
                  <QrCode className="w-4 h-4 text-[#6500B5]" />
                  <span>{featuredProperty.lotId} Live Signage Preview</span>
                </div>
                <QRCodeCanvas
                  url={
                    buildDistributableQrUrl(
                      effectiveCanonicalSiteUrl,
                      featuredProperty.lotId
                    ) || ''
                  }
                  lotId={featuredProperty.lotId}
                  size={176}
                  showDownloads={false}
                  canonicalValid={canonicalUrlValidation.valid}
                  blockedReason={canonicalUrlValidation.reason}
                />
                <div className="mt-4">
                  <p className="font-display text-base font-semibold text-[#202124]">
                    {featuredProperty.title}
                  </p>
                  <p className="text-xs text-[#696B77] mt-1">
                    {featuredProperty.city}, {featuredProperty.province} ·{' '}
                    {formatSqm(featuredProperty.lotAreaSqm)}
                  </p>
                  <div className="mt-2 flex justify-center">
                    <StatusIndicator status={featuredProperty.status} />
                  </div>
                </div>
                <div className="mt-5 flex flex-wrap justify-center gap-2.5 w-full">
                  {canonicalUrlValidation.valid ? (
                    <Link
                      to={`/signage/${encodeURIComponent(featuredProperty.lotId)}`}
                      className="flex-1 min-w-[140px] py-2.5 px-4 text-xs font-medium text-white bg-[#6500B5] rounded-md hover:bg-[#540098] transition-colors whitespace-nowrap"
                    >
                      Open Print Signage
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="Configure VITE_PUBLIC_SITE_URL or a public HTTPS domain in Admin Settings before printing QR signage."
                      className="flex-1 min-w-[140px] py-2.5 px-4 text-xs font-medium text-[#696B77] bg-[#F8F8FC] border border-[#D6D6E4] rounded-md opacity-70 cursor-not-allowed whitespace-nowrap"
                    >
                      Print Signage Disabled
                    </button>
                  )}
                  <Link
                    to={`/property/${encodeURIComponent(featuredProperty.lotId)}`}
                    className="flex-1 min-w-[140px] py-2.5 px-4 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-md hover:bg-[#F8F8FC] transition-colors whitespace-nowrap"
                  >
                    View Dossier
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* General Buyer Inquiry Section */}
      <section id="inquiry-section" className="py-12 sm:py-16 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="mb-8">
            <p className="text-xs font-semibold tracking-wide text-[#10169C]">
              Direct Buyer Assistance · BEN MICUBO REAL ESTATE SERVICES
            </p>
            <h2 className="mt-2 font-display text-2xl sm:text-3xl font-bold tracking-tight text-[#202124]">
              Request a property viewing or title verification
            </h2>
            <p className="mt-2 text-sm text-[#4B4D57]">
              Looking for a specific lot size, beachfront frontage, or agricultural parcel in the Philippines? Send an inquiry below.
            </p>
          </div>
          <div className="p-6 sm:p-8 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC]">
            <InquiryForm
              propertyLotId={null}
              propertyTitle="General Philippine Property Inquiry"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
