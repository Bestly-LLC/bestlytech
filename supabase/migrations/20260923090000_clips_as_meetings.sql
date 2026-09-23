-- Meeting recordings dropped in as clips go through the call recorder's pipeline and show in Calls.
-- kind: 'meeting' (dropped on the Calls tab, or "Make it a call"), 'note' (keep it a clip), null =
-- decide by length (10+ minutes = meeting). meeting_name: the meeting-YYYYMMDD-HHMM it became.
alter table public.voice_clips
  add column if not exists kind text check (kind is null or kind in ('meeting','note')),
  add column if not exists meeting_name text;
create index if not exists voice_clips_meeting_name on public.voice_clips (meeting_name) where meeting_name is not null;

create or replace function public.clip_claim(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.voice_clips;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update voice_clips set status = 'new' where status = 'working' and created_at < now() - interval '30 minutes';
  select * into c from voice_clips where status = 'new' order by created_at limit 1 for update skip locked;
  if c.id is null then return null; end if;
  update voice_clips set status = 'working' where id = c.id;
  return jsonb_build_object('id', c.id, 'path', c.path, 'title', c.title, 'source', c.source, 'parts', c.parts,
    'kind', c.kind, 'recorded_at', c.recorded_at, 'created_at', c.created_at, 'meeting_name', c.meeting_name);
end $$;

drop function if exists public.clip_write(text, uuid, text, jsonb, numeric, text, text);
create or replace function public.clip_write(p_key text, p_id uuid, p_transcript text default null,
  p_summary jsonb default null, p_seconds numeric default null, p_title text default null, p_error text default null,
  p_meeting_name text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update voice_clips set
    transcript = coalesce(p_transcript, transcript),
    summary = coalesce(p_summary, summary),
    seconds = coalesce(p_seconds, seconds),
    title = coalesce(nullif(p_title, ''), title),
    meeting_name = coalesce(p_meeting_name, meeting_name),
    error = p_error,
    status = case when p_error is not null then 'error' else 'done' end,
    done_at = now()
  where id = p_id;
end $$;
revoke all on function public.clip_write(text, uuid, text, jsonb, numeric, text, text, text) from public;
grant execute on function public.clip_write(text, uuid, text, jsonb, numeric, text, text, text) to anon, authenticated, service_role;
