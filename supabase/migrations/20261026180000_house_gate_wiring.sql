-- House gate wiring (Spark), 2026-10-26: schedules, the evening recap line, the team card.
-- Undo: select cron.unschedule('house-gate-run'); select cron.unschedule('house-gate-watch');
--       the original autonomy_recap body is in bestly_memory build/house-autopost-2026-10-26-orig/autonomy_recap
--       (re-read the live body first: other sessions edit it; just remove v_gate).

-- 1. The database half of the gate runs 3 minutes after the Pi's media job (every 5 minutes) and one minute before the
--    posting tick (studio-autopost-tick, 1-59/5), so a pass is on the calendar within minutes.
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'house-gate-run') then
    perform cron.schedule('house-gate-run', '3-59/5 * * * *', 'select public.house_gate_run()');
  end if;
  if not exists (select 1 from cron.job where jobname = 'house-gate-watch') then
    perform cron.schedule('house-gate-watch', '12 * * * *', 'select public.house_gate_watch()');
  end if;
end $$;

-- 2. One line per brand in the 7 PM recap, signed Spark. Patches the LIVE autonomy_recap body (other sessions edit it).
do $$
declare d text; d2 text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'autonomy_recap';
  if d like '%house_gate_daily_line%' then return; end if;
  d2 := replace(d, 'v_cov text := '''';', 'v_cov text := ''''; v_gate text := '''';');
  if d2 = d then raise exception 'recap patch 1 did not match'; end if;
  d := d2;
  d2 := replace(d, E'  v_title := ''Bestly today: your team closed',
    E'  begin v_gate := coalesce(E''\\n'' || nullif(public.house_gate_daily_line(), ''''), ''''); exception when others then v_gate := ''''; end;\n  v_title := ''Bestly today: your team closed');
  if d2 = d then raise exception 'recap patch 2 did not match'; end if;
  d := d2;
  d2 := replace(d, E'            || v_cov\n', E'            || v_cov\n            || v_gate\n');
  if d2 = d then raise exception 'recap patch 3 did not match'; end if;
  execute d2;
end $$;

-- 3. Team card: the gate is a tool of Spark (no new person to welcome). It owns the house.* alert prefixes.
select public.team_onboard('[{
  "slug": "spark-house-gate",
  "name": "House Gate",
  "role": "Checks every house post, approves the good ones, sends the rest back",
  "what_it_does": "Replaces Jared''s Approve for @bestly_llc (Bestly Cloud, Studio, Agent), HOKU, Cookie Yeti and InventoryProof. Every five minutes the Pi opens each waiting post (music bed, text inside the app buttons, readable size, not blank, a picture fingerprint) and the database checks the claim rules, the product pointer, cut-off text and duplicates against the last 60 posts and everything queued. A pass is auto-approved and slotted by the normal calendar. A fail is rejected with the reason written on the post and the generator makes a replacement. It adds one line per brand to the 7 PM recap and raises an alert only when a brand has posted nothing for two days.",
  "tool_of": "spark",
  "runs_on": "cloud + pi",
  "schedule": "every 5 minutes (Pi media check, then database gate); watchdog hourly",
  "icon": "shield",
  "admin_url": "/admin/team",
  "sort": 51,
  "pulse": {"job": "house-gate-run", "src": "cron", "gap": 20, "also": ["house-gate-watch", "house_gate_media"], "issues": ["house.nopost"]},
  "owns": ["house.nopost", "house.gate"]
}]'::jsonb);
