import {Link} from 'react-router-dom';
import {ArrowUpRight, QrCode} from 'lucide-react';
import type {Property} from '../types/property';
import {computePricePerSqm, formatPhp, formatSqm} from '../utils/format';
import {PropertyImage} from './PropertyImage';
import {StatusIndicator} from './StatusIndicator';

interface PropertyCardProps {
  property: Property;
}

export function PropertyCard({property}: PropertyCardProps) {
  const pricePerSqm = computePricePerSqm(property.priceTotalPhp, property.lotAreaSqm);

  return (
    <article className="group bg-white border border-[#E6E6EF] rounded-xl overflow-hidden flex flex-col transition-colors duration-200 hover:border-[#B9A7DE]">
      <Link
        to={`/property/${encodeURIComponent(property.lotId)}`}
        className="block aspect-[4/3] w-full overflow-hidden bg-[#F8F8FC]"
      >
        <PropertyImage
          src={property.photos[0]}
          alt={`${property.title} in ${property.city}, ${property.province}`}
          fallbackTitle={property.title}
          className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
        />
      </Link>

      <div className="p-5 flex-1 flex flex-col justify-between gap-4">
        <div>
          <div className="flex items-center justify-between gap-3 text-xs text-[#696B77]">
            <div className="flex items-center gap-1.5 min-w-0 truncate">
              <span className="font-mono font-medium text-[#10169C]">{property.lotId}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">
                {property.city}, {property.province}
              </span>
            </div>
            <StatusIndicator status={property.status} compact />
          </div>

          <h3 className="mt-2 font-display text-lg font-semibold text-[#202124] leading-snug tracking-tight">
            <Link
              to={`/property/${encodeURIComponent(property.lotId)}`}
              className="hover:text-[#6500B5] transition-colors"
            >
              {property.title}
            </Link>
          </h3>

          <p className="mt-1.5 text-xs text-[#4B4D57] flex items-center gap-1.5 flex-wrap tabular-nums">
            <span>{formatSqm(property.lotAreaSqm)}</span>
            <span aria-hidden="true">·</span>
            <span>{property.classification}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{property.dimensions}</span>
          </p>
        </div>

        <div className="pt-4 border-t border-[#EFEFF6] flex items-end justify-between gap-3">
          <div>
            <p className="font-display text-lg font-bold text-[#202124] tabular-nums leading-none">
              {formatPhp(property.priceTotalPhp)}
            </p>
            <p className="mt-1 text-xs text-[#696B77] font-mono tabular-nums">
              {formatPhp(pricePerSqm)} / sqm
              {property.isNegotiable && (
                <span className="font-sans text-[#6500B5] font-medium"> · Negotiable</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              to={`/signage/${encodeURIComponent(property.lotId)}`}
              title={`Open printable QR signage for ${property.lotId}`}
              aria-label={`Printable QR signage for ${property.lotId}`}
              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-[#E6E6EF] text-[#4B4D57] hover:text-[#6500B5] hover:border-[#C5B3E6] transition-colors"
            >
              <QrCode className="w-4 h-4" />
            </Link>
            <Link
              to={`/property/${encodeURIComponent(property.lotId)}`}
              className="inline-flex items-center gap-1 px-3 py-2 text-xs font-medium text-[#6500B5] bg-[#F3EEFA] rounded-md hover:bg-[#E8DDF7] transition-colors whitespace-nowrap shrink-0"
            >
              <span>Details</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
