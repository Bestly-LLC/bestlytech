-- Montage: Spark's video crew (OpenMontage on the Pi) wired to Studio, Spark and the LTX box (2026-10-06).
-- Record of what was applied through execute_sql in pieces (live definitions: pg_get_functiondef on each function below).
-- Jared 2026-10-06: "make it so Spark uses OpenMontage as a main tool. The LTX can make clips and we need to connect to
-- Studio and OpenMontage through Spark and Studio backend."
--
-- Flow
--   Spark make_montage (studio-chat) -> montage_quote / montage_start -> studio_video_jobs row (thread_id = the chat)
--   Pi worker bestly-montage (tools/montage) -> montage_claim -> script (free AI, brand claim rules) -> Piper voice
--     -> if broll: montage_clip_request orders vertical clips into ltx_jobs (source 'montage'), job parks as 'waiting'
--        -> LTX box renders them (wake rule: batch of 3) -> montage_claim resumes the job when none are queued/rendering
--     -> OpenMontage VideoCompose (atelier) render + review -> our checks -> storage -> montage_file
--   montage_file: new internal pending video item, or (re-cut) updates the same item; posts the result into the Spark
--     thread (montage_post) and rings the bell as "Montage:".
--   Changes with a note on a Montage item -> trigger montage_recut -> re-cut job (same item shows work_kind 'rendering').
-- Watchdog: cron montage-watch */5 (requeue stalled jobs 3x, then fail + push; push if queued work waits and the
--   worker's agent_beats row 'montage' is >15 min old). systemd restarts the worker.

create table if not exists public.studio_video_jobs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  client_slug   text not null references public.approval_clients(slug),
  pipeline      text not null default 'short' check (pipeline in ('short','explainer','montage','remix','clip_factory')),
  brief         text not null,
  platform      text not null default 'reels' check (platform in ('reels','tiktok','shorts','feed','youtube')),
  duration_s    int  not null default 30 check (duration_s between 6 and 180),
  budget_usd    numeric(8,2) not null default 0,
  auto_approve  boolean not null default false,
  status        text not null default 'queued' check (status in ('queued','working','done','failed','cancelled','waiting')),
  stage         text,
  attempts      int not null default 0,
  worker        text,
  claimed_at    timestamptz,
  heartbeat_at  timestamptz,
  finished_at   timestamptz,
  cost_usd      numeric(8,2) not null default 0,
  render_s      int,
  output_url    text,
  thumb_url     text,
  item_id       uuid references public.approval_items(id),
  script        jsonb,
  log           jsonb not null default '[]'::jsonb,
  error         text,
  requested_by  text not null default 'spark',
  thread_id     uuid,
  parent_item_id uuid references public.approval_items(id),
  parent_job_id uuid references public.studio_video_jobs(id),
  revise_note   text,
  clips         jsonb,
  broll         boolean not null default false,
  waiting_since timestamptz
);
alter table public.studio_video_jobs enable row level security;
create index if not exists studio_video_jobs_open on public.studio_video_jobs (status, created_at) where status in ('queued','working');

-- LTX box: vertical clips + Montage as a requester
alter table public.ltx_jobs add column if not exists width int not null default 1280,
  add column if not exists height int not null default 720,
  add column if not exists montage_job_id uuid references public.studio_video_jobs(id);
alter table public.ltx_jobs drop constraint if exists ltx_jobs_source_check;
alter table public.ltx_jobs add constraint ltx_jobs_source_check check (source in ('scout','spark','claude','montage'));
create index if not exists ltx_jobs_montage_idx on public.ltx_jobs (montage_job_id) where montage_job_id is not null;
-- ltx_claim(): job jsonb now carries width/height (edge fn ltx-box passes it through to the box).
-- ltx_finish(): no per-clip bell for source 'montage' (Montage reports the finished video instead).

-- Functions (all SECURITY DEFINER, execute revoked from public/anon/authenticated, granted to service_role):
--   montage_enqueue(jsonb), montage_claim(text), montage_report(uuid, jsonb), montage_file(uuid, jsonb),
--   montage_watch(), montage_post(uuid, text), montage_clip_request(uuid, jsonb),
--   montage_quote(jsonb), montage_start(jsonb), montage_status(text, uuid), trg_montage_recut()
create or replace trigger montage_recut after insert on public.approval_reviews for each row execute function public.trg_montage_recut();
select cron.schedule('montage-watch', '*/5 * * * *', 'select public.montage_watch();');
