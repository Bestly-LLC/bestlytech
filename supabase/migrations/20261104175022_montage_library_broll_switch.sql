-- 2026-11-04 (Jared: "wire the library"). Per-brand switch for Montage's clip-library b-roll (worker.library_clips_for).
-- On for InventoryProof, Cookie Yeti and Bestly Cloud (their library clips carry no text). Off for HOKU until Jared picks:
-- every approved HOKU clip shows the can, and its label text sits behind the headline (render test 2026-11-04).
alter table public.montage_brand_policy add column if not exists library_broll boolean not null default false;
comment on column public.montage_brand_policy.library_broll is
  'Montage fills plain scenes with approved studio_clips for this brand when the video has no paid LTX clips (also needs ai_footage_ok).';
update public.montage_brand_policy set library_broll = true where client_slug in ('inventoryproof', 'cookie-yeti', 'bestly-cloud');
