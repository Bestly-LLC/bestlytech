-- Tap a call to-do, see where it came from: the call, the commitment, and the moment in the
-- transcript. Used by /admin Today (From your calls) and the partner portal (Your to-dos).
-- The matched line is stored on first look so the moment never moves around.

create table if not exists public.todo_call_moment (
  todo_id     uuid primary key references public.scout_daily(id) on delete cascade,
  meeting_id  uuid not null,
  line_index  int  not null,        -- 1-based, among the transcript's spoken lines
  line_at     text not null,        -- the line's [stamp], to notice a rewritten transcript
  score       numeric,
  computed_at timestamptz not null default now()
);
alter table public.todo_call_moment enable row level security;
revoke all on public.todo_call_moment from anon, authenticated;

-- Pure matcher: best line for a task. Keyword overlap (5-letter stems, rare words weigh more),
-- neighbours count a little, trigram similarity breaks ties, and a nudge for the owner speaking
-- or a line that sounds like a promise ("I'll", "let me", "I'm going to").
create or replace function public.todo_moment_pick(p_lines text[], p_task text, p_owner text)
returns table(idx int, score numeric)
language sql stable
set search_path = public, extensions
as $$
with stop(w) as (select unnest(string_to_array(
  'the,and,for,with,this,that,about,from,into,onto,today,tomorrow,tonight,week,weeks,later,end,day,days,any,all,our,your,their,them,they,his,her,him,she,are,was,were,will,would,should,could,can,get,got,make,made,new,its,not,but,have,has,had,what,when,who,how,why,out,also,just,some,more,than,then,there,here,via,per,next,each,every,one,two,three', ',')))
, lines as (
    select o::int i,
      lower(extensions.unaccent(regexp_replace(l, '^\[[0-9:]+\]\s*[^:]{1,40}:\s*', ''))) txt,
      upper(trim(both '?' from substring(l from '^\[[0-9:]+\]\s*([^:]{1,40}):'))) who
    from unnest(p_lines) with ordinality u(l, o))
, kw as (
    select distinct left(w, 5) s
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p_task, ''))), '[^a-z0-9]+') w
    where length(w) >= 3 and w not in (select w from stop))
, toks as (
    select distinct l.i, left(w, 5) s
    from lines l, regexp_split_to_table(l.txt, '[^a-z0-9]+') w
    where length(w) >= 3 and left(w, 5) in (select s from kw))
, n as (select count(*)::numeric n from lines)
, wt as (
    select kw.s, ln((n.n + 1) / (coalesce((select count(*) from toks t where t.s = kw.s), 0) + 1)) wgt
    from kw, n)
, cand as (select distinct i from toks)
select c.i,
  ( (select coalesce(sum(wt.wgt), 0) from wt
      where exists (select 1 from toks t where t.s = wt.s and t.i between c.i - 1 and c.i + 1))
  + 0.5 * (select coalesce(sum(wt.wgt), 0) from wt join toks t on t.s = wt.s and t.i = c.i)
  + 2 * extensions.word_similarity(lower(coalesce(p_task, '')), l.txt)
  + case when l.who = upper(coalesce(p_owner, '')) then 1 else 0 end
  + case when l.txt ~ '\m(i''ll|i will|i''m going to|i''m gonna|let me|i need to|we''ll|can you|will you)\M' then 1 else 0 end
  )::numeric(10,3)
from cand c join lines l on l.i = c.i
order by 2 desc, 1 desc
limit 1
$$;
revoke all on function public.todo_moment_pick(text[], text, text) from public, anon, authenticated;

