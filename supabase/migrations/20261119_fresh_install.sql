-- BEN MICUBO REAL ESTATE SERVICES
-- Consolidated & Hardened Fresh-Install Schema, RLS Policies, Triggers & Storage
-- Consolidates Stage 2 Property Management, Google Drive Videos, and Inquiry/Storage Hardening.
-- Safe for fresh Supabase PostgreSQL projects (single-pass definitions, no duplicate constraints).
-- IMPORTANT: Review carefully and apply manually in Supabase SQL Editor.

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. AUTHORIZED ADMIN ROLES & SECURITY DEFINER HELPERS
-- ============================================================================

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin' check (role in ('admin', 'super_admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_authorized_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.admin_users a
      where a.user_id = auth.uid()
        and a.is_active = true
        and a.role in ('admin', 'super_admin')
    );
$$;

revoke all on function public.is_authorized_admin() from public;
revoke all on function public.is_authorized_admin() from anon;
grant execute on function public.is_authorized_admin() to authenticated, service_role;

-- ============================================================================
-- 2. SITE SETTINGS (No placeholder contact defaults)
-- ============================================================================

create table if not exists public.site_settings (
  id text primary key default 'default' check (id = 'default'),
  canonical_site_url text not null default '',
  default_agent_name text not null default '',
  default_agent_phone text not null default '',
  default_agent_whatsapp text not null default '',
  default_agent_messenger text not null default '',
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 3. PROPERTIES, MEDIA & DOCUMENTS
-- ============================================================================

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  lot_id text unique not null check (char_length(trim(lot_id)) >= 2),
  title text not null check (char_length(trim(title)) >= 2),
  barangay text not null default '',
  city text not null,
  province text not null,
  region text not null default '',
  complete_location text not null default '',
  lot_area_sqm numeric not null check (lot_area_sqm > 0),
  dimensions text not null default '',
  boundary_description text not null default '',
  price_per_sqm numeric not null default 0 check (price_per_sqm >= 0),
  price_total_php numeric not null check (price_total_php >= 0),
  is_price_manual_override boolean not null default false,
  is_negotiable boolean not null default false,
  classification text not null check (
    classification in ('Residential', 'Beachfront', 'Commercial', 'Agricultural', 'Other')
  ),
  status text not null default 'Available' check (
    status in ('Available', 'Reserved', 'Sold')
  ),
  visibility text not null default 'Draft' check (
    visibility in ('Draft', 'Published', 'Archived')
  ),
  is_archived boolean not null default false,
  is_featured boolean not null default false,
  road_access text not null default '',
  utilities text not null default '',
  terrain text not null default '',
  nearby_landmarks text not null default '',
  title_status text not null default '',
  tax_declaration_status text not null default '',
  additional_remarks text not null default '',
  description text not null default '',
  highlights text[] not null default '{}',
  photos text[] not null default '{}',
  youtube_url text,
  latitude double precision not null,
  longitude double precision not null,
  google_maps_url text not null default '',
  agent_name text not null default '',
  agent_phone text not null default '',
  agent_whatsapp text not null default '',
  agent_messenger text not null default '',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_published_contact_check check (
    visibility <> 'Published'
    or (
      char_length(trim(agent_name)) >= 2
      and char_length(regexp_replace(agent_phone, '[^0-9]', '', 'g')) >= 7
      and (
        char_length(regexp_replace(agent_whatsapp, '[^0-9]', '', 'g')) >= 7
        or char_length(trim(agent_messenger)) >= 2
      )
    )
  )
);

create table if not exists public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  storage_bucket text not null default 'property-media-private' check (
    storage_bucket in ('property-media-private', 'property-media-public')
  ),
  storage_path text not null default '',
  public_url text not null default '',
  caption text not null default '',
  is_cover boolean not null default false,
  is_approved_public boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint property_images_bucket_public_check check (
    (is_approved_public = false and storage_bucket = 'property-media-private')
    or (is_approved_public = true and storage_bucket = 'property-media-public')
  )
);

create table if not exists public.property_videos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source_type text not null default 'youtube' check (
    source_type in ('youtube', 'google_drive', 'direct')
  ),
  youtube_url text not null default '',
  title text not null default '',
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null check (char_length(trim(title)) >= 1),
  category text not null check (category in (
    'Survey Plan', 'Lot Plan', 'Technical Description', 'Vicinity Map',
    'Tax Declaration', 'Title Document', 'PDF Brochure', 'Other'
  )),
  visibility text not null default 'Private' check (visibility in ('Private', 'Public')),
  storage_bucket text not null default 'property-media-private' check (
    storage_bucket in ('property-media-private', 'property-media-public')
  ),
  storage_path text not null check (storage_path !~ '(^|/)\.\.(/|$)'),
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0 and file_size_bytes <= 20971520),
  created_at timestamptz not null default now(),
  constraint property_documents_bucket_visibility_check check (
    (visibility = 'Private' and storage_bucket = 'property-media-private')
    or (visibility = 'Public' and storage_bucket in ('property-media-private', 'property-media-public'))
  )
);

