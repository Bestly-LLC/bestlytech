
-- Baseline = drivers already on the car when the invite was made, MINUS anyone who was a demo driver.
-- A demo phone that comes back (same Tesla account) must count as a new add.
create or replace function public.demo_key_baseline() returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(b), '[]'::jsonb)
  from demo_key d, jsonb_array_elements_text(coalesce(d.baseline,'[]'::jsonb)) b
  where d.id = 1 and b not in (select share_user_id from demo_key_drivers);
$$;

create or replace function public.demo_key_check(p_pass text default null) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare d demo_key; last demo_key_drivers;
begin
  if not demo_key_ok(p_pass) then return null; end if;
  select * into d from demo_key where id = 1;
  select * into last from demo_key_drivers where status = 'on' and accepted_at > now() - interval '15 minutes' order by accepted_at desc limit 1;
  if last.share_user_id is not null then
    return jsonb_build_object('state','added','name',last.name,'remove_at',last.remove_at);
  end if;
  if d.status = 'ready' and coalesce(d.last_check_at, 'epoch') < now() - interval '20 seconds'
     and demo_key_enqueue('key_check', jsonb_build_object('baseline', demo_key_baseline())) then
    update demo_key set last_check_at = now() where id = 1;
  end if;
  return jsonb_build_object('state', d.status);
end $function$;

create or replace function public.demo_key_apply() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare res jsonb := coalesce(new.result, '{}'::jsonb); inv jsonb; d demo_key; x jsonb; n int := 0; hit int;
begin
  if coalesce(new.args->>'demo','') <> 'true' or new.status not in ('done','failed') or old.status = new.status then return new; end if;
  select * into d from demo_key where id = 1;
  if new.status = 'failed' then
    if new.action = 'key_create' then
      update demo_key set status = 'failed', fails = fails + 1, last_error = left(coalesce(res->>'error','failed'),300), updated_at = now() where id = 1;
    elsif new.action = 'key_remove' then
      update demo_key_drivers set last_error = left(coalesce(res->>'error','failed'),300) where share_user_id in (select jsonb_array_elements_text(new.args->'only'));
    end if;
    return new;
  end if;
  if new.action = 'key_create' then
    inv := res->'invite';
    update demo_key set status = case when coalesce(inv->>'share_link', inv->>'link') is null then 'failed' else 'ready' end,
      invite_id = inv->>'id', share_link = coalesce(inv->>'share_link', inv->>'link'),
      invite_expires_at = coalesce((inv->>'expires_at')::timestamptz, now() + interval '24 hours'),
      baseline = coalesce(res->'driver_ids','[]'::jsonb), ready_at = now(), fails = 0,
      last_error = case when coalesce(inv->>'share_link', inv->>'link') is null then 'Tesla sent no link' end, updated_at = now() where id = 1;
  elsif new.action = 'key_check' then
    for x in select v from jsonb_array_elements(coalesce(res->'new_drivers','[]'::jsonb)) v loop
      continue when exists (select 1 from tesla_guest_keys where share_user_id = x->>'id')
                 or exists (select 1 from trip_extra_drivers where share_user_id = x->>'id')
                 or demo_key_guest_pending();
      insert into demo_key_drivers (share_user_id, name, remove_at) values (x->>'id', x->>'name', now() + make_interval(mins => d.keep_minutes))
        on conflict (share_user_id) do update set status = 'on', name = excluded.name, accepted_at = now(),
          remove_at = excluded.remove_at, removed_at = null, last_error = null
        where demo_key_drivers.status = 'removed';   -- a returning demo phone; one still 'on' is left alone
      get diagnostics hit = row_count;
      n := n + hit;
    end loop;
    if n > 0 then
      update demo_key set status = 'none', invite_id = null, share_link = null, invite_expires_at = null, updated_at = now() where id = 1;
      perform demo_key_enqueue('key_create');
      update demo_key set status = 'creating' where id = 1 and exists (select 1 from tesla_fleet_commands where args->>'demo'='true' and action='key_create' and status='queued');
      perform scout_notify('Demo key added', 'Someone added Blue Steel from the demo page. They''re removed automatically in ' || d.keep_minutes || ' min.', 'info', false, '/admin/turo/settings#demo-key', 'demo-key-add-' || to_char(now(),'YYYYMMDDHH24MI'));
    end if;
  elsif new.action = 'key_remove' then
    update demo_key_drivers set status = 'removed', removed_at = now(), last_error = null
     where share_user_id in (select jsonb_array_elements_text(new.args->'only'))
       and share_user_id not in (select s->>'id' from jsonb_array_elements(coalesce(res->'still_there','[]'::jsonb)) s);
    update demo_key_drivers set last_error = 'Still on the car after removal'
     where share_user_id in (select s->>'id' from jsonb_array_elements(coalesce(res->'still_there','[]'::jsonb)) s);
    if new.args->>'revoke_only' = 'true' then
      update demo_key set status = 'none', invite_id = null, share_link = null, invite_expires_at = null, updated_at = now() where id = 1;
    end if;
  end if;
  return new;
end $function$;

