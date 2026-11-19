import React, {useEffect, useMemo, useState} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  Layers,
  Lock,
  LogOut,
  Pencil,
  Plus,
  PlusCircle,
  Printer,
  QrCode,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  Video,
} from 'lucide-react';
import {usePropertyStore} from '../context/PropertyStoreContext';
import {CompanyLogo} from '../components/CompanyLogo';
import {AdminPropertyEditor} from '../components/AdminPropertyEditor';
import {AdminPropertyModal} from '../components/AdminPropertyModal';
import {QRCodeCanvas} from '../components/QRCodeCanvas';
import {getAuthorizedDocumentDownloadUrl} from '../services/storageService';
import {
  buildWhatsAppLink,
  computePricePerSqm,
  formatDateShort,
  formatFileSize,
  formatPhp,
  formatSqm,
  getPropertyPermalink,
} from '../utils/format';
import {buildDistributableQrUrl, validateCanonicalSiteUrl} from '../utils/siteUrl';
import type {
  InquiryStatus,
  Property,
  PropertyClassification,
  PropertyDocumentItem,
  PropertyInput,
  PropertyStatus,
  PropertyVisibility,
} from '../types/property';

type AdminSection =
  | 'overview'
  | 'all'
  | 'add'
  | 'drafts'
  | 'published'
  | 'inquiries'
  | 'media'
  | 'qr'
  | 'settings';

const VALID_SECTIONS: AdminSection[] = [
  'overview',
  'all',
  'add',
  'drafts',
  'published',
  'inquiries',
  'media',
  'qr',
  'settings',
];

