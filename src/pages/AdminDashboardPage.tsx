import React, {useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Inbox,
  LogOut,
  Pencil,
  Plus,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {usePropertyStore} from '../context/PropertyStoreContext';
import {CompanyLogo} from '../components/CompanyLogo';
import {AdminPropertyModal} from '../components/AdminPropertyModal';
import {QRCodeCanvas} from '../components/QRCodeCanvas';
import {
  buildWhatsAppLink,
  computePricePerSqm,
  formatDateShort,
  formatPhp,
  formatSqm,
  getPropertyPermalink,
} from '../utils/format';
import type {
  InquiryStatus,
  Property,
  PropertyInput,
  PropertyStatus,
} from '../types/property';

type AdminTab = 'listings' | 'inquiries' | 'qr';
type ListingViewFilter = 'active' | 'archived' | 'all';

export function AdminDashboardPage() {
  const {
    properties,
    inquiries,
    isDemoMode,
    isUsingDemoFallback,
    supabaseError,
    session,
    createProperty,
    updateProperty,
    toggleArchiveProperty,
    deleteProperty,
    updateInquiryStatus,
    resetDemoData,
    signInWithSupabase,
    signOutSupabase,
  } = usePropertyStore();

  const [activeTab, setActiveTab] = useState<AdminTab>('listings');
  const [viewFilter, setViewFilter] = useState<ListingViewFilter>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');

  // Supabase Auth form state (active when Stage 2 Supabase env vars are configured)
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const filteredProperties = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return properties.filter((item) => {
      if (viewFilter === 'active' && item.isArchived) return false;
      if (viewFilter === 'archived' && !item.isArchived) return false;
      if (!q) return true;
      return (
        item.lotId.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.city.toLowerCase().includes(q) ||
        item.province.toLowerCase().includes(q)
      );
    });
  }, [properties, viewFilter, searchQuery]);

  const showToast = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => {
      setFeedbackMessage((curr) => (curr === msg ? '' : curr));
    }, 3500);
  };

  const handleSaveProperty = async (input: PropertyInput, existingId?: string) => {
    if (existingId) {
      await updateProperty(existingId, input);
      showToast(`Updated ${input.lotId}.`);
    } else {
      await createProperty(input);
      showToast(`Created listing ${input.lotId}.`);
    }
  };

  const handleQuickStatusChange = async (property: Property, nextStatus: PropertyStatus) => {
    try {
      const {id, updatedAt: _u, ...rest} = property;
      await updateProperty(id, {...rest, status: nextStatus});
      showToast(`${property.lotId} status changed to ${nextStatus}.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to update property status.');
    }
  };

  const handleSupabaseLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setSigningIn(true);
    try {
      await signInWithSupabase(email.trim(), password);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSigningIn(false);
    }
  };

  // Stage 2 Real Supabase Auth Gate when Supabase IS configured and tables are live
  if (!isDemoMode && !session && !isUsingDemoFallback) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#F8F8FC] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-[#E6E6EF] rounded-xl p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-5 pb-4 border-b border-[#E6E6EF]">
            <CompanyLogo size="md" />
            <div>
              <p className="font-display text-xs font-bold text-[#202124]">
                BEN MICUBO REAL ESTATE SERVICES
              </p>
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#6500B5] mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Supabase Auth Protected</span>
              </div>
            </div>
          </div>

          <h1 className="font-display text-2xl font-bold text-[#202124]">
            Administrator Sign In
          </h1>
          <p className="mt-1.5 text-sm text-[#4B4D57]">
            Only authorized administrators verified by Supabase Auth and Row-Level Security may modify listings.
          </p>

          <form onSubmit={handleSupabaseLogin} className="mt-6 space-y-4">
            {authError && (
              <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
                {authError}
              </div>
            )}
            <div>
              <label htmlFor="admin-email" className="block text-xs font-medium text-[#4B4D57] mb-1.5">
                Admin Email
              </label>
              <input
                id="admin-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-11 px-3.5 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label htmlFor="admin-password" className="block text-xs font-medium text-[#4B4D57] mb-1.5">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 px-3.5 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <button
              type="submit"
              disabled={signingIn}
              className="w-full h-11 text-sm font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] disabled:opacity-60 cursor-pointer"
            >
              {signingIn ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const activeCount = properties.filter((p) => !p.isArchived).length;
  const archivedCount = properties.filter((p) => p.isArchived).length;
  const newInquiryCount = inquiries.filter((i) => i.status === 'New').length;

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#F8F8FC] pb-16">
      {/* Stage 1 Demo Transparency Bar */}
      {isDemoMode ? (
        <div className="bg-[#F3EEFA] border-b border-[#DCD0F0]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-[#311A4D]">
            <p>
              <span className="font-semibold">
                {isUsingDemoFallback ? 'Stage 1 Demo Fallback:' : 'Stage 1 Demo Workspace:'}
              </span>{' '}
              {isUsingDemoFallback && supabaseError ? (
                <>
                  Supabase query failed ({supabaseError}). Displaying read-only sample data until{' '}
                  <code className="font-mono bg-white/80 px-1.5 py-0.5 rounded">supabase/schema.sql</code>{' '}
                  is applied to your Stage 2 project.
                </>
              ) : (
                <>
                  Admin edits and inquiries persist only in browser demo storage. Supabase Auth is not active yet—configure{' '}
                  <code className="font-mono bg-white/80 px-1.5 py-0.5 rounded">VITE_SUPABASE_URL</code> and{' '}
                  <code className="font-mono bg-white/80 px-1.5 py-0.5 rounded">VITE_SUPABASE_ANON_KEY</code>{' '}
                  for Stage 2 production authentication.
                </>
              )}
            </p>
            {!isUsingDemoFallback && (
              <button
                type="button"
                onClick={() => {
                  resetDemoData();
                  showToast('Restored initial Philippine demo listings and inquiries.');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[#DCD0F0] rounded-md font-medium text-[#202124] hover:bg-[#F8F8FC] whitespace-nowrap shrink-0 cursor-pointer self-start md:self-auto"
              >
                <RotateCcw className="w-3.5 h-3.5 text-[#6500B5]" />
                <span>Reset Demo Data</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-white border-b border-[#E6E6EF]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between text-xs text-[#4B4D57]">
            <span>Signed in as {session?.user.email}</span>
            <button
              type="button"
              onClick={() => void signOutSupabase()}
              className="inline-flex items-center gap-1.5 text-[#202124] hover:text-[#6500B5] cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8">
        {/* Top Bar / Breadcrumb Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#E6E6EF]">
          <div className="flex items-center gap-3.5">
            <CompanyLogo size="md" className="border border-[#E6E6EF] p-1" />
            <div>
              <p className="text-xs text-[#696B77]">
                BEN MICUBO REAL ESTATE SERVICES /{' '}
                {activeTab === 'listings'
                  ? 'Listings'
                  : activeTab === 'inquiries'
                    ? 'Inquiries'
                    : 'QR Studio'}
              </p>
              <h1 className="mt-0.5 font-display text-2xl sm:text-3xl font-bold text-[#202124] tracking-tight">
                Property &amp; QR Management
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                setEditingProperty(null);
                setModalOpen(true);
              }}
              className="inline-flex items-center gap-2 h-10 px-4 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Property</span>
            </button>
          </div>
        </div>

        {/* Summary Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 py-6">
          <div className="p-4 bg-white border border-[#E6E6EF] rounded-xl">
            <p className="text-xs text-[#696B77]">Active Listings</p>
            <p className="mt-1 font-display text-2xl font-bold text-[#202124] tabular-nums">
              {activeCount}
            </p>
          </div>
          <div className="p-4 bg-white border border-[#E6E6EF] rounded-xl">
            <p className="text-xs text-[#696B77]">Available Lots</p>
            <p className="mt-1 font-display text-2xl font-bold text-[#6500B5] tabular-nums">
              {properties.filter((p) => !p.isArchived && p.status === 'Available').length}
            </p>
          </div>
          <div className="p-4 bg-white border border-[#E6E6EF] rounded-xl">
            <p className="text-xs text-[#696B77]">Archived Listings</p>
            <p className="mt-1 font-display text-2xl font-bold text-[#202124] tabular-nums">
              {archivedCount}
            </p>
          </div>
          <div className="p-4 bg-white border border-[#E6E6EF] rounded-xl">
            <p className="text-xs text-[#696B77]">Buyer Inquiries</p>
            <p className="mt-1 font-display text-2xl font-bold text-[#10169C] tabular-nums">
              {inquiries.length}{' '}
              <span className="text-xs font-normal text-[#6500B5]">({newInquiryCount} new)</span>
            </p>
          </div>
        </div>

        {feedbackMessage && (
          <div
            role="status"
            className="mb-4 px-4 py-3 rounded-lg border border-[#DCD0F0] bg-[#F3EEFA] text-xs font-medium text-[#6500B5]"
          >
            {feedbackMessage}
          </div>
        )}

        {/* Workspace Navigation Tabs */}
        <div className="flex items-center gap-1 p-1 bg-white border border-[#E6E6EF] rounded-lg w-fit mb-6 overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setActiveTab('listings')}
            className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'listings'
                ? 'bg-[#6500B5] text-white'
                : 'text-[#4B4D57] hover:text-[#202124]'
            }`}
          >
            Listings ({properties.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inquiries')}
            className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'inquiries'
                ? 'bg-[#6500B5] text-white'
                : 'text-[#4B4D57] hover:text-[#202124]'
            }`}
          >
            Buyer Inquiries ({inquiries.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('qr')}
            className={`px-4 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'qr'
                ? 'bg-[#6500B5] text-white'
                : 'text-[#4B4D57] hover:text-[#202124]'
            }`}
          >
            QR Code Studio
          </button>
        </div>

        {/* Tab 1: Property Listings Table */}
        {activeTab === 'listings' && (
          <section className="bg-white border border-[#E6E6EF] rounded-xl overflow-hidden">
            <div className="p-4 border-b border-[#E6E6EF] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-[#696B77] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by Lot ID, title, or city..."
                  className="w-full h-9 pl-9 pr-3 text-xs border border-[#D6D6E4] rounded-md focus:outline-none focus:border-[#6500B5]"
                />
              </div>

              <div className="inline-flex items-center gap-1 p-1 bg-[#F8F8FC] border border-[#E6E6EF] rounded-md self-start sm:self-auto">
                {(['active', 'archived', 'all'] as ListingViewFilter[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewFilter(mode)}
                    className={`px-3 py-1 text-xs font-medium rounded capitalize cursor-pointer ${
                      viewFilter === mode
                        ? 'bg-[#6500B5] text-white'
                        : 'text-[#4B4D57] hover:text-[#202124]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {filteredProperties.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-medium text-[#202124]">No listings in this view</p>
                <p className="mt-1 text-xs text-[#696B77]">
                  Add a new property or switch filters above.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#E6E6EF] bg-[#F8F8FC] text-[11px] font-semibold text-[#4B4D57]">
                      <th className="py-3 px-4">Lot ID</th>
                      <th className="py-3 px-4">Property &amp; Location</th>
                      <th className="py-3 px-4 text-right">Area</th>
                      <th className="py-3 px-4 text-right">Total Price</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EFEFF6] text-sm">
                    {filteredProperties.map((item) => (
                      <tr key={item.id} className="hover:bg-[#F8F8FC]/80 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-[#10169C] whitespace-nowrap">
                          {item.lotId}
                          {item.isArchived && (
                            <span className="block text-[10px] font-normal text-[#696B77]">
                              Archived
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 min-w-[220px]">
                          <p className="font-medium text-[#202124]">{item.title}</p>
                          <p className="text-xs text-[#696B77]">
                            {item.city}, {item.province} · {item.classification}
                          </p>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-xs text-[#202124] tabular-nums whitespace-nowrap">
                          {formatSqm(item.lotAreaSqm)}
                        </td>
                        <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                          <p className="font-mono text-xs font-semibold text-[#202124]">
                            {formatPhp(item.priceTotalPhp)}
                          </p>
                          <p className="font-mono text-[11px] text-[#696B77]">
                            {formatPhp(
                              computePricePerSqm(item.priceTotalPhp, item.lotAreaSqm)
                            )}
                            /sqm
                          </p>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <select
                            aria-label={`Change status for ${item.lotId}`}
                            value={item.status}
                            onChange={(e) =>
                              void handleQuickStatusChange(
                                item,
                                e.target.value as PropertyStatus
                              )
                            }
                            className="h-8 px-2 text-xs font-medium bg-white border border-[#D6D6E4] rounded focus:outline-none focus:border-[#6500B5]"
                          >
                            <option value="Available">Available</option>
                            <option value="Reserved">Reserved</option>
                            <option value="Sold">Sold</option>
                          </select>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <Link
                              to={`/property/${encodeURIComponent(item.lotId)}`}
                              title="View public page"
                              className="w-8 h-8 rounded border border-[#E6E6EF] inline-flex items-center justify-center text-[#4B4D57] hover:text-[#202124]"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                            <Link
                              to={`/signage/${encodeURIComponent(item.lotId)}`}
                              title="Open printable QR signage"
                              className="w-8 h-8 rounded border border-[#E6E6EF] inline-flex items-center justify-center text-[#4B4D57] hover:text-[#6500B5]"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                            </Link>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingProperty(item);
                                setModalOpen(true);
                              }}
                              title="Edit property"
                              className="w-8 h-8 rounded border border-[#E6E6EF] inline-flex items-center justify-center text-[#4B4D57] hover:text-[#202124] cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void toggleArchiveProperty(item.id, !item.isArchived);
                                showToast(
                                  item.isArchived
                                    ? `Restored ${item.lotId}.`
                                    : `Archived ${item.lotId}.`
                                );
                              }}
                              title={item.isArchived ? 'Restore property' : 'Archive property'}
                              className="w-8 h-8 rounded border border-[#E6E6EF] inline-flex items-center justify-center text-[#4B4D57] hover:text-[#202124] cursor-pointer"
                            >
                              {item.isArchived ? (
                                <ArchiveRestore className="w-3.5 h-3.5" />
                              ) : (
                                <Archive className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {confirmDeleteId === item.id ? (
                              <button
                                type="button"
                                onClick={() => {
                                  void deleteProperty(item.id);
                                  setConfirmDeleteId(null);
                                  showToast(`Deleted ${item.lotId}.`);
                                }}
                                className="px-2.5 h-8 rounded bg-red-600 text-white text-xs font-medium hover:bg-red-700 cursor-pointer"
                              >
                                Confirm
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(item.id)}
                                title="Delete property"
                                className="w-8 h-8 rounded border border-[#E6E6EF] inline-flex items-center justify-center text-[#4B4D57] hover:text-red-700 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Tab 2: Buyer Inquiries */}
        {activeTab === 'inquiries' && (
          <section className="space-y-4">
            {inquiries.length === 0 ? (
              <div className="bg-white border border-[#E6E6EF] rounded-xl p-10 text-center">
                <Inbox className="w-7 h-7 text-[#6500B5] mx-auto mb-3" />
                <p className="font-display text-base font-semibold text-[#202124]">
                  No buyer inquiries yet
                </p>
                <p className="mt-1 text-xs text-[#696B77]">
                  Submissions from property detail pages or the homepage form appear here.
                </p>
              </div>
            ) : (
              inquiries.map((inquiry) => (
                <div
                  key={inquiry.id}
                  className="bg-white border border-[#E6E6EF] rounded-xl p-5 flex flex-col md:flex-row md:items-start justify-between gap-4"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#696B77]">
                      <span className="font-mono font-semibold text-[#10169C]">
                        {inquiry.propertyLotId || 'GENERAL'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{inquiry.propertyTitle}</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatDateShort(inquiry.createdAt)}</span>
                      {inquiry.preferredDate && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>Preferred visit: {inquiry.preferredDate}</span>
                        </>
                      )}
                    </div>

                    <h3 className="font-display text-base font-semibold text-[#202124]">
                      {inquiry.buyerName}
                    </h3>
                    <p className="text-sm text-[#4B4D57] leading-relaxed">{inquiry.message}</p>

                    <div className="pt-1 flex flex-wrap items-center gap-4 text-xs">
                      <a
                        href={`mailto:${inquiry.buyerEmail}`}
                        className="text-[#6500B5] hover:underline"
                      >
                        {inquiry.buyerEmail}
                      </a>
                      <a
                        href={`tel:${inquiry.buyerPhone.replace(/\s+/g, '')}`}
                        className="font-mono text-[#202124] hover:underline"
                      >
                        {inquiry.buyerPhone}
                      </a>
                      <a
                        href={buildWhatsAppLink(
                          inquiry.buyerPhone,
                          inquiry.propertyLotId || 'Listing',
                          inquiry.propertyTitle
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#6500B5] font-medium hover:underline"
                      >
                        Reply via WhatsApp →
                      </a>
                    </div>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    <label className="text-xs text-[#696B77]" htmlFor={`inq-${inquiry.id}`}>
                      Status
                    </label>
                    <select
                      id={`inq-${inquiry.id}`}
                      value={inquiry.status}
                      onChange={(e) => {
                        void updateInquiryStatus(inquiry.id, e.target.value as InquiryStatus);
                        showToast(`Inquiry from ${inquiry.buyerName} marked ${e.target.value}.`);
                      }}
                      className="h-9 px-3 text-xs font-medium bg-[#F8F8FC] border border-[#D6D6E4] rounded-md focus:outline-none focus:border-[#6500B5]"
                    >
                      <option value="New">New</option>
                      <option value="Contacted">Contacted</option>
                      <option value="Scheduled">Scheduled</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </div>
                </div>
              ))
            )}
          </section>
        )}

        {/* Tab 3: QR Code Studio */}
        {activeTab === 'qr' && (
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {properties
              .filter((p) => !p.isArchived)
              .map((item) => {
                const url = getPropertyPermalink(item.lotId);
                return (
                  <div
                    key={item.id}
                    className="bg-white border border-[#E6E6EF] rounded-xl p-6 flex flex-col items-center text-center"
                  >
                    <p className="font-mono text-xs font-semibold text-[#10169C]">{item.lotId}</p>
                    <h3 className="mt-1 font-display text-base font-semibold text-[#202124]">
                      {item.title}
                    </h3>
                    <p className="text-xs text-[#696B77] mb-4">
                      {item.city}, {item.province} · {formatPhp(item.priceTotalPhp)}
                    </p>

                    <QRCodeCanvas url={url} lotId={item.lotId} size={172} />

                    <div className="mt-4 pt-4 border-t border-[#EFEFF6] w-full flex items-center justify-between gap-2">
                      <Link
                        to={`/property/${encodeURIComponent(item.lotId)}`}
                        className="text-xs font-medium text-[#4B4D57] hover:text-[#6500B5]"
                      >
                        Open Listing
                      </Link>
                      <Link
                        to={`/signage/${encodeURIComponent(item.lotId)}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#6500B5] rounded-md hover:bg-[#540098]"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Print Sign</span>
                      </Link>
                    </div>
                  </div>
                );
              })}
          </section>
        )}
      </div>

      {modalOpen && (
        <AdminPropertyModal
          initialProperty={editingProperty}
          onClose={() => setModalOpen(false)}
          onSave={handleSaveProperty}
        />
      )}
    </main>
  );
}
