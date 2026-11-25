-- BEN MICUBO REAL ESTATE SERVICES
-- SQL Security & RLS Regression Verification Script
-- Run manually inside Supabase SQL Editor (wrapped in BEGIN ... ROLLBACK so live data is never modified).

begin;

-- 1. Verify RLS is enabled on all 8 exposed tables
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
    'property_presentations',
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

-- 2. Verify anon & public cannot execute SECURITY DEFINER admin/trigger helpers directly
do $$
begin
  if has_function_privilege('anon', 'public.is_authorized_admin()', 'EXECUTE') then
    raise exception 'SECURITY REGRESSION: anon has EXECUTE on public.is_authorized_admin()';
  end if;
  if not has_function_privilege('authenticated', 'public.is_authorized_admin()', 'EXECUTE') then
    raise exception 'SECURITY REGRESSION: authenticated lacks EXECUTE on public.is_authorized_admin()';
  end if;
  if has_function_privilege('anon', 'public.enforce_media_public_scope()', 'EXECUTE') then
    raise exception 'SECURITY REGRESSION: anon has EXECUTE on enforce_media_public_scope()';
  end if;
  if has_function_privilege('authenticated', 'public.demote_media_on_property_unpublish()', 'EXECUTE') then
    raise exception 'SECURITY REGRESSION: authenticated has EXECUTE on demote_media_on_property_unpublish()';
  end if;
end $$;

-- 3. Verify BOTH anon and authenticated cannot insert privileged inquiry columns (id, status, created_at)
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated']
  loop
    if has_column_privilege(role_name, 'public.inquiries', 'status', 'INSERT') then
      raise exception 'SECURITY REGRESSION: % can INSERT privileged column inquiries.status', role_name;
    end if;
    if has_column_privilege(role_name, 'public.inquiries', 'created_at', 'INSERT') then
      raise exception 'SECURITY REGRESSION: % can INSERT privileged column inquiries.created_at', role_name;
    end if;
    if has_column_privilege(role_name, 'public.inquiries', 'id', 'INSERT') then
      raise exception 'SECURITY REGRESSION: % can INSERT privileged column inquiries.id', role_name;
    end if;
    if not has_column_privilege(role_name, 'public.inquiries', 'buyer_name', 'INSERT') then
      raise exception 'SECURITY REGRESSION: % lacks INSERT on inquiries.buyer_name', role_name;
    end if;
  end loop;

  if has_table_privilege('anon', 'public.inquiries', 'SELECT') then
    raise exception 'SECURITY REGRESSION: anon has SELECT privilege on public.inquiries';
  end if;
end $$;

-- 4. Verify private bucket stays private
do $$
declare
  priv_is_public boolean;
begin
  select public into priv_is_public from storage.buckets where id = 'property-media-private';
  if priv_is_public is distinct from false then
    raise exception 'SECURITY REGRESSION: property-media-private bucket must have public = false';
  end if;
end $$;

-- 5. Seed test records & verify database triggers enforce media & presentation confidentiality
insert into public.properties (
  lot_id, title, city, province, lot_area_sqm, frontage_length_m,
  price_total_php, price_per_sqm, show_selling_price, show_price_per_sqm,
  classification, status, visibility, is_archived, latitude, longitude,
  agent_name, agent_phone, agent_whatsapp
) values
(
  'LOT-TEST-PUB', 'Published Regression Lot', 'Tagaytay City', 'Cavite',
  500, 22.5, 5000000, 10000, false, false,
  'Residential', 'Available', 'Published', false, 14.1, 120.9,
  'BEN MICUBO REAL ESTATE SERVICES', '+63 917 888 0001', '639178880001'
),
(
  'LOT-TEST-DRF', 'Draft Regression Lot', 'Alfonso', 'Cavite',
  500, null, 5000000, 10000, true, true,
  'Residential', 'Available', 'Draft', false, 14.1, 120.9,
  '', '', ''
);

insert into public.property_images (
  property_id, storage_bucket, storage_path, public_url, caption, is_cover, is_approved_public, sort_order
)
select id, 'property-media-public', 'LOT-TEST-PUB/images/pub.webp', 'https://example.invalid/pub.webp', 'Approved public photo', true, true, 0
from public.properties where lot_id = 'LOT-TEST-PUB';

insert into public.property_documents (
  property_id, title, category, visibility, storage_bucket, storage_path, file_name, mime_type, file_size_bytes
)
select id, 'Private TCT', 'Title Document', 'Private', 'property-media-private', 'LOT-TEST-PUB/documents/tct.pdf', 'tct.pdf', 'application/pdf', 1024
from public.properties where lot_id = 'LOT-TEST-PUB';

