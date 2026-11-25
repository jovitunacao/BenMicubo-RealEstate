-- BEN MICUBO REAL ESTATE SERVICES
-- Incremental Migration: Property Presentations, Frontage Length, and Independent Price Visibility Controls
-- Target: Existing production/staging Supabase PostgreSQL databases ONLY (DO NOT run 20261119_fresh_install.sql on live data).
-- Non-destructive & idempotent: Preserves all existing properties, media, documents, inquiries, and legacy columns.

-- ============================================================================
-- 1. NON-DESTRUCTIVE PROPERTY COLUMNS (FRONTAGE & PRICE VISIBILITY)
-- ============================================================================

-- Retain legacy `dimensions` column intact without deleting or altering stored values.
alter table public.properties
  add column if not exists frontage_length_m numeric null
    check (frontage_length_m is null or frontage_length_m > 0);

alter table public.properties
  add column if not exists show_selling_price boolean not null default true;

alter table public.properties
  add column if not exists show_price_per_sqm boolean not null default true;

-- ============================================================================
-- 2. PROPERTY PRESENTATIONS TABLE (SUPABASE STORAGE ONLY)
-- ============================================================================

create table if not exists public.property_presentations (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null check (char_length(trim(title)) >= 1 and char_length(title) <= 200),
  description text not null default '',
  visibility text not null default 'Private' check (visibility in ('Private', 'Public')),
  allow_download boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  slide_count integer null check (slide_count is null or slide_count >= 0),

  -- Interactive PDF presentation rendition (used by slide viewer & optional PDF download)
  pdf_storage_bucket text not null default 'property-media-private' check (
    pdf_storage_bucket in ('property-media-private', 'property-media-public')
  ),
  pdf_storage_path text not null default '',
  pdf_file_name text not null default '',
  pdf_mime_type text not null default '',
  pdf_file_size_bytes bigint not null default 0 check (
    pdf_file_size_bytes >= 0 and pdf_file_size_bytes <= 20971520
  ),

  -- Optional original PowerPoint (.pptx) file (only promoted public if visibility = 'Public' AND allow_download = true)
  pptx_storage_bucket text not null default 'property-media-private' check (
    pptx_storage_bucket in ('property-media-private', 'property-media-public')
  ),
  pptx_storage_path text not null default '',
  pptx_file_name text not null default '',
  pptx_mime_type text not null default '',
  pptx_file_size_bytes bigint not null default 0 check (
    pptx_file_size_bytes >= 0 and pptx_file_size_bytes <= 26214400
  ),

  -- Optional custom cover image
  cover_storage_bucket text not null default 'property-media-private' check (
    cover_storage_bucket in ('property-media-private', 'property-media-public')
  ),
  cover_storage_path text not null default '',
  cover_public_url text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint property_presentations_at_least_one_file_check check (
    nullif(trim(pdf_storage_path), '') is not null
    or nullif(trim(pptx_storage_path), '') is not null
  ),
  constraint property_presentations_safe_paths_check check (
    pdf_storage_path !~ '(^|/)\.\.(/|$)'
    and pptx_storage_path !~ '(^|/)\.\.(/|$)'
    and cover_storage_path !~ '(^|/)\.\.(/|$)'
  ),
  constraint property_presentations_bucket_visibility_check check (
    (
      visibility = 'Public'
      or (
        pdf_storage_bucket = 'property-media-private'
        and pptx_storage_bucket = 'property-media-private'
        and cover_storage_bucket = 'property-media-private'
      )
    )
    and (
      allow_download = true
      or pptx_storage_bucket = 'property-media-private'
    )
  )
);

create index if not exists idx_property_presentations_prop_sort
  on public.property_presentations(property_id, visibility, sort_order);

-- ============================================================================
-- 3. PUBLIC PUBLICATION HELPERS & MEDIA ISOLATION TRIGGERS
-- ============================================================================

create or replace function public.is_published_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.properties p
    where p.id = target_property_id
      and p.visibility = 'Published'
      and p.is_archived = false
  );
