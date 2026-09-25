-- Who actually did the thing on a trip page.
--
-- The host filter was entirely client-side: skip the browser that is signed in to the admin, has
-- opened the admin, or is on a ?demo link. Jared's iPhone Safari is none of those, so on 23 Sep he
-- sent two trip links 12 seconds apart and opened both within a minute — and both landed in the
-- log as the guest. Activity that cannot tell the host from the guest is worse than no activity,
-- because it reads as evidence.
--
-- The tell needs nothing from him: a guest can only ever see their own trip page. One browser
-- appearing on two different reservations is the host. This records a per-browser id, applies that
-- rule at write time and retroactively, and remembers the browser so it is never counted again.

alter table public.lax_guest_events
  add column if not exists device_id text,
  add column if not exists actor text not null default 'guest';

do $$ begin
  alter table public.lax_guest_events
    add constraint lax_guest_events_actor_check check (actor in ('guest','host','unsure'));
exception when duplicate_object then null; end $$;

create index if not exists lax_guest_events_device_id_idx on public.lax_guest_events (device_id) where device_id is not null;

create table if not exists public.lax_host_devices (
  device_id  text primary key,
  reason     text not null,
  first_seen timestamptz not null default now(),
  events     int not null default 0
);
comment on table public.lax_host_devices is
  'Browsers known to be the host''s. Learned, not configured: once a browser is seen on two different trip pages it is here for good, and its events never count as the guest again.';

drop function if exists public.lax_track(text, text, jsonb, text);

create or replace function public.lax_track(
  p_token text, p_kind text, p_detail jsonb default null, p_device text default null, p_device_id text default null)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare l lax_guest_links; n int; v_actor text := 'guest'; v_id text := left(p_device_id, 40);
begin
  if p_kind not in ('view','key_tap','have_app','video','directions','spot','call','email','ask','climate','honk','flash','unlock','guide','turo_app','app_link','reminder_click','error','driver_open','driver_share','carousel_misaligned','car_wash_send','car_wash_directions','next_charging') then return; end if;
  select * into l from lax_guest_links where token = p_token;
  if l.reservation_id is null then return; end if;

  -- Known host browser, or this browser has already been on someone else's trip page.
  if v_id is not null then
    if exists (select 1 from lax_host_devices where device_id = v_id) then
      v_actor := 'host';
    elsif exists (select 1 from lax_guest_events where device_id = v_id and reservation_id <> l.reservation_id and reservation_id > 0) then
      v_actor := 'host';
      insert into lax_host_devices (device_id, reason) values (v_id, 'seen on more than one trip page')
        on conflict (device_id) do nothing;
      update lax_guest_events set actor = 'host' where device_id = v_id and actor <> 'host';
    end if;
  end if;

  if p_kind = 'view' and exists (select 1 from lax_guest_events where reservation_id = l.reservation_id and kind = 'view'
      and coalesce(device,'') = coalesce(left(p_device, 60),'') and at > now() - interval '10 minutes') then return; end if;
  select count(*) into n from lax_guest_events where reservation_id = l.reservation_id and at > now() - interval '1 day';
  if n >= 300 then return; end if;

  -- Only a real guest's first visit is worth a push.
  if p_kind = 'view' and v_actor = 'guest'
     and not exists (select 1 from lax_guest_events where reservation_id = l.reservation_id and actor = 'guest') then
    perform scout_notify(coalesce((select guest_first from turo_trips where reservation_id = l.reservation_id), 'Your guest') || ' opened their trip page',
      'First visit, on ' || coalesce(left(p_device, 60), 'a phone') || '.', 'info', false, '/admin/turo/lax-pass#keys', 'guest-first-view-' || l.reservation_id);
  end if;

  insert into lax_guest_events (reservation_id, kind, detail, device, device_id, actor)
  values (l.reservation_id, p_kind, p_detail, left(p_device, 60), v_id, v_actor);
end $function$;

grant execute on function public.lax_track(text, text, jsonb, text, text) to anon, authenticated;
