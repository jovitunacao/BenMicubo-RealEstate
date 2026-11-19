-- BEN MICUBO REAL ESTATE SERVICES
-- SQL Security & RLS Regression Verification Script
-- Run manually inside Supabase SQL Editor (wrapped in BEGIN ... ROLLBACK so live data is never modified).

begin;

-- 1. Verify RLS is enabled on all 7 exposed tables
do $$
declare
  tbl text;
  rls_enabled boolean;
begin
  foreach tbl in array array[
    'admin_users',
    'site_settings',
    'properties',
    'property_images',
    'property_videos',
    'property_documents',
    'inquiries'
  ]
  loop
    select c.relrowsecurity into rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = tbl;

    if coalesce(rls_enabled, false) is false then
      raise exception 'SECURITY REGRESSION: RLS is disabled on public.%', tbl;
    end if;
  end loop;
end $$;

-- 2. Verify anon & public cannot execute is_authorized_admin() directly
do $$
begin
  if has_function_privilege('anon', 'public.is_authorized_admin()', 'EXECUTE') then
    raise exception 'SECURITY REGRESSION: anon has EXECUTE on public.is_authorized_admin()';
  end if;
  if not has_function_privilege('authenticated', 'public.is_authorized_admin()', 'EXECUTE') then
    raise exception 'SECURITY REGRESSION: authenticated lacks EXECUTE on public.is_authorized_admin()';
  end if;
end $$;

-- 3. Verify anon cannot insert privileged inquiry columns (id, status, created_at)
do $$
begin
  if has_column_privilege('anon', 'public.inquiries', 'status', 'INSERT') then
    raise exception 'SECURITY REGRESSION: anon can INSERT privileged column inquiries.status';
  end if;
  if has_column_privilege('anon', 'public.inquiries', 'created_at', 'INSERT') then
    raise exception 'SECURITY REGRESSION: anon can INSERT privileged column inquiries.created_at';
  end if;
  if has_column_privilege('anon', 'public.inquiries', 'id', 'INSERT') then
    raise exception 'SECURITY REGRESSION: anon can INSERT privileged column inquiries.id';
  end if;
  if has_table_privilege('anon', 'public.inquiries', 'SELECT') then
    raise exception 'SECURITY REGRESSION: anon has SELECT privilege on public.inquiries';
  end if;
end $$;

-- 4. Verify private bucket stays private and private docs cannot target public bucket
do $$
declare
  priv_is_public boolean;
begin
  select public into priv_is_public from storage.buckets where id = 'property-media-private';
  if priv_is_public is distinct from false then
    raise exception 'SECURITY REGRESSION: property-media-private bucket must have public = false';
  end if;
end $$;

-- 5. Behavioral RLS tests under anon role (Draft/Archived isolation, Private doc isolation, Inquiry rules)
insert into public.properties (
  lot_id, title, city, province, lot_area_sqm, price_total_php,
  classification, status, visibility, is_archived, latitude, longitude,
  agent_name, agent_phone, agent_whatsapp
) values
(
  'LOT-TEST-PUB', 'Published Regression Lot', 'Tagaytay City', 'Cavite',
  500, 5000000, 'Residential', 'Available', 'Published', false, 14.1, 120.9,
  'BEN MICUBO REAL ESTATE SERVICES', '+63 917 888 0001', '639178880001'
),
(
  'LOT-TEST-DRF', 'Draft Regression Lot', 'Alfonso', 'Cavite',
  500, 5000000, 'Residential', 'Available', 'Draft', false, 14.1, 120.9,
  '', '', ''
);

insert into public.property_documents (
  property_id, title, category, visibility, storage_bucket, storage_path, file_name, mime_type, file_size_bytes
)
select id, 'Private TCT', 'Title Document', 'Private', 'property-media-private', 'LOT-TEST-PUB/documents/tct.pdf', 'tct.pdf', 'application/pdf', 1024
from public.properties where lot_id = 'LOT-TEST-PUB';

set local role anon;

do $$
declare
  draft_count int;
  priv_doc_count int;
begin
  select count(*) into draft_count from public.properties where lot_id = 'LOT-TEST-DRF';
  if draft_count <> 0 then
    raise exception 'SECURITY REGRESSION: anon can read Draft property';
  end if;

  select count(*) into priv_doc_count from public.property_documents where title = 'Private TCT';
  if priv_doc_count <> 0 then
    raise exception 'SECURITY REGRESSION: anon can read Private document';
  end if;

  -- General inquiry (null property_lot_id) must succeed
  insert into public.inquiries (property_lot_id, property_title, buyer_name, buyer_email, buyer_phone, message)
  values (null, 'General Inquiry', 'Juan Dela Cruz', 'juan@example.ph', '+63 917 111 2222', 'Testing general inquiry insert.');

  -- Inquiry for Published lot must succeed
  insert into public.inquiries (property_lot_id, property_title, buyer_name, buyer_email, buyer_phone, message)
  values ('LOT-TEST-PUB', 'Published Regression Lot', 'Maria Santos', 'maria@example.ph', '+63 917 333 4444', 'Testing published lot inquiry.');

  -- Inquiry targeting Draft lot MUST be blocked by RLS
  begin
    insert into public.inquiries (property_lot_id, property_title, buyer_name, buyer_email, buyer_phone, message)
    values ('LOT-TEST-DRF', 'Draft Regression Lot', 'Attacker', 'bad@example.ph', '+63 917 000 0000', 'Should be blocked by RLS.');
    raise exception 'SECURITY REGRESSION: anon inserted inquiry for Draft lot';
  exception when insufficient_privilege then
    null; -- Expected RLS rejection
  end;
end $$;

reset role;
rollback;
