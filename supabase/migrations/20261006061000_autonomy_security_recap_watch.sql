-- Autonomy Phases 2-4 (docs/autonomy-opusplan.md, Jared 2026-10-05: "fix, verify, keep an undo, tell me after").
--   * security_autofix (hourly, Ares's "Auto-Fixer"): locks database functions anyone could call unless devices or guest
--     pages need them (security_public_rpcs, seeded from the 2026-10-05 API logs), pins function search paths, keeps an
--     undo for every change in security_autofix_log, hands the rest to Jared as one Needs-you card each.
--   * autonomy_recap (7 PM Pacific, Scout): one screen of what the team closed, by employee; Sundays add the week.
--   * autonomy_watch (every 30 min, "Inbox Keeper"): Scout looks into it when Needs you passes 5 cards or 2 days, and
--     "still down after an hour" cards push once.
-- Applied 2026-10-06 through execute_sql in this order. RULE for builders: a new SECURITY DEFINER function that
-- devices or public pages call with the public key must be added to security_public_rpcs, or Ares locks it within an hour.

create table if not exists public.security_public_rpcs (
  fn text primary key, why text not null, added_at timestamptz not null default now());
alter table public.security_public_rpcs enable row level security;
create policy security_public_rpcs_admin on public.security_public_rpcs for select to authenticated using (public.has_role(auth.uid(), 'admin'));
insert into public.security_public_rpcs (fn, why)
select x, 'Called with the public key (no sign-in) in the API logs on 2026-10-05; by design: Pi, Mac, Home Assistant, the Cookie Yeti extension, guest pages or the LTX box.'
from unnest(array['lax_ask_claim','partner_ai_claim','fix_ai_claim','tesla_worker_claim','wall_pi_pull','wall_pi_air_put','turo_reader_note','clip_claim','wall_ha_get','wall_pi_signs','wall_quick_get','ha_todo_sync','wall_pi_emojis','wall_pi_scout_items','wall_pi_trips','wall_pi_snapshot','cron_heartbeat','studio_boot','wall_pi_push','wall_pi_handoff','turo_inbox_put','edge_guard_beat_t','wall_pi_feeds','turo_sender_note','cy_site_guard_list','claims_send_claim','wall_pi_icloud','turo_sender_claim','turo_reader_fresh','wall_pi_nextcloud','bestly_sent_upsert','partner_mail_known','bestly_sent_state_get','cy_render_key_ok','partner_mail_targets','edge_guard_note_t','ltx_report','agent_beat','wall_pi_feed_put','tesla_worker_spend','ops_watchdog_report_t','report_missed_banner_with_html','wall_pi_mail_put','wall_pi_mail_redo','tesla_worker_done','wall_pi_news_helis','wall_pi_home_charge','lax_track','lax_guest_public','lax_return_check','fix_ai_write','record_pattern_success','lax_guest_key_check','tesla_worker_stage','get_render_queue','upsert_pattern','tesla_worker_store_tokens','rg_ava_kpis','get_outage_note','lax_trip_kind_for','lax_guest_car_command','claims_send_done','cy_report_site_issue','wall_pi_vision_keys','wall_sign_open','guest_entry_lookup']) x
on conflict (fn) do nothing;

create table if not exists public.security_autofix_log (
  id bigserial primary key, at timestamptz not null default now(), finding_key text, action text,
  do_sql text, undo_sql text, ok boolean, note text);
alter table public.security_autofix_log enable row level security;
create policy security_autofix_log_admin on public.security_autofix_log for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create table if not exists public.autonomy_recaps (
  day date primary key, sent_at timestamptz not null default now(), body text not null, stats jsonb);
alter table public.autonomy_recaps enable row level security;
create policy autonomy_recaps_admin on public.autonomy_recaps for select to authenticated using (public.has_role(auth.uid(), 'admin'));
create table if not exists public.autonomy_pushed (key text primary key, at timestamptz not null default now());
alter table public.autonomy_pushed enable row level security;

create or replace function public.security_autofix() returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  f record; p record; fn text; n int; done_ int := 0; dismissed int := 0; handed int := 0; days int;
  v_do text; v_undo text; v_undo_all text; v_names text;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not coalesce(has_role(auth.uid(), 'admin'), false) then
    raise exception 'not allowed';
  end if;
  if not coalesce((select enabled and security_autofix from autonomy_settings where id), false) then
    return '{"off":true}'::jsonb;
  end if;

  for f in select * from security_findings
            where status = 'open' and coalesce(autofix->>'state', '') not in ('needs_person', 'watching_until')
            order by severity desc, first_seen
  loop
    begin
      if f.check_name = 'anon_rpc' then
        fn := substring(f.title from '^([a-z0-9_]+)\(');
        if fn is null then
          update security_findings set autofix = jsonb_build_object('state', 'needs_person', 'at', now(),
            'reason', 'Ares could not read the function name from this finding.') where id = f.id;
          handed := handed + 1; continue;
        end if;
        if exists (select 1 from security_public_rpcs where security_public_rpcs.fn = substring(f.title from '^([a-z0-9_]+)\(')) then
          perform security_finding_set_status(f.id, 'dismissed',
            'Ares: public on purpose. Devices and guest pages call it with the public key, and it checks its own input.');
          insert into security_autofix_log (finding_key, action, ok, note) values (f.key, 'dismiss_public', true, fn);
          dismissed := dismissed + 1; continue;
        end if;
        n := 0; v_undo_all := '';
        for p in select pr.oid::regprocedure as sig from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
                  where ns.nspname = 'public' and pr.proname = fn
        loop
          v_do := format('revoke execute on function %s from public, anon; grant execute on function %s to authenticated, service_role', p.sig, p.sig);
          v_undo := format('grant execute on function %s to anon', p.sig);
          execute v_do;
          insert into security_autofix_log (finding_key, action, do_sql, undo_sql, ok, note) values (f.key, 'lock_anon', v_do, v_undo, true, fn);
          v_undo_all := v_undo_all || v_undo || '; ';
          n := n + 1;
        end loop;
        if n = 0 then
          perform security_finding_set_status(f.id, 'fixed', 'Ares: the function no longer exists.');
        else
          update security_findings set autofix = jsonb_build_object('state', 'fixed', 'at', now(), 'undo', v_undo_all) where id = f.id;
          perform security_finding_set_status(f.id, 'fixed', 'Ares locked ' || fn || '() so the public key can no longer run it. Undo: ' || v_undo_all);
          insert into admin_notifications (kind, title, body, url, severity, silent, agent_slug, dedupe_key)
          values ('security', 'Ares: locked ' || fn || '() from anonymous callers',
                  'Only signed-in admins and Bestly''s own servers can run it now. Undo is saved.', '/admin/security',
                  'success', true, 'security-auditor', 'ares.lock.' || fn || '.' || to_char(now(), 'YYYYMMDD'))
          on conflict (dedupe_key) do nothing;
        end if;
        done_ := done_ + 1;

      elsif f.check_name = 'advisor' and f.title ~* 'mutable search_path' then
        n := 0; v_names := '';
        for p in select pr.oid::regprocedure as sig, pr.proname from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
                  where ns.nspname = 'public' and pr.prokind = 'f'
                    and not exists (select 1 from pg_depend d where d.objid = pr.oid and d.deptype = 'e')
                    and not exists (select 1 from unnest(coalesce(pr.proconfig, '{}'::text[])) c where c like 'search_path=%')
        loop
          begin
            v_do := format('alter function %s set search_path = public, extensions, pg_temp', p.sig);
            v_undo := format('alter function %s reset search_path', p.sig);
            execute v_do;
            insert into security_autofix_log (finding_key, action, do_sql, undo_sql, ok, note) values (f.key, 'pin_search_path', v_do, v_undo, true, p.proname);
            n := n + 1;
          exception when others then
            insert into security_autofix_log (finding_key, action, do_sql, ok, note) values (f.key, 'pin_search_path', v_do, false, left(sqlerrm, 200));
          end;
        end loop;
        update security_findings set autofix = jsonb_build_object('state', 'fixed', 'at', now(), 'count', n) where id = f.id;
        perform security_finding_set_status(f.id, 'fixed', 'Ares pinned the search path on ' || n || ' functions (public, extensions). Undo per function in security_autofix_log.');
        insert into admin_notifications (kind, title, body, url, severity, silent, agent_slug, dedupe_key)
        values ('security', 'Ares: pinned the search path on ' || n || ' database functions',
                'Closes the "mutable search_path" warning. Behavior is unchanged; undo is saved for each one.', '/admin/security',
                'success', true, 'security-auditor', 'ares.searchpath.' || to_char(now(), 'YYYYMMDDHH24'))
        on conflict (dedupe_key) do nothing;
        done_ := done_ + 1;

      elsif f.check_name = 'domain_expiry' then
        days := nullif(substring(f.title from 'expires in ([0-9]+) day'), '')::int;
        if days is not null and days > 30 then
          update security_findings set autofix = jsonb_build_object('state', 'watching', 'at', now(),
            'reason', 'More than 30 days left. Ares will hand it to you at 30 days if auto-renew is still off.') where id = f.id;
        else
          update security_findings set autofix = jsonb_build_object('state', 'needs_person', 'at', now(),
            'reason', 'Turn on auto-renew at the registrar. Ares cannot sign in to the registrar.') where id = f.id;
          handed := handed + 1;
        end if;

      elsif f.nights_open >= 1 then
        update security_findings set autofix = jsonb_build_object('state', 'needs_person', 'at', now(),
          'reason', coalesce(f.proposed_fix, 'Ares has no automatic fix for this kind of finding yet.')) where id = f.id;
        handed := handed + 1;
      end if;
    exception when others then
      update security_findings set autofix = jsonb_build_object('state', 'needs_person', 'at', now(),
        'reason', 'Ares tried and hit an error: ' || left(sqlerrm, 200)) where id = f.id;
      insert into security_autofix_log (finding_key, action, ok, note) values (f.key, 'error', false, left(sqlerrm, 300));
      handed := handed + 1;
    end;
  end loop;

  if handed > 0 then
    perform scout_notify('Ares couldn''t fix a security issue',
      handed || ' item(s) need you. They are in Needs you with the exact step.', 'warning', true, '/admin/security',
      'ares.handed.' || to_char(now(), 'YYYYMMDDHH24'));
    update admin_notifications set agent_slug = 'security-auditor'
     where dedupe_key = 'ares.handed.' || to_char(now(), 'YYYYMMDDHH24');
  end if;

  perform agent_beat('security-auditor', true, format('Auto-fix: %s fixed, %s public on purpose, %s handed to Jared', done_, dismissed, handed), null);
  return jsonb_build_object('fixed', done_, 'dismissed_public', dismissed, 'handed_to_person', handed);
end $$;

-- The one-line "Ares couldn't fix" push goes quiet in the bell right after (the cards are in Needs you).
create or replace function public.security_autofix_after() returns void
language plpgsql security definer set search_path = public as $$
begin
  update admin_notifications set read_at = now(), silent = true, agent_slug = 'security-auditor'
   where title ~* '^(scout:\s*)?ares couldn.t fix a security issue' and read_at is null;
end $$;

-- Recap phrases: no agent prefix, no "Fixed:", cut at a natural break, never with "...".
create or replace function public.autonomy_phrase(t text) returns text
language plpgsql immutable set search_path = public as $$
declare s text := regexp_replace(coalesce(t, ''), '^\s*(fixed|resolved|done|checked)\s*:\s*', '', 'i');
        w text[]; out_ text := '';
begin
  s := regexp_replace(s, '^\s*[^:]{2,40}:\s+', '');
  s := regexp_replace(s, '^\s*(fixed|resolved)\s*:\s*', '', 'i');
  s := split_part(split_part(split_part(split_part(split_part(s, ' (', 1), ' — ', 1), '. ', 1), ', so ', 1), ' because ', 1);
  if length(s) <= 60 then return s; end if;
  w := regexp_split_to_array(s, '\s+');
  for i in 1..coalesce(array_length(w, 1), 0) loop
    exit when length(out_) + length(w[i]) + 1 > 60;
    out_ := ltrim(out_ || ' ' || w[i]);
  end loop;
  out_ := regexp_replace(out_, ',\s*\S{1,4}$', '');
  return regexp_replace(out_, '\s+(a|an|the|of|on|in|to|for|and|with|from|nobody|that|is|are|no)$', '', 'i');
end $$;

create or replace function public.autonomy_done_phrase(t text) returns text
language sql immutable set search_path = public as $$
  select case
    when t ~* '(working again|is back|back to normal|steady|recovered|caught up|ready|locked|pinned|sent|closed|cleaned|restarted|reloaded|took over|rolled back|connected|refreshed)'
         and t !~* '^\s*(scout:\s*)?(fixed|resolved)\s*:'
      then autonomy_phrase(t)
    else 'fixed: ' || lower(left(autonomy_phrase(t), 1)) || substr(autonomy_phrase(t), 2)
  end
$$;

create or replace function public.autonomy_recap(p_send boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_since timestamptz := coalesce((select max(sent_at) from autonomy_recaps), now() - interval '24 hours');
  v_body text := ''; v_total int := 0; v_need int; v_work int; v_held int; r record; v_lines int := 0;
  v_title text; v_needs text; v_working text; v_week text := '';
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not coalesce(has_role(auth.uid(), 'admin'), false) then
    raise exception 'not allowed';
  end if;
  v_since := greatest(v_since, now() - interval '36 hours');

  for r in
    with done as (
      select coalesce(n.agent_slug, 'scout') slug, n.title, n.created_at from admin_notifications n
       where n.created_at >= v_since and n.severity = 'success' and n.title !~* '^(scout:\s*)?bestly today'
    )
    select a.name, d.slug, count(*) n,
           (select string_agg(p, '; ') from (select p from (select distinct on (autonomy_subject(d2.title)) autonomy_done_phrase(d2.title) p, d2.created_at
                                                              from done d2 where d2.slug = d.slug order by autonomy_subject(d2.title), d2.created_at desc) y
                                              where p <> '' and p <> 'fixed: ' order by created_at desc limit 2) x) ex
      from done d join bestly_agents a on a.slug = d.slug
     group by a.name, d.slug order by count(*) desc
  loop
    v_total := v_total + r.n;
    if v_lines < 6 then
      v_body := v_body || E'\n' || r.name || ': ' || r.n || ' done' || case when coalesce(r.ex, '') <> '' then ' (' || r.ex || ')' else '' end;
      v_lines := v_lines + 1;
    end if;
  end loop;

  select count(*) into v_held from autonomy_held where at >= v_since;
  select count(*) into v_need from admin_today_rows();
  select string_agg(t, '; ') into v_needs from (select autonomy_phrase(title) t from admin_today_rows() limit 3) x;
  select string_agg(nm || ' ' || c, ', ') into v_working from (
    select coalesce(o.name, 'Scout') nm, count(*) c from monitor_issues m
      left join lateral (select name from notification_owner(m.key)) o on true
     where m.status = 'open' group by 1 order by 2 desc limit 4) x;
  select count(*) into v_work from monitor_issues where status = 'open';

  if extract(dow from now() at time zone 'America/Los_Angeles') = 0 then
    select E'\nThis week: ' || count(*) || ' alerts reached your phone, ' ||
           (select count(*) from autonomy_held where at > now() - interval '7 days') || ' were handled quietly.'
      into v_week from notify_ledger where sent_at > now() - interval '7 days';
  end if;

  v_title := 'Bestly today: your team closed ' || v_total || case when v_total = 1 then ' thing' else ' things' end
             || case when v_need = 0 then ', nothing needs you' else ', ' || v_need || ' need' || case when v_need = 1 then 's' else '' end || ' you' end;
  v_body := ltrim(v_body, E'\n')
            || case when v_work > 0 then E'\nStill being worked: ' || v_work || ' (' || coalesce(v_working, '') || ')' else '' end
            || case when v_need > 0 then E'\nNeeds you: ' || coalesce(v_needs, '') else '' end
            || v_week;
  if v_body = '' then v_body := 'A quiet day. Nothing to report.'; end if;

  if p_send then
    insert into autonomy_recaps (day, body, stats)
    values ((now() at time zone 'America/Los_Angeles')::date, v_title || E'\n' || v_body,
            jsonb_build_object('done', v_total, 'needs_you', v_need, 'working', v_work, 'held', v_held))
    on conflict (day) do update set body = excluded.body, stats = excluded.stats, sent_at = now();
    perform scout_notify(v_title, v_body, 'info', true, '/admin', 'recap.' || to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD'));
    update admin_notifications set read_at = now(), agent_slug = 'scout'
     where title ~* '^(scout:\s*)?bestly today' and created_at > now() - interval '5 minutes';
  end if;
  return v_title || E'\n' || v_body;
end $$;

create or replace function public.autonomy_recap_tick() returns text
language plpgsql security definer set search_path = public as $$
declare h int := extract(hour from now() at time zone 'America/Los_Angeles');
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then raise exception 'not allowed'; end if;
  if not coalesce((select enabled from autonomy_settings where id), false) then return 'off'; end if;
  if h <> (select recap_hour from autonomy_settings where id) then return 'not yet'; end if;
  if exists (select 1 from autonomy_recaps where day = (now() at time zone 'America/Los_Angeles')::date) then return 'sent'; end if;
  perform autonomy_recap(true);
  return 'sent now';
end $$;

create or replace function public.autonomy_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; oldest_h int; r record; pushed int := 0;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then raise exception 'not allowed'; end if;
  if not coalesce((select enabled from autonomy_settings where id), false) then return '{"off":true}'::jsonb; end if;

  select count(*), coalesce(max(extract(epoch from now() - t.since) / 3600)::int, 0) into n, oldest_h
    from admin_today_rows() t where t.key not like 'bell:%' or t.title !~* 'needs you (has|is)';
  if n > 5 or oldest_h > 48 then
    perform bestly_raise('scout.autonomy.needs-you', 'problem', 'warning',
      'Needs you is getting long: ' || n || ' cards, oldest ' || oldest_h || ' h',
      'Check each card against the four kinds in docs/autonomy-opusplan.md. Hand the ones that do not fit to their owner and fix the rule that let them in.',
      'scout', null, false);
  else
    perform bestly_raise('scout.autonomy.needs-you', 'resolved', 'info', 'Needs you is short again', null, 'scout', null, false);
  end if;

  for r in select t.key, t.title, t.detail, t.since from admin_today_rows() t
            where t.key like 'down:%'
              and not exists (select 1 from autonomy_pushed p where p.key = t.key || '@' || coalesce(t.since::text, ''))
  loop
    perform scout_notify(r.title, left(coalesce(r.detail, ''), 300), 'warning', true, '/admin', 'down.' || md5(r.key || coalesce(r.since::text, '')));
    insert into autonomy_pushed (key) values (r.key || '@' || coalesce(r.since::text, '')) on conflict do nothing;
    pushed := pushed + 1;
  end loop;

  perform agent_beat('inbox-keeper', true, format('Needs you: %s card(s), oldest %s h. Pushed %s.', n, oldest_h, pushed), null);
  return jsonb_build_object('needs_you', n, 'oldest_h', oldest_h, 'pushed_down', pushed);
end $$;

select cron.schedule('security-autofix', '25 * * * *', $$select public.security_autofix(); select public.security_autofix_after();$$);
select cron.schedule('autonomy-recap', '1 * * * *', $$select public.autonomy_recap_tick()$$);
select cron.schedule('autonomy-watch', '17,47 * * * *', $$select public.autonomy_watch()$$);

select public.team_onboard('[
 {"slug":"inbox-keeper","name":"Inbox Keeper","role":"Keeps Needs you short and sends the evening recap",
  "what_it_does":"Lets only four kinds of news reach Jared (security nobody could fix, money, a real person waiting, something down an hour). Closes stale and fixed alerts every 10 minutes, merges repeats into one card, signs every alert with its employee, sends the 7 PM recap of what the team got done, and has Scout look into it if Needs you grows past 5 cards or 2 days.",
  "tool_of":"scout","runs_on":"cloud","schedule":"every 10 min + 7 PM recap","icon":"inbox",
  "pulse":{"src":"cron","job":"autonomy-sweep","also":["autonomy-recap","autonomy-watch"],"gap":30},"owns":["autonomy","scout.autonomy"]},
 {"slug":"ares-autofix","name":"Auto-Fixer","role":"Applies security fixes with an undo",
  "what_it_does":"Every hour takes Ares''s open findings and fixes what is safe: locks database functions that anyone could call (unless devices or guest pages need them, checked against the API logs), pins function settings, and saves an undo for each change. Anything it cannot fix goes to Jared as one card with the exact step.",
  "tool_of":"security-auditor","runs_on":"cloud","schedule":"hourly at :25","icon":"shield-check",
  "pulse":{"src":"cron","job":"security-autofix","gap":90}}
]'::jsonb);
