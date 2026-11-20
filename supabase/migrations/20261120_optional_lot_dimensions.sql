-- ============================================================================
-- BEN MICUBO REAL ESTATE SERVICES — Optional Lot Dimensions Display Migration
-- Non-destructive migration adding per-property presentation flag.
-- Existing properties default to TRUE to preserve current presentation.
-- ============================================================================

alter table public.properties
  add column if not exists show_lot_dimensions boolean not null default true;

comment on column public.properties.show_lot_dimensions is
  'Controls whether lot dimensions are displayed on public property listings, A4 dossiers, and signage. Does not alter land area or price calculations.';