$$;

revoke all on function public.is_published_property(uuid) from public;
grant execute on function public.is_published_property(uuid) to anon, authenticated, service_role;

create or replace function public.is_published_property_lot(target_lot_id text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.properties p
    where p.lot_id = target_lot_id
      and p.visibility = 'Published'
      and p.is_archived = false
  );
$$;

revoke all on function public.is_published_property_lot(text) from public;
grant execute on function public.is_published_property_lot(text) to anon, authenticated, service_role;

create or replace function public.enforce_media_public_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  prop_published boolean;
begin
  select (p.visibility = 'Published' and p.is_archived = false)
  into prop_published
  from public.properties p
  where p.id = new.property_id;

  if tg_table_name = 'property_images' then
    if (new.storage_bucket = 'property-media-public' or new.is_approved_public = true)
       and coalesce(prop_published, false) is false then
      raise exception 'SECURITY VIOLATION: Unapproved or unpublished property images cannot target property-media-public';
    end if;
  elsif tg_table_name = 'property_documents' then
    if new.visibility = 'Private' and new.storage_bucket <> 'property-media-private' then
      raise exception 'SECURITY VIOLATION: Private documents must always target property-media-private';
    end if;
    if new.storage_bucket = 'property-media-public' and coalesce(prop_published, false) is false then
      raise exception 'SECURITY VIOLATION: Unpublished property documents cannot target property-media-public';
    end if;
  elsif tg_table_name = 'property_presentations' then
    if new.visibility = 'Private' and (
      new.pdf_storage_bucket <> 'property-media-private'
      or new.pptx_storage_bucket <> 'property-media-private'
      or new.cover_storage_bucket <> 'property-media-private'
    ) then
      raise exception 'SECURITY VIOLATION: Private presentations must always target property-media-private';
    end if;
    if (new.allow_download = false or new.visibility <> 'Public')
       and new.pptx_storage_bucket <> 'property-media-private' then
      raise exception 'SECURITY VIOLATION: PPTX files cannot target property-media-public unless visibility is Public and downloads are enabled';
    end if;
    if (
      new.pdf_storage_bucket = 'property-media-public'
      or new.pptx_storage_bucket = 'property-media-public'
      or new.cover_storage_bucket = 'property-media-public'
    ) and coalesce(prop_published, false) is false then
      raise exception 'SECURITY VIOLATION: Unpublished property presentations cannot target property-media-public';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_media_public_scope() from public;
revoke all on function public.enforce_media_public_scope() from anon, authenticated;

drop trigger if exists trg_enforce_presentation_public_scope on public.property_presentations;
create trigger trg_enforce_presentation_public_scope
  before insert or update on public.property_presentations
  for each row
  execute function public.enforce_media_public_scope();

create or replace function public.demote_media_on_property_unpublish()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if (new.visibility <> 'Published' or new.is_archived = true)
     and (old.visibility = 'Published' and old.is_archived = false) then
    update public.property_images
    set is_approved_public = false,
        storage_bucket = 'property-media-private'
    where property_id = new.id
      and (is_approved_public = true or storage_bucket = 'property-media-public');

    update public.property_documents
    set storage_bucket = 'property-media-private'
    where property_id = new.id
      and storage_bucket = 'property-media-public';

    update public.property_presentations
    set pdf_storage_bucket = 'property-media-private',
        pptx_storage_bucket = 'property-media-private',
        cover_storage_bucket = 'property-media-private'
    where property_id = new.id
      and (
        pdf_storage_bucket = 'property-media-public'
        or pptx_storage_bucket = 'property-media-public'
        or cover_storage_bucket = 'property-media-public'
      );
  end if;
  return new;
end;
$$;

revoke all on function public.demote_media_on_property_unpublish() from public;
revoke all on function public.demote_media_on_property_unpublish() from anon, authenticated;

-- ============================================================================
-- 4. BACKEND COLUMN-LEVEL PRICE REDACTION & PUBLIC PROJECTION VIEWS
-- ============================================================================

