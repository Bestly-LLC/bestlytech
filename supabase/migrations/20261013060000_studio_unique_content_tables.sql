-- Unique-content system for Montage (Jared 2026-10-12 10:32 PM: "no duplicate-looking content ... every piece unique, engaging, brings viewers back").
-- Plan: docs/studio-unique-content-opusplan.md. Code: tools/montage/variety.py (+ brands/_common.py, worker.py, comp/brand, comp/hoku).
--   studio_look_ledger   one row per video job: its LOOK FINGERPRINT (layout set, hook style, accent, track, end layout, icon style) + opening line.
--                        The duplicate gate compares a new video with the brand's last 8 (>= 3 of the dimensions must differ) and its opening with the last 20.
--   studio_series        one numbered series per brand ("Tip 3 of 8"); studio_series_topics is the small upcoming-topics queue that makes the
--                        end-card "Next: ..." tease real; studio_segments are the 2-3 recurring named segments per brand (rename them here).
--   montage_music_pick   now avoids the last TWO tracks used for the brand (was: the last one).
-- Nothing here is public: RLS on, no policies, service_role only (the Pi worker and Spark).
create table if not exists public.studio_series (
  brand_slug text primary key,
  name text not null,
  label text not null default 'Tip',
  total int not null default 8 check (total between 2 and 99),
  next_ep int not null default 1 check (next_ep >= 1),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.studio_series_topics (
  id uuid primary key default gen_random_uuid(),
  brand_slug text not null,
  ep int not null check (ep >= 1),
  topic text,
  brief text,
  status text not null default 'planned' check (status in ('planned', 'made')),
  job_id uuid,
  item_code text,
  created_at timestamptz not null default now(),
  unique (brand_slug, ep)
);
create table if not exists public.studio_segments (
  id uuid primary key default gen_random_uuid(),
  brand_slug text not null,
  key text not null,
  kicker text not null check (kicker !~ '[0-9]' and char_length(kicker) <= 24),
  blurb text not null,
  hooks text[] not null default '{}',
  sort int not null default 0,
  active boolean not null default true,
  unique (brand_slug, key)
);
create table if not exists public.studio_look_ledger (
  job_id uuid primary key,
  brand_slug text not null,
  item_id uuid,
  item_code text,
  fingerprint jsonb not null,
  opening text,
  hook text,
  segment text,
  ep int,
  state text not null default 'planned' check (state in ('planned', 'filed', 'held', 'failed')),
  superseded boolean not null default false,
  created_at timestamptz not null default now(),
  filed_at timestamptz
);
create index if not exists studio_look_ledger_brand_idx on public.studio_look_ledger (brand_slug, state, superseded, created_at desc);

alter table public.studio_series enable row level security;
alter table public.studio_series_topics enable row level security;
alter table public.studio_segments enable row level security;
alter table public.studio_look_ledger enable row level security;
revoke all on public.studio_series, public.studio_series_topics, public.studio_segments, public.studio_look_ledger from anon, authenticated;
grant all on public.studio_series, public.studio_series_topics, public.studio_segments, public.studio_look_ledger to service_role;

