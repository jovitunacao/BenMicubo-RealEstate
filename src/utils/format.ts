import type {Property} from '../types/property';
import {buildCanonicalPropertyUrl} from './siteUrl';

export function formatPhp(amount: number): string {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatSqm(sqm: number): string {
  return `${new Intl.NumberFormat('en-PH').format(sqm)} sqm`;
}

export function computePricePerSqm(totalPrice: number, lotAreaSqm: number): number {
  if (!lotAreaSqm || lotAreaSqm <= 0) return 0;
  return Math.round(totalPrice / lotAreaSqm);
}

export function computeTotalPrice(lotAreaSqm: number, pricePerSqm: number): number {
  if (!lotAreaSqm || lotAreaSqm <= 0 || !pricePerSqm || pricePerSqm < 0) return 0;
  return Math.round(lotAreaSqm * pricePerSqm);
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
    return buildCanonicalPropertyUrl(canonicalSiteUrl, lotId);
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
