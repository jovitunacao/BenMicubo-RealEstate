import {Link} from 'react-router-dom';
import {CompanyLogo} from './CompanyLogo';

export function Footer() {
  return (
    <footer className="no-print border-t border-[#E6E6EF] bg-[#F8F8FC]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pb-8 border-b border-[#E6E6EF]">
          <div>
            <div className="inline-block bg-white border border-[#E6E6EF] rounded-lg px-2.5 py-1.5">
              <CompanyLogo size="md" />
            </div>
            <p className="mt-3 font-display text-sm font-bold text-[#202124]">
              BEN MICUBO REAL ESTATE SERVICES
            </p>
            <p className="mt-2 text-sm text-[#4B4D57] leading-relaxed max-w-xs">
              Philippine residential, coastal, commercial, and agricultural land listings built for permanent QR site signage.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#10169C]">Navigation</p>
            <ul className="mt-3 space-y-2 text-sm text-[#4B4D57]">
              <li>
                <Link to="/" className="hover:text-[#6500B5] transition-colors">
                  All Property Listings
                </Link>
              </li>
              <li>
                <Link to="/property/LOT-001" className="hover:text-[#6500B5] transition-colors">
                  Featured Dossier (LOT-001)
                </Link>
              </li>
              <li>
                <Link to="/signage/LOT-001" className="hover:text-[#6500B5] transition-colors">
                  Printable QR Signage
                </Link>
              </li>
              <li>
                <Link to="/admin" className="hover:text-[#6500B5] transition-colors">
                  Admin Dashboard (Demo)
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-wide text-[#10169C]">Stage 1 Demo Notice</p>
            <p className="mt-3 text-sm text-[#4B4D57] leading-relaxed">
              Listings, agent contacts, and inquiries on this preview are sample demo data stored locally in your browser. Ready for Stage 2 Supabase connection.
            </p>
          </div>
        </div>
        <div className="pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-[#696B77]">
          <p>© {new Date().getFullYear()} BEN MICUBO REAL ESTATE SERVICES · Stage 1 Frontend Prototype</p>
          <p>Permanent QR URL structure: /property/LOT-001</p>
        </div>
      </div>
    </footer>
  );
}
