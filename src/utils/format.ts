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

export function getPropertyPermalink(lotId: string): string {
  if (typeof window === 'undefined') {
    return `/property/${encodeURIComponent(lotId)}`;
  }
  return `${window.location.origin}/property/${encodeURIComponent(lotId)}`;
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

export function formatDateShort(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return isoString;
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}
