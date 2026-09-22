-- Voice clips: anything Jared records on the Soundcore Work (or any recorder). AirDropped to the
-- Mac mini, or dropped onto /admin/clips in the browser; the Mac transcribes and summarises them.
insert into storage.buckets (id, name, public) values ('voice-clips', 'voice-clips', false)
  on conflict (id) do nothing;

create table if not exists public.voice_clips (
  id uuid primary key default gen_random_uuid(),
  title text,
  path text not null,
  bytes bigint not null default 0,
  seconds numeric,
  source text not null default 'upload',        -- airdrop | upload
  status text not null default 'new' check (status in ('new','working','done','error')),
  transcript text,
  summary jsonb,
  note text,
  error text,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists voice_clips_new on public.voice_clips (created_at) where status = 'new';
alter table public.voice_clips enable row level security;
grant select, insert, update, delete on public.voice_clips to authenticated;

drop policy if exists "Admins manage voice clips" on public.voice_clips;
create policy "Admins manage voice clips" on public.voice_clips for all to authenticated
  using (has_role(auth.uid(), 'admin')) with check (has_role(auth.uid(), 'admin'));

-- The admin's browser uploads straight into the bucket; nobody else can see it.
drop policy if exists "Admins read clip files" on storage.objects;
create policy "Admins read clip files" on storage.objects for select to authenticated
  using (bucket_id = 'voice-clips' and has_role(auth.uid(), 'admin'));
drop policy if exists "Admins write clip files" on storage.objects;
create policy "Admins write clip files" on storage.objects for insert to authenticated
  with check (bucket_id = 'voice-clips' and has_role(auth.uid(), 'admin'));
drop policy if exists "Admins delete clip files" on storage.objects;
create policy "Admins delete clip files" on storage.objects for delete to authenticated
  using (bucket_id = 'voice-clips' and has_role(auth.uid(), 'admin'));

-- The Mac mini worker (same key as the partner assistant) claims a clip and writes back.
create or replace function public.clip_claim(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.voice_clips;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update voice_clips set status = 'new' where status = 'working' and created_at < now() - interval '30 minutes';
  select * into c from voice_clips where status = 'new' order by created_at limit 1 for update skip locked;
  if c.id is null then return null; end if;
  update voice_clips set status = 'working' where id = c.id;
  return jsonb_build_object('id', c.id, 'path', c.path, 'title', c.title, 'source', c.source);
end $$;

create or replace function public.clip_write(p_key text, p_id uuid, p_transcript text default null,
  p_summary jsonb default null, p_seconds numeric default null, p_title text default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update voice_clips set
    transcript = coalesce(p_transcript, transcript),
    summary = coalesce(p_summary, summary),
    seconds = coalesce(p_seconds, seconds),
    title = coalesce(nullif(p_title, ''), title),
    error = p_error,
    status = case when p_error is not null then 'error' else 'done' end,
    done_at = now()
  where id = p_id;
end $$;

create or replace function public.clip_new(p_key text, p_path text, p_title text, p_bytes bigint,
  p_source text default 'airdrop', p_recorded_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  insert into voice_clips (title, path, bytes, source, recorded_at)
  values (nullif(p_title,''), p_path, coalesce(p_bytes,0), coalesce(p_source,'airdrop'), p_recorded_at)
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.clip_claim(text), public.clip_write(text, uuid, text, jsonb, numeric, text, text),
  public.clip_new(text, text, text, bigint, text, timestamptz) from public;
grant execute on function public.clip_claim(text), public.clip_write(text, uuid, text, jsonb, numeric, text, text),
  public.clip_new(text, text, text, bigint, text, timestamptz) to anon, authenticated, service_role;
