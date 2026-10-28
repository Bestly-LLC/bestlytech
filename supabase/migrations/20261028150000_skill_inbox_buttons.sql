-- Skill Inbox buttons (Oct 28 2026): Install for cleared saves, Send to Ares (real review queue) for flagged ones.
-- APPLIED to project rcqfqhguwpmaarseifqg as migration "skill_inbox_buttons". Rollback: tools/skill-inbox/rollback_buttons.sql
alter table public.skill_inbox
  add column if not exists ares_status text,
  add column if not exists ares_why text,
  add column if not exists ares_sent_at timestamptz,
  add column if not exists ares_claimed_at timestamptz,
  add column if not exists ares_checked_at timestamptz,
  add column if not exists ares_attempts int not null default 0,
  add column if not exists ares_notified boolean not null default false,
  add column if not exists ares_checks jsonb;

alter table public.skill_inbox drop constraint if exists skill_inbox_decision_check;
alter table public.skill_inbox add constraint skill_inbox_decision_check
  check (decision is null or decision = any (array['add','park','skip','claude','ares']));
alter table public.skill_inbox drop constraint if exists skill_inbox_ares_status_check;
alter table public.skill_inbox add constraint skill_inbox_ares_status_check
  check (ares_status is null or ares_status = any (array['queued','reviewing','cleared','blocked','needs_call']));

-- backup of rows this migration touches (rollback restores from here)
create table if not exists public.skill_inbox_buttons_backup (
  id uuid primary key, decision text, claude_status text, decided_at timestamptz, saved_at timestamptz not null default now());
alter table public.skill_inbox_buttons_backup enable row level security;

-- card JSON: add Ares review state and the per-Mac install status
create or replace function public._skill_inbox_card(r public.skill_inbox)
 returns jsonb language sql stable set search_path to 'public' as $function$
  select jsonb_build_object(
    'id', r.id, 'ig_shortcode', r.ig_shortcode, 'reel_url', r.reel_url, 'creator_handle', r.creator_handle,
    'saved_at', r.saved_at, 'received_at', r.received_at,
    'title', r.title, 'what_it_does', r.what_it_does,
    'fit_agent_slug', r.fit_agent_slug, 'fit_label', r.fit_label, 'fit_kind', r.fit_kind, 'fit_why', r.fit_why,
    'safe_status', r.safe_status, 'safe_why', r.safe_why,
    'cost_label', r.cost_label, 'cost_why', r.cost_why,
    'score', r.score, 'decision', r.decision, 'decided_at', r.decided_at,
    'surfaced_on', r.surfaced_on, 'resurfaced_at', r.resurfaced_at, 'resurfaced_why', r.resurfaced_why,
    'claude_status', r.claude_status,
    'ares_status', r.ares_status, 'ares_why', r.ares_why,
    'hosts', coalesce((select jsonb_agg(jsonb_build_object('host', h.host, 'status', h.status) order by h.host)
                         from public.skill_inbox_claude_hosts h where h.id = r.id), '[]'::jsonb))
$function$;

