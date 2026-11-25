import {useEffect, useState} from 'react';
import {Link, useParams, useSearchParams} from 'react-router-dom';
import {AlertTriangle, ArrowLeft, Eye, FileText, Printer, RefreshCw} from 'lucide-react';
import {usePropertyStore} from '../context/PropertyStoreContext';
import {PropertyDossierA4} from '../components/PropertyDossierA4';
import {getAuthorizedDocumentDownloadUrl} from '../services/storageService';
import type {PropertyDocumentItem} from '../types/property';
import {buildPropertyDossierModel} from '../utils/dossierLayout';

export function DossierPrintPage() {
  const {lotId = ''} = useParams();
  const [searchParams] = useSearchParams();
  const {
    getByLotId,
    isLoading,
    effectiveCanonicalSiteUrl,
    isAdminAuthorized,
    isDemoMode,
    isServiceUnavailable,
    refreshAll,
  } = usePropertyStore();
  const property = getByLotId(lotId);
  const [docError, setDocError] = useState('');

  const isPreviewAllowed =
    searchParams.get('preview') === '1' && (isAdminAuthorized || isDemoMode);

  useEffect(() => {
    setDocError('');
    window.scrollTo({top: 0});
  }, [lotId]);

  if (isLoading) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#F4F0E8] py-12 px-4">
        <div className="max-w-[210mm] mx-auto h-96 bg-[#FAF8F4] border border-[#E2DDD3] animate-pulse" />
      </main>
    );
  }

  if (!property && isServiceUnavailable) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#FAF8F4] py-20 px-4 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-700 mx-auto mb-3" />
        <p className="font-mono text-xs text-[#8A6D3B] uppercase tracking-widest">
          Temporary Service Interruption
        </p>
        <h1 className="mt-2 font-editorial text-3xl font-semibold text-[#1C1B19]">
          Property Dossier Temporarily Unavailable
        </h1>
        <p className="mt-2 max-w-md mx-auto text-sm text-[#6B665E]">
          Unable to connect to the live database for {decodeURIComponent(lotId).toUpperCase()}. Please retry shortly.
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
            <span>Back to All Listings</span>
          </Link>
        </div>
      </main>
    );
  }

  if (!property) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#FAF8F4] py-20 px-4 text-center">
        <p className="font-mono text-xs text-[#6B665E]">404 · Property Not Found</p>
        <h1 className="mt-2 font-editorial text-3xl font-semibold text-[#1C1B19]">
          No listing found for {decodeURIComponent(lotId).toUpperCase()}
        </h1>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to All Listings</span>
        </Link>
      </main>
    );
  }

  const dossier = buildPropertyDossierModel(property, {
    isPreviewAllowed,
    effectiveCanonicalSiteUrl,
  });

  if (!dossier.accessible) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#FAF8F4] py-20 px-4 text-center">
        <p className="font-mono text-xs text-[#8A6D3B] uppercase tracking-widest">
          Restricted Dossier
        </p>
        <h1 className="mt-2 font-editorial text-3xl font-semibold text-[#1C1B19]">
          {property.lotId} is currently {property.visibility.toLowerCase()}
        </h1>
        <p className="mt-2 max-w-md mx-auto text-sm text-[#6B665E]">
          {dossier.reason}
        </p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D]"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to All Listings</span>
        </Link>
      </main>
    );
  }

  const handleDownloadPublicDoc = async (doc: PropertyDocumentItem) => {
    setDocError('');
    if (doc.visibility !== 'Public') {
      setDocError('Confidential admin documents cannot be downloaded from printable dossiers.');
      return;
    }
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

  const backHref = `/property/${encodeURIComponent(property.lotId)}${
    dossier.isPreviewMode ? '?preview=1' : ''
  }`;

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#EAE4D8] py-8 px-4 sm:px-6 print:bg-white print:p-0 print:min-h-0">
      {/* Non-Print Editorial Preview & PDF Export Toolbar */}
      <div className="no-print max-w-[210mm] mx-auto mb-6 space-y-3">
        {dossier.isPreviewMode && (
          <div className="bg-[#FAF8F4] border border-[#B89B6A] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#1C1B19]">
            <div className="flex items-center gap-2 font-medium">
              <Eye className="w-4 h-4 text-[#8A6D3B]" />
              <span>
                Admin Dossier Preview · This listing is <strong>{property.visibility}</strong> and hidden from public visitors.
              </span>
            </div>
            <Link to="/admin" className="font-semibold text-[#8A6D3B] hover:underline">
              Admin Console →
            </Link>
          </div>
        )}

        <div className="bg-[#FAF8F4] border border-[#E2DDD3] px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to={backHref}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B665E] hover:text-[#1C1B19] shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to {property.lotId}</span>
            </Link>
            <span aria-hidden="true" className="text-[#E2DDD3]">
              |
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-[#1C1B19] font-medium truncate">
              <FileText className="w-3.5 h-3.5 text-[#8A6D3B] shrink-0" />
              <span className="truncate">5-Page A4 Editorial Dossier</span>
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {dossier.qr.canonicalValid && (
              <Link
                to={`/signage/${encodeURIComponent(property.lotId)}`}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A] whitespace-nowrap"
              >
                <span>QR Signboard</span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 h-9 px-4 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D] transition-colors cursor-pointer whitespace-nowrap"
            >
              <Printer className="w-4 h-4 text-[#B89B6A]" />
              <span>Print / Save as PDF (A4)</span>
            </button>
          </div>
        </div>

        {docError && (
          <p className="text-xs text-red-800 bg-red-50 border border-red-200 px-4 py-2.5">
            {docError}
          </p>
        )}
      </div>

      {/* 5-Page A4 Editorial Dossier Sheets */}
      <PropertyDossierA4 dossier={dossier} onDownloadDocument={handleDownloadPublicDoc} />
    </main>
  );
}
