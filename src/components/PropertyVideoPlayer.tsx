import {useEffect, useRef, useState} from 'react';
import {ExternalLink, HardDrive, Maximize2, Play, Video, X} from 'lucide-react';
import {parsePropertyVideoUrl} from '../utils/video';

interface PropertyVideoPlayerProps {
  url: string;
  title: string;
  posterFallback?: string;
}

export function PropertyVideoPlayer({
  url,
  title,
  posterFallback,
}: PropertyVideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isTheaterOpen, setIsTheaterOpen] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const inlineStageRef = useRef<HTMLDivElement | null>(null);

  const parsed = parsePropertyVideoUrl(url);

  useEffect(() => {
    setIsPlaying(false);
    setIsTheaterOpen(false);
    setThumbFailed(false);
  }, [url]);

  useEffect(() => {
    if (!isTheaterOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsTheaterOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isTheaterOpen]);

  const handleOpenFullscreen = async () => {
    setIsPlaying(true);
    setIsTheaterOpen(true);
    try {
      if (inlineStageRef.current && inlineStageRef.current.requestFullscreen) {
        await inlineStageRef.current.requestFullscreen();
      }
    } catch {
      // iOS Safari / embedded iframes fall back gracefully to the responsive Theater Modal
    }
  };

  if (!parsed) {
    return (
      <div className="aspect-video w-full max-w-full min-w-0 border border-[#E2DDD3] bg-[#F4F0E8] flex flex-col items-center justify-center p-4 sm:p-6 text-center overflow-hidden">
        <Video className="w-6 h-6 text-[#8A6D3B] mb-2 shrink-0" />
        <p className="text-sm font-medium text-[#1C1B19]">
          {url.trim() ? 'Unsupported or invalid video URL' : 'No drone tour video attached'}
        </p>
        <p className="text-xs text-[#6B665E] mt-1 max-w-sm">
          Only validated YouTube or Google Drive video sharing links can be embedded.
        </p>
      </div>
    );
  }

  const isDrive = parsed.provider === 'google_drive';
  const posterSrc =
    parsed.thumbnailUrl && !thumbFailed ? parsed.thumbnailUrl : posterFallback;

  const renderIframe = (inModal = false) => (
    <iframe
      src={parsed.embedUrl}
      title={`${title} (${parsed.providerLabel} video player${inModal ? ' fullscreen' : ''})`}
      className="block w-full h-full max-w-full border-0"
      allow={
        isDrive
          ? 'autoplay; fullscreen; picture-in-picture'
          : 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen'
      }
      allowFullScreen
      loading={inModal ? 'eager' : 'lazy'}
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );

  return (
    <div className="w-full max-w-full min-w-0 space-y-2.5">
      {isPlaying ? (
        <div className="w-full max-w-full min-w-0 space-y-2">
          <div
            ref={inlineStageRef}
            className="relative aspect-video w-full max-w-full min-w-0 overflow-hidden border border-[#E2DDD3] bg-black"
          >
            {renderIframe(false)}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#6B665E]">
            <span className="min-w-0 leading-snug">
              Playing via {parsed.providerLabel}
              {isDrive
                ? ' · Use Fullscreen or Open in Google Drive if embedded controls feel narrow on mobile'
                : ''}
            </span>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => void handleOpenFullscreen()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A] cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5 text-[#8A6D3B]" />
                <span>Fullscreen View</span>
              </button>
              <a
                href={parsed.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D]"
              >
                <span>Open in {parsed.providerLabel}</span>
                <ExternalLink className="w-3.5 h-3.5 text-[#B89B6A]" />
              </a>
              <button
                type="button"
                onClick={() => setIsPlaying(false)}
                className="inline-flex items-center gap-1 px-2 py-1.5 font-medium text-[#6B665E] hover:text-[#1C1B19] cursor-pointer"
              >
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-full min-w-0 space-y-2">
          <button
            type="button"
            onClick={() => setIsPlaying(true)}
            aria-label={`Play ${parsed.providerLabel} video for ${title}`}
            className="group relative block aspect-video w-full max-w-full min-w-0 overflow-hidden border border-[#E2DDD3] bg-[#1C1B19] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#8A6D3B]"
          >
            {posterSrc ? (
              <img
                src={posterSrc}
                alt={`${title} video preview`}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setThumbFailed(true)}
                className={`block w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${
                  isDrive ? 'opacity-55' : 'opacity-85'
                }`}
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-[#2B2721] to-[#1C1B19]" />
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent flex flex-col justify-between p-3 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-1.5 min-w-0">
                <span className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-white/95 bg-black/60 px-2 py-1 max-w-full truncate">
                  {isDrive ? (
                    <HardDrive className="w-3.5 h-3.5 text-[#B89B6A] shrink-0" />
                  ) : (
                    <Video className="w-3.5 h-3.5 text-[#B89B6A] shrink-0" />
                  )}
                  <span className="truncate">Site &amp; Drone Video</span>
                </span>
                <span className="text-[11px] sm:text-xs text-white/90 font-mono bg-black/60 px-2 py-1 shrink-0">
                  {isDrive ? 'Google Drive' : 'YouTube HD'}
                </span>
              </div>

              <div className="flex items-center gap-3 min-w-0">
                <span className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#B89B6A] text-[#1C1B19] flex items-center justify-center shadow-sm transition-transform duration-200 group-hover:scale-105 shrink-0">
                  <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-editorial text-sm sm:text-base font-semibold text-white truncate">
                    Tap to Play {parsed.providerLabel} Video
                  </p>
                  <p className="text-[11px] sm:text-xs text-white/80 line-clamp-1">
                    {isDrive
                      ? 'Or use Fullscreen / Open Video below for native mobile controls'
                      : 'Streams only when tapped to save mobile data'}
                  </p>
                </div>
              </div>
            </div>
          </button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={() => void handleOpenFullscreen()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-[#1C1B19] bg-[#F4F0E8] border border-[#E2DDD3] hover:border-[#B89B6A] cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5 text-[#8A6D3B]" />
              <span>Fullscreen Player</span>
            </button>
            <a
              href={parsed.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-[#FAF8F4] bg-[#1C1B19] hover:bg-[#35322D]"
            >
              <span>Open in {parsed.providerLabel}</span>
              <ExternalLink className="w-3.5 h-3.5 text-[#B89B6A]" />
            </a>
          </div>
        </div>
      )}

      {/* Dedicated Responsive Mobile & Desktop Fullscreen Viewer Modal */}
      {isTheaterOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${title} fullscreen video player`}
          className="fixed inset-0 z-50 bg-black/95 flex flex-col justify-between p-3 sm:p-6 overflow-hidden"
        >
          <div className="flex items-center justify-between gap-3 text-white shrink-0">
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[#B89B6A]">
                {parsed.providerLabel} Fullscreen Viewer
              </p>
              <p className="text-sm font-medium truncate">{title}</p>
            </div>
            <button
              type="button"
              onClick={() => setIsTheaterOpen(false)}
              aria-label="Close fullscreen video viewer"
              className="w-10 h-10 bg-white/15 text-white flex items-center justify-center hover:bg-white/25 shrink-0 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex items-center justify-center py-3">
            <div className="w-full max-w-5xl max-h-full aspect-video bg-black border border-white/15 overflow-hidden">
              {renderIframe(true)}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/80 shrink-0">
            <span>
              {isDrive
                ? 'Having trouble with embedded Drive controls on mobile? Open directly in the Google Drive app/tab.'
                : 'Press Escape or Close to return to the property dossier.'}
            </span>
            <a
              href={parsed.canonicalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 font-medium text-[#1C1B19] bg-[#B89B6A] hover:bg-[#c8ac7d]"
            >
              <span>Open in {parsed.providerLabel}</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
