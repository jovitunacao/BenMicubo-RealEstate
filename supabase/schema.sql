-- BEN MICUBO REAL ESTATE SERVICES
-- Stage 2 Complete Schema, Row-Level Security (RLS) & Storage Policies
-- Synchronized with supabase/migrations/20261118_stage2_property_management.sql
-- IMPORTANT: Review carefully and apply manually in Supabase SQL Editor.

create extension if not exists "pgcrypto";

-- 1. Authorized Admin Users Table
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
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.is_active = true
  );
$$;

-- 2. Site Settings Table (Canonical production URL & agency contact defaults)
create table if not exists public.site_settings (
  id text primary key default 'default',
  canonical_site_url text not null default '',
  default_agent_name text not null default 'Ben Micubo Real Estate Services',
  default_agent_phone text not null default '+63 917 555 0142',
  default_agent_whatsapp text not null default '639175550142',
  default_agent_messenger text not null default 'benmicubo.realestate',
  updated_at timestamptz not null default now()
);

-- 3. Properties Table
create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  lot_id text unique not null,
  title text not null,
  barangay text not null,
  city text not null,
  province text not null,
  region text not null,
  complete_location text not null default '',
  lot_area_sqm numeric not null check (lot_area_sqm > 0),
  dimensions text not null,
  boundary_description text not null default '',
  price_per_sqm numeric not null default 0 check (price_per_sqm >= 0),
  price_total_php numeric not null check (price_total_php >= 0),
  is_price_manual_override boolean not null default false,
  is_negotiable boolean not null default false,
  classification text not null check (classification in ('Residential', 'Beachfront', 'Commercial', 'Agricultural', 'Other')),
  status text not null default 'Available' check (status in ('Available', 'Reserved', 'Sold')),
  visibility text not null default 'Draft' check (visibility in ('Draft', 'Published', 'Archived')),
  is_archived boolean not null default false,
  is_featured boolean not null default false,
  road_access text not null,
  utilities text not null default '',
  terrain text not null,
  nearby_landmarks text not null default '',
  title_status text not null,
  tax_declaration_status text not null default '',
  additional_remarks text not null default '',
  description text not null,
  highlights text[] not null default '{}',
  photos text[] not null default '{}',
  youtube_url text,
  latitude double precision not null,
  longitude double precision not null,
  google_maps_url text not null,
  agent_name text not null,
  agent_phone text not null,
  agent_whatsapp text not null,
  agent_messenger text not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. Property Images Table
create table if not exists public.property_images (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  storage_bucket text not null default 'property-media-private' check (storage_bucket in ('property-media-private', 'property-media-public')),
  storage_path text not null default '',
  public_url text not null default '',
  caption text not null default '',
  is_cover boolean not null default false,
  is_approved_public boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 5. Property Videos Table
create table if not exists public.property_videos (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  source_type text not null default 'youtube' check (source_type in ('youtube', 'google_drive', 'direct')),
  youtube_url text not null default '',
  title text not null default '',
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- 6. Property Documents Table (Defaults strictly to Private)
create table if not exists public.property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  title text not null,
  category text not null check (category in (
    'Survey Plan', 'Lot Plan', 'Technical Description', 'Vicinity Map',
    'Tax Declaration', 'Title Document', 'PDF Brochure', 'Other'
  )),
  visibility text not null default 'Private' check (visibility in ('Private', 'Public')),
  storage_bucket text not null default 'property-media-private' check (storage_bucket in ('property-media-private', 'property-media-public')),
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  created_at timestamptz not null default now()
);

-- 7. Buyer Inquiries Table
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  property_lot_id text references public.properties(lot_id) on delete set null,
  property_title text not null check (char_length(trim(property_title)) >= 2),
  buyer_name text not null check (char_length(trim(buyer_name)) between 2 and 120),
  buyer_email text not null check (buyer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  buyer_phone text not null check (char_length(regexp_replace(buyer_phone, '[^0-9]', '', 'g')) >= 9),
  preferred_date text,
  message text not null check (char_length(trim(message)) between 8 and 2000),
  status text not null default 'New' check (status in ('New', 'Contacted', 'Scheduled', 'Closed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_properties_lot_id on public.properties(lot_id);
create index if not exists idx_properties_visibility_status on public.properties(visibility, status);
create index if not exists idx_property_images_prop_sort on public.property_images(property_id, sort_order);
create index if not exists idx_property_videos_prop_sort on public.property_videos(property_id, sort_order);
create index if not exists idx_property_documents_prop_vis on public.property_documents(property_id, visibility);
create index if not exists idx_inquiries_lot_status on public.inquiries(property_lot_id, status, created_at desc);

alter table public.admin_users enable row level security;
alter table public.site_settings enable row level security;
alter table public.properties enable row level security;
alter table public.property_images enable row level security;
alter table public.property_videos enable row level security;
alter table public.property_documents enable row level security;
alter table public.inquiries enable row level security;

drop policy if exists "Admin read own membership" on public.admin_users;
create policy "Admin read own membership"
  on public.admin_users for select
  using (user_id = auth.uid());

drop policy if exists "Public read site settings" on public.site_settings;
create policy "Public read site settings"
  on public.site_settings for select
  using (true);

drop policy if exists "Admin manage site settings" on public.site_settings;
create policy "Admin manage site settings"
  on public.site_settings for all
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

drop policy if exists "Public read published properties" on public.properties;
create policy "Public read published properties"
  on public.properties for select
  using (visibility = 'Published' and is_archived = false);

drop policy if exists "Admin full access to properties" on public.properties;
create policy "Admin full access to properties"
  on public.properties for all
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

drop policy if exists "Public read published property images" on public.property_images;
create policy "Public read published property images"
  on public.property_images for select
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
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

drop policy if exists "Public read published property videos" on public.property_videos;
create policy "Public read published property videos"
  on public.property_videos for select
  using (
    exists (
      select 1 from public.properties p
      where p.id = property_id and p.visibility = 'Published' and p.is_archived = false
    )
  );

drop policy if exists "Admin manage property videos" on public.property_videos;
create policy "Admin manage property videos"
  on public.property_videos for all
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

drop policy if exists "Public read approved public documents" on public.property_documents;
create policy "Public read approved public documents"
  on public.property_documents for select
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
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

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

drop policy if exists "Admin manage inquiries" on public.inquiries;
create policy "Admin manage inquiries"
  on public.inquiries for all
  using (public.is_authorized_admin())
  with check (public.is_authorized_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('property-media-public', 'property-media-public', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('property-media-private', 'property-media-private', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read approved media bucket" on storage.objects;
create policy "Public read approved media bucket"
  on storage.objects for select
  using (bucket_id = 'property-media-public');

drop policy if exists "Admin write public media bucket" on storage.objects;
create policy "Admin write public media bucket"
  on storage.objects for all
  using (bucket_id = 'property-media-public' and public.is_authorized_admin())
  with check (bucket_id = 'property-media-public' and public.is_authorized_admin());

drop policy if exists "Admin full access private media bucket" on storage.objects;
create policy "Admin full access private media bucket"
  on storage.objects for all
  using (bucket_id = 'property-media-private' and public.is_authorized_admin())
  with check (bucket_id = 'property-media-private' and public.is_authorized_admin());