create or replace function public.skill_inbox_decide(p_id uuid, p_decision text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r public.skill_inbox;
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  if p_decision is not null and p_decision not in ('add','park','skip','claude','ares') then
    raise exception 'decision must be add, park, skip, claude, ares or null';
  end if;
  select * into r from public.skill_inbox where id = p_id for update;
  if not found or r.hidden or r.status <> 'ready' then raise exception 'That save is not available'; end if;
  if p_decision in ('add','ares') and r.safe_status = 'blocked' then raise exception 'Ares blocked this one'; end if;
  if p_decision = 'claude' and coalesce(r.safe_status, '') <> 'cleared' then raise exception 'Only Ares-cleared saves can be installed'; end if;
  if p_decision = 'ares' and coalesce(r.safe_status, 'needs_look') <> 'needs_look' then raise exception 'Only saves that need a look go to Ares'; end if;
  if r.claude_status = 'installed' and p_decision is distinct from 'claude' then
    raise exception 'Already installed in Claude Code, so it cannot be undone here';
  end if;
  if r.decision = 'ares' and r.ares_status = 'reviewing' and p_decision is distinct from 'ares' then
    raise exception 'Ares is checking this one right now';
  end if;
  if p_decision = 'claude' and r.claude_status = 'failed' then
    delete from public.skill_inbox_claude_hosts where id = p_id and status = 'failed';
  end if;
  update public.skill_inbox
     set decision = p_decision,
         decided_at = case when p_decision is null then null else now() end,
         claude_status = case when p_decision = 'claude' and (r.claude_status is null or r.claude_status = 'failed') then 'drafting'
                              when p_decision is distinct from 'claude' and r.claude_status = 'drafting' then null
                              else r.claude_status end,
         ares_status = case when p_decision = 'ares' then 'queued'
                            when r.decision = 'ares' and p_decision is distinct from 'ares' then null
                            else r.ares_status end,
         ares_sent_at = case when p_decision = 'ares' then now()
                             when r.decision = 'ares' and p_decision is distinct from 'ares' then null
                             else r.ares_sent_at end,
         ares_attempts = case when p_decision = 'ares' then 0 else r.ares_attempts end,
         ares_notified = case when p_decision = 'ares' then false else r.ares_notified end,
         updated_at = now()
   where id = p_id returning * into r;
  return public._skill_inbox_card(r);
end $function$;

-- parked list: the same actions apply there, and in-flight receipts (Ares review, install) stay visible until installed + 1 day
create or replace function public.skill_inbox_parked(p_q text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_day date := public._skill_inbox_day(); v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  return coalesce((
    select jsonb_agg(public._skill_inbox_card(s) order by (s.decision in ('ares','claude')) desc, s.saved_at desc nulls last, s.received_at desc)
      from (select * from public.skill_inbox s
             where not s.hidden and s.status = 'ready'
               and (s.decision = 'park'
                    or (s.decision is null and (s.surfaced_on is null or s.surfaced_on < v_day))
                    or (s.surfaced_on is distinct from v_day
                        and (s.decision = 'ares'
                             or (s.decision = 'claude' and (s.claude_status is distinct from 'installed' or s.claude_installed_at > now() - interval '1 day')))))
               and (v_q is null
                    or position(lower(v_q) in lower(concat_ws(' ', s.title, s.what_it_does, s.fit_label, s.caption, s.transcript))) > 0)
             order by (s.decision in ('ares','claude')) desc, s.saved_at desc nulls last, s.received_at desc
             limit 100) s
  ), '[]'::jsonb);
end $function$;

-- daily picks: never resurface a save that is with Ares or being installed
create or replace function public.skill_inbox_pick(p_day date, p_n integer default null, p_rebalance boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_n int := coalesce(p_n, (select picks_per_day from public.skill_inbox_state where id), 3); v_have int; v_new int;
begin
  if p_rebalance then
    update public.skill_inbox set surfaced_on = null, updated_at = now() where surfaced_on = p_day and decision is null;
  end if;
  select count(*) into v_have from public.skill_inbox where surfaced_on = p_day and not hidden and status = 'ready';

  with cand as (
    select id from public.skill_inbox s
     where s.status = 'ready' and not s.hidden and coalesce(s.safe_status, 'needs_look') <> 'blocked'
       and s.decision is distinct from 'skip' and s.decision is distinct from 'add'
       and s.decision is distinct from 'ares' and s.decision is distinct from 'claude'
       and (s.surfaced_on is null or s.surfaced_on < p_day)
       and (
            (s.decision is null and s.surfaced_on is null and s.score >= 25)
         or s.resurface_boost > 0
       )
     order by (s.score + s.resurface_boost) desc, s.received_at
     limit greatest(0, v_n - v_have)),
  up as (
    update public.skill_inbox s
       set surfaced_on = p_day,
           resurfaced_at = case when s.decision = 'park' or s.surfaced_on is not null or s.resurface_boost > 0 then now() else s.resurfaced_at end,
           decision = null, decided_at = null, updated_at = now()
      from cand where s.id = cand.id returning 1)
  select count(*) into v_new from up;
  return jsonb_build_object('day', p_day, 'kept', v_have, 'added', v_new);
end $function$;

-- push copy no longer says "Add"
create or replace function public.skill_inbox_push_today()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_day date := public._skill_inbox_day(); v_open int; v_titles text; v_ch text; v_sent date;
begin
  select push_sent_on into v_sent from public.skill_inbox_state where id;
  if v_sent = v_day then return jsonb_build_object('ok', true, 'skipped', 'already_sent'); end if;
  select count(*), string_agg(title, E'\n' order by (score + resurface_boost) desc)
    into v_open, v_titles
    from public.skill_inbox where surfaced_on = v_day and decision is null and not hidden and status = 'ready';
  if v_open = 0 then return jsonb_build_object('ok', true, 'skipped', 'no_picks'); end if;

  perform set_config('bestly.from', 'platform-radar', true);
  v_ch := public.notify_route(
    'Radar: ' || v_open || case when v_open = 1 then ' pick' else ' picks' end || ' in your Skill Inbox',
    coalesce(v_titles, '') || E'\n\nInstall, send to Ares, park or skip each one. Nothing installs without Ares.',
    'active', 'Radar', 'https://cloud.bestly.tech/admin/skill-inbox', null,
    'radar-skill-picks-' || v_day::text, null, null, false, now());
  perform set_config('bestly.from', '', true);

  update public.skill_inbox_state set push_sent_on = v_day where id;
  return jsonb_build_object('ok', true, 'picks', v_open, 'channel', v_ch);
end $function$;

-- Ares review queue (service role only; the Pi job on Clio calls these)
create or replace function public.skill_inbox_ares_claim(p_limit integer default 5)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  update public.skill_inbox set ares_status = 'queued', updated_at = now()
   where decision = 'ares' and ares_status = 'reviewing' and ares_claimed_at < now() - interval '30 minutes';
  with c as (
    select id from public.skill_inbox
     where decision = 'ares' and ares_status = 'queued' and not hidden
     order by ares_sent_at limit greatest(1, least(coalesce(p_limit, 5), 10)) for update skip locked),
  up as (
    update public.skill_inbox s set ares_status = 'reviewing', ares_claimed_at = now(), updated_at = now()
      from c where s.id = c.id returning s.*)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', up.id, 'title', up.title, 'what_it_does', up.what_it_does, 'caption', up.caption, 'transcript', up.transcript,
           'tool_url', up.tool_url, 'reel_url', up.reel_url, 'creator_handle', up.creator_handle, 'safe_why', up.safe_why,
           'attempts', up.ares_attempts) order by up.ares_sent_at), '[]'::jsonb)
    into v from up;
  return v;
