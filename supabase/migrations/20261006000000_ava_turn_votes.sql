-- Thumbs on Ava's lines (Jared, 2026-10-05). He watches a call live, sees a line he likes or hates, and taps it.
-- That judgment is worth more than anything the Coach infers on its own: it is the owner saying "say more of this"
-- or "never say that again", tied to the exact sentence.
--
-- Works mid-call. A live call has no rg_calls/ava_calls row until the post-call webhook lands, so a vote is keyed by
-- the voice platform's conversation_id and backfilled with call_id once the row exists.
-- Votes only ever go on HER lines. Thumbing the other person's words would mean nothing.

create table if not exists public.ava_turn_votes (
  id              uuid primary key default gen_random_uuid(),
  source          text not null check (source in ('roofguard', 'ava')),
  call_id         uuid,
  conversation_id text,
  turn_index      int not null,
  turn_t          int,                       -- seconds into the call, for lining up with the recording
  said            text not null,             -- a copy of the line, so the note survives a transcript rewrite
  vote            text not null check (vote in ('up', 'down')),
  note            text,
  seen_by_coach   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (call_id is not null or conversation_id is not null)
);
-- one vote per line, whichever id we have for the call
create unique index if not exists ava_turn_votes_one
  on public.ava_turn_votes (source, coalesce(call_id::text, conversation_id), turn_index);
create index if not exists ava_turn_votes_conv on public.ava_turn_votes (conversation_id) where call_id is null;
create index if not exists ava_turn_votes_new on public.ava_turn_votes (source, created_at desc);
alter table public.ava_turn_votes enable row level security;
revoke all on public.ava_turn_votes from anon, authenticated;

-- the post-call webhook finally creates the row: attach any votes left during the call
create or replace function public.ava_turn_votes_attach(p_source text, p_call uuid, p_conversation text) returns void
language sql security definer set search_path to 'public' as $$
  update ava_turn_votes set call_id = p_call, updated_at = now()
   where source = p_source and call_id is null and conversation_id = p_conversation
     and p_conversation is not null and p_call is not null;
$$;
revoke all on function public.ava_turn_votes_attach(text, uuid, text) from public, anon, authenticated;

-- ------------------------------------------------------------------ Jared taps
-- p_vote null clears it, so the same tap toggles off.
create or replace function public.admin_turn_vote(
  p_source text, p_turn int, p_said text, p_vote text default null,
  p_call uuid default null, p_conversation text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_key text;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  if p_source not in ('roofguard', 'ava') then raise exception 'bad source'; end if;
  if p_vote is not null and p_vote not in ('up', 'down') then raise exception 'bad vote'; end if;
  if p_call is null and coalesce(p_conversation, '') = '' then raise exception 'need a call'; end if;
  v_key := coalesce(p_call::text, p_conversation);

  if p_vote is null then
    delete from ava_turn_votes
     where source = p_source and turn_index = p_turn and coalesce(call_id::text, conversation_id) = v_key;
    return jsonb_build_object('vote', null);
  end if;

  insert into ava_turn_votes (source, call_id, conversation_id, turn_index, turn_t, said, vote, note)
  values (p_source, p_call, nullif(p_conversation, ''), p_turn, null, left(coalesce(p_said, ''), 2000), p_vote, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (source, coalesce(call_id::text, conversation_id), turn_index) do update
    set vote = excluded.vote, said = excluded.said, note = coalesce(excluded.note, ava_turn_votes.note),
        call_id = coalesce(excluded.call_id, ava_turn_votes.call_id),
        seen_by_coach = false, updated_at = now();
  return jsonb_build_object('vote', p_vote);
end $$;
revoke all on function public.admin_turn_vote(text, int, text, text, uuid, text, text) from public, anon;
grant execute on function public.admin_turn_vote(text, int, text, text, uuid, text, text) to authenticated;

-- what is already thumbed on this call, so the buttons come back filled in
create or replace function public.admin_turn_votes(p_source text, p_call uuid default null, p_conversation text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return (select coalesce(jsonb_object_agg(turn_index::text, jsonb_build_object('vote', vote, 'note', note)), '{}')
            from ava_turn_votes
           where source = p_source
             and ((p_call is not null and call_id = p_call)
               or (coalesce(p_conversation, '') <> '' and conversation_id = p_conversation)));
end $$;
revoke all on function public.admin_turn_votes(text, uuid, text) from public, anon;
grant execute on function public.admin_turn_votes(text, uuid, text) to authenticated;

-- ------------------------------------------------------------------ the Coach reads them
-- Jared's thumbs go into the review prompt as their own section. The Coach is told plainly that these outrank
-- its own judgment: a line he thumbed down does not get defended.
create or replace function public.coach_turn_votes(p_source text, p_call uuid) returns jsonb
language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('vote', vote, 'said', said, 'note', note) order by turn_index), '[]')
    from ava_turn_votes where source = p_source and call_id = p_call;
$$;
revoke all on function public.coach_turn_votes(text, uuid) from public, anon, authenticated;
grant execute on function public.coach_turn_votes(text, uuid) to service_role;

-- the feed Jared sees in the Coach: his own notes on her lines, newest first
create or replace function public.admin_turn_vote_feed(p_source text, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]') from (
    select v.id, v.vote, v.said, v.note, v.call_id, v.created_at, v.seen_by_coach
      from ava_turn_votes v
     where v.source = p_source
     order by v.created_at desc limit greatest(1, least(p_limit, 100))) q);
