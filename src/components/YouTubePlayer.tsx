import {useState} from 'react';
import {Play, Video} from 'lucide-react';
import {
  extractYouTubeVideoId,
  getYouTubeEmbedUrl,
  getYouTubeThumbnailUrl,
} from '../utils/youtube';

interface YouTubePlayerProps {
  url: string;
  title: string;
  posterFallback?: string;
}

export function YouTubePlayer({url, title, posterFallback}: YouTubePlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);

  const videoId = extractYouTubeVideoId(url);

  if (!videoId) {
    return (
      <div className="aspect-video w-full rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] flex flex-col items-center justify-center p-6 text-center">
        <Video className="w-6 h-6 text-[#696B77] mb-2" />
        <p className="text-sm font-medium text-[#202124]">No drone tour video attached</p>
        <p className="text-xs text-[#696B77] mt-1">
          A YouTube aerial or walkthrough link can be added from the Admin Dashboard.
        </p>
      </div>
    );
  }

  if (isPlaying) {
    return (
      <div className="aspect-video w-full rounded-xl overflow-hidden border border-[#E6E6EF] bg-black">
        <iframe
          src={getYouTubeEmbedUrl(videoId)}
          title={`${title} drone video tour`}
          className="w-full h-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
        />
      </div>
    );
  }

  const posterSrc = !thumbFailed ? getYouTubeThumbnailUrl(videoId) : posterFallback;

  return (
    <button
      type="button"
      onClick={() => setIsPlaying(true)}
      aria-label={`Play YouTube drone video for ${title}`}
      className="group relative aspect-video w-full rounded-xl overflow-hidden border border-[#E6E6EF] bg-[#202124] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[#6500B5]"
    >
      {posterSrc ? (
        <img
          src={posterSrc}
          alt={`${title} video preview`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setThumbFailed(true)}
          className="w-full h-full object-cover opacity-85 transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <div className="w-full h-full bg-[#241A3B]" />
      )}

      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent flex flex-col justify-between p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white/95 bg-black/55 px-2.5 py-1 rounded">
            Drone &amp; Site Walkthrough
          </span>
          <span className="text-xs text-white/80 font-mono">YouTube HD</span>
        </div>

        <div className="flex items-center gap-4">
          <span className="w-12 h-12 rounded-full bg-gradient-to-br from-[#6500B5] to-[#10169C] text-white flex items-center justify-center shadow-sm transition-transform duration-200 group-hover:scale-105 shrink-0">
            <Play className="w-5 h-5 fill-current ml-0.5" />
          </span>
          <div>
            <p className="font-display text-sm sm:text-base font-semibold text-white">
              Tap to load &amp; play video
            </p>
            <p className="text-xs text-white/80">
              Mobile-optimized lazy embed — loads video stream on demand
            </p>
          </div>
        </div>
      </div>
    </button>
  );
}
