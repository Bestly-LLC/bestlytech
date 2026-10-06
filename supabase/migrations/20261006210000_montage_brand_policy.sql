-- Montage brand policy (2026-10-06, docs/montage-opusplan.md). Applied via execute_sql; this file is the record.
-- Jared: Montage makes videos for every product except Centering YOU (she records her own; no AI in her content)
-- and real estate (legal-first, AutoReel-style photo tours only, not built yet).
create table if not exists public.montage_brand_policy (
  client_slug   text primary key references public.approval_clients(slug),
  montage_ok    boolean not null default false,
  ai_footage_ok boolean not null default false,
  ai_voice_ok   boolean not null default false,
  note          text not null,
  updated_at    timestamptz not null default now()
);
alter table public.montage_brand_policy enable row level security;
-- seeded: hoku (on), inventoryproof / cookie-yeti / bestly-cloud (off until their styles ship),
--         centering-you, demo-two, listings, re-demo (off, no AI footage, no AI voice).
-- montage_quote(jsonb) now reads this table: refuses with the note, drops b-roll when ai_footage_ok is false,
-- and returns 'brands' (the clients Montage can make videos for).