end $function$;

create or replace function public.skill_inbox_ares_finish(p_id uuid, p jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r public.skill_inbox; v text := lower(coalesce(p->>'verdict', '')); w text := left(nullif(btrim(coalesce(p->>'why', '')), ''), 140);
        nm text; ttl text; bd text;
begin
  select * into r from public.skill_inbox where id = p_id and decision = 'ares' and ares_status = 'reviewing' for update;
  if not found then return jsonb_build_object('ok', false); end if;
  nm := coalesce(nullif(r.title, ''), 'a saved skill');
  if v = 'retry' then
    if r.ares_attempts + 1 >= 4 then
      v := 'unsure'; w := coalesce(w, 'The free AI was busy four times, so the check did not finish');
    else
      update public.skill_inbox set ares_status = 'queued', ares_attempts = r.ares_attempts + 1, updated_at = now() where id = p_id;
      return jsonb_build_object('ok', true, 'verdict', 'retry');
    end if;
  end if;
  if v not in ('cleared', 'blocked', 'unsure') then v := 'unsure'; w := coalesce(w, 'Ares could not read the result of the check'); end if;

  if v = 'cleared' then
    update public.skill_inbox set safe_status = 'cleared', safe_why = coalesce(w, 'Checked by Ares'),
           ares_status = 'cleared', ares_why = w, ares_checked_at = now(), ares_checks = p->'checks',
           decision = 'claude', decided_at = now(), claude_status = 'drafting', updated_at = now()
     where id = p_id;
    ttl := 'Ares: cleared ' || nm; bd := coalesce(w, 'Checked.') || ' Radar is writing the skill now and both Macs will install it.';
  elsif v = 'blocked' then
    update public.skill_inbox set safe_status = 'blocked', safe_why = coalesce(w, 'Blocked by Ares'),
           ares_status = 'blocked', ares_why = w, ares_checked_at = now(), ares_checks = p->'checks',
           decision = null, decided_at = null, hidden = true, hidden_reason = 'blocked', updated_at = now()
     where id = p_id;
    ttl := 'Ares: blocked ' || nm; bd := coalesce(w, 'Not safe.') || ' Hidden. Nothing was installed or run.';
  else
    update public.skill_inbox set ares_status = 'needs_call', ares_why = w, ares_checked_at = now(), ares_checks = p->'checks',
           decision = null, decided_at = null, updated_at = now()
     where id = p_id;
    ttl := 'Ares: ' || nm || ' needs your call'; bd := coalesce(w, 'Ares could not decide.') || ' Nothing was installed.';
  end if;

  if not r.ares_notified then
    begin
      perform set_config('bestly.from', 'security-auditor', true);
      perform public.notify_route(ttl, bd, 'active', 'Ares', 'https://cloud.bestly.tech/admin/skill-inbox', null,
                                  'ares-skill-' || p_id::text, null, null, false, now());
      perform set_config('bestly.from', '', true);
    exception when others then
      perform set_config('bestly.from', '', true);
    end;
    update public.skill_inbox set ares_notified = true where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'verdict', v);