export function AdminDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    properties,
    activeProperties,
    draftProperties,
    archivedProperties,
    inquiries,
    siteSettings,
    effectiveCanonicalSiteUrl,
    canonicalUrlValidation,
    isDemoMode,
    isUsingDemoFallback,
    supabaseError,
    session,
    isAdminAuthorized,
    adminRole,
    createProperty,
    updateProperty,
    setPropertyVisibility,
    bulkUpdateStatus,
    bulkUpdateVisibility,
    deleteProperty,
    updateInquiryStatus,
    saveSiteSettings,
    resetDemoData,
    signInWithSupabase,
    signOutSupabase,
  } = usePropertyStore();

  const tabParam = searchParams.get('tab') as AdminSection | null;
  const [activeSection, setActiveSection] = useState<AdminSection>(
    tabParam && VALID_SECTIONS.includes(tabParam) ? tabParam : 'overview'
  );

  useEffect(() => {
    if (tabParam && VALID_SECTIONS.includes(tabParam) && tabParam !== activeSection) {
      setActiveSection(tabParam);
    }
  }, [tabParam, activeSection]);

  const navigateSection = (section: AdminSection) => {
    setActiveSection(section);
    setSearchParams(section === 'overview' ? {} : {tab: section});
  };

  // All Properties filters + Bulk selection
  const [searchQuery, setSearchQuery] = useState('');
  const [visibilityFilter, setVisibilityFilter] = useState<'All' | PropertyVisibility>('All');
  const [statusFilter, setStatusFilter] = useState<'All' | PropertyStatus>('All');
  const [classificationFilter, setClassificationFilter] = useState<
    'All' | PropertyClassification
  >('All');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Modal edit state & delete confirm
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Settings form state
  const [canonicalInput, setCanonicalInput] = useState(effectiveCanonicalSiteUrl);
  const [agentNameInput, setAgentNameInput] = useState(siteSettings.defaultAgentName);
  const [agentPhoneInput, setAgentPhoneInput] = useState(siteSettings.defaultAgentPhone);
  const [agentWhatsappInput, setAgentWhatsappInput] = useState(
    siteSettings.defaultAgentWhatsapp
  );
  const [agentMessengerInput, setAgentMessengerInput] = useState(
    siteSettings.defaultAgentMessenger
  );
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setCanonicalInput(effectiveCanonicalSiteUrl);
    setAgentNameInput(siteSettings.defaultAgentName);
    setAgentPhoneInput(siteSettings.defaultAgentPhone);
    setAgentWhatsappInput(siteSettings.defaultAgentWhatsapp);
    setAgentMessengerInput(siteSettings.defaultAgentMessenger);
  }, [siteSettings, effectiveCanonicalSiteUrl]);

  // Supabase Auth form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const showToast = (msg: string) => {
    setErrorMessage('');
    setFeedbackMessage(msg);
    setTimeout(() => {
      setFeedbackMessage((curr) => (curr === msg ? '' : curr));
    }, 4000);
  };

  const showError = (msg: string) => {
    setFeedbackMessage('');
    setErrorMessage(msg);
  };

  const filteredProperties = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return properties.filter((item) => {
      if (visibilityFilter !== 'All' && item.visibility !== visibilityFilter) return false;
      if (statusFilter !== 'All' && item.status !== statusFilter) return false;
      if (classificationFilter !== 'All' && item.classification !== classificationFilter)
        return false;
      if (!q) return true;
      return (
        item.lotId.toLowerCase().includes(q) ||
        item.title.toLowerCase().includes(q) ||
        item.city.toLowerCase().includes(q) ||
        item.province.toLowerCase().includes(q) ||
        item.barangay.toLowerCase().includes(q)
      );
    });
  }, [properties, visibilityFilter, statusFilter, classificationFilter, searchQuery]);

  const handleSaveProperty = async (input: PropertyInput, existingId?: string) => {
    if (existingId) {
      await updateProperty(existingId, input);
      showToast(`Updated ${input.lotId} (${input.visibility}).`);
    } else {
      const created = await createProperty(input);
      showToast(`Created ${created.lotId} (${created.visibility}).`);
      navigateSection(created.visibility === 'Draft' ? 'drafts' : 'published');
    }
  };

  const handleQuickStatusChange = async (property: Property, nextStatus: PropertyStatus) => {
    try {
      const {id, updatedAt: _u, ...rest} = property;
      await updateProperty(id, {...rest, status: nextStatus});
      showToast(`${property.lotId} status updated to ${nextStatus}.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Unable to update property status.');
    }
  };

  const handleQuickVisibilityChange = async (
    property: Property,
    nextVisibility: PropertyVisibility
  ) => {
    try {
      await setPropertyVisibility(property.id, nextVisibility);
      showToast(`${property.lotId} moved to ${nextVisibility}.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Unable to change listing visibility.');
    }
  };

  const handleBulkStatus = async (status: PropertyStatus) => {
    if (selectedIds.length === 0) return;
    try {
      await bulkUpdateStatus(selectedIds, status);
      showToast(`Updated ${selectedIds.length} listing(s) to ${status}.`);
      setSelectedIds([]);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Bulk status update failed.');
    }
  };

  const handleBulkVisibility = async (visibility: PropertyVisibility) => {
    if (selectedIds.length === 0) return;
    try {
      await bulkUpdateVisibility(selectedIds, visibility);
      showToast(`Updated ${selectedIds.length} listing(s) to ${visibility}.`);
      setSelectedIds([]);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Bulk visibility update failed.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    const check = validateCanonicalSiteUrl(canonicalInput);
    if (canonicalInput.trim() && !check.valid) {
      showError(check.reason || 'Invalid canonical production website URL.');
      return;
    }

    setSavingSettings(true);
    try {
      await saveSiteSettings({
        canonicalSiteUrl: check.valid ? check.normalizedUrl : '',
        defaultAgentName: agentNameInput.trim() || siteSettings.defaultAgentName,
        defaultAgentPhone: agentPhoneInput.trim() || siteSettings.defaultAgentPhone,
        defaultAgentWhatsapp: agentWhatsappInput.trim() || siteSettings.defaultAgentWhatsapp,
        defaultAgentMessenger: agentMessengerInput.trim() || siteSettings.defaultAgentMessenger,
      });
      showToast('Site configuration and canonical URL settings saved.');
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Unable to save site settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleOpenAdminDoc = async (doc: PropertyDocumentItem) => {
    try {
      const url = await getAuthorizedDocumentDownloadUrl(doc, true);
      const link = document.createElement('a');
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.download = doc.fileName;
      link.click();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Unable to open document.');
    }
  };

  const handleCopyCanonical = async (lotId: string) => {
    const url = getPropertyPermalink(lotId, effectiveCanonicalSiteUrl);
    try {
      await navigator.clipboard.writeText(url);
      showToast(
        canonicalUrlValidation.valid
          ? `Copied permanent URL for ${lotId}: ${url}`
          : `Copied preview URL for ${lotId}: ${url}`
      );
    } catch {
      // Clipboard blocked
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

  // Real Supabase Auth Gate when Supabase IS configured and tables are live
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

  if (!isDemoMode && session && !isAdminAuthorized && !isUsingDemoFallback) {
    return (
      <main className="min-h-[calc(100vh-64px)] bg-[#F8F8FC] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md bg-white border border-red-200 rounded-xl p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-3 pb-4 border-b border-[#E6E6EF]">
            <CompanyLogo size="md" />
            <div>
              <p className="font-display text-xs font-bold text-[#202124]">
                BEN MICUBO REAL ESTATE SERVICES
              </p>
              <p className="text-xs font-medium text-red-700 mt-0.5">
                Unauthorized Administrator Account
              </p>
            </div>
          </div>
          <h1 className="font-display text-xl font-bold text-[#202124]">
            Admin Role Required
          </h1>
          <p className="text-xs text-[#4B4D57] leading-relaxed">
            Signed in as <code className="font-mono">{session.user.email}</code>, but this account does not have an active record in <code className="font-mono">public.admin_users</code>. Row-Level Security blocks write access.
          </p>
          <button
            type="button"
            onClick={() => void signOutSupabase()}
            className="w-full h-10 inline-flex items-center justify-center gap-2 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </main>
    );
  }

  const newInquiryCount = inquiries.filter((i) => i.status === 'New').length;
  const availableCount = activeProperties.filter((p) => p.status === 'Available').length;
  const soldCount = properties.filter((p) => p.status === 'Sold').length;

  const navItems: Array<{
    id: AdminSection;
    label: string;
    icon: React.ComponentType<{className?: string}>;
    badge?: number;
  }> = [
    {id: 'overview', label: 'Overview', icon: LayoutDashboard},
    {id: 'all', label: 'All Properties', icon: Layers, badge: properties.length},
    {id: 'add', label: 'Add Property', icon: PlusCircle},
    {id: 'drafts', label: 'Draft Listings', icon: FileText, badge: draftProperties.length},
    {id: 'published', label: 'Published Listings', icon: CheckCircle2, badge: activeProperties.length},
    {id: 'inquiries', label: 'Buyer Inquiries', icon: Inbox, badge: inquiries.length},
    {id: 'media', label: 'Media & Documents', icon: FolderOpen},
    {id: 'qr', label: 'QR Code Studio', icon: QrCode},
    {id: 'settings', label: 'Settings', icon: Settings},
  ];

  const allDocuments = properties.flatMap((prop) =>
    (prop.documents || []).map((doc) => ({property: prop, doc}))
  );

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllFiltered = () => {
    const filteredIds = filteredProperties.map((p) => p.id);
    const allSelected =
      filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredIds);
    }
  };

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#F8F8FC] pb-16">
      {/* Stage 1 Demo / Supabase Session Strip */}
      {isDemoMode ? (
        <div className="bg-[#F3EEFA] border-b border-[#DCD0F0]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs text-[#311A4D]">
            <p>
              <span className="font-semibold">
                {isUsingDemoFallback ? 'Stage 2 Fallback (Demo Mode):' : 'Stage 2 Local Workspace (Demo Mode):'}
              </span>{' '}
              {isUsingDemoFallback && supabaseError ? (
                <>
                  Supabase query failed ({supabaseError}). Showing sample data until{' '}
                  <code className="font-mono bg-white/80 px-1.5 py-0.5 rounded">
                    supabase/migrations/20261118_stage2_property_management.sql
                  </code>{' '}
                  is applied.
                </>
              ) : (
                <>
                  Edits persist in browser local storage. Configure{' '}
                  <code className="font-mono bg-white/80 px-1.5 py-0.5 rounded">VITE_SUPABASE_URL</code> and{' '}
                  <code className="font-mono bg-white/80 px-1.5 py-0.5 rounded">VITE_SUPABASE_ANON_KEY</code>{' '}
                  for live Supabase persistence;{' '}
                  <code className="font-mono bg-white/80 px-1.5 py-0.5 rounded">VITE_PUBLIC_SITE_URL</code>{' '}
                  is optional in dev/preview (required only for distributable QR codes &amp; signage).
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
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between text-xs text-[#4B4D57]">
            <span>
              Signed in as {session?.user.email}
              {adminRole ? ` (${adminRole})` : ''}
            </span>
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

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        {/* Top Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-[#E6E6EF]">
          <div className="flex items-center gap-3.5">
            <CompanyLogo size="md" className="border border-[#E6E6EF] p-1" />
            <div>
              <p className="text-xs text-[#696B77]">
                BEN MICUBO REAL ESTATE SERVICES · Stage 2 Admin Console
              </p>
              <h1 className="mt-0.5 font-display text-2xl sm:text-3xl font-bold text-[#202124] tracking-tight">
                {navItems.find((item) => item.id === activeSection)?.label || 'Overview'}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => navigateSection('add')}
              className="inline-flex items-center gap-2 h-10 px-4 text-xs font-medium text-white bg-gradient-to-r from-[#6500B5] to-[#10169C] rounded-lg hover:opacity-95 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Property</span>
            </button>
          </div>
        </div>

        {/* Feedback & Error Notices */}
        {feedbackMessage && (
          <div
            role="status"
            className="mt-4 px-4 py-3 rounded-lg border border-[#DCD0F0] bg-[#F3EEFA] text-xs font-medium text-[#6500B5]"
          >
            {feedbackMessage}
          </div>
        )}
        {errorMessage && (
          <div
            role="alert"
            className="mt-4 px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-xs font-medium text-red-900"
          >
            {errorMessage}
          </div>
        )}

        {/* Main Sidebar + Workspace Layout */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Navigation Rail */}
          <aside className="lg:col-span-3">
            <nav
              aria-label="Admin sections"
              className="bg-white border border-[#E6E6EF] rounded-xl p-2 flex lg:flex-col gap-1 overflow-x-auto"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateSection(item.id)}
                    className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      active
                        ? 'bg-[#6500B5] text-white'
                        : 'text-[#4B4D57] hover:bg-[#F8F8FC] hover:text-[#202124]'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{item.label}</span>
                    </span>
                    {item.badge !== undefined && (
                      <span
                        className={`font-mono text-[11px] px-1.5 py-0.5 rounded ${
                          active ? 'bg-white/20 text-white' : 'bg-[#F8F8FC] text-[#696B77]'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* Workspace Content */}
          <div className="lg:col-span-9 space-y-6">
            {/* 1. OVERVIEW */}
            {activeSection === 'overview' && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 bg-white border border-[#E6E6EF] rounded-xl">
                    <p className="text-xs text-[#696B77]">Published Lots</p>
                    <p className="mt-1 font-display text-2xl font-bold text-[#6500B5] tabular-nums">
                      {activeProperties.length}
                    </p>
                    <p className="text-[11px] text-[#696B77] mt-0.5">{availableCount} available</p>
                  </div>
                  <div className="p-4 bg-white border border-[#E6E6EF] rounded-xl">
                    <p className="text-xs text-[#696B77]">Draft Listings</p>
                    <p className="mt-1 font-display text-2xl font-bold text-[#202124] tabular-nums">
                      {draftProperties.length}
                    </p>
                    <p className="text-[11px] text-[#696B77] mt-0.5">Awaiting publish</p>
                  </div>
                  <div className="p-4 bg-white border border-[#E6E6EF] rounded-xl">
                    <p className="text-xs text-[#696B77]">Sold &amp; Archived</p>
                    <p className="mt-1 font-display text-2xl font-bold text-[#202124] tabular-nums">
                      {soldCount} / {archivedProperties.length}
                    </p>
                    <p className="text-[11px] text-[#696B77] mt-0.5">Sold / Archived</p>
                  </div>
                  <div className="p-4 bg-white border border-[#E6E6EF] rounded-xl">
                    <p className="text-xs text-[#696B77]">Buyer Inquiries</p>
                    <p className="mt-1 font-display text-2xl font-bold text-[#10169C] tabular-nums">
                      {inquiries.length}
                    </p>
                    <p className="text-[11px] text-[#6500B5] mt-0.5">{newInquiryCount} new</p>
                  </div>
                </div>

                {/* Canonical Production Domain Status Card */}
                <div
                  className={`p-5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    canonicalUrlValidation.valid
                      ? 'bg-white border-[#E6E6EF]'
                      : 'bg-amber-50 border-amber-200'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {canonicalUrlValidation.valid ? (
                      <Globe className="w-5 h-5 text-[#6500B5] shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <h2 className="font-display text-sm font-bold text-[#202124]">
                        {canonicalUrlValidation.valid
                          ? 'Public Website URL Active for QR & Share Links'
                          : 'Public Website URL Not Configured (QR Distribution Disabled)'}
                      </h2>
                      <p className="mt-1 text-xs text-[#4B4D57]">
                        {canonicalUrlValidation.valid ? (
                          <>
                            Permanent property URLs and QR codes resolve to{' '}
                            <code className="font-mono text-[#10169C]">
                              {canonicalUrlValidation.normalizedUrl}/property/LOT-XXX
                            </code>
                          </>
                        ) : (
                          <>
                            {canonicalUrlValidation.reason}{' '}
                            Property creation, editing, publishing, photos, and videos continue working normally in development/preview mode.
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigateSection('settings')}
                    className="h-9 px-4 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Configure Domain
                  </button>
                </div>

                {/* Recent Drafts & Inquiries Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white border border-[#E6E6EF] rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-sm font-bold text-[#202124]">
                        Drafts Ready for Review ({draftProperties.length})
                      </h2>
                      <button
                        type="button"
                        onClick={() => navigateSection('drafts')}
                        className="text-xs font-medium text-[#6500B5] hover:underline cursor-pointer"
                      >
                        View all →
                      </button>
                    </div>
                    {draftProperties.length === 0 ? (
                      <p className="text-xs text-[#696B77]">No unpublished draft listings.</p>
                    ) : (
                      draftProperties.slice(0, 4).map((item) => (
                        <div
                          key={item.id}
                          className="p-3 rounded-lg bg-[#F8F8FC] border border-[#E6E6EF] flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-[#10169C]">
                              {item.lotId}
                            </p>
                            <p className="text-xs font-medium text-[#202124] truncate">
                              {item.title}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingProperty(item);
                              setModalOpen(true);
                            }}
                            className="px-2.5 py-1.5 text-xs font-medium text-[#6500B5] bg-white border border-[#DCD0F0] rounded hover:bg-[#F3EEFA] cursor-pointer shrink-0"
                          >
                            Edit / Publish
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="bg-white border border-[#E6E6EF] rounded-xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="font-display text-sm font-bold text-[#202124]">
                        Recent Buyer Inquiries ({newInquiryCount} new)
                      </h2>
                      <button
                        type="button"
                        onClick={() => navigateSection('inquiries')}
                        className="text-xs font-medium text-[#6500B5] hover:underline cursor-pointer"
                      >
                        Open inbox →
                      </button>
                    </div>
                    {inquiries.length === 0 ? (
                      <p className="text-xs text-[#696B77]">No buyer inquiries yet.</p>
                    ) : (
                      inquiries.slice(0, 4).map((inq) => (
                        <div
                          key={inq.id}
                          className="p-3 rounded-lg bg-[#F8F8FC] border border-[#E6E6EF] space-y-1"
                        >
                          <div className="flex items-center justify-between text-[11px] text-[#696B77]">
                            <span className="font-mono font-semibold text-[#10169C]">
                              {inq.propertyLotId || 'GENERAL'}
                            </span>
                            <span>{inq.status}</span>
                          </div>
                          <p className="text-xs font-semibold text-[#202124]">{inq.buyerName}</p>
                          <p className="text-xs text-[#4B4D57] line-clamp-1">{inq.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}

            {/* 2. ALL PROPERTIES (With Search, Filters & Bulk Status/Visibility Management) */}
            {activeSection === 'all' && (
              <section className="bg-white border border-[#E6E6EF] rounded-xl overflow-hidden">
                <div className="p-4 border-b border-[#E6E6EF] space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="w-4 h-4 text-[#696B77] absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search Lot ID, title, barangay, city..."
                        className="w-full h-9 pl-9 pr-3 text-xs border border-[#D6D6E4] rounded-md focus:outline-none focus:border-[#6500B5]"
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label="Filter by visibility"
                        value={visibilityFilter}
                        onChange={(e) =>
                          setVisibilityFilter(e.target.value as 'All' | PropertyVisibility)
                        }
                        className="h-9 px-2.5 text-xs bg-white border border-[#D6D6E4] rounded-md"
                      >
                        <option value="All">All Visibility</option>
                        <option value="Published">Published</option>
                        <option value="Draft">Draft</option>
                        <option value="Archived">Archived</option>
                      </select>
                      <select
                        aria-label="Filter by availability"
                        value={statusFilter}
                        onChange={(e) =>
                          setStatusFilter(e.target.value as 'All' | PropertyStatus)
                        }
                        className="h-9 px-2.5 text-xs bg-white border border-[#D6D6E4] rounded-md"
                      >
                        <option value="All">All Availability</option>
                        <option value="Available">Available</option>
                        <option value="Reserved">Reserved</option>
                        <option value="Sold">Sold</option>
                      </select>
                      <select
                        aria-label="Filter by classification"
                        value={classificationFilter}
                        onChange={(e) =>
                          setClassificationFilter(
                            e.target.value as 'All' | PropertyClassification
                          )
                        }
                        className="h-9 px-2.5 text-xs bg-white border border-[#D6D6E4] rounded-md"
                      >
                        <option value="All">All Types</option>
                        <option value="Residential">Residential</option>
                        <option value="Commercial">Commercial</option>
                        <option value="Agricultural">Agricultural</option>
                        <option value="Beachfront">Beachfront</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  {/* Bulk Actions Bar */}
                  {selectedIds.length > 0 && (
                    <div className="p-3 rounded-lg bg-[#F3EEFA] border border-[#DCD0F0] flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#6500B5]">
                        {selectedIds.length} listing(s) selected
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleBulkStatus('Available')}
                          className="px-2.5 py-1 bg-white border border-[#DCD0F0] rounded hover:border-[#6500B5] cursor-pointer"
                        >
                          Mark Available
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBulkStatus('Reserved')}
                          className="px-2.5 py-1 bg-white border border-[#DCD0F0] rounded hover:border-[#6500B5] cursor-pointer"
                        >
                          Mark Reserved
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBulkStatus('Sold')}
                          className="px-2.5 py-1 bg-white border border-[#DCD0F0] rounded hover:border-[#6500B5] cursor-pointer"
                        >
                          Mark Sold
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBulkVisibility('Published')}
                          className="px-2.5 py-1 bg-[#6500B5] text-white rounded hover:bg-[#540098] cursor-pointer"
                        >
                          Publish Selected
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleBulkVisibility('Archived')}
                          className="px-2.5 py-1 bg-white border border-[#DCD0F0] rounded hover:border-[#6500B5] cursor-pointer"
                        >
                          Archive Selected
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {filteredProperties.length === 0 ? (
                  <div className="p-10 text-center">
                    <p className="text-sm font-medium text-[#202124]">No matching properties</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#E6E6EF] bg-[#F8F8FC] text-[11px] font-semibold text-[#4B4D57]">
                          <th className="py-3 px-3">
                            <input
                              type="checkbox"
                              aria-label="Select all visible properties"
                              checked={
                                filteredProperties.length > 0 &&
                                filteredProperties.every((p) => selectedIds.includes(p.id))
                              }
                              onChange={toggleSelectAllFiltered}
                              className="accent-[#6500B5]"
                            />
                          </th>
                          <th className="py-3 px-3">Lot ID</th>
                          <th className="py-3 px-3">Property &amp; Location</th>
                          <th className="py-3 px-3 text-right">Area / Price</th>
                          <th className="py-3 px-3">Availability</th>
                          <th className="py-3 px-3">Visibility</th>
                          <th className="py-3 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFEFF6] text-xs">
                        {filteredProperties.map((item) => (
                          <tr key={item.id} className="hover:bg-[#F8F8FC]/80">
                            <td className="py-3 px-3">
                              <input
                                type="checkbox"
                                aria-label={`Select ${item.lotId}`}
                                checked={selectedIds.includes(item.id)}
                                onChange={() => toggleSelectId(item.id)}
                                className="accent-[#6500B5]"
                              />
                            </td>
                            <td className="py-3 px-3 font-mono font-semibold text-[#10169C] whitespace-nowrap">
                              {item.lotId}
                            </td>
                            <td className="py-3 px-3 min-w-[200px]">
                              <p className="font-semibold text-[#202124]">{item.title}</p>
                              <p className="text-[11px] text-[#696B77]">
                                {item.city}, {item.province} · {item.classification} ·{' '}
                                {item.images.length} photos · {item.videos.length} videos ·{' '}
                                {item.documents.length} docs
                              </p>
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                              <p className="font-semibold text-[#202124]">
                                {formatPhp(item.priceTotalPhp)}
                              </p>
                              <p className="text-[11px] text-[#696B77]">
                                {formatSqm(item.lotAreaSqm)} ·{' '}
                                {formatPhp(
                                  computePricePerSqm(item.priceTotalPhp, item.lotAreaSqm)
                                )}
                                /sqm
                              </p>
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <select
                                aria-label={`Availability for ${item.lotId}`}
                                value={item.status}
                                onChange={(e) =>
                                  void handleQuickStatusChange(
                                    item,
                                    e.target.value as PropertyStatus
                                  )
                                }
                                className="h-8 px-2 text-xs bg-white border border-[#D6D6E4] rounded"
                              >
                                <option value="Available">Available</option>
                                <option value="Reserved">Reserved</option>
                                <option value="Sold">Sold</option>
                              </select>
                            </td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <select
                                aria-label={`Visibility for ${item.lotId}`}
                                value={item.visibility}
                                onChange={(e) =>
                                  void handleQuickVisibilityChange(
                                    item,
                                    e.target.value as PropertyVisibility
                                  )
                                }
                                className="h-8 px-2 text-xs bg-white border border-[#D6D6E4] rounded"
                              >
                                <option value="Draft">Draft</option>
                                <option value="Published">Published</option>
                                <option value="Archived">Archived</option>
                              </select>
                            </td>
                            <td className="py-3 px-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1">
                                <Link
                                  to={`/property/${encodeURIComponent(item.lotId)}${
                                    item.visibility !== 'Published' ? '?preview=1' : ''
                                  }`}
                                  title={
                                    item.visibility === 'Published'
                                      ? 'Open public listing'
                                      : 'Preview unpublished listing'
                                  }
                                  className="w-8 h-8 rounded border border-[#E6E6EF] inline-flex items-center justify-center text-[#4B4D57] hover:text-[#6500B5]"
                                >
                                  {item.visibility === 'Published' ? (
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  ) : (
                                    <Eye className="w-3.5 h-3.5" />
                                  )}
                                </Link>
                                {canonicalUrlValidation.valid ? (
                                  <Link
                                    to={`/signage/${encodeURIComponent(item.lotId)}`}
                                    title="QR Signage"
                                    className="w-8 h-8 rounded border border-[#E6E6EF] inline-flex items-center justify-center text-[#4B4D57] hover:text-[#6500B5]"
                                  >
                                    <QrCode className="w-3.5 h-3.5" />
                                  </Link>
                                ) : (
                                  <button
                                    type="button"
                                    disabled
                                    title="Configure VITE_PUBLIC_SITE_URL or a public HTTPS domain in Settings before printing QR signage."
                                    className="w-8 h-8 rounded border border-[#E6E6EF] inline-flex items-center justify-center text-[#696B77] opacity-50 cursor-not-allowed"
                                  >
                                    <QrCode className="w-3.5 h-3.5" />
                                  </button>
                                )}
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
                                {confirmDeleteId === item.id ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void deleteProperty(item.id);
                                      setConfirmDeleteId(null);
                                      showToast(`Deleted ${item.lotId}.`);
                                    }}
                                    className="px-2 h-8 rounded bg-red-600 text-white text-xs font-medium cursor-pointer"
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

            {/* 3. ADD PROPERTY */}
            {activeSection === 'add' && (
              <section>
                <AdminPropertyEditor
                  initialProperty={null}
                  existingProperties={properties}
                  siteSettings={siteSettings}
                  onSave={handleSaveProperty}
                  onCancel={() => navigateSection('all')}
                />
              </section>
            )}

            {/* 4. DRAFT LISTINGS */}
            {activeSection === 'drafts' && (
              <section className="space-y-4">
                {draftProperties.length === 0 ? (
                  <div className="bg-white border border-[#E6E6EF] rounded-xl p-10 text-center">
                    <FileText className="w-7 h-7 text-[#6500B5] mx-auto mb-2" />
                    <p className="font-display text-base font-semibold text-[#202124]">
                      No draft listings
                    </p>
                    <p className="text-xs text-[#696B77] mt-1">
                      Create a new listing or save an in-progress lot as a Draft.
                    </p>
                  </div>
                ) : (
                  draftProperties.map((item) => (
                    <div
                      key={item.id}
                      className="bg-white border border-[#E6E6EF] rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-[#696B77]">
                          <span className="font-mono font-semibold text-[#10169C]">
                            {item.lotId}
                          </span>
                          <span>·</span>
                          <span>Draft (Private to Admin)</span>
                          <span>·</span>
                          <span>Updated {formatDateShort(item.updatedAt)}</span>
                        </div>
                        <h3 className="font-display text-base font-semibold text-[#202124]">
                          {item.title}
                        </h3>
                        <p className="text-xs text-[#4B4D57]">
                          {item.city}, {item.province} · {formatSqm(item.lotAreaSqm)} ·{' '}
                          {formatPhp(item.priceTotalPhp)} · {item.images.length} photos ·{' '}
                          {item.documents.length} documents
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Link
                          to={`/property/${encodeURIComponent(item.lotId)}?preview=1`}
                          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#202124] bg-[#F8F8FC] border border-[#D6D6E4] rounded-lg hover:border-[#6500B5]"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#6500B5]" />
                          <span>Preview</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProperty(item);
                            setModalOpen(true);
                          }}
                          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-lg hover:border-[#6500B5] cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleQuickVisibilityChange(item, 'Published')}
                          className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] cursor-pointer"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Publish</span>
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </section>
            )}

            {/* 5. PUBLISHED LISTINGS */}
            {activeSection === 'published' && (
              <section className="space-y-4">
                {activeProperties.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white border border-[#E6E6EF] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#696B77]">
                        <span className="font-mono font-semibold text-[#10169C]">
                          {item.lotId}
                        </span>
                        <span>·</span>
                        <span>{item.status}</span>
                        <span>·</span>
                        <span>{item.classification}</span>
                      </div>
                      <h3 className="font-display text-base font-semibold text-[#202124]">
                        {item.title}
                      </h3>
                      <p className="text-xs text-[#4B4D57]">
                        {item.city}, {item.province} · {formatSqm(item.lotAreaSqm)} ·{' '}
                        {formatPhp(item.priceTotalPhp)}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <select
                        aria-label={`Change availability for ${item.lotId}`}
                        value={item.status}
                        onChange={(e) =>
                          void handleQuickStatusChange(item, e.target.value as PropertyStatus)
                        }
                        className="h-9 px-2.5 text-xs font-medium bg-[#F8F8FC] border border-[#D6D6E4] rounded-lg"
                      >
                        <option value="Available">Available</option>
                        <option value="Reserved">Reserved</option>
                        <option value="Sold">Sold</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => void handleCopyCanonical(item.lotId)}
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-lg hover:border-[#6500B5] cursor-pointer"
                      >
                        <Copy className="w-3.5 h-3.5 text-[#6500B5]" />
                        <span>Copy URL</span>
                      </button>

                      {canonicalUrlValidation.valid ? (
                        <Link
                          to={`/signage/${encodeURIComponent(item.lotId)}`}
                          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#6500B5] bg-[#F3EEFA] border border-[#DCD0F0] rounded-lg"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>QR Sign</span>
                        </Link>
                      ) : (
                        <button
                          type="button"
                          disabled
                          title="Configure VITE_PUBLIC_SITE_URL or a public HTTPS domain in Settings before printing QR signage."
                          className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#696B77] bg-[#F8F8FC] border border-[#E6E6EF] rounded-lg opacity-65 cursor-not-allowed"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          <span>Signage Disabled</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setEditingProperty(item);
                          setModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-lg cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Edit</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleQuickVisibilityChange(item, 'Archived')}
                        className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#4B4D57] bg-white border border-[#D6D6E4] rounded-lg hover:text-[#202124] cursor-pointer"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        <span>Archive</span>
                      </button>
                    </div>
                  </div>
                ))}

                {archivedProperties.length > 0 && (
                  <div className="pt-4">
                    <h2 className="font-display text-sm font-bold text-[#4B4D57] mb-3">
                      Archived Listings ({archivedProperties.length})
                    </h2>
                    <div className="space-y-2.5">
                      {archivedProperties.map((item) => (
                        <div
                          key={item.id}
                          className="bg-white border border-[#E6E6EF] rounded-xl p-4 flex items-center justify-between gap-4"
                        >
                          <div>
                            <p className="font-mono text-xs text-[#696B77]">{item.lotId}</p>
                            <p className="text-sm font-medium text-[#202124]">{item.title}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleQuickVisibilityChange(item, 'Published')}
                            className="inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium text-[#6500B5] bg-[#F3EEFA] rounded-lg cursor-pointer"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" />
                            <span>Restore &amp; Publish</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* 6. BUYER INQUIRIES */}
            {activeSection === 'inquiries' && (
              <section className="space-y-4">
                {inquiries.length === 0 ? (
                  <div className="bg-white border border-[#E6E6EF] rounded-xl p-10 text-center">
                    <Inbox className="w-7 h-7 text-[#6500B5] mx-auto mb-3" />
                    <p className="font-display text-base font-semibold text-[#202124]">
                      No buyer inquiries yet
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
                          <span>·</span>
                          <span>{inquiry.propertyTitle}</span>
                          <span>·</span>
                          <span>{formatDateShort(inquiry.createdAt)}</span>
                          {inquiry.preferredDate && (
                            <>
                              <span>·</span>
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
                            void updateInquiryStatus(
                              inquiry.id,
                              e.target.value as InquiryStatus
                            );
                            showToast(
                              `Inquiry from ${inquiry.buyerName} marked ${e.target.value}.`
                            );
                          }}
                          className="h-9 px-3 text-xs font-medium bg-[#F8F8FC] border border-[#D6D6E4] rounded-md"
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

            {/* 7. MEDIA & DOCUMENTS */}
            {activeSection === 'media' && (
              <section className="space-y-6">
                <div className="bg-white border border-[#E6E6EF] rounded-xl p-5">
                  <h2 className="font-display text-base font-bold text-[#202124]">
                    Media Inventory by Listing
                  </h2>
                  <p className="text-xs text-[#696B77] mt-1">
                    Unpublished assets stay in <code className="font-mono">property-media-private</code>; published photos move to <code className="font-mono">property-media-public</code>.
                  </p>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#E6E6EF] bg-[#F8F8FC] text-[#4B4D57]">
                          <th className="py-2.5 px-3">Lot ID</th>
                          <th className="py-2.5 px-3">Visibility</th>
                          <th className="py-2.5 px-3">Photos</th>
                          <th className="py-2.5 px-3">Videos</th>
                          <th className="py-2.5 px-3">Documents</th>
                          <th className="py-2.5 px-3 text-right">Manage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EFEFF6]">
                        {properties.map((prop) => (
                          <tr key={prop.id}>
                            <td className="py-2.5 px-3 font-mono font-semibold text-[#10169C]">
                              {prop.lotId}
                            </td>
                            <td className="py-2.5 px-3">{prop.visibility}</td>
                            <td className="py-2.5 px-3">
                              <span className="inline-flex items-center gap-1">
                                <ImageIcon className="w-3.5 h-3.5 text-[#6500B5]" />
                                {prop.images.length}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="inline-flex items-center gap-1">
                                <Video className="w-3.5 h-3.5 text-[#10169C]" />
                                {prop.videos.length}
                              </span>
                            </td>
                            <td className="py-2.5 px-3">
                              {prop.documents.filter((d) => d.visibility === 'Private').length} private /{' '}
                              {prop.documents.filter((d) => d.visibility === 'Public').length} public
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingProperty(prop);
                                  setModalOpen(true);
                                }}
                                className="text-xs font-medium text-[#6500B5] hover:underline cursor-pointer"
                              >
                                Manage Media
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white border border-[#E6E6EF] rounded-xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-base font-bold text-[#202124]">
                      Property Files &amp; Documents Registry ({allDocuments.length})
                    </h2>
                    <span className="text-[11px] text-[#696B77]">
                      Private files use signed URLs (60s)
                    </span>
                  </div>

                  {allDocuments.length === 0 ? (
                    <p className="text-xs text-[#696B77]">No documents uploaded yet.</p>
                  ) : (
                    <div className="space-y-2">
                      {allDocuments.map(({property, doc}) => (
                        <div
                          key={doc.id}
                          className="p-3 rounded-lg bg-[#F8F8FC] border border-[#E6E6EF] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-[#10169C]">
                                {property.lotId}
                              </span>
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${
                                  doc.visibility === 'Private'
                                    ? 'bg-amber-100 text-amber-900'
                                    : 'bg-emerald-100 text-emerald-900'
                                }`}
                              >
                                {doc.visibility === 'Private' && <Lock className="w-3 h-3" />}
                                {doc.visibility}
                              </span>
                              <span className="text-[#696B77]">{doc.category}</span>
                            </div>
                            <p className="mt-0.5 font-semibold text-[#202124] truncate">
                              {doc.title}
                            </p>
                            <p className="text-[11px] font-mono text-[#696B77] truncate">
                              {doc.storageBucket}/{doc.storagePath} · {formatFileSize(doc.fileSizeBytes)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleOpenAdminDoc(doc)}
                            className="px-3 py-1.5 text-xs font-medium text-[#6500B5] bg-white border border-[#DCD0F0] rounded-md hover:bg-[#F3EEFA] cursor-pointer shrink-0"
                          >
                            Authorized Open
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* 8. QR CODE STUDIO */}
            {activeSection === 'qr' && (
              <section className="space-y-5">
                {!canonicalUrlValidation.valid && (
                  <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950">
                    <div>
                      <p className="font-semibold">
                        QR Downloads &amp; Printable Signage Disabled Until Public Website URL Is Configured
                      </p>
                      <p className="mt-0.5">
                        {canonicalUrlValidation.reason} Distributable QR codes never encode localhost, Google AI Studio preview URLs, or temporary development addresses.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateSection('settings')}
                      className="px-3.5 py-2 bg-[#6500B5] text-white rounded-lg font-medium shrink-0 cursor-pointer"
                    >
                      Configure in Settings
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {properties
                    .filter((p) => p.visibility !== 'Archived')
                    .map((item) => {
                      const url =
                        buildDistributableQrUrl(effectiveCanonicalSiteUrl, item.lotId) || '';
                      return (
                        <div
                          key={item.id}
                          className="bg-white border border-[#E6E6EF] rounded-xl p-5 flex flex-col items-center text-center"
                        >
                          <p className="font-mono text-xs font-semibold text-[#10169C]">
                            {item.lotId} · {item.visibility}
                          </p>
                          <h3 className="mt-1 font-display text-sm font-semibold text-[#202124]">
                            {item.title}
                          </h3>
                          <p className="text-xs text-[#696B77] mb-4">
                            {item.city}, {item.province} · {formatPhp(item.priceTotalPhp)}
                          </p>

                          <QRCodeCanvas
                            url={url}
                            lotId={item.lotId}
                            size={164}
                            canonicalValid={canonicalUrlValidation.valid}
                            blockedReason={canonicalUrlValidation.reason}
                          />

                          <div className="mt-4 pt-3 border-t border-[#EFEFF6] w-full flex items-center justify-between gap-2">
                            <Link
                              to={`/property/${encodeURIComponent(item.lotId)}${
                                item.visibility !== 'Published' ? '?preview=1' : ''
                              }`}
                              className="text-xs font-medium text-[#4B4D57] hover:text-[#6500B5]"
                            >
                              Open Listing
                            </Link>
                            {canonicalUrlValidation.valid ? (
                              <Link
                                to={`/signage/${encodeURIComponent(item.lotId)}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#6500B5] rounded-md hover:bg-[#540098]"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>Print Sign</span>
                              </Link>
                            ) : (
                              <button
                                type="button"
                                disabled
                                title="Configure VITE_PUBLIC_SITE_URL or a public HTTPS domain in Settings before printing QR signage."
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#696B77] bg-[#F8F8FC] border border-[#E6E6EF] rounded-md opacity-70 cursor-not-allowed"
                              >
                                <Printer className="w-3.5 h-3.5" />
                                <span>Print Disabled</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </section>
            )}

            {/* 9. SETTINGS */}
            {activeSection === 'settings' && (
              <section className="space-y-6">
                <form
                  onSubmit={handleSaveSettings}
                  className="bg-white border border-[#E6E6EF] rounded-xl p-6 space-y-5"
                >
                  <div>
                    <h2 className="font-display text-base font-bold text-[#202124]">
                      Canonical Production Domain &amp; Agency Defaults
                    </h2>
                    <p className="mt-1 text-xs text-[#696B77]">
                      Permanent QR codes always encode this HTTPS production website URL. Temporary preview URLs (<code className="font-mono">*.run.app</code>, <code className="font-mono">localhost</code>) are blocked.
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="canonical-site-url"
                      className="block text-xs font-medium text-[#4B4D57] mb-1.5"
                    >
                      Canonical Production Website URL (HTTPS)
                    </label>
                    <input
                      id="canonical-site-url"
                      type="url"
                      value={canonicalInput}
                      onChange={(e) => setCanonicalInput(e.target.value)}
                      placeholder="https://benmicuborealestate.pages.dev"
                      className="w-full h-11 px-3.5 font-mono text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
                    />
                    <p className="mt-1.5 text-[11px] text-[#696B77]">
                      Also configurable at build time via <code className="font-mono">VITE_PUBLIC_SITE_URL</code> in Cloudflare Pages environment variables.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                        Default Advisor Name
                      </label>
                      <input
                        type="text"
                        value={agentNameInput}
                        onChange={(e) => setAgentNameInput(e.target.value)}
                        className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                        Default Phone Number
                      </label>
                      <input
                        type="text"
                        value={agentPhoneInput}
                        onChange={(e) => setAgentPhoneInput(e.target.value)}
                        className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                        Default WhatsApp Digits
                      </label>
                      <input
                        type="text"
                        value={agentWhatsappInput}
                        onChange={(e) => setAgentWhatsappInput(e.target.value)}
                        className="w-full h-10 px-3 font-mono text-sm border border-[#D6D6E4] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                        Default Messenger Handle
                      </label>
                      <input
                        type="text"
                        value={agentMessengerInput}
                        onChange={(e) => setAgentMessengerInput(e.target.value)}
                        className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg"
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-end">
                    <button
                      type="submit"
                      disabled={savingSettings}
                      className="h-10 px-5 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] disabled:opacity-60 cursor-pointer"
                    >
                      {savingSettings ? 'Saving Settings...' : 'Save Site Settings'}
                    </button>
                  </div>
                </form>

                <div className="bg-white border border-[#E6E6EF] rounded-xl p-6 space-y-2 text-xs text-[#4B4D57]">
                  <h3 className="font-display text-sm font-bold text-[#202124]">
                    Supabase Security &amp; Storage Checklist
                  </h3>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      Database migration: <code className="font-mono">supabase/migrations/20261118_stage2_property_management.sql</code>
                    </li>
                    <li>
                      Admin access control: <code className="font-mono">public.admin_users</code> verified by <code className="font-mono">public.is_authorized_admin()</code> RLS helper
                    </li>
                    <li>
                      Private media bucket: <code className="font-mono">property-media-private</code> (admin signed URLs only)
                    </li>
                    <li>
                      Public approved media bucket: <code className="font-mono">property-media-public</code>
                    </li>
                  </ul>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      {modalOpen && (
        <AdminPropertyModal
          initialProperty={editingProperty}
          existingProperties={properties}
          siteSettings={siteSettings}
          onClose={() => setModalOpen(false)}
          onSave={handleSaveProperty}
        />
      )}
    </main>
  );
}
