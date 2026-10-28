-- ROLLBACK for supabase/migrations/20261028150000_skill_inbox_buttons.sql (Skill Inbox Install / Send to Ares buttons).
-- Run in the Supabase SQL editor (project rcqfqhguwpmaarseifqg). Then: remove the skill_inbox_ares cron line on Clio, delete jobs/skill_inbox_ares.py there,
-- and revert the admin page commit (git revert the "Skill Inbox buttons" commit on main).
-- Rows Jared sent to Ares or installed AFTER the migration are kept: Ares rows go back to 'add'; claude rows stay as they are.

select cron.unschedule('skill-inbox-ares-watch');
delete from public.pi_jobs where job = 'skill_inbox_ares';
delete from public.monitor_issues where key = 'security.skill-review-stuck';

-- 1. data first (the old check constraint does not know 'ares')
update public.skill_inbox set decision = 'add', decided_at = coalesce(decided_at, now()), ares_status = null, updated_at = now() where decision = 'ares';
update public.skill_inbox s set decision = b.decision, claude_status = b.claude_status, decided_at = b.decided_at, updated_at = now()
  from public.skill_inbox_buttons_backup b where b.id = s.id and s.decision = 'claude' and s.claude_status = 'drafting';

-- 2. constraint back to the old four values
alter table public.skill_inbox drop constraint if exists skill_inbox_decision_check;
alter table public.skill_inbox add constraint skill_inbox_decision_check check (decision = any (array['add'::text, 'park'::text, 'skip'::text, 'claude'::text]));
alter table public.skill_inbox drop constraint if exists skill_inbox_ares_status_check;

-- 3. drop the new functions
drop function if exists public.skill_inbox_ares_claim(integer);
drop function if exists public.skill_inbox_ares_finish(uuid, jsonb);
drop function if exists public.skill_inbox_ares_watch();

-- 4. original functions back (as they were before the migration)
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
    'claude_status', r.claude_status)
$function$;

create or replace function public.skill_inbox_decide(p_id uuid, p_decision text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r public.skill_inbox;
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  if p_decision is not null and p_decision not in ('add','park','skip','claude') then
    raise exception 'decision must be add, park, skip, claude or null';
  end if;
  select * into r from public.skill_inbox where id = p_id for update;
  if not found or r.hidden or r.status <> 'ready' then raise exception 'That save is not available'; end if;
  if p_decision = 'add' and r.safe_status = 'blocked' then raise exception 'Ares blocked this one'; end if;
  if p_decision = 'claude' and coalesce(r.safe_status, '') <> 'cleared' then raise exception 'Only Ares-cleared saves can go to Claude'; end if;
  if r.claude_status = 'installed' and p_decision is distinct from 'claude' then
    raise exception 'Already installed in Claude Code, so it cannot be undone here';
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
         updated_at = now()
   where id = p_id returning * into r;
  return public._skill_inbox_card(r) || jsonb_build_object('claude_status', r.claude_status);
end $function$;

create or replace function public.skill_inbox_parked(p_q text default null)
 returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_day date := public._skill_inbox_day(); v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  return coalesce((
    select jsonb_agg(public._skill_inbox_card(s) order by s.saved_at desc nulls last, s.received_at desc)
      from (select * from public.skill_inbox s
             where not s.hidden and s.status = 'ready'
               and (s.decision = 'park' or (s.decision is null and (s.surfaced_on is null or s.surfaced_on < v_day)))
               and (v_q is null
                    or position(lower(v_q) in lower(concat_ws(' ', s.title, s.what_it_does, s.fit_label, s.caption, s.transcript))) > 0)
             order by s.saved_at desc nulls last, s.received_at desc
             limit 100) s
  ), '[]'::jsonb);
end $function$;

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
    coalesce(v_titles, '') || E'\n\nAdd, park or skip each one. Nothing installs without Ares.',
    'active', 'Radar', 'https://cloud.bestly.tech/admin/skill-inbox', null,
    'radar-skill-picks-' || v_day::text, null, null, false, now());
  perform set_config('bestly.from', '', true);

  update public.skill_inbox_state set push_sent_on = v_day where id;
  return jsonb_build_object('ok', true, 'picks', v_open, 'channel', v_ch);
end $function$;

-- 5. columns are left in place on purpose (no data loss); drop them by hand later if you really want:
--    alter table public.skill_inbox drop column ares_status, drop column ares_why, ... (and drop table public.skill_inbox_buttons_backup)
