import React, {useState} from 'react';
import {Plus, Trash2, Upload, X} from 'lucide-react';
import type {
  Property,
  PropertyClassification,
  PropertyInput,
  PropertyStatus,
} from '../types/property';
import {computePricePerSqm, formatPhp} from '../utils/format';
import {extractYouTubeVideoId} from '../utils/youtube';
import {PropertyImage} from './PropertyImage';

interface AdminPropertyModalProps {
  initialProperty: Property | null;
  onClose: () => void;
  onSave: (input: PropertyInput, existingId?: string) => Promise<void>;
}

const SAMPLE_IMAGE_CHOICES = [
  {label: 'Tagaytay Ridge', path: '/images/tagaytay_ridge.svg'},
  {label: 'Batangas Coast', path: '/images/batangas_coast.svg'},
  {label: 'Laguna Estate', path: '/images/laguna_estate.svg'},
  {label: 'Siargao Palms', path: '/images/siargao_palm.svg'},
  {label: 'Cebu Highland', path: '/images/cebu_highland.svg'},
  {label: 'Palawan Meadow', path: '/images/palawan_farm.svg'},
  {label: 'Survey Plan', path: '/images/survey_plan.svg'},
  {label: 'Road Frontage', path: '/images/road_frontage.svg'},
];

export function AdminPropertyModal({
  initialProperty,
  onClose,
  onSave,
}: AdminPropertyModalProps) {
  const [lotId, setLotId] = useState(initialProperty?.lotId ?? 'LOT-007');
  const [title, setTitle] = useState(initialProperty?.title ?? '');
  const [barangay, setBarangay] = useState(initialProperty?.barangay ?? '');
  const [city, setCity] = useState(initialProperty?.city ?? '');
  const [province, setProvince] = useState(initialProperty?.province ?? '');
  const [region, setRegion] = useState(initialProperty?.region ?? 'CALABARZON (Region IV-A)');
  const [lotAreaSqm, setLotAreaSqm] = useState(String(initialProperty?.lotAreaSqm ?? 500));
  const [dimensions, setDimensions] = useState(initialProperty?.dimensions ?? '20m × 25m');
  const [priceTotalPhp, setPriceTotalPhp] = useState(
    String(initialProperty?.priceTotalPhp ?? 10000000)
  );
  const [classification, setClassification] = useState<PropertyClassification>(
    initialProperty?.classification ?? 'Residential'
  );
  const [status, setStatus] = useState<PropertyStatus>(
    initialProperty?.status ?? 'Available'
  );
  const [isFeatured, setIsFeatured] = useState(initialProperty?.isFeatured ?? false);
  const [roadAccess, setRoadAccess] = useState(
    initialProperty?.roadAccess ?? '10m concrete barangay road'
  );
  const [titleStatus, setTitleStatus] = useState(
    initialProperty?.titleStatus ?? 'Clean TCT · Updated Real Property Tax'
  );
  const [terrain, setTerrain] = useState(initialProperty?.terrain ?? 'Flat graded elevation');
  const [description, setDescription] = useState(initialProperty?.description ?? '');
  const [highlightsText, setHighlightsText] = useState(
    initialProperty?.highlights.join('\n') ?? ''
  );
  const [photos, setPhotos] = useState<string[]>(
    initialProperty?.photos ?? ['/images/laguna_estate.svg', '/images/survey_plan.svg']
  );
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState(initialProperty?.youtubeUrl ?? '');
  const [latitude, setLatitude] = useState(String(initialProperty?.latitude ?? 14.1228));
  const [longitude, setLongitude] = useState(String(initialProperty?.longitude ?? 120.9856));
  const [googleMapsUrl, setGoogleMapsUrl] = useState(
    initialProperty?.googleMapsUrl ??
      'https://www.google.com/maps/search/?api=1&query=14.1228,120.9856'
  );
  const [agentName, setAgentName] = useState(initialProperty?.agentName ?? 'Rafael Mendoza');
  const [agentPhone, setAgentPhone] = useState(
    initialProperty?.agentPhone ?? '+63 917 555 0142'
  );
  const [agentWhatsapp, setAgentWhatsapp] = useState(
    initialProperty?.agentWhatsapp ?? '639175550142'
  );
  const [agentMessenger, setAgentMessenger] = useState(
    initialProperty?.agentMessenger ?? 'benmicubo.realestate'
  );

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const numericArea = Number(lotAreaSqm) || 0;
  const numericPrice = Number(priceTotalPhp) || 0;
  const computedPerSqm = computePricePerSqm(numericPrice, numericArea);
  const parsedYouTubeId = youtubeUrl.trim() ? extractYouTubeVideoId(youtubeUrl) : null;

  const handleAddPhotoUrl = () => {
    const trimmed = newPhotoUrl.trim();
    if (!trimmed) return;
    setPhotos((prev) => [...prev, trimmed]);
    setNewPhotoUrl('');
  };

  const handleLocalImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotos((prev) => [...prev, reader.result as string]);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRemovePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSyncMapsUrl = () => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      setGoogleMapsUrl(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!lotId.trim() || !title.trim() || !city.trim() || !province.trim()) {
      setError('Lot ID, Title, City, and Province are required.');
      return;
    }
    if (numericArea <= 0) {
      setError('Lot area must be greater than 0 sqm.');
      return;
    }
    if (numericPrice < 0) {
      setError('Total price cannot be negative.');
      return;
    }
    if (youtubeUrl.trim() && !parsedYouTubeId) {
      setError('Please enter a valid YouTube watch, share, or embed URL (or leave blank).');
      return;
    }

    const input: PropertyInput = {
      lotId: lotId.trim().toUpperCase(),
      title: title.trim(),
      barangay: barangay.trim() || 'Brgy. Central',
      city: city.trim(),
      province: province.trim(),
      region: region.trim() || 'Philippines',
      lotAreaSqm: numericArea,
      dimensions: dimensions.trim() || 'Standard parcel',
      priceTotalPhp: numericPrice,
      classification,
      status,
      isArchived: initialProperty?.isArchived ?? false,
      isFeatured,
      roadAccess: roadAccess.trim() || 'Paved barangay road',
      titleStatus: titleStatus.trim() || 'Clean TCT',
      terrain: terrain.trim() || 'Level',
      description: description.trim() || 'Verified land parcel ready for viewing.',
      highlights: highlightsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
      photos: photos.length > 0 ? photos : ['/images/survey_plan.svg'],
      youtubeUrl: youtubeUrl.trim(),
      latitude: Number(latitude) || 14.5995,
      longitude: Number(longitude) || 120.9842,
      googleMapsUrl:
        googleMapsUrl.trim() ||
        `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
      agentName: agentName.trim() || 'Ben Micubo Real Estate Advisor',
      agentPhone: agentPhone.trim() || '+63 917 555 0142',
      agentWhatsapp: agentWhatsapp.trim() || '639175550142',
      agentMessenger: agentMessenger.trim() || 'benmicubo.realestate',
    };

    setSaving(true);
    try {
      await onSave(input, initialProperty?.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save property.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={initialProperty ? `Edit ${initialProperty.lotId}` : 'Add new property listing'}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div className="bg-white border border-[#E6E6EF] rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E6E6EF] flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-[#202124]">
              {initialProperty ? `Edit Listing · ${initialProperty.lotId}` : 'Add New Property Listing'}
            </h2>
            <p className="text-xs text-[#696B77]">
              Permanent URL: /property/{lotId.trim().toUpperCase() || 'LOT-XXX'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="w-9 h-9 rounded-md border border-[#E6E6EF] flex items-center justify-center text-[#4B4D57] hover:text-[#202124] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6">
          {error && (
            <div className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800">
              {error}
            </div>
          )}

          {/* Core Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                Permanent Lot ID
              </label>
              <input
                type="text"
                required
                value={lotId}
                onChange={(e) => setLotId(e.target.value.toUpperCase())}
                placeholder="LOT-007"
                className="w-full h-10 px-3 font-mono text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                Property Title
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Alfonso Pine Ridge Corner Lot"
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
          </div>

          {/* Location */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Barangay</label>
              <input
                type="text"
                value={barangay}
                onChange={(e) => setBarangay(e.target.value)}
                placeholder="Brgy. Luksuhin"
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">City / Town</label>
              <input
                type="text"
                required
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Alfonso"
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Province</label>
              <input
                type="text"
                required
                value={province}
                onChange={(e) => setProvince(e.target.value)}
                placeholder="Cavite"
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Region</label>
              <input
                type="text"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                placeholder="CALABARZON"
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
          </div>

          {/* Pricing, Dimensions & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                Lot Area (sqm)
              </label>
              <input
                type="number"
                min={1}
                required
                value={lotAreaSqm}
                onChange={(e) => setLotAreaSqm(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono tabular-nums border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                Total Price (PHP)
              </label>
              <input
                type="number"
                min={0}
                required
                value={priceTotalPhp}
                onChange={(e) => setPriceTotalPhp(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono tabular-nums border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
              <p className="mt-1 text-[11px] font-mono text-[#6500B5] tabular-nums">
                {formatPhp(computedPerSqm)} / sqm
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                Classification
              </label>
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value as PropertyClassification)}
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg bg-white focus:outline-none focus:border-[#6500B5]"
              >
                <option value="Residential">Residential</option>
                <option value="Beachfront">Beachfront</option>
                <option value="Commercial">Commercial</option>
                <option value="Agricultural">Agricultural</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                Availability
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as PropertyStatus)}
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg bg-white focus:outline-none focus:border-[#6500B5]"
              >
                <option value="Available">Available</option>
                <option value="Reserved">Reserved</option>
                <option value="Sold">Sold</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Dimensions</label>
              <input
                type="text"
                value={dimensions}
                onChange={(e) => setDimensions(e.target.value)}
                placeholder="20m frontage × 25m depth"
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Road Access</label>
              <input
                type="text"
                value={roadAccess}
                onChange={(e) => setRoadAccess(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Title Status</label>
              <input
                type="text"
                value={titleStatus}
                onChange={(e) => setTitleStatus(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Terrain</label>
              <input
                type="text"
                value={terrain}
                onChange={(e) => setTerrain(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <label className="flex items-center gap-2.5 pt-4 text-sm text-[#202124] cursor-pointer">
              <input
                type="checkbox"
                checked={isFeatured}
                onChange={(e) => setIsFeatured(e.target.checked)}
                className="accent-[#6500B5]"
              />
              <span>Feature this property on Homepage hero</span>
            </label>
          </div>

          {/* Description & Highlights */}
          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed overview of proximity, views, utilities, and investment potential..."
              className="w-full px-3 py-2 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#4B4D57] mb-1">
              Highlights (one per line)
            </label>
            <textarea
              rows={2}
              value={highlightsText}
              onChange={(e) => setHighlightsText(e.target.value)}
              placeholder="25m concrete frontage&#10;Clean TCT ready for transfer"
              className="w-full px-3 py-2 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
            />
          </div>

          {/* Photo Gallery Manager */}
          <div className="p-4 rounded-xl border border-[#E6E6EF] bg-[#F8F8FC] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#202124]">
                Photo Gallery ({photos.length})
              </p>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-md hover:bg-[#F2F2F8] cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-[#6500B5]" />
                <span>Upload Image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLocalImageUpload}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              {photos.map((src, index) => (
                <div
                  key={`${src.slice(0, 24)}-${index}`}
                  className="relative w-24 h-16 rounded-lg overflow-hidden border border-[#D6D6E4] bg-white group"
                >
                  <PropertyImage src={src} alt={`Gallery item ${index + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => handleRemovePhoto(index)}
                    aria-label={`Remove photo ${index + 1}`}
                    className="absolute top-1 right-1 w-6 h-6 rounded bg-black/75 text-white flex items-center justify-center opacity-90 hover:opacity-100 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                type="url"
                value={newPhotoUrl}
                onChange={(e) => setNewPhotoUrl(e.target.value)}
                placeholder="Paste image URL (Supabase Storage or HTTPS)..."
                className="flex-1 h-9 px-3 text-xs bg-white border border-[#D6D6E4] rounded-md focus:outline-none focus:border-[#6500B5]"
              />
              <button
                type="button"
                onClick={handleAddPhotoUrl}
                className="inline-flex items-center gap-1 px-3 h-9 text-xs font-medium text-white bg-[#6500B5] rounded-md hover:bg-[#540098] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add URL</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#696B77]">
              <span>Quick sample visuals:</span>
              {SAMPLE_IMAGE_CHOICES.map((sample) => (
                <button
                  key={sample.path}
                  type="button"
                  onClick={() => setPhotos((prev) => [...prev, sample.path])}
                  className="px-2 py-0.5 bg-white border border-[#D6D6E4] rounded text-[#4B4D57] hover:text-[#6500B5] cursor-pointer"
                >
                  + {sample.label}
                </button>
              ))}
            </div>
          </div>

          {/* YouTube & Google Maps */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                YouTube Drone Video URL
              </label>
              <input
                type="url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
              {youtubeUrl.trim() && (
                <p className="mt-1 text-[11px] font-mono text-[#4B4D57]">
                  {parsedYouTubeId
                    ? `Detected YouTube ID: ${parsedYouTubeId}`
                    : 'Unrecognized YouTube URL format'}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                Google Maps Link
              </label>
              <input
                type="url"
                value={googleMapsUrl}
                onChange={(e) => setGoogleMapsUrl(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Latitude</label>
              <input
                type="number"
                step="any"
                value={latitude}
                onChange={(e) => setLatitude(e.target.value)}
                className="w-full h-10 px-3 font-mono text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Longitude</label>
              <input
                type="number"
                step="any"
                value={longitude}
                onChange={(e) => setLongitude(e.target.value)}
                className="w-full h-10 px-3 font-mono text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <button
              type="button"
              onClick={handleSyncMapsUrl}
              className="h-10 px-3 text-xs font-medium text-[#202124] bg-[#F8F8FC] border border-[#D6D6E4] rounded-lg hover:bg-[#EFEFF7] cursor-pointer"
            >
              Generate Maps Link from GPS
            </button>
          </div>

          {/* Agent Info */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Agent Name</label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">Phone</label>
              <input
                type="text"
                value={agentPhone}
                onChange={(e) => setAgentPhone(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                WhatsApp (digits)
              </label>
              <input
                type="text"
                value={agentWhatsapp}
                onChange={(e) => setAgentWhatsapp(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#4B4D57] mb-1">
                Messenger Handle
              </label>
              <input
                type="text"
                value={agentMessenger}
                onChange={(e) => setAgentMessenger(e.target.value)}
                className="w-full h-10 px-3 text-sm border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-[#E6E6EF] flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 text-xs font-medium text-[#4B4D57] bg-white border border-[#D6D6E4] rounded-lg hover:text-[#202124] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="h-10 px-5 text-xs font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] disabled:opacity-60 cursor-pointer"
            >
              {saving
                ? 'Saving...'
                : initialProperty
                  ? 'Save Property Changes'
                  : 'Create Property Listing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
