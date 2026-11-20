import {Download, ExternalLink, FileText, Globe, MapPin, MessageCircle, Phone, Send, Video} from 'lucide-react';
import type {PropertyDocumentItem} from '../types/property';
import type {DossierModel} from '../utils/dossierLayout';
import {CompanyLogo} from './CompanyLogo';
import {PropertyImage} from './PropertyImage';
import {QRCodeCanvas} from './QRCodeCanvas';

interface PropertyDossierA4Props {
  dossier: DossierModel;
  onDownloadDocument?: (doc: PropertyDocumentItem) => void;
}

function FolioHeader({
  lotId,
  sectionTitle,
  pageNumber,
}: {
  lotId: string;
  sectionTitle: string;
  pageNumber: number;
}) {
  return (
    <header className="flex items-center justify-between gap-4 pb-3 border-b border-[#E2DDD3] text-[10px] tracking-[0.16em] uppercase text-[#6B665E]">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="font-mono font-semibold text-[#1C1B19]">{lotId}</span>
        <span aria-hidden="true" className="text-[#B89B6A]">
          ·
        </span>
        <span className="truncate">{sectionTitle}</span>
      </div>
      <span className="font-mono shrink-0 text-[#1C1B19]">
        FOLIO 0{pageNumber} / 05
      </span>
    </header>
  );
}

function FolioFooter({
  lotId,
  updatedAtLabel,
  pageNumber,
}: {
  lotId: string;
  updatedAtLabel: string;
  pageNumber: number;
}) {
  return (
    <footer className="mt-auto pt-3 border-t border-[#E2DDD3] flex items-center justify-between gap-4 text-[10px] text-[#6B665E]">
      <span className="tracking-wider uppercase">
        BEN MICUBO REAL ESTATE SERVICES
      </span>
      <span className="font-mono">
        {lotId} · Updated {updatedAtLabel} · Page {pageNumber} of 5
      </span>
    </footer>
  );
}

