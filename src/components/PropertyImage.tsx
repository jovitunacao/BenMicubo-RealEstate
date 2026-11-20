import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {MapPin} from 'lucide-react';

interface PropertyImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
  loading?: 'lazy' | 'eager';
  compact?: boolean;
  onRecoverSignedUrl?: () => Promise<string | null>;
}

export function PropertyImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackTitle,
  loading = 'eager',
  compact = false,
  onRecoverSignedUrl,
}: PropertyImageProps) {
  const [activeSrc, setActiveSrc] = useState(src || '');
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const recoveryAttemptedForRef = useRef<string | null>(null);

  useEffect(() => {
    setActiveSrc(src || '');
    setHasError(false);
    setIsLoaded(false);
    recoveryAttemptedForRef.current = null;
  }, [src]);

  useLayoutEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0) {
      setHasError(false);
      setIsLoaded(true);
    }
  }, [activeSrc]);

  const handleImageError = async () => {
    const currentFailedSrc = activeSrc;
    if (
      onRecoverSignedUrl &&
      currentFailedSrc &&
      recoveryAttemptedForRef.current !== currentFailedSrc
    ) {
      recoveryAttemptedForRef.current = currentFailedSrc;
      try {
        const refreshed = await onRecoverSignedUrl();
        if (refreshed && refreshed !== currentFailedSrc) {
          setActiveSrc(refreshed);
          setHasError(false);
          setIsLoaded(false);
          return;
        }
      } catch {
        // Fall through to unavailable fallback state
      }
    }
    setHasError(true);
    setIsLoaded(true);
  };

  if (!activeSrc || hasError) {
    if (compact) {
      return (
        <div
          role="img"
          aria-label={alt}
          className="w-full h-full flex flex-col items-center justify-center bg-[#F4F0E8] text-[#6B665E] p-1 text-center select-none overflow-hidden"
        >
          <MapPin className="w-4 h-4 text-[#8A6D3B] shrink-0" aria-hidden="true" />
          <span className="mt-0.5 text-[9px] font-mono leading-none truncate max-w-full">
            {hasError ? 'Retry' : 'No photo'}
          </span>
        </div>
      );
    }

    return (
      <div
        role="img"
        aria-label={alt}
        className="w-full h-full flex flex-col items-center justify-center bg-[#F4F0E8] text-[#4B4D57] p-6 text-center select-none"
      >
        <div className="w-10 h-10 border border-[#E2DDD3] bg-[#FAF8F4] flex items-center justify-center mb-3">
          <MapPin className="w-5 h-5 text-[#8A6D3B]" />
        </div>
        <p className="text-sm font-medium text-[#1C1B19] max-w-[22ch] leading-snug">
          {fallbackTitle || alt}
        </p>
        <p className="text-xs text-[#6B665E] mt-1">
          {hasError ? 'Image temporarily unavailable' : 'Property visual preview'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#F4F0E8]">
      {!isLoaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[#EFECE3] animate-pulse pointer-events-none"
        />
      )}
      <img
        ref={imgRef}
        src={activeSrc}
        alt={alt}
        loading={loading}
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={() => {
          setHasError(false);
          setIsLoaded(true);
        }}
        onError={() => {
          void handleImageError();
        }}
        className={`block ${className}`}
      />
    </div>
  );
}
