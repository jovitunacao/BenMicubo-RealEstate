interface CompanyLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<CompanyLogoProps['size']>, string> = {
  sm: 'h-10',
  md: 'h-14',
  lg: 'h-20 sm:h-24',
  xl: 'h-24 sm:h-28',
};

export function CompanyLogo({size = 'md', className = ''}: CompanyLogoProps) {
  return (
    <span
      className={`inline-flex items-center justify-center bg-white overflow-hidden rounded shrink-0 ${SIZE_CLASSES[size]} ${className}`}
    >
      <img
        src="/assets/aistudio/IMG_9346_9b5dcd00.jpeg"
        alt="BEN MICUBO REAL ESTATE SERVICES official logo"
        loading="eager"
        className="h-full w-auto object-contain scale-[1.04]"
      />
    </span>
  );
}