end $$;
revoke all on function public.admin_turn_vote_feed(text, int) from public, anon;
grant execute on function public.admin_turn_vote_feed(text, int) to authenticated;

-- ------------------------------------------------------------------ wire the votes into the Coach's queue
-- Two changes to coach_next: each call now carries Jared's thumbs, and a call he has thumbed since its last
-- review goes back in the queue so the review is redone with his judgment in hand.
create or replace function public.coach_next(p_source text, p_limit int default 4) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if p_source = 'roofguard' then
    return (select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (
      select c.id, c.call_no, c.direction, c.outcome, c.opener_key, c.dm_reached, c.kept_talking, c.is_test, c.duration_sec,
             c.summary, c.notes, c.playbook_arms, l.company, l.category,
             left(coach_transcript(c.transcript), 9000) transcript,
             coach_turn_votes('roofguard', c.id) jared_votes
        from rg_calls c left join rg_leads l on l.id = c.lead_id
        left join rg_call_reviews r on r.call_id = c.id
       where c.deleted_at is null and c.transcript is not null and jsonb_array_length(c.transcript) > 2
         and coalesce(c.duration_sec, 0) >= 10 and coalesce(c.ended_at, c.updated_at) > now() - interval '14 days'
         and (r.call_id is null or (r.status = 'failed' and r.tries < 3 and r.updated_at < now() - interval '20 minutes')
              or exists (select 1 from ava_turn_votes v where v.source = 'roofguard' and v.call_id = c.id and not v.seen_by_coach))
       order by coalesce(c.ended_at, c.updated_at) desc limit p_limit) q);
  elsif p_source = 'ava' then
    return (select coalesce(jsonb_agg(to_jsonb(q)), '[]') from (
      select c.id, c.call_no, c.direction, c.purpose, c.caller_name, c.summary, c.message, c.urgent, c.callback_wanted,
             c.forwarded, c.is_spam, c.duration_sec, left(coach_transcript(c.transcript), 9000) transcript,
             coach_turn_votes('ava', c.id) jared_votes
        from ava_calls c left join ava_call_reviews r on r.call_id = c.id
       where c.deleted_at is null and c.transcript is not null and jsonb_array_length(c.transcript) > 2
         and coalesce(c.duration_sec, 0) >= 10 and coalesce(c.ended_at, c.created_at) > now() - interval '14 days'
         and (r.call_id is null or (r.status = 'failed' and r.tries < 3 and r.updated_at < now() - interval '20 minutes')
              or exists (select 1 from ava_turn_votes v where v.source = 'ava' and v.call_id = c.id and not v.seen_by_coach))
       order by coalesce(c.ended_at, c.created_at) desc limit p_limit) q);
  end if;
  raise exception 'source must be roofguard or ava';
end $$;
revoke all on function public.coach_next(text, int) from public, anon, authenticated;
grant execute on function public.coach_next(text, int) to service_role;

-- a finished review is proof the Coach saw the thumbs. Marking them here rather than when the queue is read means
-- a review that fails does not silently eat Jared's feedback.
create or replace function public.ava_turn_votes_seen_trg() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'done' then
    update ava_turn_votes set seen_by_coach = true, updated_at = now()
     where call_id = new.call_id and not seen_by_coach
       and source = case when tg_table_name = 'rg_call_reviews' then 'roofguard' else 'ava' end;
  end if;
  return new;
end $$;
drop trigger if exists rg_call_reviews_votes_seen on public.rg_call_reviews;
create trigger rg_call_reviews_votes_seen after insert or update on public.rg_call_reviews
  for each row execute function public.ava_turn_votes_seen_trg();
drop trigger if exists ava_call_reviews_votes_seen on public.ava_call_reviews;
create trigger ava_call_reviews_votes_seen after insert or update on public.ava_call_reviews
  for each row execute function public.ava_turn_votes_seen_trg();