-- What a tapped call to-do came from. Admin: any. Partner: only calls he was on.
create or replace function public.todo_call_context(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r       public.scout_daily;
  m       public.meeting_recordings;
  me      text;
  v_admin boolean := public.has_role(auth.uid(), 'admin');
  v_mid   text;
  v_ci    int;
  v_com   jsonb;
  v_lines text[];
  v_hit   int;
  v_score numeric;
  mo      public.todo_call_moment;
  lo int; hi int; i int;
  v_out   jsonb := '[]'::jsonb;
  v_stamp text; v_who text; v_secs int; v_hit_at text; v_hit_secs int;
  WIN constant int := 4;   -- lines either side: a moment, not the transcript
begin
  if auth.uid() is null then raise exception 'sign in'; end if;
  if not v_admin then
    me := public.partner_roster_name();
    if me is null then raise exception 'not allowed'; end if;
  end if;

  select * into r from public.scout_daily where id = p_id and kind = 'call';
  if r.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  v_mid := coalesce(nullif(r.action->>'meeting_id', ''), nullif(split_part(coalesce(r.source_key, ''), ':', 2), ''));
  if v_mid is not null and v_mid ~ '^[0-9a-f-]{36}$' then
    select * into m from public.meeting_recordings where id = v_mid::uuid;
  end if;
  if m.id is null and coalesce(r.action->>'meeting', '') <> '' then
    select * into m from public.meeting_recordings where name = r.action->>'meeting' limit 1;
  end if;
  if m.id is null then
    if not v_admin then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    return jsonb_build_object('ok', true, 'why', 'no_recording', 'title', r.title, 'note', r.why, 'lines', '[]'::jsonb);
  end if;

  -- the gate: a partner only ever sees calls he was on
  if not v_admin and not (me = any(coalesce(m.people, '{}'))) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- the commitment this to-do was written from
  v_ci := nullif(substring(coalesce(r.source_key, '') from '^call:[^:]+:([0-9]+)$'), '')::int;
  if v_ci is not null then v_com := m.summary->'commitments'->v_ci; end if;
  if v_com is null or lower(coalesce(v_com->>'task', '')) <> lower(r.title) then
    select c.value into v_com from jsonb_array_elements(coalesce(m.summary->'commitments', '[]'::jsonb)) c
     where lower(c.value->>'task') = lower(r.title) limit 1;
  end if;

  -- spoken lines only; the "#" header notes are ours
  select array_agg(x order by o) into v_lines
    from regexp_split_to_table(coalesce(m.transcript, ''), E'\n') with ordinality t(x, o)
   where x ~ '^\[[0-9]+(:[0-9]{2}){1,2}\] ';

  if v_lines is not null then
    select * into mo from public.todo_call_moment where todo_id = r.id;
    if mo.todo_id is not null and mo.meeting_id = m.id and mo.line_index <= array_length(v_lines, 1)
       and v_lines[mo.line_index] like '[' || mo.line_at || ']%' then
      v_hit := mo.line_index;
    else
      select p.idx, p.score into v_hit, v_score
        from public.todo_moment_pick(v_lines, r.title || ' ' || coalesce(v_com->>'task', ''), coalesce(r.action->>'owner', v_com->>'owner')) p;
      if v_hit is not null then
        insert into public.todo_call_moment (todo_id, meeting_id, line_index, line_at, score)
        values (r.id, m.id, v_hit, substring(v_lines[v_hit] from '^\[([0-9:]+)\]'), v_score)
        on conflict (todo_id) do update set meeting_id = excluded.meeting_id, line_index = excluded.line_index,
          line_at = excluded.line_at, score = excluded.score, computed_at = now();
      end if;
    end if;
  end if;

  if v_hit is not null then
    lo := greatest(1, v_hit - WIN);
    hi := least(array_length(v_lines, 1), v_hit + WIN);
    for i in lo .. hi loop
      v_stamp := substring(v_lines[i] from '^\[([0-9:]+)\]');
      v_who   := substring(v_lines[i] from '^\[[0-9:]+\]\s*([^:]{1,40}):');
      v_secs  := case when v_stamp ~ '^[0-9]+:[0-9]{2}:[0-9]{2}$'
                      then split_part(v_stamp, ':', 1)::int * 3600 + split_part(v_stamp, ':', 2)::int * 60 + split_part(v_stamp, ':', 3)::int
                      else split_part(v_stamp, ':', 1)::int * 60 + split_part(v_stamp, ':', 2)::int end;
      if i = v_hit then v_hit_at := v_stamp; v_hit_secs := v_secs; end if;
      v_out := v_out || jsonb_build_object(
        'at', v_stamp,
        'secs', v_secs,
        'who', initcap(trim(both '?' from coalesce(v_who, ''))),
        'sure', coalesce(v_who, '') not like '%?%',
        'text', regexp_replace(v_lines[i], '^\[[0-9:]+\]\s*[^:]{1,40}:\s*', ''),
        'hit', i = v_hit);
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'why', case when v_lines is null then 'no_transcript' when v_hit is null then 'not_found' else null end,
    'title', r.title,
    'note', r.why,
    'commitment', v_com,
    'meeting', jsonb_build_object(
      'id', m.id, 'name', m.name, 'started_at', m.started_at, 'stopped_at', m.stopped_at,
      'people', (select coalesce(jsonb_agg(p), '[]'::jsonb) from (
                   select distinct p from unnest(array['jared'] || coalesce(m.people, '{}')) p
                    where p !~ '^speaker-') s),
      'summary', m.summary->>'summary'),
    'hit_at', v_hit_at,
    'hit_secs', v_hit_secs,
    'lines', v_out);
end $$;
revoke all on function public.todo_call_context(uuid) from public, anon;
grant execute on function public.todo_call_context(uuid) to authenticated;

comment on function public.todo_call_context(uuid) is
  'Where a call to-do came from: meeting, commitment, and a 9-line transcript excerpt around the matched moment (stored in todo_call_moment on first look). Admin: any to-do; partner: only calls he was on.';
