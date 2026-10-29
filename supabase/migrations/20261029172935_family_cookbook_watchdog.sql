-- Family Cookbook, part 10: Basil's family watchdog and the daily purge trigger.
-- basil_family_watchdog() is called from basil_recipes_watchdog() (part 11) every hour and returns { healed, problems }.
create or replace function public.family_maint_tick()
returns bigint language sql security definer set search_path = public, pg_temp as $$
  select public.invoke_edge_function('family-maint', jsonb_build_object('op', 'daily'), 5000)
$$;

create or replace function public.basil_family_watchdog()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  healed text[] := '{}'; problems text[] := '{}'; c record; n int; f int; o int; ps jsonb; last_purge timestamptz;
begin
  -- 1. Cards stuck in "reading": retry twice, then the small paid reader (inside the cap), then the check queue
  begin
    ps := public.family_paid_state();
    for c in select * from public.family_captures where status = 'reading' and updated_at < now() - interval '4 minutes' loop
      if c.attempts < 2 then
        update public.family_captures set attempts = attempts + 1, updated_at = now() where id = c.id;
        perform public.invoke_edge_function('recipe-parse', jsonb_build_object('capture_id', c.id, 'force', true), 5000);
        healed := healed || 'retried a family card that was stuck'::text;
      elsif c.attempts = 2 and coalesce((ps ->> 'ok')::boolean, false) and not c.paid_used then
        update public.family_captures set attempts = 3, updated_at = now() where id = c.id;
        perform public.invoke_edge_function('recipe-parse', jsonb_build_object('capture_id', c.id, 'force', true, 'paid', true), 5000);
        healed := healed || 'sent a hard-to-read family card to the small paid reader'::text;
      elsif c.draft is not null then
        update public.family_captures set status = 'ready', lowconf = true, error = null, updated_at = now() where id = c.id;
        healed := healed || 'moved a family card to the check queue after the readers timed out'::text;
      else
        update public.family_captures set status = 'failed', updated_at = now(),
               error = 'We could not read this one. Take the photo again with more light.' where id = c.id;
        healed := healed || 'marked a family card that could not be read so it can be retaken'::text;
      end if;
    end loop;
    select count(*) into n from public.family_captures where status = 'failed' and updated_at > now() - interval '2 hours';
    if n > 0 then
      problems := problems || (n || ' family card(s) could not be read')::text;
      perform public.bestly_raise('kitchen.family-read', 'problem', 'warning', 'Basil could not read a family recipe card',
        n || ' card(s) failed after a retry and the paid backup. The family member can retake the photo from the app.', 'home', null, false);
    else
      perform public.bestly_raise('kitchen.family-read', 'resolved');
    end if;
  exception when others then problems := problems || ('family card reads: ' || sqlerrm);
  end;

  -- 2. Sign-in: the Bestly Cloud code exchange keeps failing and nobody has got through
  begin
    select count(*) filter (where not ok and stage in ('discovery', 'token', 'userinfo')), count(*) filter (where ok and stage = 'session')
      into f, o from public.family_auth_log where at > now() - interval '2 hours';
    if f >= 2 and o = 0 then
      problems := problems || 'family cookbook sign-in is failing'::text;
      perform public.bestly_raise('kitchen.family-oauth', 'problem', 'warning', 'Family Cookbook sign-in is failing',
        f || ' sign-in attempts failed at the Bestly Cloud step in the last 2 hours and none got through. Check the sign-in app on cloud.bestly.tech.', 'home', null, false);
    else
      perform public.bestly_raise('kitchen.family-oauth', 'resolved');
    end if;
  exception when others then problems := problems || ('family sign-in check: ' || sqlerrm);
  end;

  -- 3. Photos that have not reached Bestly Cloud Files yet (they are safe in the private bucket meanwhile)
  begin
    select count(*) into n from public.family_photos where nc_synced_at is null and nc_tries < 3 and created_at < now() - interval '20 minutes';
    if n > 0 then
      perform public.invoke_edge_function('family-maint', jsonb_build_object('op', 'nc_sync'), 5000);
      healed := healed || ('asked Bestly Cloud to take ' || n || ' family photo(s) again');
    end if;
    select count(*) into n from public.family_photos where nc_synced_at is null and nc_tries >= 3 and created_at < now() - interval '2 hours';
    if n > 0 then
      problems := problems || (n || ' family photo(s) are not in Bestly Cloud Files')::text;
      perform public.bestly_raise('kitchen.family-photos', 'problem', 'warning', 'Family photos did not reach Bestly Cloud Files',
        n || ' original card photo(s) failed to upload three times. They are safe in the private store and the app still shows them.', 'home', null, false);
    else
      perform public.bestly_raise('kitchen.family-photos', 'resolved');
    end if;
  exception when others then problems := problems || ('family photo sync: ' || sqlerrm);
  end;

  -- 4. The daily purge of Recently Deleted (30 days)
  begin
    if not exists (select 1 from cron.job where jobname = 'basil-family-purge') then
      perform cron.schedule('basil-family-purge', '23 10 * * *', 'select public.family_maint_tick()');
      healed := healed || 're-created the Family Cookbook purge schedule'::text;
    elsif exists (select 1 from cron.job where jobname = 'basil-family-purge' and not active) then
      perform cron.alter_job((select jobid from cron.job where jobname = 'basil-family-purge'), active := true);
      healed := healed || 'turned the Family Cookbook purge schedule back on'::text;
    end if;
    select max(at) into last_purge from public.family_purge_log where ok;
    if last_purge is null or last_purge < now() - interval '36 hours' then
      perform public.family_maint_tick();
      healed := healed || 'ran the Family Cookbook purge the daily schedule missed'::text;
    end if;
    if last_purge is not null and last_purge < now() - interval '72 hours' then
      problems := problems || 'the Family Cookbook purge has not finished in 3 days'::text;
      perform public.bestly_raise('kitchen.family-purge', 'problem', 'warning', 'Family Cookbook purge is not finishing',
        'Recently Deleted recipes older than 30 days are not being removed. Last good run: ' || last_purge::text, 'home', null, false);
    else
      perform public.bestly_raise('kitchen.family-purge', 'resolved');
    end if;
  exception when others then problems := problems || ('family purge check: ' || sqlerrm);
  end;

  -- 5. Paid reader cap: a quiet note in the recap, never a push
  begin
    ps := public.family_paid_state();
    if coalesce((ps ->> 'on')::boolean, false) and not coalesce((ps ->> 'ok')::boolean, true) then
      insert into public.admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key, silent, agent_slug)
      values ('family', 'Basil: the Family Cookbook paid reader hit its monthly cap',
              'Spent $' || (ps ->> 'spent') || ' of $' || (ps ->> 'cap') || ' for ' || (ps ->> 'month') || '. Cards the free readers cannot read now go to the check queue until next month.',
              '/admin/home-hub/kitchen', 'family:cap', 'info', 'family-cap:' || (ps ->> 'month'), true, 'basil')
      on conflict (dedupe_key) do nothing;
    end if;
  exception when others then problems := problems || ('family paid cap: ' || sqlerrm);
  end;

  return jsonb_build_object('healed', to_jsonb(healed), 'problems', to_jsonb(problems));
end $$;

revoke all on function public.family_maint_tick(), public.basil_family_watchdog() from public, anon, authenticated;
grant execute on function public.family_maint_tick(), public.basil_family_watchdog() to service_role;
