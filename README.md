# BEN MICUBO REAL ESTATE SERVICES

Mobile-first Philippine real estate property listing platform with permanent QR property dossiers (`/property/LOT-XXX`), A4 printable signage (`/signage/LOT-XXX`), and hardened Supabase PostgreSQL + Supabase Storage media, document, and inquiry management.

---

## Supabase Storage Architecture & Security Model

All property photos (cover photo + additional gallery photos) and documents are stored exclusively in Supabase Storage using strict two-bucket isolation:

- **`property-media-private` (Private Bucket)**:
  - Stores all newly uploaded images and documents by default, all Draft/Archived listing media, all unapproved images, and all Confidential/Private documents.
  - Accessible only to authenticated administrators listed in `public.admin_users` (`is_active = true`) via short-lived signed URLs (`60s` for documents, `3600s` for admin image previews).
- **`property-media-public` (Public Bucket)**:
  - Receives ONLY approved public images (`is_approved_public = true`) and `Public` buyer-downloadable documents **after** the parent property row is committed in `Published` (`is_archived = false`) state.
  - Redundant staged copies in `property-media-private` are cleaned up post-commit when promoted and unreferenced by other records.
  - When unpublishing (`Published -> Draft` or `Archived`) or demoting media, private backups are created and verified in `property-media-private` **before** DB demotion and physical deletion from `property-media-public`.
- **CDN Caching Caveat for Revoked Public URLs**:
  - Once an object in `property-media-public` is physically deleted after unpublishing or removal, Supabase RLS and origin immediately block new fetches; however, previously fetched public URLs may remain cached briefly at intermediate CDN edge nodes until their `Cache-Control` TTL expires. Never upload confidential/private documents or unapproved images to `property-media-public`.

---

## Features Implemented

- **Public Property Directory (`/`)**: Search by Lot ID, barangay, city, province, or classification; filter by availability (`Available`, `Reserved`, `Sold`). Cards display the designated Supabase cover photo.
- **Permanent Property Dossiers (`/property/:lotId`)**:
  - Multi-photo Supabase gallery (designated cover photo first + approved gallery photos), touch swipe on mobile, thumbnails, and fullscreen keyboard/touch lightbox
  - Multiple YouTube and Google Drive **video** links with lazy-loaded embedded playback and direct fallback links
  - Full land specifications, Google Maps GPS link, public-only downloadable documents, direct WhatsApp/Messenger/Phone, Buyer Inquiry form, and **Share Listing** controls
- **Printable A4 QR Signage (`/signage/:lotId`)**: High-contrast signboard layout with PNG/SVG QR downloads, blocked automatically until a valid HTTPS canonical production domain is configured.
- **Admin Dashboard (`/admin`)**:
  - Multi-photo drag-and-drop & batch uploader with WebP compression (max 1920px, ~200–500 KB target), upload progress, duplicate detection, cover selection, drag/arrow reordering, and single-photo replacement
  - Immutable `LOT-XXX` IDs and private-by-default document controls

---

## Environment Variables (Cloudflare Pages)

Configure client-safe variables in **Cloudflare Pages → Settings → Variables and Secrets** (copy `.env.example` to `.env` for local Vite work):

```env
VITE_SUPABASE_URL="https://your-project-ref.supabase.co"
VITE_SUPABASE_ANON_KEY="your-supabase-anon-key"
VITE_PUBLIC_SITE_URL="https://benmicuborealestate.pages.dev"
```

> **Security:** Never expose Supabase `service_role` keys or server secrets in `VITE_*` variables or client code.

---

## Supabase Setup (Manual Review & Execution)

1. Open your Supabase project → **SQL Editor**.
2. **Fresh installation**: Review and execute `supabase/migrations/20261119_fresh_install.sql` (also mirrored in `supabase/schema.sql`).
3. **RLS Verification**: Review `supabase/tests/rls_security_regression.sql` inside a rolled-back transaction (`BEGIN; ... ROLLBACK;`) in non-production environments to verify anonymous/non-admin/unpublish protections.
4. Create an administrator account in **Supabase Authentication → Users** and insert their UUID into `public.admin_users`:
   ```sql
   insert into public.admin_users (user_id, email, role, is_active)
   values ('<AUTH_USER_UUID>', 'admin@benmicuborealestate.com', 'super_admin', true);
   ```

---

## Local Development, Testing & Build

```bash
npm install
npm run dev      # Starts local dev server on port 3000
npm test         # Runs unit, publishing-order, and Supabase Storage hardening tests
npm run lint     # TypeScript type-check (tsc --noEmit)
npm run build    # Builds production bundle into dist/
```

---

## Cloudflare Pages Deployment Notes

- **Framework preset**: Vite
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **SPA Routing**: `/public/_redirects` (`/* /index.html 200`) resolves direct QR scans (`/property/LOT-001`, `/signage/LOT-001`) cleanly.