insert into public.property_documents (
  property_id, title, category, visibility, storage_bucket, storage_path, file_name, mime_type, file_size_bytes
)
select id, 'Public Brochure', 'PDF Brochure', 'Public', 'property-media-public', 'LOT-TEST-PUB/documents/brochure.pdf', 'brochure.pdf', 'application/pdf', 2048
from public.properties where lot_id = 'LOT-TEST-PUB';

insert into public.property_presentations (
  property_id, title, visibility, allow_download, sort_order,
  pdf_storage_bucket, pdf_storage_path, pdf_file_name, pdf_mime_type, pdf_file_size_bytes,
  pptx_storage_bucket, pptx_storage_path, pptx_file_name, pptx_mime_type, pptx_file_size_bytes
)
select
  id, 'Public View-Only Deck', 'Public', false, 0,
  'property-media-public', 'LOT-TEST-PUB/presentations/deck.pdf', 'deck.pdf', 'application/pdf', 4096,
  'property-media-private', 'LOT-TEST-PUB/presentations/deck.pptx', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 8192
from public.properties where lot_id = 'LOT-TEST-PUB';

insert into public.property_presentations (
  property_id, title, visibility, allow_download, sort_order,
  pdf_storage_bucket, pdf_storage_path, pdf_file_name, pdf_mime_type, pdf_file_size_bytes
)
select
  id, 'Confidential Investment Memo', 'Private', false, 1,
  'property-media-private', 'LOT-TEST-PUB/presentations/private-memo.pdf', 'private-memo.pdf', 'application/pdf', 4096
from public.properties where lot_id = 'LOT-TEST-PUB';

-- Trigger must block unapproved/Draft media, Private documents, Private presentations, and non-downloadable PPTX from property-media-public
do $$
declare
  draft_prop_id uuid;
  pub_prop_id uuid;
begin
  select id into draft_prop_id from public.properties where lot_id = 'LOT-TEST-DRF';
  select id into pub_prop_id from public.properties where lot_id = 'LOT-TEST-PUB';

  begin
    insert into public.property_images (
      property_id, storage_bucket, storage_path, public_url, is_cover, is_approved_public, sort_order
    ) values (
      draft_prop_id, 'property-media-public', 'LOT-TEST-DRF/images/leak.webp', 'https://example.invalid/leak.webp', true, true, 0
    );
    raise exception 'SECURITY REGRESSION: Draft property image was allowed into property-media-public';
  exception when raise_exception then
    null;
  end;

  begin
    insert into public.property_documents (
      property_id, title, category, visibility, storage_bucket, storage_path, file_name, mime_type, file_size_bytes
    ) values (
      pub_prop_id, 'Private Doc Leak', 'Title Document', 'Private', 'property-media-public', 'LOT-TEST-PUB/documents/priv-leak.pdf', 'priv-leak.pdf', 'application/pdf', 512
    );
    raise exception 'SECURITY REGRESSION: Private document was allowed into property-media-public';
  exception when check_violation or raise_exception then
    null;
  end;

  begin
    insert into public.property_presentations (
      property_id, title, visibility, allow_download,
      pdf_storage_bucket, pdf_storage_path, pptx_storage_bucket, pptx_storage_path
    ) values (
      pub_prop_id, 'PPTX Leak Deck', 'Public', false,
      'property-media-public', 'LOT-TEST-PUB/presentations/ok.pdf',
      'property-media-public', 'LOT-TEST-PUB/presentations/leak.pptx'
    );
    raise exception 'SECURITY REGRESSION: Non-downloadable PPTX was allowed into property-media-public';
  exception when check_violation or raise_exception then
    null;
  end;
end $$;

insert into storage.objects (bucket_id, name)
values
  ('property-media-public', 'LOT-TEST-PUB/images/pub.webp'),
  ('property-media-public', 'LOT-TEST-PUB/documents/brochure.pdf'),
  ('property-media-public', 'LOT-TEST-PUB/presentations/deck.pdf'),
  ('property-media-public', 'LOT-TEST-DRF/images/stale-unlinked.webp'),
  ('property-media-private', 'LOT-TEST-PUB/documents/tct.pdf'),
  ('property-media-private', 'LOT-TEST-PUB/presentations/deck.pptx'),
  ('property-media-private', 'LOT-TEST-PUB/presentations/private-memo.pdf')
on conflict (bucket_id, name) do nothing;

-- 6. Behavioral RLS & Redaction tests under ANON role
set local role anon;

do $$
declare
  raw_prop_count int;
  draft_count int;
  pub_price_total numeric;
  pub_price_sqm numeric;
  priv_doc_count int;
  priv_pres_count int;
  leaked_pptx_path text;
  pub_obj_count int;
  pub_pres_obj_count int;
  stale_obj_count int;
  priv_obj_count int;
