import {useState} from 'react';
import {Link, useLocation, useNavigate} from 'react-router-dom';
import {Menu, X} from 'lucide-react';
import {CompanyLogo} from './CompanyLogo';

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const handleInquiryNav = () => {
    setMobileMenuOpen(false);
    if (location.pathname === '/') {
      document.getElementById('inquiry-section')?.scrollIntoView({behavior: 'smooth'});
    } else {
      navigate('/#inquiry-section');
      setTimeout(() => {
        document.getElementById('inquiry-section')?.scrollIntoView({behavior: 'smooth'});
      }, 120);
    }
  };

  const handleListingsNav = () => {
    setMobileMenuOpen(false);
    if (location.pathname === '/') {
      document.getElementById('listings-section')?.scrollIntoView({behavior: 'smooth'});
    } else {
      navigate('/');
      setTimeout(() => {
        document.getElementById('listings-section')?.scrollIntoView({behavior: 'smooth'});
      }, 120);
    }
  };

  const handleQrGuideNav = () => {
    setMobileMenuOpen(false);
    if (location.pathname === '/') {
      document.getElementById('qr-workflow')?.scrollIntoView({behavior: 'smooth'});
    } else {
      navigate('/');
      setTimeout(() => {
        document.getElementById('qr-workflow')?.scrollIntoView({behavior: 'smooth'});
      }, 120);
    }
  };

  return (
    <header className="no-print sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-[#E6E6EF]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4 lg:gap-8">
        {/* Zone 1: Brand Lockup (single-line wordmark with proportional logo) */}
        <Link
          to="/"
          onClick={() => setMobileMenuOpen(false)}
          className="flex items-center gap-2.5 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#6500B5] rounded"
        >
          <CompanyLogo size="sm" />
          <span className="font-display text-xs sm:text-sm lg:text-base font-bold tracking-tight text-[#202124] whitespace-nowrap">
            BEN MICUBO REAL ESTATE SERVICES
          </span>
        </Link>

        {/* Zone 2: Concise single-line navigation links */}
        <nav
          aria-label="Primary navigation"
          className="hidden md:flex items-center gap-5 lg:gap-7 text-sm font-medium text-[#4B4D57]"
        >
          <button
            type="button"
            onClick={handleListingsNav}
            className="hover:text-[#6500B5] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Properties
          </button>
          <button
            type="button"
            onClick={handleQrGuideNav}
            className="hover:text-[#6500B5] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            QR Signage
          </button>
          <Link
            to="/signage/LOT-001"
            className="hover:text-[#6500B5] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Sample Print
          </Link>
          <Link
            to="/admin"
            className="hover:text-[#6500B5] hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
          >
            Admin
          </Link>
        </nav>

        {/* Zone 3: Single primary action + compact mobile menu trigger */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleInquiryNav}
            className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-xs font-medium text-white bg-[#6500B5] rounded-md hover:bg-[#540098] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Book Viewing
          </button>
          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-md text-[#202124] hover:bg-[#F8F8FC] transition-colors cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#E6E6EF] bg-white px-4 py-3 space-y-1">
          <button
            type="button"
            onClick={handleListingsNav}
            className="w-full text-left px-3 py-2.5 text-sm font-medium text-[#202124] rounded-md hover:bg-[#F8F8FC] hover:text-[#6500B5]"
          >
            Properties
          </button>
          <button
            type="button"
            onClick={handleQrGuideNav}
            className="w-full text-left px-3 py-2.5 text-sm font-medium text-[#202124] rounded-md hover:bg-[#F8F8FC] hover:text-[#6500B5]"
          >
            QR Signage
          </button>
          <Link
            to="/signage/LOT-001"
            onClick={() => setMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-sm font-medium text-[#202124] rounded-md hover:bg-[#F8F8FC] hover:text-[#6500B5]"
          >
            Sample Print Layout
          </Link>
          <Link
            to="/admin"
            onClick={() => setMobileMenuOpen(false)}
            className="block px-3 py-2.5 text-sm font-medium text-[#202124] rounded-md hover:bg-[#F8F8FC] hover:text-[#6500B5]"
          >
            Admin Dashboard
          </Link>
          <div className="pt-2">
            <button
              type="button"
              onClick={handleInquiryNav}
              className="w-full py-2.5 px-4 text-sm font-medium text-white bg-[#6500B5] rounded-md hover:bg-[#540098]"
            >
              Book Viewing
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
