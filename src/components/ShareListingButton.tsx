import {useEffect, useRef, useState} from 'react';
import {Check, Copy, MessageCircle, Send, Share2, Smartphone} from 'lucide-react';
import {
  buildMessengerLink,
  buildSmsShareLink,
  buildViberShareLink,
  buildWhatsAppShareLink,
} from '../utils/format';

interface ShareListingButtonProps {
  lotId: string;
  title: string;
  shareUrl: string;
  messengerHandle: string;
}

export function ShareListingButton({
  lotId,
  title,
  shareUrl,
  messengerHandle,
}: ShareListingButtonProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const supportsNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [open]);

  const handleNativeShare = async () => {
    if (!supportsNativeShare) return;
    try {
      await navigator.share({
        title: `${lotId} — ${title} | BEN MICUBO REAL ESTATE SERVICES`,
        text: `View verified property dossier for ${lotId} (${title})`,
        url: shareUrl,
      });
      setOpen(false);
    } catch {
      // User dismissed native share sheet
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Ignore if clipboard blocked
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-2 h-9 px-3.5 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-lg hover:border-[#6500B5] hover:text-[#6500B5] transition-colors cursor-pointer whitespace-nowrap"
      >
        <Share2 className="w-3.5 h-3.5 text-[#6500B5]" />
        <span>Share Listing</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 bg-white border border-[#E6E6EF] rounded-xl shadow-lg p-2 z-30 space-y-1"
        >
          <div className="px-2.5 py-1.5 border-b border-[#EFEFF6]">
            <p className="text-[11px] font-semibold text-[#202124] truncate">
              Share {lotId}
            </p>
            <p className="text-[10px] font-mono text-[#696B77] truncate">{shareUrl}</p>
          </div>

          {supportsNativeShare && (
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleNativeShare()}
              className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-[#202124] rounded-lg hover:bg-[#F8F8FC] hover:text-[#6500B5] cursor-pointer text-left"
            >
              <Share2 className="w-3.5 h-3.5 text-[#6500B5]" />
              <span>Share via Device...</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={() => void handleCopy()}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-[#202124] rounded-lg hover:bg-[#F8F8FC] hover:text-[#6500B5] cursor-pointer text-left"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-700" />
                <span className="text-emerald-700">Link Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-[#6500B5]" />
                <span>Copy Listing Link</span>
              </>
            )}
          </button>

          <a
            role="menuitem"
            href={buildWhatsAppShareLink(shareUrl, lotId, title)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-[#202124] rounded-lg hover:bg-[#F8F8FC] hover:text-[#6500B5]"
          >
            <MessageCircle className="w-3.5 h-3.5 text-[#6500B5]" />
            <span>Share on WhatsApp</span>
          </a>

          <a
            role="menuitem"
            href={buildMessengerLink(messengerHandle)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              void handleCopy();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-[#202124] rounded-lg hover:bg-[#F8F8FC] hover:text-[#6500B5]"
          >
            <Send className="w-3.5 h-3.5 text-[#10169C]" />
            <span>Send via Messenger</span>
          </a>

          <a
            role="menuitem"
            href={buildViberShareLink(shareUrl, lotId, title)}
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-[#202124] rounded-lg hover:bg-[#F8F8FC] hover:text-[#6500B5]"
          >
            <MessageCircle className="w-3.5 h-3.5 text-[#7900C8]" />
            <span>Share on Viber</span>
          </a>

          <a
            role="menuitem"
            href={buildSmsShareLink(shareUrl, lotId, title)}
            onClick={() => setOpen(false)}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs font-medium text-[#202124] rounded-lg hover:bg-[#F8F8FC] hover:text-[#6500B5]"
          >
            <Smartphone className="w-3.5 h-3.5 text-[#4B4D57]" />
            <span>Share via SMS</span>
          </a>
        </div>
      )}
    </div>
  );
}
