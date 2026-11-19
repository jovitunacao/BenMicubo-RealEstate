-- BEN MICUBO REAL ESTATE SERVICES
-- Incremental Security Hardening Migration (Idempotent)
-- IMPORTANT: Review carefully and apply manually in Supabase SQL Editor.

-- 1. Tighten public inquiry insert policy so inquiries cannot probe unpublished/archived Lot IDs
drop policy if exists "Public insert inquiries" on public.inquiries;
create policy "Public insert inquiries"
  on public.inquiries for insert
  with check (
    status = 'New'
    and (
      property_lot_id is null
      or exists (
        select 1 from public.properties p
        where p.lot_id = property_lot_id
          and p.visibility = 'Published'
          and p.is_archived = false
      )
    )
  );

-- 2. Enforce exact storage bucket file size and MIME type limits (idempotent)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'property-media-public',
    'property-media-public',
    true,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  ),
  (
    'property-media-private',
    'property-media-private',
    false,
    20971520,
    array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
