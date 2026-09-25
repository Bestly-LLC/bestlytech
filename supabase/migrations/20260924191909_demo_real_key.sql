
create table if not exists demo_key (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  pass text not null default replace(gen_random_uuid()::text, '-', ''),
  keep_minutes int not null default 120,
  status text not null default 'none',          -- none | creating | ready | failed
  invite_id text, share_link text, invite_expires_at timestamptz, baseline jsonb,
  ready_at timestamptz, last_error text, fails int not null default 0,
  last_view_at timestamptz, last_check_at timestamptz, updated_at timestamptz not null default now()
);
insert into demo_key (id) values (1) on conflict do nothing;
create table if not exists demo_key_drivers (
  share_user_id text primary key, name text, accepted_at timestamptz not null default now(),
  remove_at timestamptz not null, removed_at timestamptz, status text not null default 'on', last_error text
);
alter table demo_key enable row level security;
alter table demo_key_drivers enable row level security;

create or replace function demo_key_busy() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tesla_fleet_commands where args->>'demo' = 'true' and status in ('queued','running') and created_at > now() - interval '15 minutes');
$$;

create or replace function demo_key_enqueue(p_action text, p_args jsonb default '{}') returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if demo_key_busy() then return false; end if;
  insert into tesla_fleet_commands (reservation_id, action, args) values (null, p_action, p_args || '{"demo":true}'::jsonb);
  return true;
end $$;

create or replace function demo_key_ok(p_pass text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(has_role(auth.uid(), 'admin'), false)
      or (p_pass is not null and length(p_pass) >= 16 and exists (select 1 from demo_key where pass = p_pass));
$$;

-- Demo page asks for the real key. Admin or host link only; everyone else gets nothing (fake demo flow).
create or replace function demo_key_get(p_pass text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d demo_key; fs tesla_fleet_settings;
begin
  if not demo_key_ok(p_pass) then return null; end if;
  select * into d from demo_key where id = 1;
  if not d.enabled then return jsonb_build_object('state','off'); end if;
  select * into fs from tesla_fleet_settings where id = 1;
  update demo_key set last_view_at = now() where id = 1;
  if d.status = 'ready' and d.invite_expires_at < now() + interval '10 minutes' then
    update demo_key set status = 'none', updated_at = now() where id = 1; d.status := 'none';
  end if;
  if d.status in ('none') or (d.status = 'failed' and d.updated_at < now() - interval '2 minutes') then
    if fs.connected_at is not null and demo_key_enqueue('key_create') then
      update demo_key set status = 'creating', updated_at = now() where id = 1; d.status := 'creating';
    end if;
  end if;
  return jsonb_build_object('state', d.status, 'link', case when d.status = 'ready' then d.share_link end,
    'keep_minutes', d.keep_minutes, 'expires_at', d.invite_expires_at, 'error', case when d.status = 'failed' then d.last_error end);
end $$;

-- Demo page polls after the tap: asks Tesla (at most every 30s) whether someone accepted.
create or replace function demo_key_check(p_pass text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d demo_key; last demo_key_drivers;
begin
  if not demo_key_ok(p_pass) then return null; end if;
  select * into d from demo_key where id = 1;
  select * into last from demo_key_drivers where accepted_at > now() - interval '15 minutes' order by accepted_at desc limit 1;
  if last.share_user_id is not null then
    return jsonb_build_object('state','added','name',last.name,'remove_at',last.remove_at);
  end if;
  if d.status = 'ready' and coalesce(d.last_check_at, 'epoch') < now() - interval '30 seconds'
     and demo_key_enqueue('key_check', jsonb_build_object('baseline', coalesce(d.baseline, '[]'::jsonb))) then
    update demo_key set last_check_at = now() where id = 1;
  end if;
  return jsonb_build_object('state', d.status);
end $$;

-- Worker results for demo jobs.
create or replace function demo_key_apply() returns trigger
language plpgsql security definer set search_path = public as $$
declare res jsonb := coalesce(new.result, '{}'::jsonb); inv jsonb; d demo_key; x jsonb; n int := 0;
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
      -- Never claim a Turo guest's or extra driver's key as a demo driver.
      continue when exists (select 1 from tesla_guest_keys where share_user_id = x->>'id')
                 or exists (select 1 from trip_extra_drivers where share_user_id = x->>'id')
                 or exists (select 1 from tesla_guest_keys g where g.status = 'ready' and g.baseline_drivers is not null and not (g.baseline_drivers ? (x->>'id'))
                              and exists (select 1 from turo_trips t where t.reservation_id = g.reservation_id and now() between t.starts_at - interval '3 hours' and t.ends_at)
                              and d.ready_at < g.ready_at);
      insert into demo_key_drivers (share_user_id, name, remove_at) values (x->>'id', x->>'name', now() + make_interval(mins => d.keep_minutes))
        on conflict (share_user_id) do nothing;
      n := n + 1;
    end loop;
    if n > 0 then
      -- The invite is used up: make a fresh one for the next demo.
      update demo_key set status = 'none', invite_id = null, share_link = null, invite_expires_at = null, updated_at = now() where id = 1;
      perform demo_key_enqueue('key_create') ; -- busy guard may skip; the tick retries
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
end $$;
drop trigger if exists demo_key_apply on tesla_fleet_commands;
create trigger demo_key_apply after update of status on tesla_fleet_commands for each row execute function demo_key_apply();