-- Restrict direct SELECT on base `public.properties` and `public.property_presentations`
-- strictly to authorized administrators. Public visitors & non-admin callers read from
-- `public.public_properties` and `public.public_property_presentations`, which redact
-- hidden pricing columns and non-downloadable PPTX paths in SQL before reaching PostgREST.

drop policy if exists "Public read published properties" on public.properties;

revoke all on public.properties from anon, authenticated;
grant select, insert, update, delete on public.properties to authenticated;

drop policy if exists "Admin read all properties" on public.properties;
create policy "Admin read all properties"
  on public.properties for select
  to authenticated
  using (public.is_authorized_admin());

-- Update child/inquiry RLS policies to verify publication via SECURITY DEFINER helper
drop policy if exists "Public read published property images" on public.property_images;
create policy "Public read published property images"
  on public.property_images for select
  to anon, authenticated
  using (
    is_approved_public = true
    and storage_bucket = 'property-media-public'
    and public.is_published_property(property_id)
  );

drop policy if exists "Public read published property videos" on public.property_videos;
create policy "Public read published property videos"
  on public.property_videos for select
  to anon, authenticated
  using (public.is_published_property(property_id));

drop policy if exists "Public read approved public documents" on public.property_documents;
create policy "Public read approved public documents"
  on public.property_documents for select
  to anon, authenticated
  using (
    visibility = 'Public'
    and storage_bucket = 'property-media-public'
    and public.is_published_property(property_id)
  );

drop policy if exists "Public insert inquiries" on public.inquiries;
create policy "Public insert inquiries"
  on public.inquiries for insert
  to anon, authenticated
  with check (
    status = 'New'
    and (
      property_lot_id is null
      or public.is_published_property_lot(property_lot_id)
    )
  );

alter table public.property_presentations enable row level security;
revoke all on public.property_presentations from anon, authenticated;
grant select, insert, update, delete on public.property_presentations to authenticated;

drop policy if exists "Admin manage property presentations" on public.property_presentations;
create policy "Admin manage property presentations"
  on public.property_presentations for all
  to authenticated
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

-- Public redacted property projection view (omits hidden prices, dimensions, override flags, Draft/Archived rows)
create or replace view public.public_properties
with (security_barrier = true)
as
select
  p.id,
  p.lot_id,
  p.title,
  p.barangay,
  p.city,
  p.province,
  p.region,
  p.complete_location,
  p.lot_area_sqm,
  p.frontage_length_m,
  p.boundary_description,
  case when p.show_selling_price then p.price_total_php else null end as price_total_php,
  case when p.show_price_per_sqm then p.price_per_sqm else null end as price_per_sqm,
  p.show_selling_price,
  p.show_price_per_sqm,
  p.is_negotiable,
  p.classification,
  p.status,
  p.visibility,
  p.is_archived,
  p.is_featured,
  p.road_access,
  p.utilities,
  p.terrain,
  p.nearby_landmarks,
  p.title_status,
  p.tax_declaration_status,
  p.additional_remarks,
  p.description,
  p.highlights,
  p.photos,
  p.youtube_url,
  p.latitude,
  p.longitude,
  p.google_maps_url,
  p.agent_name,
  p.agent_phone,
  p.agent_whatsapp,
  p.agent_messenger,
  p.published_at,
  p.created_at,
  p.updated_at
from public.properties p
where p.visibility = 'Published'
  and p.is_archived = false;

revoke all on public.public_properties from public;
grant select on public.public_properties to anon, authenticated;

