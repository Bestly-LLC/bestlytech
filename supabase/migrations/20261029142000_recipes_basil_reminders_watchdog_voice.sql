-- Recipes tab, part 3: Basil's side. Everything here is signed Basil and rides the existing notification path
-- (set_config('bestly.from','basil') + bestly_ntfy -> ha_push), the existing hourly tick/watchdog and the existing voice entry.
--
--   basil_ferment_reminders()   "Taste today", "Burp bottles", "Drink by": once a day per ferment, 8 AM to 9 PM Pacific
--   basil_tick()                now also calls the reminders (patched in place, nothing else changes)
--   basil_recipes_watchdog()    stuck photo/link reads (retry, then raise), ferment reminders, handoffs, timer schedule
--   basil_watchdog()            now also calls basil_recipes_watchdog() as check 7 (patched in place)
--   basil_voice()               wrapped: while cook mode is open, "next / back / repeat / start timer / stop timer" become a
--                               recipe_commands row that the open page picks up over Realtime. Everything else goes to the
--                               original function, renamed basil_voice_core.
--   cron basil-timers           every minute: announce kitchen timers whose page went to sleep (recipe_timers_due)

create or replace function public.basil_ferment_reminders()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  la timestamp := now() at time zone 'America/Los_Angeles';
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  f record; v_day int; v_check int; v_hi int; v_by date; v_first date; n int := 0;
begin
  if extract(hour from la) < 8 or extract(hour from la) >= 21 then return 0; end if;
  for f in
    select x.*, p.name as rname, p.doc -> 'ferment' as fe
      from public.recipe_ferments x join public.pantry_recipes p on p.id = x.recipe_id
     where x.state <> 'done'
  loop
    if f.state = 'fermenting' then
      v_day := v_today - (f.started_at at time zone 'America/Los_Angeles')::date + 1;
      v_check := coalesce((f.fe ->> 'check_from_day')::int, 2);
      v_hi := coalesce((f.fe #>> '{ready_days,1}')::int, v_check + 1);
      if v_day >= v_check and v_day <= v_hi + 5 and f.tasted_on is distinct from v_today
         and (f.last_taste_reminder is null or f.last_taste_reminder < v_today) then
        perform set_config('bestly.from', 'basil', true);
        perform public.bestly_ntfy('Taste today',
          f.rname || ' is on day ' || v_day || '. ' ||
          case when v_day > v_hi then 'It is past the usual window. Taste it and bottle it when you like it.'
               else 'Taste it, and bottle it when you like it.' end, 3, array['basil']);
        perform set_config('bestly.from', '', true);
        update public.recipe_ferments set last_taste_reminder = v_today where id = f.id;
        n := n + 1;
      end if;
    elsif f.state = 'bottled' then
      v_by := (f.bottled_at at time zone 'America/Los_Angeles')::date + coalesce((f.fe #>> '{after_bottling,drink_within_days,1}')::int, 14);
      v_first := (f.bottled_at at time zone 'America/Los_Angeles')::date + coalesce((f.fe #>> '{after_bottling,drink_within_days,0}')::int, 7);
      if v_today <= v_by and f.burped_on is distinct from v_today and (f.last_burp_reminder is null or f.last_burp_reminder < v_today) then
        perform set_config('bestly.from', 'basil', true);
        perform public.bestly_ntfy('Burp bottles',
          'Burp the lids on your ' || f.rname || '. Best from ' || to_char(v_first, 'Mon FMDD') || ', drink by ' || to_char(v_by, 'Mon FMDD') || '.', 3, array['basil']);
        perform set_config('bestly.from', '', true);
        update public.recipe_ferments set last_burp_reminder = v_today where id = f.id;
        n := n + 1;
      end if;
      if v_today >= v_by and f.drink_by_notified is null then
        perform set_config('bestly.from', 'basil', true);
        perform public.bestly_ntfy('Drink by today',
          'Your ' || f.rname || ' is at the end of its window (' || to_char(v_by, 'Mon FMDD') || '). Drink it up, or it may go flat or sour.', 3, array['basil']);
        perform set_config('bestly.from', '', true);
        update public.recipe_ferments set drink_by_notified = v_today where id = f.id;
        n := n + 1;
      end if;
      if v_today > v_by + 2 then
        update public.recipe_ferments set state = 'done', finished_at = now() where id = f.id;
      end if;
    end if;
  end loop;
  insert into public.pantry_runs (job, ok, detail) values ('ferment-reminders', true, jsonb_build_object('sent', n));
  return n;
end $$;
revoke all on function public.basil_ferment_reminders() from public, anon, authenticated;
grant execute on function public.basil_ferment_reminders() to service_role;

create or replace function public.basil_recipes_watchdog()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  healed text[] := '{}'; problems text[] := '{}';
  la timestamp := now() at time zone 'America/Los_Angeles';
  n int; j record; v_key text; v_req bigint; v_failed int; v_active int;
begin
  -- 1. the minute job that announces timers exists and is on; late timers get announced now
  begin
    if not exists (select 1 from cron.job where jobname = 'basil-timers') then
      perform cron.schedule('basil-timers', '* * * * *', 'select public.recipe_timers_due()');
      healed := healed || 're-created the kitchen timer schedule'::text;
    elsif exists (select 1 from cron.job where jobname = 'basil-timers' and not active) then
      perform cron.alter_job((select jobid from cron.job where jobname = 'basil-timers'), active := true);
      healed := healed || 'turned the kitchen timer schedule back on'::text;
    end if;
    n := public.recipe_timers_due();
    if n > 0 then healed := healed || (n || ' kitchen timer(s) announced late'); end if;
  exception when others then problems := problems || ('kitchen timers: ' || sqlerrm);
  end;

  -- 2. ferment reminders: they run inside the hourly tick; if the tick skipped them, send now
  begin
    select count(*) into v_active from public.recipe_ferments where state <> 'done';
    if v_active > 0 and extract(hour from la) between 9 and 20
       and not exists (select 1 from public.pantry_runs where job = 'ferment-reminders' and ok and ran_at > now() - interval '3 hours') then
      n := public.basil_ferment_reminders();
      healed := healed || ('ran the ferment reminders the hourly check missed (' || n || ' sent)');
    end if;
    perform public.bestly_raise('kitchen.ferments', 'resolved');
  exception when others then
    problems := problems || ('ferment reminders: ' || sqlerrm);
    perform public.bestly_raise('kitchen.ferments', 'problem', 'warning', 'Basil could not send ferment reminders',
      'A ferment reminder failed even on a retry. Error: ' || sqlerrm, 'home', null, false);
  end;

  -- 3. photo / link reads: stuck ones get one retry (the edge function), then fail and raise
  begin
    for j in select * from public.recipe_parse_jobs where status in ('queued', 'running') and updated_at < now() - interval '3 minutes' loop
      if j.attempts < 2 then
        update public.recipe_parse_jobs set status = 'queued', updated_at = now() where id = j.id;
        select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
        if v_key is not null then
          select net.http_post(url := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/recipe-parse',
                               body := jsonb_build_object('job_id', j.id),
                               headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key, 'apikey', v_key),
                               timeout_milliseconds := 5000) into v_req;
          healed := healed || 'retried a recipe read that was stuck'::text;
        else
          problems := problems || 'no service key in Vault, so a stuck recipe read could not be retried'::text;
        end if;
      else
        update public.recipe_parse_jobs set status = 'failed', error = coalesce(error, 'It took too long twice.'), updated_at = now() where id = j.id;
      end if;
    end loop;
    select count(*) into v_failed from public.recipe_parse_jobs where status = 'failed' and attempts >= 2 and updated_at > now() - interval '2 hours';
    if v_failed > 0 then
      problems := problems || (v_failed || ' recipe read(s) failed twice')::text;
      perform public.bestly_raise('kitchen.parse', 'problem', 'warning', 'Basil could not read a recipe',
        v_failed || ' photo or link read(s) failed twice in the last 2 hours. The free models may all be busy.', 'home', null, false);
    else
      perform public.bestly_raise('kitchen.parse', 'resolved');
    end if;
  exception when others then problems := problems || ('recipe reads: ' || sqlerrm);
  end;

  -- 4. handoffs: only the newest one should ever be pending; old ones expire; rows must not pile up
  begin
    update public.recipe_handoff set status = 'expired', handled_at = now() where status = 'pending' and created_at < now() - interval '12 hours';
    get diagnostics n = row_count;
    if n > 0 then healed := healed || (n || ' old iPad handoff(s) expired'); end if;
    update public.recipe_handoff set status = 'expired', handled_at = now()
     where status = 'pending' and id <> (select id from public.recipe_handoff where status = 'pending' order by created_at desc limit 1);
    get diagnostics n = row_count;
    if n > 0 then healed := healed || (n || ' extra pending handoff(s) expired'); end if;
    select count(*) into n from public.recipe_handoff where created_at > now() - interval '1 hour';
    if n > 20 then problems := problems || (n || ' iPad handoffs in the last hour')::text; end if;
    select count(*) into n from public.recipe_handoff;
    if n > 2000 then problems := problems || ('the handoff table has ' || n || ' rows and nothing is pruning it'); end if;
    update public.recipe_commands set status = 'expired' where status = 'new' and created_at < now() - interval '2 minutes';
  exception when others then problems := problems || ('handoffs: ' || sqlerrm);
  end;

  -- 5. the settings row exists
  begin
    insert into public.recipe_settings (key, value) values ('ha', '{"speaker": true, "timer_push": true, "kitchen_auto": true, "voice": true}'::jsonb)
    on conflict (key) do nothing;
    if found then healed := healed || 'recreated the recipe settings'::text; end if;
  exception when others then problems := problems || ('recipe settings: ' || sqlerrm);
  end;

  return jsonb_build_object('healed', to_jsonb(healed), 'problems', to_jsonb(problems));
end $$;
revoke all on function public.basil_recipes_watchdog() from public, anon, authenticated;
grant execute on function public.basil_recipes_watchdog() to service_role;

-- Patch basil_tick() and basil_watchdog() in place (anchored, idempotent, fails loudly if the anchor moved).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.basil_tick()'::regprocedure);
  if position('basil_ferment_reminders' in d) = 0 then
    d := replace(d, $a$insert into pantry_runs (job, ok, detail) values ('tick', true,$a$,
$b$begin
    perform public.basil_ferment_reminders();
  exception when others then
    insert into pantry_runs (job, ok, detail) values ('ferment-reminders', false, jsonb_build_object('error', sqlerrm));
  end;
  insert into pantry_runs (job, ok, detail) values ('tick', true,$b$);
    if position('basil_ferment_reminders' in d) = 0 then raise exception 'basil_tick anchor not found'; end if;
    execute d;
  end if;

  d := pg_get_functiondef('public.basil_watchdog()'::regprocedure);
  if position('basil_recipes_watchdog' in d) = 0 then
    d := replace(d, $a$if cardinality(problems) > 0 then$a$,
$b$-- 7 recipes: timers, ferment reminders, photo/link reads, iPad handoffs (basil_recipes_watchdog)
  declare rw jsonb;
  begin
    rw := public.basil_recipes_watchdog();
    healed := healed || coalesce((select array_agg(x) from jsonb_array_elements_text(rw -> 'healed') x), '{}'::text[]);
    problems := problems || coalesce((select array_agg(x) from jsonb_array_elements_text(rw -> 'problems') x), '{}'::text[]);
  exception when others then problems := problems || ('recipes check: ' || sqlerrm);
  end;

  if cardinality(problems) > 0 then$b$);
    if position('basil_recipes_watchdog' in d) = 0 then raise exception 'basil_watchdog anchor not found'; end if;
    execute d;
  end if;
end $$;

-- Voice: wrap basil_voice. The original keeps its body under the name basil_voice_core.
do $$
begin
  if to_regprocedure('public.basil_voice_core(text)') is null and to_regprocedure('public.basil_voice(text)') is not null then
    alter function public.basil_voice(text) rename to basil_voice_core;
  end if;
end $$;

create or replace function public.basil_voice(p_text text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t text; act text; s record; v_voice boolean;
begin
  t := public.pantry_norm(p_text);
  t := regexp_replace(t, '^(hey basil|ok basil|okay basil|basil|hey scout|scout) ', '');
  t := regexp_replace(t, '^(please|so|um|uh|okay|ok|oh) ', '');
  t := regexp_replace(t, ' (please|thanks|thank you)$', '');
  select recipe_id, active_until into s from public.recipe_cook_session where id = 1;
  if s.active_until is not null and s.active_until > now() then
    v_voice := coalesce((select (value ->> 'voice')::boolean from public.recipe_settings where key = 'ha'), true);
    act := case
      when t ~ '^(go to the |go to )?next( step| one)?$' or t in ('continue', 'keep going') then 'next'
      when t ~ '^(go )?back( a step| one step| one)?$' or t ~ '^(go to the )?previous( step)?$' then 'back'
      when t in ('repeat', 'repeat that', 'say that again', 'read that again', 'read it again', 'read the step', 'what was that') then 'repeat'
      when t ~ '^start( the)? timer$' then 'start_timer'
      when t ~ '^(stop|cancel|clear)( the)? timer$' then 'stop_timer'
    end;
    if act is not null and v_voice then
      insert into public.recipe_commands (action, said) values (act, left(p_text, 200));
      return jsonb_build_object('handled', true, 'action', 'recipe_' || act, 'reply',
        case act when 'next' then 'Next step.' when 'back' then 'Going back.' when 'repeat' then 'Reading it again.'
                 when 'start_timer' then 'Starting the timer.' else 'Timer stopped.' end);
    end if;
  end if;
  return public.basil_voice_core(p_text);
end $$;
revoke all on function public.basil_voice(text) from public, anon, authenticated;
grant execute on function public.basil_voice(text) to service_role;

-- Minute job for kitchen timers (the page announces at 0:00; this catches a page that went to sleep).
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'basil-timers') then
    perform cron.schedule('basil-timers', '* * * * *', 'select public.recipe_timers_due()');
  end if;
exception when others then null;
end $$;

-- Photos: private bucket, admin only, same pattern as scout-files. recipes/<id>/... are cover photos; recipes/parse/... are snap-to-save shots.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recipe-photos', 'recipe-photos', false, 12582912, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do nothing;
do $$ begin
  create policy recipe_photos_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'recipe-photos' and public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy recipe_photos_select on storage.objects for select to authenticated
    using (bucket_id = 'recipe-photos' and public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy recipe_photos_delete on storage.objects for delete to authenticated
    using (bucket_id = 'recipe-photos' and public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;
