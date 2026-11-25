import {useCallback, useEffect, useRef, useState} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Maximize2,
  Minimize2,
  Play,
  Presentation,
  RefreshCw,
  X,
} from 'lucide-react';
import type {PropertyPresentationItem} from '../types/property';
import {getAuthorizedPresentationAssetUrl} from '../services/storageService';
import {formatFileSize} from '../utils/format';
import {PropertyImage} from './PropertyImage';

interface PropertyPresentationViewerProps {
  lotId: string;
  propertyTitle: string;
  presentations: PropertyPresentationItem[];
  isPreviewAllowed?: boolean;
}

type PdfDocumentHandle = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{
    getViewport: (params: {scale: number}) => {width: number; height: number};
    render: (params: {
      canvasContext: CanvasRenderingContext2D;
      canvas: HTMLCanvasElement;
      viewport: {width: number; height: number};
    }) => {promise: Promise<void>; cancel: () => void};
  }>;
  destroy: () => Promise<void>;
};

export function PropertyPresentationViewer({
  lotId,
  propertyTitle,
  presentations,
  isPreviewAllowed = false,
}: PropertyPresentationViewerProps) {
  const [activePresentationId, setActivePresentationId] = useState<string | null>(null);
  const [isDeckOpen, setIsDeckOpen] = useState(false);
  const [isFullscreenModal, setIsFullscreenModal] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(1);
  const [totalSlides, setTotalSlides] = useState<number>(0);
  const [isLoadingDeck, setIsLoadingDeck] = useState(false);
  const [isRenderingSlide, setIsRenderingSlide] = useState(false);
  const [deckError, setDeckError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [isDownloadingKey, setIsDownloadingKey] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const pdfDocRef = useRef<PdfDocumentHandle | null>(null);
  const renderTaskRef = useRef<{cancel: () => void} | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  const activePresentation =
    presentations.find((p) => p.id === activePresentationId) || presentations[0] || null;

  const cleanupPdfInstance = useCallback(() => {
    try {
      renderTaskRef.current?.cancel();
    } catch {
      // Ignore cancellation errors on cleanup
    }
    renderTaskRef.current = null;
    const existingDoc = pdfDocRef.current;
    pdfDocRef.current = null;
    if (existingDoc) {
      void existingDoc.destroy().catch(() => {});
    }
  }, []);

  useEffect(() => {
    setActivePresentationId(presentations[0]?.id ?? null);
    setIsDeckOpen(false);
    setIsFullscreenModal(false);
    setCurrentSlide(1);
    setTotalSlides(0);
    setDeckError('');
    setDownloadError('');
    cleanupPdfInstance();
  }, [lotId, presentations, cleanupPdfInstance]);

  useEffect(() => {
    return () => {
      cleanupPdfInstance();
    };
  }, [cleanupPdfInstance]);

  const renderSlidePage = useCallback(
    async (pageNumber: number) => {
      const doc = pdfDocRef.current;
      const canvas = canvasRef.current;
      const container = stageContainerRef.current;
      if (!doc || !canvas) return;

      try {
        renderTaskRef.current?.cancel();
      } catch {
        // Ignore prior cancellation
      }

      setIsRenderingSlide(true);
      setDeckError('');
      try {
        const page = await doc.getPage(pageNumber);
        const baseViewport = page.getViewport({scale: 1});
        const containerWidth = container?.clientWidth
          ? Math.max(container.clientWidth - 2, 280)
          : isFullscreenModal
            ? 1080
            : 760;
        const maxStageHeight =
          typeof window !== 'undefined'
            ? isFullscreenModal
              ? Math.max(window.innerHeight - 170, 320)
              : Math.min(window.innerHeight * 0.68, 640)
            : 540;

        const widthScale = containerWidth / baseViewport.width;
        const heightScale = maxStageHeight / baseViewport.height;
        const cssScale = Math.min(widthScale, heightScale);
        const displayWidth = Math.max(240, Math.floor(baseViewport.width * cssScale));
        const displayHeight = Math.max(160, Math.floor(baseViewport.height * cssScale));

        const dpr =
          typeof window !== 'undefined'
            ? Math.min(window.devicePixelRatio || 1, 2)
            : 1;
        const renderViewport = page.getViewport({scale: cssScale * dpr});

        canvas.width = Math.max(1, Math.floor(renderViewport.width));
        canvas.height = Math.max(1, Math.floor(renderViewport.height));
        canvas.style.width = `${displayWidth}px`;
        canvas.style.height = `${displayHeight}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Browser canvas context unavailable for slide rendering.');
        }

        const task = page.render({
          canvasContext: ctx,
          canvas,
          viewport: renderViewport,
        });
        renderTaskRef.current = task;
        await task.promise;
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name !== 'RenderingCancelledException') {
          setDeckError(
            err instanceof Error
              ? err.message
              : 'Unable to render this presentation slide.'
          );
        }
      } finally {
        setIsRenderingSlide(false);
      }
    },
    [isFullscreenModal]
  );

  const openSlideDeck = useCallback(
    async (pres: PropertyPresentationItem) => {
      setActivePresentationId(pres.id);
      setIsDeckOpen(true);
      setCurrentSlide(1);
      setTotalSlides(pres.slideCount ?? 0);
      setDeckError('');
      setDownloadError('');

      const hasPdfAsset = Boolean(
        pres.pdfStoragePath || pres.pdfPublicUrl || pres.pdfDataUrl
      );
      if (!hasPdfAsset) {
        cleanupPdfInstance();
        setIsLoadingDeck(false);
        setDeckError(
          'Browser slide preview is unavailable because no PDF presentation file is attached to this record.'
        );
        return;
      }

      cleanupPdfInstance();
      setIsLoadingDeck(true);
      try {
        const assetUrl = await getAuthorizedPresentationAssetUrl(
          pres,
          'pdf',
          isPreviewAllowed
        );
        const [pdfjs, workerModule] = await Promise.all([
          import('pdfjs-dist'),
          import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ]);
        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;

        const loadingTask = pdfjs.getDocument({
          url: assetUrl,
          withCredentials: false,
        });
        const loadedDoc = (await loadingTask.promise) as unknown as PdfDocumentHandle;
        pdfDocRef.current = loadedDoc;
        setTotalSlides(loadedDoc.numPages);
        setCurrentSlide(1);
      } catch (err) {
        cleanupPdfInstance();
        setDeckError(
          err instanceof Error
            ? err.message
            : 'Failed to load presentation slides. Please try again.'
        );
      } finally {
        setIsLoadingDeck(false);
      }
    },
    [cleanupPdfInstance, isPreviewAllowed]
  );

  useEffect(() => {
    if (!isDeckOpen || isLoadingDeck || !pdfDocRef.current) return;
    void renderSlidePage(currentSlide);
  }, [isDeckOpen, isLoadingDeck, currentSlide, isFullscreenModal, renderSlidePage]);

  useEffect(() => {
    if (!isDeckOpen) return;
    const onResize = () => {
      if (pdfDocRef.current && !isLoadingDeck) {
        void renderSlidePage(currentSlide);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isDeckOpen, isLoadingDeck, currentSlide, renderSlidePage]);

  const goToPrevSlide = useCallback(() => {
    setCurrentSlide((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNextSlide = useCallback(() => {
    setCurrentSlide((prev) => (totalSlides > 0 ? Math.min(totalSlides, prev + 1) : prev));
  }, [totalSlides]);

  useEffect(() => {
    if (!isDeckOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrevSlide();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNextSlide();
      } else if (e.key === 'Home') {
        e.preventDefault();
        setCurrentSlide(1);
      } else if (e.key === 'End' && totalSlides > 0) {
        e.preventDefault();
        setCurrentSlide(totalSlides);
      } else if (e.key === 'Escape' && isFullscreenModal) {
        e.preventDefault();
        setIsFullscreenModal(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDeckOpen, isFullscreenModal, totalSlides, goToPrevSlide, goToNextSlide]);

  const handleToggleFullscreen = async () => {
    if (isFullscreenModal) {
      setIsFullscreenModal(false);
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        try {
          await document.exitFullscreen();
        } catch {
          // Ignore exitFullscreen fallback error
        }
      }
      return;
    }

    setIsFullscreenModal(true);
    try {
      if (stageContainerRef.current?.requestFullscreen) {
        await stageContainerRef.current.requestFullscreen();
      }
    } catch {
      // Responsive modal fallback remains active for iOS Safari / restricted embeds
    }
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onFsChange = () => {
      if (!document.fullscreenElement && isFullscreenModal) {
        // Leave modal open only if opened without native fullscreen; otherwise sync close cleanly
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, [isFullscreenModal]);

  const handleDownloadAsset = async (
    pres: PropertyPresentationItem,
    kind: 'pdf' | 'pptx'
  ) => {
    if (!pres.allowDownload && !isPreviewAllowed) {
      setDownloadError('Downloads are disabled for this presentation.');
      return;
    }
    const key = `${pres.id}-${kind}`;
    setDownloadError('');
    setIsDownloadingKey(key);
    try {
      const url = await getAuthorizedPresentationAssetUrl(
        pres,
        kind,
        isPreviewAllowed
      );
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download =
        kind === 'pdf'
          ? pres.pdfFileName || `${lotId}-presentation.pdf`
          : pres.pptxFileName || `${lotId}-presentation.pptx`;
      link.click();
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Unable to download presentation file.'
      );
    } finally {
      setIsDownloadingKey(null);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || totalSlides <= 1) {
      touchStartXRef.current = null;
      return;
    }
    const endX = e.changedTouches[0]?.clientX;
    if (typeof endX === 'number') {
      const deltaX = endX - touchStartXRef.current;
      if (deltaX <= -40) goToNextSlide();
      else if (deltaX >= 40) goToPrevSlide();
    }
    touchStartXRef.current = null;
  };

  if (presentations.length === 0) {
    return null;
  }

  const renderDeckStage = (inModal: boolean) => {
    if (!activePresentation) return null;
    const hasPdf = Boolean(
      activePresentation.pdfStoragePath ||
        activePresentation.pdfPublicUrl ||
        activePresentation.pdfDataUrl
    );
    const hasPptx = Boolean(
      activePresentation.pptxStoragePath ||
        activePresentation.pptxPublicUrl ||
        activePresentation.pptxDataUrl
    );
    const canDownload = activePresentation.allowDownload || isPreviewAllowed;

    return (
      <div
        className={`flex flex-col ${
          inModal ? 'h-full w-full max-w-6xl mx-auto justify-between gap-3' : 'space-y-3'
        }`}
      >
        {/* Deck Top Bar */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 border ${
            inModal
              ? 'bg-[#1C1B19] text-[#FAF8F4] border-white/15'
              : 'bg-[#F4F0E8] text-[#1C1B19] border-[#E2DDD3]'
          }`}
        >
          <div className="min-w-0">
            <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[#8A6D3B]">
              Property Briefing · {lotId}
            </p>
            <h3 className="text-sm sm:text-base font-editorial font-semibold truncate">
              {activePresentation.title}
            </h3>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span
              aria-live="polite"
              className={`px-2.5 py-1 text-xs font-mono border ${
                inModal
                  ? 'border-white/20 bg-white/10 text-[#FAF8F4]'
                  : 'border-[#E2DDD3] bg-[#FAF8F4] text-[#1C1B19]'
              }`}
            >
              {totalSlides > 0 ? `${currentSlide} / ${totalSlides}` : '— / —'}
            </span>

            <button
              type="button"
              onClick={() => void handleToggleFullscreen()}
              aria-label={inModal ? 'Exit fullscreen presentation' : 'Fullscreen presentation'}
              className={`inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium border cursor-pointer ${
                inModal
                  ? 'border-white/20 bg-white/10 text-[#FAF8F4] hover:bg-white/20'
                  : 'border-[#E2DDD3] bg-[#FAF8F4] text-[#1C1B19] hover:border-[#B89B6A]'
              }`}
            >
              {inModal ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5 text-[#B89B6A]" />
                  <span>Exit Fullscreen</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5 text-[#8A6D3B]" />
                  <span>Fullscreen</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsFullscreenModal(false);
                setIsDeckOpen(false);
                cleanupPdfInstance();
              }}
              aria-label="Close presentation viewer"
              className={`inline-flex items-center gap-1 h-8 px-2.5 text-xs font-medium border cursor-pointer ${
                inModal
                  ? 'border-white/20 bg-white/10 text-[#FAF8F4] hover:bg-white/20'
                  : 'border-[#E2DDD3] bg-[#FAF8F4] text-[#6B665E] hover:text-[#1C1B19]'
              }`}
            >
              <X className="w-3.5 h-3.5" />
              <span>Close</span>
            </button>
          </div>
        </div>

        {/* Slide Canvas Viewport */}
        <div
          ref={stageContainerRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onContextMenu={(e) => {
            if (!canDownload) e.preventDefault();
          }}
          className={`relative w-full max-w-full min-w-0 overflow-hidden border flex items-center justify-center touch-pan-y select-none ${
            inModal
              ? 'flex-1 min-h-0 bg-[#141311] border-white/15 p-2 sm:p-4'
              : 'min-h-[260px] sm:min-h-[380px] bg-[#EFECE5] border-[#E2DDD3] p-2 sm:p-4'
          }`}
        >
          {isLoadingDeck ? (
            <div className="py-16 px-6 text-center space-y-2">
              <div className="w-7 h-7 border-2 border-[#B89B6A] border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-medium text-[#1C1B19] bg-[#FAF8F4]/90 px-3 py-1">
                Loading slide deck...
              </p>
            </div>
          ) : deckError ? (
            <div className="max-w-md mx-auto p-6 bg-[#FAF8F4] border border-[#E2DDD3] text-center space-y-3">
              <Presentation className="w-6 h-6 text-[#8A6D3B] mx-auto" />
              <p className="text-xs text-[#35322D] leading-relaxed">{deckError}</p>
              {hasPdf && (
                <button
                  type="button"
                  onClick={() => void openSlideDeck(activePresentation)}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D] cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#B89B6A]" />
                  <span>Retry Loading Deck</span>
                </button>
              )}
            </div>
          ) : (
            <div className="relative flex items-center justify-center max-w-full overflow-hidden">
              <canvas
                ref={canvasRef}
                aria-label={`${activePresentation.title} — Slide ${currentSlide} of ${totalSlides}`}
                className="block max-w-full h-auto bg-white shadow-sm"
              />
              {isRenderingSlide && (
                <div className="absolute inset-0 bg-[#FAF8F4]/60 flex items-center justify-center pointer-events-none">
                  <span className="px-3 py-1 text-[11px] font-mono text-[#1C1B19] bg-[#FAF8F4] border border-[#E2DDD3]">
                    Rendering slide {currentSlide}...
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation & Optional Download Footer */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 border ${
            inModal
              ? 'bg-[#1C1B19] text-[#FAF8F4] border-white/15'
              : 'bg-[#FAF8F4] text-[#1C1B19] border-[#E2DDD3]'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={goToPrevSlide}
              disabled={isLoadingDeck || currentSlide <= 1}
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium border cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                inModal
                  ? 'border-white/20 bg-white/10 text-[#FAF8F4] hover:bg-white/20'
                  : 'border-[#E2DDD3] bg-[#F4F0E8] text-[#1C1B19] hover:border-[#B89B6A]'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>
            <button
              type="button"
              onClick={goToNextSlide}
              disabled={
                isLoadingDeck || totalSlides === 0 || currentSlide >= totalSlides
              }
              className={`inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium border cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                inModal
                  ? 'border-white/20 bg-[#B89B6A] text-[#1C1B19] hover:bg-[#c8ac7d]'
                  : 'border-[#1C1B19] bg-[#1C1B19] text-[#FAF8F4] hover:bg-[#35322D]'
              }`}
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
            <span
              className={`hidden sm:inline text-[11px] ml-2 ${
                inModal ? 'text-white/70' : 'text-[#6B665E]'
              }`}
            >
              Swipe or use ← / → arrow keys
            </span>
          </div>

          {canDownload && (hasPdf || hasPptx) && (
            <div className="flex flex-wrap items-center gap-2">
              {hasPdf && (
                <button
                  type="button"
                  disabled={isDownloadingKey === `${activePresentation.id}-pdf`}
                  onClick={() => void handleDownloadAsset(activePresentation, 'pdf')}
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A] cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5 text-[#8A6D3B]" />
                  <span>
                    PDF
                    {activePresentation.pdfFileSizeBytes > 0
                      ? ` (${formatFileSize(activePresentation.pdfFileSizeBytes)})`
                      : ''}
                  </span>
                </button>
              )}
              {hasPptx && (
                <button
                  type="button"
                  disabled={isDownloadingKey === `${activePresentation.id}-pptx`}
                  onClick={() => void handleDownloadAsset(activePresentation, 'pptx')}
                  className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] border border-[#1C1B19] hover:bg-[#35322D] cursor-pointer disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5 text-[#B89B6A]" />
                  <span>
                    PPTX
                    {activePresentation.pptxFileSizeBytes > 0
                      ? ` (${formatFileSize(activePresentation.pptxFileSizeBytes)})`
                      : ''}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <section
      id="presentations"
      aria-labelledby="presentations-heading"
      className="space-y-4 min-w-0 max-w-full"
    >
      <div>
        <p className="text-[10px] tracking-[0.16em] uppercase text-[#8A6D3B]">
          Executive Presentation Deck{presentations.length > 1 ? 's' : ''}
        </p>
        <h2
          id="presentations-heading"
          className="mt-1 font-editorial text-2xl font-semibold text-[#1C1B19]"
        >
          Property Presentations ({presentations.length})
        </h2>
        <p className="mt-1 text-xs text-[#6B665E]">
          Slide decks load on demand only when opened, keeping initial page loading fast on mobile data.
        </p>
      </div>

      {downloadError && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 p-3">
          {downloadError}
        </p>
      )}

      {/* Presentation Roster Cards — Zero PDF bytes downloaded until clicked */}
      <div className="grid grid-cols-1 gap-4">
        {presentations.map((pres) => {
          const isSelected = isDeckOpen && activePresentation?.id === pres.id;
          const hasPdf = Boolean(
            pres.pdfStoragePath || pres.pdfPublicUrl || pres.pdfDataUrl
          );
          const hasPptx = Boolean(
            pres.pptxStoragePath || pres.pptxPublicUrl || pres.pptxDataUrl
          );
          const canDownload = pres.allowDownload || isPreviewAllowed;

          return (
            <article
              key={pres.id}
              className={`border transition-colors bg-[#FAF8F4] overflow-hidden ${
                isSelected ? 'border-[#B89B6A]' : 'border-[#E2DDD3]'
              }`}
            >
              <div className="flex flex-col sm:flex-row">
                {/* Cover Thumbnail or Typographic Presentation Cover */}
                <div className="sm:w-52 aspect-[16/10] sm:aspect-auto sm:min-h-[140px] bg-[#F4F0E8] border-b sm:border-b-0 sm:border-r border-[#E2DDD3] shrink-0 overflow-hidden flex items-center justify-center">
                  {pres.coverPublicUrl ? (
                    <PropertyImage
                      src={pres.coverPublicUrl}
                      alt={`${pres.title} presentation cover`}
                      loading="lazy"
                      compact
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full p-4 flex flex-col justify-between bg-gradient-to-br from-[#F4F0E8] to-[#EAE3D5] text-[#1C1B19]">
                      <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-[#8A6D3B]">
                        {lotId} · SLIDE DECK
                      </span>
                      <p className="font-editorial text-base font-semibold leading-snug line-clamp-2">
                        {pres.title}
                      </p>
                      <span className="font-mono text-[10px] text-[#6B665E]">
                        {pres.slideCount ? `${pres.slideCount} Slides` : 'Presentation Brief'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Details & Actions */}
                <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-[0.12em] text-[#6B665E]">
                      <span className="text-[#8A6D3B] font-semibold">
                        BEN MICUBO BRIEFING
                      </span>
                      {pres.slideCount ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{pres.slideCount} Slides</span>
                        </>
                      ) : null}
                      {pres.visibility === 'Private' && isPreviewAllowed && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-800">Private Admin Preview</span>
                        </>
                      )}
                    </div>

                    <h3 className="mt-1 font-editorial text-xl font-semibold text-[#1C1B19] leading-snug">
                      {pres.title}
                    </h3>
                    {pres.description && (
                      <p className="mt-1 text-xs text-[#35322D] leading-relaxed line-clamp-3">
                        {pres.description}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#E2DDD3]">
                    {hasPdf ? (
                      <button
                        type="button"
                        onClick={() => void openSlideDeck(pres)}
                        className="inline-flex items-center gap-2 h-9 px-4 text-xs font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D] transition-colors cursor-pointer"
                      >
                        <Play className="w-3.5 h-3.5 text-[#B89B6A] fill-current" />
                        <span>{isSelected ? 'Reload Slide Deck' : 'Open Slide Deck'}</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-[#6B665E]">
                        <FileText className="w-3.5 h-3.5 text-[#8A6D3B]" />
                        <span>No PDF slide preview uploaded</span>
                      </span>
                    )}

                    {canDownload && hasPdf && (
                      <button
                        type="button"
                        disabled={isDownloadingKey === `${pres.id}-pdf`}
                        onClick={() => void handleDownloadAsset(pres, 'pdf')}
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A] cursor-pointer disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5 text-[#8A6D3B]" />
                        <span>
                          Download PDF
                          {pres.pdfFileSizeBytes > 0
                            ? ` (${formatFileSize(pres.pdfFileSizeBytes)})`
                            : ''}
                        </span>
                      </button>
                    )}

                    {canDownload && hasPptx && (
                      <button
                        type="button"
                        disabled={isDownloadingKey === `${pres.id}-pptx`}
                        onClick={() => void handleDownloadAsset(pres, 'pptx')}
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A] cursor-pointer disabled:opacity-50"
                      >
                        <Download className="w-3.5 h-3.5 text-[#8A6D3B]" />
                        <span>
                          Download PPTX
                          {pres.pptxFileSizeBytes > 0
                            ? ` (${formatFileSize(pres.pptxFileSizeBytes)})`
                            : ''}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {/* Inline Slide Viewer Stage */}
      {isDeckOpen && !isFullscreenModal && renderDeckStage(false)}

      {/* Fullscreen Modal Viewer (works cleanly across desktop & iOS Safari) */}
      {isDeckOpen && isFullscreenModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${propertyTitle} — ${activePresentation?.title || 'Presentation'} fullscreen viewer`}
          className="fixed inset-0 z-50 bg-black/95 p-3 sm:p-6 flex flex-col overflow-hidden"
        >
          {renderDeckStage(true)}
        </div>
      )}
    </section>
  );
}
