import type {Property} from '../types/property';
import {buildCanonicalPropertyUrl} from './siteUrl';

export function formatPhp(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return 'Price Upon Request';
  }
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatSqm(sqm: number): string {
  return `${new Intl.NumberFormat('en-PH').format(sqm)} sqm`;
}

export function formatFrontageLength(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters) || meters <= 0) {
    return '';
  }
  const rounded = Number(meters.toFixed(2));
  return `${new Intl.NumberFormat('en-PH', {maximumFractionDigits: 2}).format(rounded)} m`;
}

export function hasVisibleFrontageLength(
  property: Pick<Property, 'frontageLengthM'>
): boolean {
  return (
    property.frontageLengthM !== null &&
    property.frontageLengthM !== undefined &&
    Number.isFinite(property.frontageLengthM) &&
    property.frontageLengthM > 0
  );
}

export function computePricePerSqm(
  totalPrice: number | null | undefined,
  lotAreaSqm: number
): number {
  if (
    totalPrice === null ||
    totalPrice === undefined ||
    !Number.isFinite(totalPrice) ||
    !lotAreaSqm ||
    lotAreaSqm <= 0
  ) {
    return 0;
  }
  return Math.round(totalPrice / lotAreaSqm);
}

export function computeTotalPrice(lotAreaSqm: number, pricePerSqm: number): number {
  if (!lotAreaSqm || lotAreaSqm <= 0 || !pricePerSqm || pricePerSqm < 0) return 0;
  return Math.round(lotAreaSqm * pricePerSqm);
}

export interface PropertyPricingDisplay {
  showSellingPrice: boolean;
  showPricePerSqm: boolean;
  totalPriceLabel: string;
  pricePerSqmLabel: string;
  primaryHeadlineLabel: string;
  secondarySubLabel: string;
  isPriceUponRequest: boolean;
  hasAnyVisiblePrice: boolean;
}

/**
 * Resolves public-safe display labels for all four combinations of
 * `showSellingPrice` and `showPricePerSqm` without deriving or exposing hidden values.
 */
export function resolvePropertyPricingDisplay(
  property: Pick<
    Property,
    'priceTotalPhp' | 'pricePerSqm' | 'lotAreaSqm' | 'showSellingPrice' | 'showPricePerSqm'
  >
): PropertyPricingDisplay {
  const showSellingPrice =
    property.showSellingPrice !== false &&
    property.priceTotalPhp !== null &&
    property.priceTotalPhp !== undefined &&
    Number.isFinite(property.priceTotalPhp);

  const showPricePerSqm =
    property.showPricePerSqm !== false &&
    property.pricePerSqm !== null &&
    property.pricePerSqm !== undefined &&
    Number.isFinite(property.pricePerSqm);

  const totalPriceLabel = showSellingPrice
    ? formatPhp(property.priceTotalPhp)
    : '';
  const pricePerSqmLabel = showPricePerSqm
    ? `${formatPhp(property.pricePerSqm)} / sqm`
    : '';

  const hasAnyVisiblePrice = Boolean(totalPriceLabel || pricePerSqmLabel);
  const isPriceUponRequest = !hasAnyVisiblePrice;

  const primaryHeadlineLabel = totalPriceLabel || pricePerSqmLabel || 'Price Upon Request';
  const secondarySubLabel =
    totalPriceLabel && pricePerSqmLabel ? pricePerSqmLabel : '';

  return {
    showSellingPrice,
    showPricePerSqm,
    totalPriceLabel,
    pricePerSqmLabel,
    primaryHeadlineLabel,
    secondarySubLabel,
    isPriceUponRequest,
    hasAnyVisiblePrice,
  };
}

export function generateNextLotId(existingProperties: Pick<Property, 'lotId'>[]): string {
  let maxNumber = 0;
  for (const prop of existingProperties) {
    const match = prop.lotId.toUpperCase().match(/^LOT-(\d+)$/);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (!Number.isNaN(n) && n > maxNumber) {
        maxNumber = n;
      }
    }
  }
  const next = maxNumber + 1;
  return `LOT-${String(next).padStart(3, '0')}`;
}

export function getPropertyPath(lotId: string): string {
  return `/property/${encodeURIComponent(lotId.trim().toUpperCase())}`;
}

export function getPropertyPermalink(lotId: string, canonicalSiteUrl?: string): string {
  if (canonicalSiteUrl) {
    const canonical = buildCanonicalPropertyUrl(canonicalSiteUrl, lotId);
    if (canonical.startsWith('https://')) {
      return canonical;
    }
  }
  if (typeof window === 'undefined') {
    return getPropertyPath(lotId);
  }
  return `${window.location.origin}${getPropertyPath(lotId)}`;
}

export function buildWhatsAppLink(phoneDigits: string, lotId: string, title: string): string {
  const cleanPhone = phoneDigits.replace(/[^0-9]/g, '');
  const text = encodeURIComponent(
    `Hello BEN MICUBO REAL ESTATE SERVICES, I scanned/viewed listing ${lotId} (${title}) and would like to request more details or schedule a site tripping.`
  );
  return `https://wa.me/${cleanPhone}?text=${text}`;
}

export function buildMessengerLink(handle: string): string {
  const cleanHandle = handle.replace(/^@/, '').trim();
  return `https://m.me/${cleanHandle}`;
}

export function buildWhatsAppShareLink(shareUrl: string, lotId: string, title: string): string {
  const text = encodeURIComponent(
    `Check out ${lotId} — ${title} from BEN MICUBO REAL ESTATE SERVICES: ${shareUrl}`
  );
  return `https://wa.me/?text=${text}`;
}

export function buildViberShareLink(shareUrl: string, lotId: string, title: string): string {
  const text = encodeURIComponent(
    `BEN MICUBO REAL ESTATE SERVICES · ${lotId} (${title}): ${shareUrl}`
  );
  return `viber://forward?text=${text}`;
}

export function buildSmsShareLink(shareUrl: string, lotId: string, title: string): string {
  const body = encodeURIComponent(
    `BEN MICUBO REAL ESTATE SERVICES · ${lotId} (${title}): ${shareUrl}`
  );
  return `sms:?&body=${body}`;
}

export function formatDateShort(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
