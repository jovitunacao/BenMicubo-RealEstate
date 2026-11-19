import {useState} from 'react';
import {Link, useParams} from 'react-router-dom';
import {AlertTriangle, ArrowLeft, MapPin, Phone, Printer, Settings} from 'lucide-react';
import {usePropertyStore} from '../context/PropertyStoreContext';
import {CompanyLogo} from '../components/CompanyLogo';
import {QRCodeCanvas} from '../components/QRCodeCanvas';
import {formatPhp, formatSqm} from '../utils/format';
import {buildDistributableQrUrl} from '../utils/siteUrl';

export function SignagePrintPage() {
  const {lotId = ''} = useParams();
  const {getByLotId, effectiveCanonicalSiteUrl, canonicalUrlValidation} = usePropertyStore();
  const property = getByLotId(lotId);
  const [showPriceOnSign, setShowPriceOnSign] = useState(false);

  if (!property) {
    return (
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <h1 className="font-display text-2xl font-bold text-[#202124]">
          Property {decodeURIComponent(lotId).toUpperCase()} not found
        </h1>
        <Link
          to="/"
          className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#6500B5] hover:underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Listings
        </Link>
      </main>
    );
  }

  const permalink =
    buildDistributableQrUrl(effectiveCanonicalSiteUrl, property.lotId) || '';
  const canGeneratePrintQr = canonicalUrlValidation.valid && Boolean(permalink);

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#F8F8FC] py-8 px-4 sm:px-6">
      {/* Non-print toolbar */}
      <div className="no-print max-w-3xl mx-auto mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white border border-[#E6E6EF] rounded-xl p-4">
        <div className="flex items-center gap-3">
          <Link
            to={`/property/${encodeURIComponent(property.lotId)}`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4B4D57] hover:text-[#6500B5]"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to {property.lotId}</span>
          </Link>
          <span aria-hidden="true" className="text-[#D6D6E4]">|</span>
          <label className="inline-flex items-center gap-2 text-xs text-[#202124] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showPriceOnSign}
              onChange={(e) => setShowPriceOnSign(e.target.checked)}
              className="rounded border-[#D6D6E4] accent-[#6500B5]"
            />
            <span>Include price on printed sign</span>
          </label>
        </div>

        <button
          type="button"
          disabled={!canGeneratePrintQr}
          onClick={() => window.print()}
          className="inline-flex items-center justify-center gap-2 h-10 px-5 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
        >
          <Printer className="w-4 h-4" />
          <span>Print Signage (A4)</span>
        </button>
      </div>

      {/* Guardrail Blocking Printable QR Signage When Canonical Domain Is Invalid */}
      {!canGeneratePrintQr ? (
        <section className="max-w-2xl mx-auto bg-white border border-amber-300 rounded-2xl p-8 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-700" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-[#202124]">
                Printable QR Signage Disabled — Public Website URL Required
              </h1>
              <p className="mt-1.5 text-sm text-[#4B4D57] leading-relaxed">
                {canonicalUrlValidation.reason ||
                  'A valid HTTPS public website URL must be configured before generating QR codes or printable signage for distribution.'}
              </p>
              <p className="mt-2 text-xs text-[#696B77] leading-relaxed">
                To ensure physical signage never encodes <code className="font-mono">localhost</code>, Google AI Studio preview links, or temporary development addresses, QR generation and printing stay disabled until you configure <code className="font-mono">VITE_PUBLIC_SITE_URL</code> or save your production HTTPS domain (for example <code className="font-mono">https://benmicuborealestate.pages.dev</code>) in Admin Settings.
              </p>
            </div>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Link
              to="/admin?tab=settings"
              className="inline-flex items-center gap-2 h-10 px-4 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098]"
            >
              <Settings className="w-4 h-4" />
              <span>Configure Production Domain in Settings</span>
            </Link>
            <Link
              to={`/property/${encodeURIComponent(property.lotId)}`}
              className="inline-flex items-center gap-2 h-10 px-4 text-xs font-medium text-[#202124] bg-[#F8F8FC] border border-[#D6D6E4] rounded-lg"
            >
              Return to Property Dossier
            </Link>
          </div>
        </section>
      ) : (
        /* Printable A4 Signboard Sheet */
        <article className="max-w-2xl mx-auto bg-white border-2 border-[#202124] rounded-2xl overflow-hidden shadow-xs print:shadow-none print:rounded-none">
          {/* Top Purple-to-Blue Accent Band with White Logo Card */}
          <div className="bg-gradient-to-r from-[#6500B5] via-[#7900C8] to-[#10169C] text-white px-6 sm:px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <div className="bg-white px-2.5 py-1.5 rounded-lg shrink-0">
                <CompanyLogo size="md" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium tracking-wider uppercase text-white/85">
                  Property {property.status === 'Sold' ? 'Sold' : 'For Sale'} · {property.classification}
                </p>
                <p className="mt-0.5 font-display text-base sm:text-xl font-bold tracking-tight leading-snug">
                  BEN MICUBO REAL ESTATE SERVICES
                </p>
              </div>
            </div>
            <div className="sm:text-right shrink-0">
              <p className="text-[11px] text-white/80">Lot ID</p>
              <p className="font-mono text-xl sm:text-2xl font-bold">{property.lotId}</p>
            </div>
          </div>

          {/* Center High-Contrast QR Focus */}
          <div className="px-8 py-10 text-center flex flex-col items-center bg-white">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-[#202124] tracking-tight max-w-md [text-wrap:balance]">
              Scan for Photos, Drone Video &amp; Google Maps
            </h1>
            <p className="mt-2 text-sm text-[#4B4D57]">
              Point your smartphone camera at the QR code below for live pricing and title details.
            </p>

            <div className="my-8">
              <QRCodeCanvas
                url={permalink}
                lotId={property.lotId}
                size={240}
                showDownloads
                canonicalValid={canonicalUrlValidation.valid}
              />
            </div>

            <div className="w-full max-w-lg border-t border-b border-[#E6E6EF] py-5 grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
              <div>
                <p className="text-xs text-[#696B77]">Lot Area &amp; Dimensions</p>
                <p className="mt-0.5 font-display text-lg font-bold text-[#202124] tabular-nums">
                  {formatSqm(property.lotAreaSqm)}
                </p>
                <p className="text-xs text-[#4B4D57] tabular-nums">{property.dimensions}</p>
              </div>
              <div>
                <p className="text-xs text-[#696B77]">Location</p>
                <p className="mt-0.5 font-display text-base font-semibold text-[#202124] flex items-start gap-1.5">
                  <MapPin className="w-4 h-4 text-[#6500B5] shrink-0 mt-0.5" />
                  <span>
                    {property.city}, {property.province}
                  </span>
                </p>
                <p className="text-xs text-[#4B4D57] pl-5">{property.barangay}</p>
              </div>
            </div>

            {showPriceOnSign && (
              <div className="mt-5">
                <p className="text-xs text-[#696B77]">Selling Price</p>
                <p className="font-display text-2xl font-bold text-[#6500B5] tabular-nums">
                  {formatPhp(property.priceTotalPhp)}
                </p>
              </div>
            )}
          </div>

          {/* Footer Contact Bar */}
          <div className="bg-[#F8F8FC] border-t border-[#E6E6EF] px-8 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-[#6500B5] text-white flex items-center justify-center shrink-0">
                <Phone className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs text-[#696B77]">
                  BEN MICUBO REAL ESTATE SERVICES · {property.agentName}
                </p>
                <p className="font-mono text-base font-bold text-[#202124]">
                  {property.agentPhone}
                </p>
              </div>
            </div>

            <div className="sm:text-right">
              <p className="text-xs text-[#696B77]">Permanent Listing Link</p>
              <p className="font-mono text-xs text-[#10169C] break-all">{permalink}</p>
            </div>
          </div>
        </article>
      )}
    </main>
  );
}
