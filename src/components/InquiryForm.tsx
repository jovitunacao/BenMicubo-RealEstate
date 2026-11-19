import React, {useState} from 'react';
import {CheckCircle2} from 'lucide-react';
import {usePropertyStore} from '../context/PropertyStoreContext';

interface InquiryFormProps {
  propertyLotId: string | null;
  propertyTitle: string;
}

export function InquiryForm({propertyLotId, propertyTitle}: InquiryFormProps) {
  const {submitInquiry, isDemoMode} = usePropertyStore();

  const [buyerName, setBuyerName] = useState('');
  const [buyerEmail, setBuyerEmail] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [preferredDate, setPreferredDate] = useState('');
  const [message, setMessage] = useState(
    propertyLotId
      ? `I would like to request the title details and schedule a site viewing for ${propertyLotId} with BEN MICUBO REAL ESTATE SERVICES.`
      : ''
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const cleanName = buyerName.trim();
    const cleanEmail = buyerEmail.trim();
    const cleanPhone = buyerPhone.trim();
    const cleanMessage = message.trim();

    if (cleanName.length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (cleanPhone.replace(/[^0-9]/g, '').length < 9) {
      setError('Please enter a valid Philippine mobile or landline number.');
      return;
    }
    if (cleanMessage.length < 8) {
      setError('Please add a brief message or viewing request.');
      return;
    }

    setSubmitting(true);
    try {
      await submitInquiry({
        propertyLotId,
        propertyTitle,
        buyerName: cleanName,
        buyerEmail: cleanEmail,
        buyerPhone: cleanPhone,
        preferredDate: preferredDate || undefined,
        message: cleanMessage,
      });
      setSubmitted(true);
      setBuyerName('');
      setBuyerEmail('');
      setBuyerPhone('');
      setPreferredDate('');
      setMessage('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send inquiry. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="p-6 rounded-xl border border-[#DCD0F0] bg-[#F3EEFA]">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-5 h-5 text-[#6500B5] shrink-0 mt-0.5" />
          <div>
            <h4 className="font-display text-base font-semibold text-[#202124]">
              Inquiry received
            </h4>
            <p className="mt-1 text-sm text-[#4B4D57] leading-relaxed">
              Thank you for contacting BEN MICUBO REAL ESTATE SERVICES regarding{' '}
              <span className="font-medium text-[#202124]">{propertyTitle}</span>.
              {isDemoMode
                ? ' In Stage 1 Demo Mode, your inquiry is saved locally and can be reviewed immediately inside the Admin Dashboard.'
                : ' Our licensed broker will contact you shortly.'}
            </p>
            <button
              type="button"
              onClick={() => setSubmitted(false)}
              className="mt-4 px-4 py-2 text-xs font-medium text-[#202124] bg-white border border-[#D6D6E4] rounded-md hover:bg-[#F8F8FC] transition-colors cursor-pointer"
            >
              Send another inquiry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800"
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="buyer-name" className="block text-xs font-medium text-[#4B4D57] mb-1.5">
            Full Name
          </label>
          <input
            id="buyer-name"
            type="text"
            required
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="Juan Dela Cruz"
            className="w-full h-11 px-3.5 text-sm text-[#202124] bg-white border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
          />
        </div>

        <div>
          <label htmlFor="buyer-phone" className="block text-xs font-medium text-[#4B4D57] mb-1.5">
            Mobile / Viber / WhatsApp
          </label>
          <input
            id="buyer-phone"
            type="tel"
            required
            value={buyerPhone}
            onChange={(e) => setBuyerPhone(e.target.value)}
            placeholder="+63 917 000 0000"
            className="w-full h-11 px-3.5 text-sm text-[#202124] bg-white border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="buyer-email" className="block text-xs font-medium text-[#4B4D57] mb-1.5">
            Email Address
          </label>
          <input
            id="buyer-email"
            type="email"
            required
            value={buyerEmail}
            onChange={(e) => setBuyerEmail(e.target.value)}
            placeholder="buyer@email.ph"
            className="w-full h-11 px-3.5 text-sm text-[#202124] bg-white border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
          />
        </div>

        <div>
          <label htmlFor="preferred-date" className="block text-xs font-medium text-[#4B4D57] mb-1.5">
            Preferred Viewing Date (Optional)
          </label>
          <input
            id="preferred-date"
            type="date"
            value={preferredDate}
            onChange={(e) => setPreferredDate(e.target.value)}
            className="w-full h-11 px-3.5 text-sm text-[#202124] bg-white border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
          />
        </div>
      </div>

      <div>
        <label htmlFor="buyer-message" className="block text-xs font-medium text-[#4B4D57] mb-1.5">
          Questions or Viewing Notes
        </label>
        <textarea
          id="buyer-message"
          rows={3}
          required
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Request copy of TCT, payment terms, or site tripping schedule..."
          className="w-full px-3.5 py-2.5 text-sm text-[#202124] bg-white border border-[#D6D6E4] rounded-lg focus:outline-none focus:border-[#6500B5]"
        />
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <p className="text-xs text-[#696B77]">
          {isDemoMode
            ? 'Demo form — saves directly to local Admin Inbox'
            : 'Direct inquiry routed to BEN MICUBO REAL ESTATE SERVICES'}
        </p>
        <button
          type="submit"
          disabled={submitting}
          className="h-11 px-6 text-sm font-medium text-white bg-[#6500B5] rounded-lg hover:bg-[#540098] transition-colors disabled:opacity-60 cursor-pointer whitespace-nowrap"
        >
          {submitting ? 'Sending...' : 'Submit Inquiry'}
        </button>
      </div>
    </form>
  );
}
