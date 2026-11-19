import {useState} from 'react';
import {ExternalLink, HardDrive, Play, Video} from 'lucide-react';
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
  const [thumbFailed, setThumbFailed] = useState(false);

  const parsed = parsePropertyVideoUrl(url);

  if (!parsed) {
    return (
      <div className="aspect-video w-full rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] flex flex-col items-center justify-center p-6 text-center">
        <Video className="w-6 h-6 text-[#696B77] mb-2" />
        <p className="text-sm font-medium text-[#202124]">
          {url.trim() ? 'Unsupported or invalid video URL' : 'No drone tour video attached'}
        </p>
        <p className="text-xs text-[#696B77] mt-1">
          Only validated YouTube or Google Drive video sharing links can be embedded.
        </p>
      </div>
    );
  }

  const isDrive = parsed.provider === 'google_drive';

  if (isPlaying) {
    return (
      <div className="space-y-2">
        <div className="aspect-video w-full rounded-xl overflow-hidden border border-[#E6E6EF] bg-black">
          <iframe
            src={parsed.embedUrl}
            title={`${title} (${parsed.providerLabel} video player)`}
            className="w-full h-full"
            allow={
              isDrive
                ? 'autoplay; fullscreen; picture-in-picture'
                : 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen'
            }
            allowFullScreen
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#696B77]">
          <span>
            Playing via {parsed.providerLabel}
            {isDrive ? ' · Requires public link sharing ("Anyone with the link")' : ''}
          </span>
          <a
            href={parsed.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium text-[#6500B5] hover:underline"
          >
            <span>Open directly in {parsed.providerLabel}</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    );
  }

  const posterSrc =
    parsed.thumbnailUrl && !thumbFailed ? parsed.thumbnailUrl : posterFallback;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setIsPlaying(true)}
        aria-label={`Play ${parsed.providerLabel} video for ${title}`}
        className="group relative aspect-video w-full rounded-xl overflow-hidden border border-[#E6E6EF] bg-[#202124] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#6500B5]"
      >
        {posterSrc ? (
          <img
            src={posterSrc}
            alt={`${title} video preview`}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setThumbFailed(true)}
            className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02] ${
              isDrive ? 'opacity-45' : 'opacity-85'
            }`}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#241A3B] to-[#10169C]/80" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent flex flex-col justify-between p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-white/95 bg-black/55 px-2.5 py-1 rounded">
              {isDrive ? (
                <HardDrive className="w-3.5 h-3.5 text-[#C5B3E6]" />
              ) : (
                <Video className="w-3.5 h-3.5 text-[#C5B3E6]" />
              )}
              <span>Drone &amp; Site Walkthrough</span>
            </span>
            <span className="text-xs text-white/90 font-mono bg-black/55 px-2.5 py-1 rounded">
              {isDrive ? 'Google Drive Preview' : 'YouTube HD'}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <span className="w-12 h-12 rounded-full bg-gradient-to-br from-[#6500B5] to-[#10169C] text-white flex items-center justify-center shadow-sm transition-transform duration-200 group-hover:scale-105 shrink-0">
              <Play className="w-5 h-5 fill-current ml-0.5" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm sm:text-base font-semibold text-white">
                Tap to load &amp; play {parsed.providerLabel} video
              </p>
              <p className="text-xs text-white/80">
                Lazy-loaded player — streams only when tapped to save mobile data
              </p>
            </div>
          </div>
        </div>
      </button>

      <div className="flex items-center justify-end">
        <a
          href={parsed.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-[#6500B5] hover:underline"
        >
          <span>Open directly in {parsed.providerLabel}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