begin
  -- Base properties table must return 0 rows to anon (prevents bypassing price redaction)
  select count(*) into raw_prop_count from public.properties;
  if raw_prop_count <> 0 then
    raise exception 'SECURITY REGRESSION: anon can SELECT directly from raw public.properties table';
  end if;

  -- Public view hides Drafts and redacts hidden prices to NULL
  select count(*) into draft_count from public.public_properties where lot_id = 'LOT-TEST-DRF';
  if draft_count <> 0 then
    raise exception 'SECURITY REGRESSION: anon can read Draft property via public_properties';
  end if;

  select price_total_php, price_per_sqm
  into pub_price_total, pub_price_sqm
  from public.public_properties
  where lot_id = 'LOT-TEST-PUB';
  if pub_price_total is not null or pub_price_sqm is not null then
    raise exception 'SECURITY REGRESSION: Hidden price columns leaked in public_properties view';
  end if;

  select count(*) into priv_doc_count from public.property_documents where title = 'Private TCT';
  if priv_doc_count <> 0 then
    raise exception 'SECURITY REGRESSION: anon can read Private document';
  end if;

  -- Public presentation view hides Private decks and redacts PPTX path when allow_download = false
  select count(*) into priv_pres_count from public.public_property_presentations where title = 'Confidential Investment Memo';
  if priv_pres_count <> 0 then
    raise exception 'SECURITY REGRESSION: anon can read Private presentation';
  end if;

  select pptx_storage_path into leaked_pptx_path from public.public_property_presentations where title = 'Public View-Only Deck';
  if coalesce(leaked_pptx_path, '') <> '' then
    raise exception 'SECURITY REGRESSION: Non-downloadable PPTX path leaked in public_property_presentations';
  end if;

  select count(*) into pub_obj_count
  from storage.objects
  where bucket_id = 'property-media-public' and name = 'LOT-TEST-PUB/images/pub.webp';
  if pub_obj_count <> 1 then
    raise exception 'SECURITY REGRESSION: anon could not read approved Published storage object';
  end if;

  select count(*) into pub_pres_obj_count
  from storage.objects
  where bucket_id = 'property-media-public' and name = 'LOT-TEST-PUB/presentations/deck.pdf';
  if pub_pres_obj_count <> 1 then
    raise exception 'SECURITY REGRESSION: anon could not read Public presentation PDF storage object';
  end if;

  select count(*) into stale_obj_count
  from storage.objects
  where bucket_id = 'property-media-public' and name = 'LOT-TEST-DRF/images/stale-unlinked.webp';
  if stale_obj_count <> 0 then
    raise exception 'SECURITY REGRESSION: anon can read unlinked/Draft object in property-media-public';
  end if;

  select count(*) into priv_obj_count
  from storage.objects
  where bucket_id = 'property-media-private';
  if priv_obj_count <> 0 then
    raise exception 'SECURITY REGRESSION: anon can read property-media-private objects';
  end if;

  -- General & Published-lot inquiries succeed
  insert into public.inquiries (property_lot_id, property_title, buyer_name, buyer_email, buyer_phone, message)
  values (null, 'General Inquiry', 'Juan Dela Cruz', 'juan@example.ph', '+63 917 111 2222', 'Testing general inquiry insert.');

  insert into public.inquiries (property_lot_id, property_title, buyer_name, buyer_email, buyer_phone, message)
  values ('LOT-TEST-PUB', 'Published Regression Lot', 'Maria Santos', 'maria@example.ph', '+63 917 333 4444', 'Testing published lot inquiry.');

  -- Inquiry targeting Draft lot MUST be blocked by RLS
  begin
    insert into public.inquiries (property_lot_id, property_title, buyer_name, buyer_email, buyer_phone, message)
    values ('LOT-TEST-DRF', 'Draft Regression Lot', 'Attacker', 'bad@example.ph', '+63 917 000 0000', 'Should be blocked by RLS.');
    raise exception 'SECURITY REGRESSION: anon inserted inquiry for Draft lot';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

-- 7. Behavioral RLS & column-grant tests under NON-ADMIN AUTHENTICATED role
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000009999', true);
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-000000009999', 'role', 'authenticated')::text,
  true
);
set local role authenticated;

do $$
declare
  inq_read_count int;
  raw_prop_count int;
  draft_count int;
  priv_doc_count int;
  priv_pres_count int;
  priv_obj_count int;
  updated_rows int;
