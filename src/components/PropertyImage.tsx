import {useEffect, useState} from 'react';
import {MapPin} from 'lucide-react';

interface PropertyImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
  loading?: 'lazy' | 'eager';
}

export function PropertyImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackTitle,
  loading = 'lazy',
}: PropertyImageProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setHasError(false);
    setIsLoaded(false);
  }, [src]);

  if (!src || hasError) {
    return (
      <div
        role="img"
        aria-label={alt}
        className="w-full h-full flex flex-col items-center justify-center bg-[#F8F8FC] text-[#4B4D57] p-6 text-center select-none"
      >
        <div className="w-10 h-10 rounded-lg border border-[#DCD0F0] bg-white flex items-center justify-center mb-3">
          <MapPin className="w-5 h-5 text-[#6500B5]" />
        </div>
        <p className="text-sm font-medium text-[#202124] max-w-[22ch] leading-snug">
          {fallbackTitle || alt}
        </p>
        <p className="text-xs text-[#696B77] mt-1">
          {hasError ? 'Image temporarily unavailable' : 'Property visual preview'}
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {!isLoaded && (
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[#F3F1FA] animate-pulse"
        />
      )}
      <img
        src={src}
        alt={alt}
        loading={loading}
        referrerPolicy="no-referrer"
        onLoad={() => setIsLoaded(true)}
        onError={() => {
          setHasError(true);
          setIsLoaded(true);
        }}
        className={`${className} transition-opacity duration-200 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
