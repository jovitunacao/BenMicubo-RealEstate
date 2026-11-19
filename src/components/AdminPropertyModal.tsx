import {X} from 'lucide-react';
import type {Property, PropertyInput, SiteSettings} from '../types/property';
import {AdminPropertyEditor} from './AdminPropertyEditor';

interface AdminPropertyModalProps {
  initialProperty: Property | null;
  existingProperties: Property[];
  siteSettings: SiteSettings;
  onClose: () => void;
  onSave: (input: PropertyInput, existingId?: string) => Promise<void>;
}

export function AdminPropertyModal({
  initialProperty,
  existingProperties,
  siteSettings,
  onClose,
  onSave,
}: AdminPropertyModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={initialProperty ? `Edit ${initialProperty.lotId}` : 'Add new property listing'}
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div className="bg-[#F8F8FC] border border-[#E6E6EF] rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-6 py-4 bg-white border-b border-[#E6E6EF] flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-lg font-bold text-[#202124]">
              {initialProperty
                ? `Edit Property · ${initialProperty.lotId}`
                : 'Add New Property Listing'}
            </h2>
            <p className="text-xs text-[#696B77]">
              BEN MICUBO REAL ESTATE SERVICES · Stage 2 Listing Workspace
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

        <div className="p-5 sm:p-6 overflow-y-auto">
          <AdminPropertyEditor
            initialProperty={initialProperty}
            existingProperties={existingProperties}
            siteSettings={siteSettings}
            onCancel={onClose}
            onSave={async (input, existingId) => {
              await onSave(input, existingId);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