end $function$;

-- in-database watchdog: reviews stuck over 2 hours raise an alert signed Ares (notification_owners prefix 'security' -> security-auditor = Ares)
create or replace function public.skill_inbox_ares_watch()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare n int; m numeric; bad boolean; v_open boolean;
begin
  select count(*), extract(epoch from now() - min(ares_sent_at)) / 60 into n, m
    from public.skill_inbox where decision = 'ares' and ares_status in ('queued', 'reviewing') and ares_sent_at < now() - interval '2 hours';
  bad := n > 0;
  select exists(select 1 from public.monitor_issues where key = 'security.skill-review-stuck' and status <> 'resolved') into v_open;
  if bad then
    perform public.bestly_raise('security.skill-review-stuck', 'problem', 'warning', 'Skill reviews are stuck',
      n || ' saved skill' || case when n = 1 then ' has' else 's have' end || ' waited ' || round(m / 60.0, 1) ||
      ' hours for my review. The review job on Clio is not finishing. Ares.', 'security', null, false);
  elsif v_open then
    perform public.bestly_raise('security.skill-review-stuck', 'resolved', 'info', 'Fixed: skill reviews are moving', 'Reviews are finishing again. Ares.', 'security', null, true);
  end if;
  return jsonb_build_object('stuck', n, 'alert', bad);
end $function$;

revoke all on function public.skill_inbox_ares_claim(integer), public.skill_inbox_ares_finish(uuid, jsonb), public.skill_inbox_ares_watch() from public, anon, authenticated;
grant execute on function public.skill_inbox_ares_claim(integer), public.skill_inbox_ares_finish(uuid, jsonb), public.skill_inbox_ares_watch() to service_role;

-- heartbeat row: Scout alerts if the Ares review job goes quiet for more than 45 minutes
insert into public.pi_jobs (job, description, max_gap_min, last_run_at, last_ok_at, last_ok, last_summary)
values ('skill_inbox_ares', 'Skill Inbox: Ares reviews saves that need a look, free AI plus plain checks (Ares)', 45, now(), now(), true, 'installed')
on conflict (job) do nothing;

select cron.schedule('skill-inbox-ares-watch', '4,19,34,49 * * * *', 'select public.skill_inbox_ares_watch()');

-- migrate existing Add choices (cleared -> Install, needs_look -> Ares review, anything else -> undecided)
insert into public.skill_inbox_buttons_backup (id, decision, claude_status, decided_at)
  select id, decision, claude_status, decided_at from public.skill_inbox where decision = 'add' on conflict do nothing;
update public.skill_inbox set decision = 'claude', claude_status = 'drafting', decided_at = coalesce(decided_at, now()), updated_at = now()
 where decision = 'add' and safe_status = 'cleared' and status = 'ready' and not hidden;
update public.skill_inbox set decision = 'ares', ares_status = 'queued', ares_sent_at = now(), ares_attempts = 0, ares_notified = false, updated_at = now()
 where decision = 'add' and safe_status = 'needs_look' and status = 'ready' and not hidden;
update public.skill_inbox set decision = null, decided_at = null, updated_at = now() where decision = 'add';
