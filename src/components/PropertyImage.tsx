import {useState} from 'react';
import {MapPin} from 'lucide-react';

interface PropertyImageProps {
  src?: string;
  alt: string;
  className?: string;
  fallbackTitle?: string;
}

export function PropertyImage({
  src,
  alt,
  className = 'w-full h-full object-cover',
  fallbackTitle,
}: PropertyImageProps) {
  const [hasError, setHasError] = useState(false);

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
        <p className="text-xs text-[#696B77] mt-1">Property visual preview</p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setHasError(true)}
      className={className}
    />
  );
}
