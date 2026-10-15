-- Basil self-heal (Oct 14 2026). Jared: "Kirkland beef chili says on the way still, it's here. Fix this, self heal and
-- watchdog, make sure all self-updating items are." Applied live via MCP; this file is the record.
--
-- Root cause: Costco Same-Day never sends a "delivered" email. Its "Your Costco order receipt" email IS the delivery
-- signal (Oct 14: confirmed 1:38 PM, receipt 6:42 PM; Sep 9: 10:41 AM / 5:22 PM). Basil only flipped "on the way"
-- rows 10 hours after they were added, so the order sat as "on the way" all evening.
--
-- Now:
--  * pantry_mark_delivered(): one helper flips "on the way" -> in stock with an event row per item.
--  * pantry_ingest_receipt(): a receipt email means delivered (rows land in stock, the order's other rows flip).
--  * pantry_settle_deliveries(): receipt in = arrived; else 10 quiet hours = arrived. basil_tick + basil_watchdog use it.
--  * basil_tick(): settles deliveries and watches the watchdog (re-creates/turns on its schedule, raises if it stops).
--  * basil_watchdog(): checks and heals every self-updating part: hourly check, both schedules, the receipt mail
--    trigger, receipts the trigger missed or failed, stuck deliveries, and a voice test that rolls itself back.
--    Raises kitchen.* to Scout's monitor only when healing fails. Tested by breaking all three on purpose in a
--    rolled-back transaction: it turned basil-tick back on, re-enabled the trigger and flipped the stuck item.
--  * basil_voice(): "the groceries are here" / "costco is here" / "my order arrived" marks the order in stock.
--  * basil_kitchen_arrived(): the Kitchen page's "It's all here" button.

CREATE OR REPLACE FUNCTION public.pantry_mark_delivered(p_source text, p_why text, p_older interval DEFAULT NULL::interval)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n int;
begin
  with f as (
    update pantry_items set status = 'have'
     where status = 'arriving' and (p_source is null or source = p_source)
       and (p_older is null or updated_at < now() - p_older)
    returning id, name
  ), l as (
    insert into pantry_events (source, action, item_id, item_name, before_status, after_status, said)
    select 'basil', 'have', id, name, 'arriving', 'have', left(p_why, 200) from f returning 1
  )
  select count(*) into n from f;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.pantry_settle_deliveries()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare r record; n int := 0;
begin
  for r in select distinct i.source from pantry_items i
            where i.status = 'arriving' and i.source ~ '^costco \d+$'
              and exists (select 1 from bestly_mail b
                           where b.sent_at > now() - interval '14 days' and pantry_is_grocery_mail(b.from_addr, b.subject)
                             and b.subject ~* '(receipt|delivered)'
                             and position(substring(i.source from '^costco (\d+)$') in coalesce(b.body_text, '')) > 0) loop
    n := n + pantry_mark_delivered(r.source, 'delivered: the order''s receipt email is in');
  end loop;
  n := n + pantry_mark_delivered(null, 'delivered: on the way for 10 hours with no news', interval '10 hours');
  return n;
end $function$;

revoke all on function public.pantry_mark_delivered(text, text, interval) from public, anon, authenticated;
revoke all on function public.pantry_settle_deliveries() from public, anon, authenticated;

-- Receipt email = delivered (patched in place, as applied live)
do $$
declare d text := pg_get_functiondef('public.pantry_ingest_receipt(uuid)'::regprocedure);
begin
  if d ~ 'v_final := ' then return; end if;
  d := replace(d, 'v_match uuid; u int := 0;', 'v_match uuid; u int := 0; v_final boolean;');
  d := replace(d, $o$  v_ref := substring(m.body_text from 'Order ID:\s*#\s*(\d+)');$o$,
                  $n$  v_ref := substring(m.body_text from 'Order ID:\s*#\s*(\d+)');
  -- Costco Same-Day and Instacart send the receipt once the order is delivered; the confirmation means "on the way".
  v_final := coalesce(m.subject, '') ~* 'receipt';$n$);
  d := replace(d, $o$set status = case when status in ('out', 'low') then 'arriving' else status end,$o$,
                  $n$set status = case when v_final and status in ('arriving', 'out', 'low') then 'have'
                           when status in ('out', 'low') then 'arriving' else status end,$n$);
  d := replace(d, $o$values (v_name, 'groceries', v_loc, v_qty, v_unit, 'arriving', v_soon, v_useby,$o$,
                  $n$values (v_name, 'groceries', v_loc, v_qty, v_unit, case when v_final then 'have' else 'arriving' end, v_soon, v_useby,$n$);
  d := replace(d, $o$  insert into pantry_receipts (mail_id, order_ref, items, ok, error) values (p_mail_id, v_ref, n, true, null)$o$,
                  $n$  if v_final then
    perform pantry_mark_delivered('costco ' || coalesce(v_ref, p_mail_id::text), 'delivered: ' || coalesce(m.subject, 'receipt'));
  end if;
  insert into pantry_receipts (mail_id, order_ref, items, ok, error) values (p_mail_id, v_ref, n, true, null)$n$);
  if d !~ 'v_final := ' or d !~ 'perform pantry_mark_delivered' then raise exception 'ingest patch incomplete'; end if;
  execute d;
end $$;

CREATE OR REPLACE FUNCTION public.pantry_mail_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if pantry_is_grocery_mail(new.from_addr, new.subject) then
    begin
      if new.subject ~* 'delivered' or new.body_text ~* 'has been delivered' then
        perform pantry_mark_delivered(null, 'delivered email: ' || coalesce(new.subject, ''));
      elsif new.body_text ~* 'order id' then
        perform pantry_ingest_receipt(new.id);
      end if;
    exception when others then
      insert into pantry_runs (job, ok, detail) values ('mail-trigger', false, jsonb_build_object('mail', new.id, 'error', sqlerrm));
    end;
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.basil_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  la timestamp := now() at time zone 'America/Los_Angeles';
  flipped int := 0; retried int := 0; pushed boolean := false; r record;
  soon text; ideas text; v_body text;
begin
  -- Deliveries: receipt email in = arrived; otherwise 10 quiet hours = arrived (pantry_settle_deliveries).
  flipped := pantry_settle_deliveries();

  -- Watch the watchdog: its schedule exists and is on, and it ran in the last 3 hours.
  begin
    if not exists (select 1 from cron.job where jobname = 'basil-watchdog') then
      perform cron.schedule('basil-watchdog', '47 * * * *', 'select public.basil_watchdog()');
    elsif exists (select 1 from cron.job where jobname = 'basil-watchdog' and not active) then
      perform cron.alter_job((select jobid from cron.job where jobname = 'basil-watchdog'), active := true);
    end if;
  exception when others then null;
  end;
  if not exists (select 1 from pantry_runs where job = 'watchdog' and ran_at > now() - interval '3 hours') then
    perform bestly_raise('kitchen.watchdog', 'problem', 'warning', 'Basil''s watchdog has stopped',
      'The hourly kitchen watchdog has not run in 3 hours, so nothing is double-checking the pantry. Its schedule was re-checked.', 'home', null, false);
  else
    perform bestly_raise('kitchen.watchdog', 'resolved');
  end if;

  for r in select b.id from bestly_mail b
            where b.sent_at > now() - interval '3 days' and pantry_is_grocery_mail(b.from_addr, b.subject)
              and b.body_text ~* 'order id' and coalesce(b.subject,'') !~* 'delivered'
              and not exists (select 1 from pantry_receipts x where x.mail_id = b.id and x.ok) loop
    perform pantry_ingest_receipt(r.id); retried := retried + 1;
  end loop;

  if extract(hour from la) >= 16 and extract(hour from la) < 21
     and not exists (select 1 from pantry_runs where job = 'dinner-push' and ok and (ran_at at time zone 'America/Los_Angeles')::date = la::date) then
    select string_agg(name || coalesce(' (' || trim(to_char(qty, 'FM999990.##')) || ')', ''), ', ' order by use_by nulls last)
      into soon from pantry_items where status in ('have','low') and (use_soon or use_by <= current_date + 1);
    select string_agg(name || ': ' || how, E'\n') into ideas from pantry_dinner_ideas(3);
    v_body := coalesce('Use soon: ' || soon || E'\n\n', '') || coalesce(E'Tonight you can make:\n' || ideas, 'Nothing complete on hand tonight. Time to shop.');
    perform set_config('bestly.from', 'basil', true);
    perform bestly_ntfy('Dinner ideas from Basil', v_body, 3, array['basil']);
    perform set_config('bestly.from', '', true);
    insert into pantry_runs (job, ok, detail) values ('dinner-push', true, jsonb_build_object('soon', soon));
    pushed := true;
  end if;

  insert into pantry_runs (job, ok, detail) values ('tick', true, jsonb_build_object('flipped', flipped, 'retried', retried, 'pushed', pushed));
  insert into agent_beats (slug, at, ok, summary)
  values ('basil', now(), true, format('Kitchen check: %s delivered, %s receipts retried%s', flipped, retried, case when pushed then ', dinner ideas sent' else '' end))
  on conflict (slug) do update set at = now(), ok = true, summary = excluded.summary;
  delete from pantry_runs where ran_at < now() - interval '30 days';
  return jsonb_build_object('ok', true, 'flipped', flipped, 'retried', retried, 'pushed', pushed);
exception when others then
  insert into agent_beats (slug, at, ok, summary) values ('basil', now(), false, left('Kitchen check failed: ' || sqlerrm, 500))
  on conflict (slug) do update set at = now(), ok = false, summary = excluded.summary;
  insert into pantry_runs (job, ok, detail) values ('tick', false, jsonb_build_object('error', sqlerrm));
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end $function$;

CREATE OR REPLACE FUNCTION public.basil_watchdog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Checks everything Basil does on his own, heals what it can, and raises to Scout's monitor only when healing fails:
-- 1 hourly check ran   2 both schedules exist + on   3 receipt mail trigger exists + on   4 grocery receipts loaded
-- 5 nothing stuck "on the way"   6 voice commands answer (test runs inside a rolled-back block, leaves no trace)
declare last_ok timestamptz; res jsonb; bad_receipts int; healed text[] := '{}'; problems text[] := '{}'; n int; j record; r record; probe text;
begin
  -- 1 hourly check
  select max(ran_at) into last_ok from pantry_runs where job = 'tick' and ok;
  if last_ok is null or last_ok < now() - interval '90 minutes' then
    res := basil_tick(); healed := healed || 'reran kitchen check'::text;
    if coalesce((res->>'ok')::boolean, false) then
      perform bestly_raise('kitchen.tick', 'resolved');
    else
      perform bestly_raise('kitchen.tick', 'problem', 'warning', 'Basil''s kitchen check is failing',
        'The hourly check failed and a rerun did not fix it. Error: ' || coalesce(res->>'error', 'unknown'), 'home', null, false);
    end if;
  else
    perform bestly_raise('kitchen.tick', 'resolved');
  end if;

  -- 2 schedules
  for j in select * from (values ('basil-tick', '17 * * * *', 'select public.basil_tick()'),
                                 ('basil-watchdog', '47 * * * *', 'select public.basil_watchdog()')) v(name, sched, cmd) loop
    begin
      if not exists (select 1 from cron.job where jobname = j.name) then
        perform cron.schedule(j.name, j.sched, j.cmd); healed := healed || ('re-created schedule ' || j.name);
      elsif exists (select 1 from cron.job where jobname = j.name and not active) then
        perform cron.alter_job((select jobid from cron.job where jobname = j.name), active := true);
        healed := healed || ('turned schedule back on: ' || j.name);
      end if;
    exception when others then problems := problems || ('schedule ' || j.name || ': ' || sqlerrm);
    end;
  end loop;

  -- 3 receipt mail trigger
  begin
    if not exists (select 1 from pg_trigger where tgname = 'pantry_mail_trg' and tgrelid = 'public.bestly_mail'::regclass) then
      problems := problems || 'the receipt trigger on incoming mail is missing'::text;
    elsif exists (select 1 from pg_trigger where tgname = 'pantry_mail_trg' and tgrelid = 'public.bestly_mail'::regclass and tgenabled = 'D') then
      execute 'alter table public.bestly_mail enable trigger pantry_mail_trg';
      healed := healed || 're-enabled the receipt trigger'::text;
    end if;
  exception when others then problems := problems || ('receipt trigger: ' || sqlerrm);
  end;

  -- 4 grocery receipts: ones the trigger never saw, then failed ones
  for r in select b.id from bestly_mail b
            where b.sent_at > now() - interval '3 days' and pantry_is_grocery_mail(b.from_addr, b.subject)
              and b.body_text ~* 'order id' and coalesce(b.subject, '') !~* 'delivered'
              and not exists (select 1 from pantry_receipts x where x.mail_id = b.id) loop
    perform pantry_ingest_receipt(r.id); healed := healed || 'loaded a receipt the trigger missed'::text;
  end loop;
  select count(*) into bad_receipts from pantry_receipts where not ok and at > now() - interval '2 days';
  if bad_receipts > 0 then
    perform pantry_ingest_receipt(mail_id) from pantry_receipts where not ok and at > now() - interval '2 days';
    healed := healed || 'retried failed receipts'::text;
    select count(*) into bad_receipts from pantry_receipts where not ok and at > now() - interval '2 days';
  end if;
  if bad_receipts > 0 then
    perform bestly_raise('kitchen.receipts', 'problem', 'warning', 'Basil could not read a grocery receipt',
      bad_receipts || ' grocery receipt(s) failed to load into your inventory, even after a retry.', 'home', null, false);
  else
    perform bestly_raise('kitchen.receipts', 'resolved');
  end if;

  -- 5 deliveries
  n := pantry_settle_deliveries();
  if n > 0 then healed := healed || (n || ' item(s) were stuck on the way, now in stock'); end if;
  if exists (select 1 from pantry_items where status = 'arriving' and updated_at < now() - interval '12 hours') then
    problems := problems || 'items are still on the way after 12 hours'::text;
  end if;

  -- 6 voice: ask about a real item; the exception at the end rolls the test back
  select name into probe from pantry_items where status in ('have', 'low') order by added_at limit 1;
  if probe is not null then
    begin
      if not coalesce((basil_voice('do we have ' || probe)->>'handled')::boolean, false) then
        raise exception 'voice_no_answer';
      end if;
      raise exception 'voice_ok';
    exception when others then
      if sqlerrm <> 'voice_ok' then problems := problems || ('voice check (do we have ' || probe || '): ' || sqlerrm); end if;
    end;
  end if;

  if cardinality(problems) > 0 then
    perform bestly_raise('kitchen.selfcheck', 'problem', 'warning', 'Basil found something he could not fix',
      array_to_string(problems, '; '), 'home', null, false);
  else
    perform bestly_raise('kitchen.selfcheck', 'resolved');
  end if;
  insert into pantry_runs (job, ok, detail) values ('watchdog', cardinality(problems) = 0, jsonb_build_object('healed', healed, 'problems', problems));
  return jsonb_build_object('ok', cardinality(problems) = 0, 'healed', healed, 'problems', problems);
end $function$;

-- Voice: "the groceries are here" (patched in place, as applied live)
do $$
declare d text := pg_get_functiondef('public.basil_voice(text)'::regprocedure);
begin
  if d ~ 'pantry_mark_delivered' then return; end if;
  d := replace(d, $o$  -- dinner ideas
$o$, $n$  -- the order is here: everything "on the way" is now in stock
  if t ~ '^(my |the )?(groceries|grocery order|costco order|costco|instacart order|instacart|order|delivery)( just)? (is |are |has |have )?(just )?(here|arrived|came|come|been delivered|delivered|showed up)$' then
    n := pantry_mark_delivered(null, 'voice: ' || p_text);
    return jsonb_build_object('handled', true, 'action', 'delivered', 'reply',
      case when n = 0 then 'Nothing was on the way, so the list is already up to date.'
           when n = 1 then 'Got it. 1 item from the order is now in stock.'
           else format('Got it. %s items from the order are now in stock.', n) end);
  end if;

  -- dinner ideas
$n$);
  if d !~ 'pantry_mark_delivered' then raise exception 'voice patch incomplete'; end if;
  execute d;
end $$;
revoke all on function public.basil_voice(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.basil_kitchen_arrived()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n int;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  n := pantry_mark_delivered(null, 'page: Jared tapped It''s all here');
  return jsonb_build_object('delivered', n);
end $function$;
revoke all on function public.basil_kitchen_arrived() from public, anon;
grant execute on function public.basil_kitchen_arrived() to authenticated;