begin
  select count(*) into inq_read_count from public.inquiries;
  if inq_read_count <> 0 then
    raise exception 'SECURITY REGRESSION: non-admin authenticated user can SELECT inquiries';
  end if;

  update public.inquiries set status = 'Closed';
  get diagnostics updated_rows = row_count;
  if updated_rows <> 0 then
    raise exception 'SECURITY REGRESSION: non-admin authenticated user updated inquiries';
  end if;

  select count(*) into raw_prop_count from public.properties;
  if raw_prop_count <> 0 then
    raise exception 'SECURITY REGRESSION: non-admin authenticated user can SELECT raw public.properties';
  end if;

  select count(*) into draft_count from public.public_properties where lot_id = 'LOT-TEST-DRF';
  if draft_count <> 0 then
    raise exception 'SECURITY REGRESSION: non-admin authenticated user can read Draft property';
  end if;

  select count(*) into priv_doc_count from public.property_documents where title = 'Private TCT';
  if priv_doc_count <> 0 then
    raise exception 'SECURITY REGRESSION: non-admin authenticated user can read Private document';
  end if;

  select count(*) into priv_pres_count from public.property_presentations;
  if priv_pres_count <> 0 then
    raise exception 'SECURITY REGRESSION: non-admin authenticated user can read raw property_presentations';
  end if;

  select count(*) into priv_obj_count from storage.objects where bucket_id = 'property-media-private';
  if priv_obj_count <> 0 then
    raise exception 'SECURITY REGRESSION: non-admin authenticated user can read property-media-private';
  end if;

  begin
    insert into storage.objects (bucket_id, name)
    values ('property-media-public', 'LOT-TEST-PUB/images/evil.webp');
    raise exception 'SECURITY REGRESSION: non-admin authenticated user inserted into storage.objects';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.inquiries (property_lot_id, property_title, buyer_name, buyer_email, buyer_phone, message)
  values ('LOT-TEST-PUB', 'Published Regression Lot', 'Auth Buyer', 'auth.buyer@example.ph', '+63 917 444 5555', 'Testing authenticated non-admin inquiry.');

  begin
    insert into public.inquiries (property_lot_id, property_title, buyer_name, buyer_email, buyer_phone, message)
    values ('LOT-TEST-DRF', 'Draft Regression Lot', 'Auth Attacker', 'bad@example.ph', '+63 917 000 0000', 'Should be blocked by RLS.');
    raise exception 'SECURITY REGRESSION: non-admin authenticated inserted inquiry for Draft lot';
  exception when insufficient_privilege then
    null;
  end;
end $$;

reset role;

-- 8. Verify unpublishing Published property demotes images, documents, AND presentations & revokes public storage SELECT access
update public.properties
set visibility = 'Draft', updated_at = now()
where lot_id = 'LOT-TEST-PUB';

do $$
declare
  leaked_pub_imgs int;
  leaked_pub_docs int;
  leaked_pub_pres int;
begin
  select count(*) into leaked_pub_imgs
  from public.property_images pi
  join public.properties p on p.id = pi.property_id
  where p.lot_id = 'LOT-TEST-PUB'
    and (pi.is_approved_public = true or pi.storage_bucket = 'property-media-public');
  if leaked_pub_imgs <> 0 then
    raise exception 'SECURITY REGRESSION: Unpublishing did not demote property_images to private bucket';
  end if;

  select count(*) into leaked_pub_docs
  from public.property_documents pd
  join public.properties p on p.id = pd.property_id
  where p.lot_id = 'LOT-TEST-PUB'
    and pd.storage_bucket = 'property-media-public';
  if leaked_pub_docs <> 0 then
    raise exception 'SECURITY REGRESSION: Unpublishing did not demote property_documents to private bucket';
  end if;

  select count(*) into leaked_pub_pres
  from public.property_presentations pp
  join public.properties p on p.id = pp.property_id
  where p.lot_id = 'LOT-TEST-PUB'
    and (
      pp.pdf_storage_bucket = 'property-media-public'
      or pp.pptx_storage_bucket = 'property-media-public'
      or pp.cover_storage_bucket = 'property-media-public'
    );
  if leaked_pub_pres <> 0 then
    raise exception 'SECURITY REGRESSION: Unpublishing did not demote property_presentations to private bucket';
  end if;
end $$;

set local role anon;

do $$
declare
  post_unpublish_obj_count int;
  post_unpublish_pres_count int;
begin
  select count(*) into post_unpublish_obj_count
  from storage.objects
  where bucket_id = 'property-media-public' and name = 'LOT-TEST-PUB/images/pub.webp';
  if post_unpublish_obj_count <> 0 then
    raise exception 'SECURITY REGRESSION: Previously published storage object stayed publicly readable after unpublish';
  end if;

  select count(*) into post_unpublish_pres_count
  from storage.objects
  where bucket_id = 'property-media-public' and name = 'LOT-TEST-PUB/presentations/deck.pdf';
  if post_unpublish_pres_count <> 0 then
    raise exception 'SECURITY REGRESSION: Previously published presentation PDF stayed publicly readable after unpublish';
  end if;
end $$;

reset role;
rollback;
