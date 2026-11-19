# BEN MICUBO REAL ESTATE SERVICES

Mobile-first Philippine real estate property listing platform with permanent QR property dossiers (`/property/LOT-XXX`), A4 printable signage (`/signage/LOT-XXX`), Stage 1 Demo fallback, and Stage 2 Supabase property, media, document, and inquiry management.

---

## Features Implemented (Stage 1 + Stage 2)

- **Public Property Directory (`/`)**: Search by Lot ID, barangay, city, province, or classification (`Residential`, `Commercial`, `Agricultural`, `Beachfront`, `Other`); filter by availability (`Available`, `Reserved`, `Sold`).
- **Permanent Property Dossiers (`/property/:lotId`)**:
  - Ordered photo galleries with captions & fullscreen lightbox
  - Multiple YouTube videos (including unlisted links) with lazy-loaded playback
  - Full land specifications: area (sqm), price per sqm, total selling price, negotiable indicator, dimensions, boundaries, road access, utilities, terrain, nearby landmarks, title & tax declaration status, Google Maps GPS link
  - **Public-only** downloadable brochures/maps (`Private` admin documents are never displayed)
  - Direct WhatsApp, Messenger, Phone, Buyer Inquiry form, and **Share Listing** button (native mobile share, Copy Link, WhatsApp, Messenger, Viber, SMS)
  - Sold properties remain accessible at their permanent URL with a prominent `SOLD` status notice
  - `Draft` and `Archived` properties are hidden from public buyers
- **Printable A4 QR Signage (`/signage/:lotId`)**: High-contrast signboard layout with the official BEN MICUBO REAL ESTATE SERVICES logo and PNG/SVG QR downloads, blocked automatically until a valid HTTPS canonical production domain is configured.
- **Admin Dashboard (`/admin`)**:
  - 9 sections: **Overview**, **All Properties** (with search, filters, and bulk status/visibility updates), **Add Property**, **Draft Listings**, **Published Listings**, **Buyer Inquiries**, **Media & Documents**, **QR Code Studio**, and **Settings**
  - Auto-generated unique `LOT-XXX` IDs (locked/immutable after creation so installed QR signage never breaks)
  - Auto-calculated total price (`lotAreaSqm × pricePerSqm`) with authorized manual override toggle
  - Client-side JPG/PNG/WebP resizing & compression before upload, drag-and-drop photo ordering, cover selection, captions, and replace/delete
  - Private (`property-media-private`) vs Public (`property-media-public`) storage buckets; new documents strictly default to `Private` and use short-lived signed URLs for admins

---

## Environment Variables

Copy `.env.example` to `.env` for local development or configure in **Cloudflare Pages → Settings → Environment variables**:

```env
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_ANON_KEY="your-supabase-anon-key"
VITE_PUBLIC_SITE_URL="https://benmicuborealestate.pages.dev"
```

> **Security:** Never place `service_role` or private backend keys in frontend environment variables (`VITE_*`).

---

## Supabase Setup (Manual Review & Execution)

1. Open your Supabase project → **SQL Editor**.
2. Review and execute `supabase/migrations/20261118_stage2_property_management.sql` (or `supabase/schema.sql`).
   - This idempotently creates/updates `admin_users`, `site_settings`, `properties`, `property_images`, `property_videos`, `property_documents`, `inquiries`, helper function `public.is_authorized_admin()`, Row-Level Security policies, and Storage buckets (`property-media-public` and `property-media-private`).
3. Create an administrator account in **Supabase Authentication → Users**.
4. Grant admin permissions by inserting that user's UUID into `public.admin_users`:
   ```sql
   insert into public.admin_users (user_id, email, role, is_active)
   values ('<AUTH_USER_UUID>', 'admin@benmicuborealestate.com', 'super_admin', true);
   ```

---

## Canonical Production Domain & QR Code Safety

Permanent QR codes and printable signage are **blocked** whenever the canonical site URL is missing, uses `http://`, or points to `localhost`, `127.0.0.1`, `*.run.app`, or temporary preview URLs.

Configure your live HTTPS production domain via either:
- `VITE_PUBLIC_SITE_URL` environment variable (recommended for Cloudflare Pages builds), or
- **Admin Dashboard → Settings → Canonical Production Website URL** (e.g., `https://benmicuborealestate.pages.dev`).

---

## Local Development, Testing & Build

```bash
npm install
npm run dev      # Starts local dev server on port 3000
npm test         # Runs Stage 2 unit tests (QR uniqueness, lotId immutability, canonical URL & privacy guards)
npm run lint     # TypeScript type-check (tsc --noEmit)
npm run build    # Builds production bundle into dist/
```

---

## Cloudflare Pages Deployment Notes

- **Framework preset**: Vite
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **SPA Routing**: Ensure `/public/_redirects` (`/* /index.html 200`) is deployed so direct QR scans to `/property/LOT-001` or `/signage/LOT-001` resolve cleanly.
