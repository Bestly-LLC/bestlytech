-- Rollback for 20261027221500_skill_inbox.sql. STAGED, not applied.
-- Drops the Skill Inbox tables and functions and puts Radar's team card back the way it was on 2026-10-27.
-- This deletes every saved row. If you want the saves, export first:
--   select * from public.skill_inbox;   (copy to CSV from the SQL editor)
-- Safe to run twice.

drop function if exists public.skill_inbox_push_today();
drop function if exists public.skill_inbox_pick(date, int, boolean);
drop function if exists public.skill_inbox_set_boosts(jsonb);
drop function if exists public.skill_inbox_requeue(int, int);
drop function if exists public.skill_inbox_finish(uuid, jsonb);
drop function if exists public.skill_inbox_claim(int);
drop function if exists public.skill_inbox_known(int);
drop function if exists public.skill_inbox_ingest(jsonb);
drop function if exists public.skill_inbox_key_ok(text);
drop function if exists public.skill_inbox_parked(text);
drop function if exists public.skill_inbox_decide(uuid, text);
drop function if exists public.skill_inbox_today();
drop function if exists public._skill_inbox_card(public.skill_inbox);
drop function if exists public._skill_inbox_day();
drop table if exists public.skill_inbox;
drop table if exists public.skill_inbox_state;

delete from public.notification_owners where prefix = 'radar-skill';
delete from public.pi_jobs where job in ('skill_inbox', 'skill_inbox_push', 'skill_inbox_watch');

-- Radar's team card back to its 2026-10-27 values (what_it_does and schedule were read from production before the change).
update public.bestly_agents set
  what_it_does = regexp_replace(what_it_does, ' It also runs the Skill Inbox: .*$', ''),
  schedule     = 'Every 3 hours + Monday digest',
  admin_url    = case when admin_url = '/admin/skill-inbox' then null else admin_url end,
  pulse        = (coalesce(pulse, '{}'::jsonb) - 'also') || jsonb_build_object('issues', to_jsonb(array['platform.'])),
  updated_at   = now()
where slug = 'platform-radar' and what_it_does like '%Skill Inbox%';
