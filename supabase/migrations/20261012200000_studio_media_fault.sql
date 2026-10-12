-- A post video that will not play must tell someone, once, quietly (Jared 2026-10-12: Bestly Cloud videos "won't load").
-- Studio and the client board now catch a failed <video> (error, or no data ~8 s after play), retry once with a
-- cache-busting query, and on a final failure show the person an inline "won't play" state. This is the other half:
-- the browser reports the final failure here. Signed Spark (she owns Studio). Never pushes: a video failure is a bell
-- and recap item, not an interruption.
--
-- studio_media_fault(p_token, p_item, p_url, p_code, p_ua)
--   token : a Studio staff session OR a client board session (either may be the one watching)
--   logs  : studio_media_faults, at most one row per person per file per 30 minutes
--   alert : one bestly_raise per item (or per url when no item) per Los Angeles day, severity info, healed=true (no push)
-- studio_media_fault_tidy() (cron studio-media-fault-tidy, 8:40 AM UTC): yesterday's studio.media.* issues close
--   themselves; a video that still fails raises again today.
create table if not exists public.studio_media_faults (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  who        text,
  item       uuid,
  url        text,
  code       text,
  ua         text
);
alter table public.studio_media_faults enable row level security;
create index if not exists studio_media_faults_at on public.studio_media_faults (at desc);

insert into public.notification_owners (prefix, agent_slug, note)
values ('studio.media', 'spark', 'Post videos that will not play (Studio and the client board); bell only, never a push')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;

create or replace function public.studio_media_fault(p_token text, p_item uuid, p_url text, p_code text, p_ua text)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  s public.studio_caller; c public.approval_caller; v_who text; v_title text; v_slug text; v_key text; v_new boolean;
  v_today text := to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD');
  v_url text := left(coalesce(p_url, ''), 600);
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is not null then v_who := 'staff:' || coalesce(s.slug, s.name);
  else
    c := public.approval_resolve_client(p_token);
    if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_who := 'client:' || c.id::text;
  end if;
  if v_url = '' then return jsonb_build_object('ok', false, 'error', 'no_url'); end if;
  -- the table cannot be flooded: one row per person per file per 30 minutes
  if not exists (select 1 from studio_media_faults where who = v_who and url = v_url and at > now() - interval '30 minutes') then
    insert into studio_media_faults (who, item, url, code, ua) values (v_who, p_item, v_url, left(p_code, 60), left(p_ua, 300));
  end if;
  if p_item is not null then
    select coalesce(i.title, 'a post'), cl.slug into v_title, v_slug
      from approval_items i left join approval_clients cl on cl.id = i.client_id where i.id = p_item;
  end if;
  v_key := 'studio.media.' || coalesce(p_item::text, md5(v_url)) || '.' || v_today;
  v_new := not exists (select 1 from monitor_issues where key = v_key);
  if v_new then
    perform bestly_raise(v_key, 'problem', 'info',
      'A video will not play' || coalesce(': ' || left(v_title, 60), ''),
      'The browser could not play ' || coalesce(nullif(v_title, ''), 'a video') || coalesce(' (' || v_slug || ')', '') || ' in Studio (' || coalesce(nullif(left(p_code, 60), ''), 'no code') || '). It was retried once and the person was shown a Retry button and a link to the file. File: ' || v_url,
      'studio', null, true);   -- p_healed = true: bell only, no push
  end if;
  return jsonb_build_object('ok', true, 'raised', v_new);
end $f$;

revoke all on function public.studio_media_fault(text, uuid, text, text, text) from public;
grant execute on function public.studio_media_fault(text, uuid, text, text, text) to anon, authenticated, service_role;

create or replace function public.studio_media_fault_tidy() returns void language plpgsql security definer set search_path to 'public' as $f$
declare k text; v_today text := to_char(now() at time zone 'America/Los_Angeles', 'YYYYMMDD');
begin
  for k in select key from monitor_issues where key like 'studio.media.%' and status = 'open' and key not like '%.' || v_today loop
    perform bestly_raise(k, 'resolved', 'info', 'Video report closed', 'Yesterday''s report closed itself; a video that still fails raises again.', 'studio', null, true);
  end loop;
end $f$;
revoke all on function public.studio_media_fault_tidy() from public, anon, authenticated;
grant execute on function public.studio_media_fault_tidy() to service_role;

select cron.schedule('studio-media-fault-tidy', '40 8 * * *', 'select public.studio_media_fault_tidy()');

-- The browser calls studio_media_fault with the publishable key (token-gated), so it is also listed here, or Ares's
-- Auto-Fixer locks it within the hour.
insert into public.security_public_rpcs (fn, why) values
  ('studio_media_fault', 'Studio and the client board report a post video that will not play (publishable key + a staff or client session token); token-gated, logs and raises one bell-only Spark alert per item per day')
on conflict (fn) do nothing;
