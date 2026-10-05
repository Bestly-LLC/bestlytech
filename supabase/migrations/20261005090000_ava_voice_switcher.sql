-- Voice switcher for both Avas (Spark, 2026-10-04).
-- Jared: a dropdown in /admin to switch Ava's voice on the fly and play a sample; Lulu, Sapphire, Chutki, Serafina
-- plus the last two voices she used. One favorites list serves both Avas (personal + RoofGuard); history is per Ava.
-- Everything is driven by the edge function ava-voices (admin only). The ElevenLabs key never leaves Vault.

create table if not exists public.ava_voice_favorites (
  voice_id text primary key,
  public_owner_id text,                 -- set for shared-library voices that must be added to the account before use
  name text not null,
  accent text, gender text, description text, preview_url text,
  sort int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.ava_voice_history (
  id bigint generated always as identity primary key,
  source text not null check (source in ('ava', 'rg')),
  voice_id text not null,
  name text not null,
  used_at timestamptz not null default now()
);
create index if not exists ava_voice_history_recent on public.ava_voice_history (source, used_at desc);

alter table public.ava_voice_favorites enable row level security;
alter table public.ava_voice_history enable row level security;
create policy "admin ava_voice_favorites" on public.ava_voice_favorites for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "admin ava_voice_history" on public.ava_voice_history for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
grant select, insert, update, delete on public.ava_voice_favorites to authenticated;
grant select on public.ava_voice_history to authenticated;

-- The only voice either Ava has used so far is Lily (the default), so that is the one honest history row.
insert into public.ava_voice_history (source, voice_id, name)
select s, 'pFZP5JQG7iQjIQuC4Bku', 'Lily' from (values ('ava'), ('rg')) v(s)
where not exists (select 1 from public.ava_voice_history);
insert into public.ava_voice_favorites (voice_id, name, accent, gender, sort)
values ('pFZP5JQG7iQjIQuC4Bku', 'Lily', 'british', 'female', 900) on conflict do nothing;

-- Watchdog (no AI): every 10 minutes ava-voices checks that each Ava's voice still exists. A missing one reverts to the
-- previous voice (or Lily), patches the agent, and Scout tells Jared. Same pattern as the line-health checks.
select cron.schedule('ava-voices-health', '4-59/10 * * * *',
  $c$select public.invoke_edge_function('ava-voices', '{"action":"health"}'::jsonb, 60000)$c$);