export function PropertyDossierA4({dossier, onDownloadDocument}: PropertyDossierA4Props) {
  const {portfolio} = dossier;

  return (
    <div className="dossier-sheet-root flex flex-col items-center gap-8 print:block">
      {/* PAGE 1: COVER & EXECUTIVE BRIEF */}
      <article
        data-dossier-page="1"
        className="dossier-a4-page border border-[#E2DDD3] shadow-sm p-8 sm:p-11 flex flex-col justify-between"
      >
        <div>
          {/* Institutional Header */}
          <div className="flex items-center justify-between gap-4 pb-5 border-b border-[#E2DDD3]">
            <div className="flex items-center gap-3 min-w-0">
              <CompanyLogo size="sm" className="border border-[#E2DDD3] p-0.5" />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold tracking-[0.14em] uppercase text-[#1C1B19] truncate">
                  BEN MICUBO REAL ESTATE SERVICES
                </p>
                <p className="text-[10px] tracking-[0.14em] uppercase text-[#6B665E]">
                  Official Property Dossier
                </p>
              </div>
            </div>

            <div className="text-right shrink-0">
              <p className="font-mono text-xs font-semibold text-[#1C1B19]">{dossier.lotId}</p>
              <p className="text-[11px] text-[#6B665E]">
                {dossier.status} · {dossier.classification}
              </p>
            </div>
          </div>

          <div className="h-[1px] w-24 bg-[#B89B6A] -mt-[1px]" />

          {/* Hero Title */}
          <div className="mt-6">
            <p className="text-[11px] font-medium tracking-[0.16em] uppercase text-[#6B665E]">
              {dossier.locationLine}
              {dossier.regionLine ? ` · ${dossier.regionLine}` : ''}
            </p>
            <h1 className="mt-2 font-editorial text-3xl sm:text-[40px] leading-[1.08] font-semibold tracking-tight text-[#1C1B19] [text-wrap:balance]">
              {dossier.title}
            </h1>
          </div>

          {/* Primary Cover Plate */}
          <figure className="mt-6 dossier-avoid-break">
            <div className="aspect-[16/10] w-full bg-[#F4F0E8] border border-[#E2DDD3] overflow-hidden flex items-center justify-center">
              {portfolio.coverPhoto ? (
                <PropertyImage
                  src={portfolio.coverPhoto.url}
                  alt={portfolio.coverPhoto.caption || dossier.title}
                  fallbackTitle={dossier.title}
                  loading="eager"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-center px-6 py-10">
                  <p className="font-editorial text-xl italic text-[#6B665E]">
                    Approved cover photograph pending archival upload
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-[#6B665E]">
                    {dossier.lotId} · {dossier.locationLine}
                  </p>
                </div>
              )}
            </div>
            <figcaption className="mt-2 flex items-center justify-between gap-4 text-[11px] text-[#6B665E]">
              <span className="italic font-editorial text-sm">
                {portfolio.coverPhoto?.caption
                  ? `Plate I — ${portfolio.coverPhoto.caption}`
                  : `Plate I — ${dossier.title}`}
              </span>
              <span className="font-mono text-[10px] shrink-0">
                {portfolio.totalApprovedPhotos} approved plate
                {portfolio.totalApprovedPhotos === 1 ? '' : 's'}
              </span>
            </figcaption>
          </figure>

          {/* Valuation & 4-Metric Executive Strip */}
          <section className="mt-6 pt-5 border-t border-[#E2DDD3] dossier-avoid-break">
            <div className="flex flex-wrap items-baseline justify-between gap-4 pb-5 border-b border-[#E2DDD3]">
              <div>
                <p className="text-[10px] tracking-[0.16em] uppercase text-[#6B665E]">
                  Indicative Selling Price
                </p>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="font-editorial text-3xl sm:text-[34px] font-semibold text-[#1C1B19] tabular-nums">
                    {dossier.priceTotalLabel}
                  </span>
                  {dossier.isNegotiable && (
                    <span className="text-[11px] font-medium tracking-[0.12em] uppercase text-[#8A6D3B]">
                      Negotiable
                    </span>
                  )}
                </div>
              </div>

              <div className="sm:text-right">
                <p className="text-[10px] tracking-[0.16em] uppercase text-[#6B665E]">
                  Unit Rate
                </p>
                <p className="mt-1 font-mono text-base font-medium text-[#1C1B19] tabular-nums">
                  {dossier.pricePerSqmLabel}
                </p>
              </div>
            </div>

            <dl
              className={`grid border-b border-[#E2DDD3] ${
                dossier.executiveMetrics.length === 3
                  ? 'grid-cols-1 sm:grid-cols-3'
                  : 'grid-cols-2 sm:grid-cols-4'
              }`}
            >
              {dossier.executiveMetrics.map((metric, idx) => (
                <div
                  key={metric.label}
                  className={`py-3.5 ${
                    idx > 0
                      ? 'sm:pl-4 sm:border-l sm:border-[#E2DDD3] border-t border-[#E2DDD3] sm:border-t-0'
                      : 'pr-3'
                  } ${
                    dossier.executiveMetrics.length !== 3 && idx % 2 === 1
                      ? 'pl-4 border-l border-[#E2DDD3] sm:pl-4'
                      : 'pr-3'
                  }`}
                >
                  <dt className="text-[10px] tracking-[0.14em] uppercase text-[#6B665E]">
                    {metric.label}
                  </dt>
                  <dd
                    className={`mt-1 text-xs font-medium text-[#1C1B19] ${
                      metric.mono ? 'font-mono tabular-nums' : ''
                    }`}
                  >
                    {metric.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <FolioFooter
          lotId={dossier.lotId}
          updatedAtLabel={dossier.updatedAtLabel}
          pageNumber={1}
        />
      </article>

      {/* PAGE 2: SPATIAL NARRATIVE & CURATED PHOTO PORTFOLIO */}
      <article
        data-dossier-page="2"
        className="dossier-a4-page border border-[#E2DDD3] shadow-sm p-8 sm:p-11 flex flex-col justify-between"
      >
        <div className="space-y-6">
          <FolioHeader
            lotId={dossier.lotId}
            sectionTitle="Spatial Narrative & Photo Portfolio"
            pageNumber={2}
          />

          {/* Spatial Narrative */}
          <section>
            <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
              Property Overview
            </p>
            <h2 className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
              Site Character &amp; Context
            </h2>

            <div
              className={`mt-3 text-[13px] leading-[1.68] text-[#35322D] space-y-3 ${
                dossier.useCompactTwoColumnNarrative
                  ? 'sm:columns-2 sm:gap-6 print:columns-2 print:gap-6 text-[12px] leading-[1.58]'
                  : 'max-w-prose'
              }`}
            >
              {dossier.descriptionParagraphs.length > 0 ? (
                dossier.descriptionParagraphs.map((para, idx) => (
                  <p
                    key={idx}
                    className={
                      idx === 0
                        ? 'first-letter:font-editorial first-letter:text-4xl first-letter:font-semibold first-letter:float-left first-letter:mr-2 first-letter:mt-0.5 first-letter:leading-none first-letter:text-[#1C1B19]'
                        : ''
                    }
                  >
                    {para}
                  </p>
                ))
              ) : (
                <p className="italic text-[#6B665E]">
                  Property description available upon advisor consultation.
                </p>
              )}
            </div>

            {dossier.additionalRemarks && (
              <div className="mt-4 p-3.5 bg-[#F4F0E8] border border-[#E2DDD3] text-xs text-[#35322D] leading-relaxed dossier-avoid-break">
                <span className="font-semibold uppercase tracking-[0.1em] text-[10px] text-[#1C1B19] block mb-1">
                  Commercial Terms &amp; Remarks
                </span>
                {dossier.additionalRemarks}
              </div>
            )}

            {dossier.highlights.length > 0 && (
              <div className="mt-4 pt-3.5 border-t border-[#E2DDD3] dossier-avoid-break">
                <p className="text-[10px] tracking-[0.16em] uppercase text-[#6B665E] mb-2">
                  Distinguishing Attributes
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-[#1C1B19]">
                  {dossier.highlights.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span aria-hidden="true" className="text-[#B89B6A] font-serif">
                        —
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* Adaptive Curated Photo Portfolio */}
          <section className="pt-4 border-t border-[#E2DDD3]">
            <div className="flex items-baseline justify-between gap-4 mb-3">
              <h3 className="font-editorial text-xl font-semibold text-[#1C1B19]">
                Photographic Portfolio
              </h3>
              <span className="font-mono text-[10px] text-[#6B665E]">
                {portfolio.totalApprovedPhotos} approved plate
                {portfolio.totalApprovedPhotos === 1 ? '' : 's'}
              </span>
            </div>

            {portfolio.gridMode === 'none' && (
              <div className="p-6 bg-[#F4F0E8] border border-[#E2DDD3] text-center text-xs text-[#6B665E]">
                No approved photographs are currently attached to this folio.
              </div>
            )}

            {portfolio.gridMode === 'cover-only' && portfolio.coverPhoto && (
              <div className="p-4 bg-[#F4F0E8] border border-[#E2DDD3] flex items-center justify-between gap-4">
                <p className="text-xs text-[#35322D]">
                  Single primary photographic plate featured on Cover Folio (Plate I). Additional site angles may be requested from the assigned advisor.
                </p>
                <span className="font-mono text-[10px] text-[#6B665E] shrink-0">PLATE I / I</span>
              </div>
            )}

            {portfolio.gridMode === 'single-secondary' && portfolio.secondaryPhotos[0] && (
              <figure className="dossier-avoid-break">
                <div className="aspect-[16/9] w-full bg-[#F4F0E8] border border-[#E2DDD3] overflow-hidden">
                  <PropertyImage
                    src={portfolio.secondaryPhotos[0].url}
                    alt={portfolio.secondaryPhotos[0].caption || `${dossier.title} plate 2`}
                    className="w-full h-full object-cover"
                  />
                </div>
                <figcaption className="mt-1.5 text-[11px] italic font-editorial text-[#6B665E]">
                  Plate II — {portfolio.secondaryPhotos[0].caption || 'Secondary property perspective'}
                </figcaption>
              </figure>
            )}

            {portfolio.gridMode === 'two-up' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {portfolio.secondaryPhotos.map((img, idx) => (
                  <figure key={img.id || idx} className="dossier-avoid-break">
                    <div className="aspect-[4/3] w-full bg-[#F4F0E8] border border-[#E2DDD3] overflow-hidden">
                      <PropertyImage
                        src={img.url}
                        alt={img.caption || `${dossier.title} plate ${idx + 2}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <figcaption className="mt-1 text-[11px] italic font-editorial text-[#6B665E] truncate">
                      Plate {idx + 2} — {img.caption || 'Site perspective'}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}

            {portfolio.gridMode === 'three-up' && (
              <div className="grid grid-cols-3 gap-3">
                {portfolio.secondaryPhotos.map((img, idx) => (
                  <figure key={img.id || idx} className="dossier-avoid-break">
                    <div className="aspect-[4/3] w-full bg-[#F4F0E8] border border-[#E2DDD3] overflow-hidden">
                      <PropertyImage
                        src={img.url}
                        alt={img.caption || `${dossier.title} plate ${idx + 2}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <figcaption className="mt-1 text-[10px] italic font-editorial text-[#6B665E] truncate">
                      Plate {idx + 2} — {img.caption || 'Site perspective'}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}

            {portfolio.gridMode === 'four-to-six-grid' && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {portfolio.secondaryPhotos.map((img, idx) => (
                    <figure key={img.id || idx} className="dossier-avoid-break">
                      <div className="aspect-[4/3] w-full bg-[#F4F0E8] border border-[#E2DDD3] overflow-hidden">
                        <PropertyImage
                          src={img.url}
                          alt={img.caption || `${dossier.title} plate ${idx + 2}`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <figcaption className="mt-1 text-[10px] italic font-editorial text-[#6B665E] truncate">
                        Plate {idx + 2} — {img.caption || 'Site perspective'}
                      </figcaption>
                    </figure>
                  ))}
                </div>
                {portfolio.additionalOnlinePhotoCount > 0 && (
                  <p className="mt-2 font-mono text-[10px] text-[#6B665E]">
                    + {portfolio.additionalOnlinePhotoCount} additional approved plate
                    {portfolio.additionalOnlinePhotoCount === 1 ? '' : 's'} available via online property gallery.
                  </p>
                )}
              </>
            )}
          </section>
        </div>

        <FolioFooter
          lotId={dossier.lotId}
          updatedAtLabel={dossier.updatedAtLabel}
          pageNumber={2}
        />
      </article>

      {/* PAGE 3: LAND, LEGAL & PUBLIC DOCUMENT LEDGER */}
      <article
        data-dossier-page="3"
        className="dossier-a4-page border border-[#E2DDD3] shadow-sm p-8 sm:p-11 flex flex-col justify-between"
      >
        <div className="space-y-7">
          <FolioHeader
            lotId={dossier.lotId}
            sectionTitle="Land, Legal & Public Document Ledger"
            pageNumber={3}
          />

          <section>
            <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
              Technical Schedule
            </p>
            <h2 className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
              Land, Boundary &amp; Title Specifications
            </h2>

            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 border-t border-l border-[#E2DDD3] bg-[#FAF8F4]">
              {dossier.specificationLedger.map((spec) => (
                <div
                  key={spec.label}
                  className={`p-4 border-r border-b border-[#E2DDD3] dossier-avoid-break ${
                    spec.fullWidth ? 'sm:col-span-2' : ''
                  }`}
                >
                  <dt className="text-[10px] tracking-[0.14em] uppercase text-[#6B665E]">
                    {spec.label}
                  </dt>
                  <dd
                    className={`mt-1 text-xs sm:text-[13px] font-medium text-[#1C1B19] leading-relaxed ${
                      spec.mono ? 'font-mono tabular-nums' : ''
                    }`}
                  >
                    {spec.value}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="dossier-avoid-break">
            <div className="flex items-baseline justify-between gap-4 pb-2 border-b border-[#E2DDD3]">
              <div>
                <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                  Public Due Diligence Register
                </p>
                <h3 className="mt-0.5 font-editorial text-xl font-semibold text-[#1C1B19]">
                  Approved Public Documents ({dossier.publicDocuments.length})
                </h3>
              </div>
              <span className="font-mono text-[10px] text-[#6B665E]">
                PUBLIC CLEARANCE ONLY
              </span>
            </div>

            {dossier.publicDocuments.length === 0 ? (
              <div className="mt-3 p-5 bg-[#F4F0E8] border border-[#E2DDD3] text-xs text-[#35322D] leading-relaxed">
                No public buyer-downloadable files are published on this folio. Certified title documents, technical descriptions, and tax records are furnished strictly upon verified buyer inquiry.
              </div>
            ) : (
              <div className="mt-3 border-t border-[#E2DDD3]">
                {dossier.publicDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="py-3 border-b border-[#E2DDD3] flex items-center justify-between gap-4"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <FileText className="w-4 h-4 text-[#8A6D3B] shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#1C1B19] truncate">
                          {doc.title}
                        </p>
                        <p className="text-[11px] font-mono text-[#6B665E] truncate">
                          {doc.category} · {doc.fileName} · {doc.fileSizeLabel}
                        </p>
                      </div>
                    </div>

                    {onDownloadDocument && (
                      <button
                        type="button"
                        onClick={() => onDownloadDocument(doc.rawDocument)}
                        className="no-print inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A] shrink-0 cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5 text-[#8A6D3B]" />
                        <span>Download</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <p className="mt-3 text-[11px] text-[#6B665E] italic">
              Note: Confidential legal records remain restricted to verified due diligence and are excluded from public downloads and printed buyer folios.
            </p>
          </section>
        </div>

        <FolioFooter
          lotId={dossier.lotId}
          updatedAtLabel={dossier.updatedAtLabel}
          pageNumber={3}
        />
      </article>

      {/* PAGE 4: SITE GEOLOCATION & AERIAL VISUALS */}
      <article
        data-dossier-page="4"
        className="dossier-a4-page border border-[#E2DDD3] shadow-sm p-8 sm:p-11 flex flex-col justify-between"
      >
        <div className="space-y-6">
          <FolioHeader
            lotId={dossier.lotId}
            sectionTitle="Site Geolocation & Aerial Visuals"
            pageNumber={4}
          />

          <section className="dossier-avoid-break">
            <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
              Geographic Verification
            </p>
            <h2 className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
              Site Coordinates &amp; Google Maps Pin
            </h2>

            <div className="mt-3 p-5 bg-[#F4F0E8] border border-[#E2DDD3] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-9 h-9 border border-[#E2DDD3] bg-[#FAF8F4] flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4 text-[#8A6D3B]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1C1B19]">
                    {dossier.geolocation.completeLocation}
                  </p>
                  {dossier.geolocation.region && (
                    <p className="text-xs text-[#6B665E]">{dossier.geolocation.region}</p>
                  )}
                  <p className="mt-1 font-mono text-xs text-[#1C1B19] tabular-nums">
                    GPS: {dossier.geolocation.coordinatesDisplay}
                  </p>
                </div>
              </div>

              {dossier.geolocation.mapsPinUrl && (
                <a
                  href={dossier.geolocation.mapsPinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 h-9 px-4 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D] shrink-0 whitespace-nowrap"
                >
                  <span>Open in Google Maps</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>

            {dossier.geolocation.hasValidCoordinates && dossier.geolocation.mapsEmbedUrl ? (
              <>
                {/* Interactive Map on Screen */}
                <div className="mt-3 h-64 w-full border border-[#E2DDD3] bg-[#F4F0E8] overflow-hidden print:hidden">
                  <iframe
                    src={dossier.geolocation.mapsEmbedUrl}
                    title={`Google Maps pin for ${dossier.lotId}`}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    className="w-full h-full border-0"
                  />
                </div>
                {/* Print-safe Geolocation Plaque (avoids blank iframe blocks in browser PDF export) */}
                <div className="hidden print:flex mt-3 p-5 border border-[#E2DDD3] bg-[#FAF8F4] items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <p className="text-[10px] tracking-[0.14em] uppercase text-[#6B665E]">
                      Verified Google Maps Direct Reference
                    </p>
                    <p className="font-mono text-xs text-[#1C1B19] break-all">
                      {dossier.geolocation.mapsPinUrl}
                    </p>
                  </div>
                  <Globe className="w-5 h-5 text-[#B89B6A] shrink-0" />
                </div>
              </>
            ) : (
              <div className="mt-3 p-5 border border-[#E2DDD3] bg-[#FAF8F4] text-xs text-[#6B665E]">
                Exact parcel GPS coordinates are pending verification on this record.
              </div>
            )}
          </section>

          <section className="pt-4 border-t border-[#E2DDD3]">
            <div className="flex items-baseline justify-between gap-4 mb-3">
              <div>
                <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                  Motion &amp; Aerial Footage
                </p>
                <h3 className="mt-0.5 font-editorial text-xl font-semibold text-[#1C1B19]">
                  Aerial Drone &amp; Video Index ({dossier.videos.length})
                </h3>
              </div>
            </div>

            {dossier.videos.length === 0 ? (
              <div className="p-5 bg-[#F4F0E8] border border-[#E2DDD3] text-xs text-[#6B665E]">
                No aerial drone or walkthrough video links are attached to this folio.
              </div>
            ) : (
              <div className="space-y-3">
                {dossier.videos.slice(0, 4).map((vid, idx) => (
                  <div
                    key={vid.id}
                    className="p-3.5 border border-[#E2DDD3] bg-[#FAF8F4] flex items-center gap-4 dossier-avoid-break"
                  >
                    <div className="w-28 aspect-video bg-[#F4F0E8] border border-[#E2DDD3] shrink-0 overflow-hidden flex items-center justify-center">
                      {vid.thumbnailUrl ? (
                        <img
                          src={vid.thumbnailUrl}
                          alt={vid.title}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Video className="w-5 h-5 text-[#8A6D3B]" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-[#8A6D3B]">
                        Reel 0{idx + 1} · {vid.providerLabel}
                      </p>
                      <p className="text-xs font-semibold text-[#1C1B19] truncate">{vid.title}</p>
                      {vid.description && (
                        <p className="text-[11px] text-[#6B665E] line-clamp-1">{vid.description}</p>
                      )}
                      <a
                        href={vid.watchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-block font-mono text-[10px] text-[#1C1B19] underline break-all"
                      >
                        {vid.watchUrl}
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <FolioFooter
          lotId={dossier.lotId}
          updatedAtLabel={dossier.updatedAtLabel}
          pageNumber={4}
        />
      </article>

      {/* PAGE 5: PRIVATE ADVISORY & PERMANENT VERIFICATION QR */}
      <article
        data-dossier-page="5"
        className="dossier-a4-page border border-[#E2DDD3] shadow-sm p-8 sm:p-11 flex flex-col justify-between"
      >
        <div className="space-y-7">
          <FolioHeader
            lotId={dossier.lotId}
            sectionTitle="Private Advisory & Verification"
            pageNumber={5}
          />

          <section className="text-center max-w-lg mx-auto pt-2">
            <p className="text-[10px] tracking-[0.18em] uppercase text-[#8A6D3B]">
              Permanent Verification Folio
            </p>
            <h2 className="mt-2 font-editorial text-3xl font-semibold text-[#1C1B19]">
              Inspect, Verify &amp; Schedule Viewing
            </h2>
            <p className="mt-2 text-xs text-[#6B665E] leading-relaxed">
              Scan the permanent verification code below to access live parcel availability, interactive gallery plates, downloadable public documents, and direct site navigation.
            </p>
          </section>

          {/* Permanent QR Verification Plaque */}
          <section className="max-w-md mx-auto p-6 bg-[#F4F0E8] border border-[#E2DDD3] flex flex-col items-center text-center dossier-avoid-break">
            <div className="p-3 bg-white border border-[#E2DDD3]">
              <QRCodeCanvas
                url={dossier.qr.qrTargetUrl}
                lotId={dossier.lotId}
                size={184}
                canonicalValid={dossier.qr.canonicalValid}
                blockedReason={dossier.qr.canonicalReason}
              />
            </div>

            <p className="mt-4 text-[10px] tracking-[0.16em] uppercase text-[#6B665E]">
              Permanent Property URL
            </p>
            <p className="mt-1 font-mono text-xs font-medium text-[#1C1B19] break-all">
              {dossier.qr.permalinkDisplay}
            </p>
          </section>

          {/* Assigned Property Advisor */}
          <section className="border-t border-b border-[#E2DDD3] py-6 dossier-avoid-break">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
              <div>
                <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                  Assigned Property Advisor
                </p>
                <p className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]">
                  {dossier.advisor.name}
                </p>
                <p className="text-xs text-[#6B665E]">BEN MICUBO REAL ESTATE SERVICES</p>
              </div>

              <div className="space-y-2 text-xs text-[#1C1B19]">
                {dossier.advisor.hasDirectContact ? (
                  <>
                    {dossier.advisor.phone && (
                      <div className="flex items-center gap-2.5">
                        <Phone className="w-3.5 h-3.5 text-[#8A6D3B] shrink-0" />
                        <span className="font-mono font-medium">{dossier.advisor.phone}</span>
                      </div>
                    )}
                    {dossier.advisor.whatsapp && (
                      <div className="flex items-center gap-2.5">
                        <MessageCircle className="w-3.5 h-3.5 text-[#8A6D3B] shrink-0" />
                        <span>
                          WhatsApp: <span className="font-mono">{dossier.advisor.whatsapp}</span>
                        </span>
                      </div>
                    )}
                    {dossier.advisor.messenger && (
                      <div className="flex items-center gap-2.5">
                        <Send className="w-3.5 h-3.5 text-[#8A6D3B] shrink-0" />
                        <span>
                          Messenger: <span className="font-mono">{dossier.advisor.messenger}</span>
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-[#6B665E]">
                    Direct phone/messaging contact has not been published on this preview record. Submit inquiries via the online listing page.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* Institutional Colophon */}
          <section className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2 text-[11px] text-[#6B665E] dossier-avoid-break">
            <div className="flex items-center gap-3">
              <CompanyLogo size="sm" className="border border-[#E2DDD3] p-0.5" />
              <div>
                <p className="font-semibold text-[#1C1B19]">BEN MICUBO REAL ESTATE SERVICES</p>
                <p>Philippine Land &amp; Property Advisory</p>
              </div>
            </div>
            <p className="max-w-xs sm:text-right leading-relaxed">
              Specifications reflect saved lot records as of {dossier.updatedAtLabel}. Subject to prior sale or revision without notice.
            </p>
          </section>
        </div>

        <FolioFooter
          lotId={dossier.lotId}
          updatedAtLabel={dossier.updatedAtLabel}
          pageNumber={5}
        />
      </article>
    </div>
  );
}