-- Public redacted presentation projection view (only Public presentations on Published properties; redacts PPTX unless allow_download = true)
create or replace view public.public_property_presentations
with (security_barrier = true)
as
select
  pp.id,
  pp.property_id,
  pp.title,
  pp.description,
  pp.visibility,
  pp.allow_download,
  pp.sort_order,
  pp.slide_count,
  pp.pdf_storage_bucket,
  pp.pdf_storage_path,
  case when pp.allow_download then pp.pdf_file_name else '' end as pdf_file_name,
  pp.pdf_mime_type,
  case when pp.allow_download then pp.pdf_file_size_bytes else 0 end as pdf_file_size_bytes,
  case when pp.allow_download then pp.pptx_storage_bucket else 'property-media-private' end as pptx_storage_bucket,
  case when pp.allow_download then pp.pptx_storage_path else '' end as pptx_storage_path,
  case when pp.allow_download then pp.pptx_file_name else '' end as pptx_file_name,
  case when pp.allow_download then pp.pptx_mime_type else '' end as pptx_mime_type,
  case when pp.allow_download then pp.pptx_file_size_bytes else 0 end as pptx_file_size_bytes,
  pp.cover_storage_bucket,
  pp.cover_storage_path,
  pp.cover_public_url,
  pp.created_at,
  pp.updated_at
from public.property_presentations pp
where pp.visibility = 'Public'
  and public.is_published_property(pp.property_id);

revoke all on public.public_property_presentations from public;
grant select on public.public_property_presentations to anon, authenticated;

-- ============================================================================
-- 5. STORAGE BUCKET MIME TYPES, LIMITS & PRESENTATION OBJECT POLICIES
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'property-media-public',
    'property-media-public',
    true,
    26214400, -- 25 MB max per file (supports multi-slide PDF / downloadable PPTX)
    array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]
  ),
  (
    'property-media-private',
    'property-media-private',
    false,
    31457280, -- 30 MB max per file
    array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ]
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read approved media bucket" on storage.objects;
create policy "Public read approved media bucket"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'property-media-public'
    and (storage.foldername(name))[2] in ('images', 'documents', 'presentations')
    and (
      exists (
        select 1
        from public.property_images pi
        where pi.storage_bucket = 'property-media-public'
          and pi.storage_path = name
          and pi.is_approved_public = true
          and public.is_published_property(pi.property_id)
      )
      or exists (
        select 1
        from public.property_documents pd
        where pd.storage_bucket = 'property-media-public'
          and pd.storage_path = name
          and pd.visibility = 'Public'
          and public.is_published_property(pd.property_id)
      )
      or exists (
        select 1
        from public.property_presentations pp
        where pp.visibility = 'Public'
          and public.is_published_property(pp.property_id)
          and (
            (pp.pdf_storage_bucket = 'property-media-public' and pp.pdf_storage_path = name)
            or (pp.cover_storage_bucket = 'property-media-public' and pp.cover_storage_path = name)
            or (
              pp.allow_download = true
              and pp.pptx_storage_bucket = 'property-media-public'
              and pp.pptx_storage_path = name
            )
          )
      )
    )
  );

drop policy if exists "Admin write public media bucket" on storage.objects;
create policy "Admin write public media bucket"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'property-media-public' and public.is_authorized_admin())
  with check (
    bucket_id = 'property-media-public'
    and public.is_authorized_admin()
    and (storage.foldername(name))[2] in ('images', 'documents', 'presentations')
    and name !~ '(^|/)\.\.(/|$)'
  );

drop policy if exists "Admin full access private media bucket" on storage.objects;
create policy "Admin full access private media bucket"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'property-media-private' and public.is_authorized_admin())
  with check (
    bucket_id = 'property-media-private'
    and public.is_authorized_admin()
    and (storage.foldername(name))[2] in ('images', 'documents', 'presentations')
    and name !~ '(^|/)\.\.(/|$)'
  );

-- ============================================================================
-- ROLLBACK NOTES (Manual Emergency Revert Only — Run Outside Automated Flow)
-- ============================================================================
-- 1. Dropping views & policy changes does NOT delete existing property rows or Storage objects:
--    - drop view if exists public.public_property_presentations;
--    - drop view if exists public.public_properties;
--    - drop table if exists public.property_presentations cascade;
--    - Re-add "Public read published properties" if reverting frontend to older tag.
--    - Optionally drop columns frontage_length_m, show_selling_price, show_price_per_sqm if reverting completely.
