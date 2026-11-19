import {CheckCircle2, Clock, Lock} from 'lucide-react';
import type {PropertyStatus} from '../types/property';

interface StatusIndicatorProps {
  status: PropertyStatus;
  compact?: boolean;
}

export function StatusIndicator({status, compact = false}: StatusIndicatorProps) {
  if (status === 'Available') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-medium text-[#166534] whitespace-nowrap shrink-0 ${
          compact ? 'text-xs' : 'text-xs px-2.5 py-1 rounded bg-[#EEF8F2] border border-[#C6E5D2]'
        }`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Available</span>
      </span>
    );
  }

  if (status === 'Reserved') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 font-medium text-[#92400E] whitespace-nowrap shrink-0 ${
          compact ? 'text-xs' : 'text-xs px-2.5 py-1 rounded bg-[#FEF3C7] border border-[#FDE68A]'
        }`}
      >
        <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Reserved</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium text-[#3F3F46] whitespace-nowrap shrink-0 ${
        compact ? 'text-xs' : 'text-xs px-2.5 py-1 rounded bg-[#F4F4F6] border border-[#E6E6EF]'
      }`}
    >
      <Lock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>Sold</span>
    </span>
  );
}