-- Enforce that public Storage bucket rows only belong to Published, non-archived properties
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
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_media_public_scope() from public;
revoke all on function public.enforce_media_public_scope() from anon, authenticated;

drop trigger if exists trg_enforce_image_public_scope on public.property_images;
create trigger trg_enforce_image_public_scope
  before insert or update on public.property_images
  for each row
  execute function public.enforce_media_public_scope();

drop trigger if exists trg_enforce_document_public_scope on public.property_documents;
create trigger trg_enforce_document_public_scope
  before insert or update on public.property_documents
  for each row
  execute function public.enforce_media_public_scope();

-- Automatically demote public media metadata when a property is unpublished or archived
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
  end if;
  return new;
end;
$$;

revoke all on function public.demote_media_on_property_unpublish() from public;
revoke all on function public.demote_media_on_property_unpublish() from anon, authenticated;

drop trigger if exists trg_demote_media_on_property_unpublish on public.properties;
create trigger trg_demote_media_on_property_unpublish
  after update of visibility, is_archived on public.properties
  for each row
  execute function public.demote_media_on_property_unpublish();

-- ============================================================================
-- 4. BUYER INQUIRIES (Validation + Privileged Field Protection)
-- ============================================================================

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  property_lot_id text references public.properties(lot_id) on delete set null,
  property_title text not null check (char_length(trim(property_title)) >= 2 and char_length(property_title) <= 240),
  buyer_name text not null check (char_length(trim(buyer_name)) between 2 and 120),
  buyer_email text not null check (buyer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(buyer_email) <= 160),
  buyer_phone text not null check (char_length(regexp_replace(buyer_phone, '[^0-9]', '', 'g')) >= 9 and char_length(buyer_phone) <= 32),
  preferred_date text check (preferred_date is null or char_length(preferred_date) <= 40),
  message text not null check (char_length(trim(message)) between 8 and 2000),
  status text not null default 'New' check (status in ('New', 'Contacted', 'Scheduled', 'Closed')),
  created_at timestamptz not null default now()
);

-- Force server-controlled defaults when non-admin clients insert inquiries
create or replace function public.enforce_public_inquiry_defaults()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_authorized_admin() then
    new.id := gen_random_uuid();
    new.status := 'New';
    new.created_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_public_inquiry_defaults() from public;
revoke all on function public.enforce_public_inquiry_defaults() from anon, authenticated;

drop trigger if exists trg_enforce_public_inquiry_defaults on public.inquiries;
create trigger trg_enforce_public_inquiry_defaults
  before insert on public.inquiries
  for each row
  execute function public.enforce_public_inquiry_defaults();

-- ============================================================================
-- 5. INDEXES
-- ============================================================================

create index if not exists idx_properties_lot_id on public.properties(lot_id);
create index if not exists idx_properties_visibility_status on public.properties(visibility, status);
create index if not exists idx_property_images_prop_sort on public.property_images(property_id, sort_order);
create index if not exists idx_property_videos_prop_sort on public.property_videos(property_id, sort_order);
create index if not exists idx_property_documents_prop_vis on public.property_documents(property_id, visibility);
create index if not exists idx_inquiries_lot_status on public.inquiries(property_lot_id, status, created_at desc);

-- ============================================================================
-- 6. ROW-LEVEL SECURITY (RLS) & LEAST-PRIVILEGE GRANTS
-- ============================================================================

alter table public.admin_users enable row level security;
alter table public.site_settings enable row level security;
alter table public.properties enable row level security;
alter table public.property_images enable row level security;
alter table public.property_videos enable row level security;
alter table public.property_documents enable row level security;
alter table public.inquiries enable row level security;

-- Lock down table privileges cleanly before applying RLS
revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;

revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;
grant insert, update, delete on public.site_settings to authenticated;

revoke all on public.properties from anon, authenticated;
grant select on public.properties to anon, authenticated;
grant insert, update, delete on public.properties to authenticated;

revoke all on public.property_images from anon, authenticated;
grant select on public.property_images to anon, authenticated;
grant insert, update, delete on public.property_images to authenticated;

revoke all on public.property_videos from anon, authenticated;
grant select on public.property_videos to anon, authenticated;
grant insert, update, delete on public.property_videos to authenticated;

revoke all on public.property_documents from anon, authenticated;
grant select on public.property_documents to anon, authenticated;
grant insert, update, delete on public.property_documents to authenticated;

