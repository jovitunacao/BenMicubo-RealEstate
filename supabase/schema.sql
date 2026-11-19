-- Stage 2 Supabase Schema & Row-Level Security (RLS) Reference
-- Run this in your Supabase SQL Editor when transitioning from Stage 1 Demo Mode.

create extension if not exists "pgcrypto";

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  lot_id text unique not null, -- Stable public slug e.g. 'LOT-001'
  title text not null,
  barangay text not null,
  city text not null,
  province text not null,
  region text not null,
  lot_area_sqm numeric not null check (lot_area_sqm > 0),
  dimensions text not null,
  price_total_php numeric not null check (price_total_php >= 0),
  classification text not null check (classification in ('Residential', 'Beachfront', 'Commercial', 'Agricultural')),
  status text not null default 'Available' check (status in ('Available', 'Reserved', 'Sold')),
  is_archived boolean not null default false,
  is_featured boolean not null default false,
  road_access text not null,
  title_status text not null,
  terrain text not null,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  property_lot_id text references public.properties(lot_id) on delete set null,
  property_title text not null,
  buyer_name text not null,
  buyer_email text not null,
  buyer_phone text not null,
  preferred_date text,
  message text not null,
  status text not null default 'New' check (status in ('New', 'Contacted', 'Scheduled', 'Closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'admin',
  created_at timestamptz not null default now()
);

alter table public.properties enable row level security;
alter table public.inquiries enable row level security;
alter table public.admin_users enable row level security;

-- Public can read active (non-archived) properties
create policy "Public read active properties"
  on public.properties for select
  using (is_archived = false);

-- Only authenticated admins can insert, update, delete, or read archived properties
create policy "Admin full access to properties"
  on public.properties for all
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));

-- Anyone can submit an inquiry
create policy "Public insert inquiries"
  on public.inquiries for insert
  with check (true);

-- Only authenticated admins can read or update inquiries
create policy "Admin manage inquiries"
  on public.inquiries for all
  using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()))
  with check (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));
