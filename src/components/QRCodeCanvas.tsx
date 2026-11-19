import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import QRCode from 'qrcode';
import {AlertTriangle, Download, Settings} from 'lucide-react';

interface QRCodeCanvasProps {
  url: string;
  lotId: string;
  size?: number;
  showDownloads?: boolean;
  canonicalValid?: boolean;
  blockedReason?: string;
}

export function QRCodeCanvas({
  url,
  lotId,
  size = 200,
  showDownloads = true,
  canonicalValid = true,
  blockedReason,
}: QRCodeCanvasProps) {
  const [dataUrl, setDataUrl] = useState<string>('');
  const [svgMarkup, setSvgMarkup] = useState<string>('');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (!canonicalValid) {
      setDataUrl('');
      setSvgMarkup('');
      setError('');
      return;
    }

    let active = true;

    async function generate() {
      try {
        const [pngUrl, svgText] = await Promise.all([
          QRCode.toDataURL(url, {
            width: Math.max(size * 3, 600),
            margin: 2,
            color: {
              dark: '#202124',
              light: '#FFFFFF',
            },
            errorCorrectionLevel: 'M',
          }),
          QRCode.toString(url, {
            type: 'svg',
            margin: 2,
            color: {
              dark: '#202124',
              light: '#FFFFFF',
            },
            errorCorrectionLevel: 'M',
          }),
        ]);
        if (active) {
          setDataUrl(pngUrl);
          setSvgMarkup(svgText);
          setError('');
        }
      } catch {
        if (active) {
          setError('Unable to render QR code preview.');
        }
      }
    }

    void generate();
    return () => {
      active = false;
    };
  }, [url, size, canonicalValid]);

  if (!canonicalValid) {
    return (
      <div className="w-full p-4 rounded-xl border border-amber-200 bg-amber-50 text-left space-y-2.5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-amber-950">
              QR generation paused until canonical domain is configured
            </p>
            <p className="mt-1 text-xs text-amber-900 leading-relaxed">
              {blockedReason ||
                'Permanent QR codes require an HTTPS production domain (never localhost or preview URLs).'}
            </p>
          </div>
        </div>
        <Link
          to="/admin?tab=settings"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#6500B5] rounded-md hover:bg-[#540098] transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          <span>Configure Domain in Admin</span>
        </Link>
      </div>
    );
  }

  const handleDownloadPng = () => {
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${lotId.toLowerCase()}-qr.png`;
    link.click();
  };

  const handleDownloadSvg = () => {
    if (!svgMarkup) return;
    const blob = new Blob([svgMarkup], {type: 'image/svg+xml;charset=utf-8'});
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `${lotId.toLowerCase()}-qr.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };

  if (error) {
    return (
      <div className="p-4 border border-[#E6E6EF] rounded-lg bg-[#F8F8FC] text-xs text-[#696B77]">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div
        className="bg-white p-3 rounded-lg border border-[#E6E6EF]"
        style={{width: size + 24, height: size + 24}}
      >
        {dataUrl ? (
          <img
            src={dataUrl}
            alt={`QR code linking to BEN MICUBO REAL ESTATE SERVICES property ${lotId}`}
            width={size}
            height={size}
            className="w-full h-full object-contain block"
          />
        ) : (
          <div className="w-full h-full bg-[#F2F2F8] animate-pulse rounded" />
        )}
      </div>

      {showDownloads && (
        <div className="no-print mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleDownloadPng}
            disabled={!dataUrl}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-md hover:bg-[#F8F8FC] transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#6500B5]" />
            <span>PNG</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadSvg}
            disabled={!svgMarkup}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-md hover:bg-[#F8F8FC] transition-colors disabled:opacity-50 cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 text-[#6500B5]" />
            <span>SVG</span>
          </button>
        </div>
      )}
    </div>
  );
}