-- Inquiries: anon and non-admin authenticated may ONLY insert user-facing columns (cannot set id, status, created_at)
revoke all on public.inquiries from anon, authenticated;
grant insert (
  property_lot_id,
  property_title,
  buyer_name,
  buyer_email,
  buyer_phone,
  preferred_date,
  message
) on public.inquiries to anon, authenticated;
grant select, update, delete on public.inquiries to authenticated;

-- admin_users policies (read-only self-check for authenticated users; writes require SQL Editor / service_role)
drop policy if exists "Admin read own membership" on public.admin_users;
create policy "Admin read own membership"
  on public.admin_users for select
  to authenticated
  using (user_id = auth.uid());

-- site_settings policies
drop policy if exists "Public read site settings" on public.site_settings;
create policy "Public read site settings"
  on public.site_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "Admin manage site settings" on public.site_settings;
create policy "Admin manage site settings"
  on public.site_settings for all
  to authenticated
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

-- properties policies
drop policy if exists "Public read published properties" on public.properties;
create policy "Public read published properties"
  on public.properties for select
  to anon, authenticated
  using (visibility = 'Published' and is_archived = false);

drop policy if exists "Admin full access to properties" on public.properties;
create policy "Admin full access to properties"
  on public.properties for all
  to authenticated
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

-- property_images policies
drop policy if exists "Public read published property images" on public.property_images;
create policy "Public read published property images"
  on public.property_images for select
  to anon, authenticated
  using (
    is_approved_public = true
    and storage_bucket = 'property-media-public'
    and exists (
      select 1 from public.properties p
      where p.id = property_id and p.visibility = 'Published' and p.is_archived = false
    )
  );

drop policy if exists "Admin manage property images" on public.property_images;
create policy "Admin manage property images"
  on public.property_images for all
  to authenticated
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

-- property_videos policies
drop policy if exists "Public read published property videos" on public.property_videos;
create policy "Public read published property videos"
  on public.property_videos for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id and p.visibility = 'Published' and p.is_archived = false
    )
  );

drop policy if exists "Admin manage property videos" on public.property_videos;
create policy "Admin manage property videos"
  on public.property_videos for all
  to authenticated
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

-- property_documents policies (Private docs NEVER readable publicly)
drop policy if exists "Public read approved public documents" on public.property_documents;
create policy "Public read approved public documents"
  on public.property_documents for select
  to anon, authenticated
  using (
    visibility = 'Public'
    and storage_bucket = 'property-media-public'
    and exists (
      select 1 from public.properties p
      where p.id = property_id and p.visibility = 'Published' and p.is_archived = false
    )
  );

drop policy if exists "Admin manage property documents" on public.property_documents;
create policy "Admin manage property documents"
  on public.property_documents for all
  to authenticated
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

-- inquiries policies (Public insert only for Published properties or General inquiries; no public read)
drop policy if exists "Public insert inquiries" on public.inquiries;
create policy "Public insert inquiries"
  on public.inquiries for insert
  to anon, authenticated
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

drop policy if exists "Admin manage inquiries" on public.inquiries;
drop policy if exists "Admin select inquiries" on public.inquiries;
create policy "Admin select inquiries"
  on public.inquiries for select
  to authenticated
  using (public.is_authorized_admin());

drop policy if exists "Admin insert inquiries" on public.inquiries;
create policy "Admin insert inquiries"
  on public.inquiries for insert
  to authenticated
  with check (public.is_authorized_admin());

drop policy if exists "Admin update inquiries" on public.inquiries;
create policy "Admin update inquiries"
  on public.inquiries for update
  to authenticated
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

drop policy if exists "Admin delete inquiries" on public.inquiries;
create policy "Admin delete inquiries"
  on public.inquiries for delete
  to authenticated
  using (public.is_authorized_admin());

-- ============================================================================
-- 7. SUPABASE STORAGE BUCKETS & HARDENED OBJECT POLICIES
-- ============================================================================

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

drop policy if exists "Public read approved media bucket" on storage.objects;
create policy "Public read approved media bucket"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'property-media-public'
    and (storage.foldername(name))[2] in ('images', 'documents')
    and (
      exists (
        select 1
        from public.property_images pi
        join public.properties p on p.id = pi.property_id
        where pi.storage_bucket = 'property-media-public'
          and pi.storage_path = name
          and pi.is_approved_public = true
          and p.visibility = 'Published'
          and p.is_archived = false
      )
      or exists (
        select 1
        from public.property_documents pd
        join public.properties p on p.id = pd.property_id
        where pd.storage_bucket = 'property-media-public'
          and pd.storage_path = name
          and pd.visibility = 'Public'
          and p.visibility = 'Published'
          and p.is_archived = false
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
    and (storage.foldername(name))[2] in ('images', 'documents')
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
    and (storage.foldername(name))[2] in ('images', 'documents')
    and name !~ '(^|/)\.\.(/|$)'
  );
