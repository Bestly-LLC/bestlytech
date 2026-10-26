-- 2026-10-26: Studio TikTok Direct Post (Content Posting API). One row per tap on Post on the client's TikTok posting screen.
-- Service role only: the browser talks to the studio-tiktok-post edge function, never to this table.
-- Undo: drop table public.tiktok_direct_posts; delete the studio-tiktok-post function; redeploy the previous board.
create table if not exists public.tiktok_direct_posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.approval_clients(id) on delete cascade,
  item_id uuid references public.approval_items(id) on delete set null,
  status text not null default 'uploading' check (status in ('uploading','processing','published','failed')),
  publish_id text,
  tiktok_status text,
  title text,
  privacy_level text,
  allow_comment boolean not null default false,
  allow_duet boolean not null default false,
  allow_stitch boolean not null default false,
  brand_organic boolean not null default false,
  brand_content boolean not null default false,
  is_aigc boolean not null default false,
  creator_nickname text,
  video_seconds numeric,
  video_bytes bigint,
  post_id text,
  permalink text,
  fail_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tiktok_direct_posts_client_idx on public.tiktok_direct_posts (client_id, created_at desc);
alter table public.tiktok_direct_posts enable row level security;
revoke all on public.tiktok_direct_posts from anon, authenticated;
