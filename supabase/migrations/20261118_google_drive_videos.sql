-- BEN MICUBO REAL ESTATE SERVICES
-- Incremental Migration: Add 'google_drive' provider to existing public.property_videos table
-- Idempotent and safe to run on projects that already applied 20261118_stage2_property_management.sql.
-- IMPORTANT: Review carefully and apply manually in Supabase SQL Editor.

alter table public.property_videos
  drop constraint if exists property_videos_source_type_check;

alter table public.property_videos
  add constraint property_videos_source_type_check
  check (source_type in ('youtube', 'google_drive', 'direct'));
