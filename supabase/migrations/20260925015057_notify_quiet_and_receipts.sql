-- Two things, both about noise.
--
-- 1. Receipts. Of the unread scout notes, nearly all are "Done on the Mac mini: …",
--    "Checked: …" or "X is working again" — things that already happened and need nothing.
--    They ring, push and sit unread forever. They now land in the list silently: no sound, no
--    toast, no push, and they do not count toward the badge.
--
-- 2. Do Not Disturb. A browser cannot read macOS Focus — there is no web API for it — but a Web
--    Push that arrives while the Mac is in Focus is already suppressed by macOS itself. What was
--    missing is Bestly's own quiet: skip sending at all, and stop the in-app toast and sound.

create table if not exists public.admin_notify_prefs (
  id             smallint primary key default 1 check (id = 1),
  dnd_until      timestamptz,
  quiet_on       boolean not null default false,
  quiet_start    time    not null default '22:00',
  quiet_end      time    not null default '08:00',
  urgent_through boolean not null default true,
  sound_on       boolean not null default true,
  updated_at     timestamptz not null default now()
);
insert into public.admin_notify_prefs (id) values (1) on conflict (id) do nothing;

alter table public.admin_notify_prefs enable row level security;
drop policy if exists "notify prefs: admin" on public.admin_notify_prefs;
create policy "notify prefs: admin" on public.admin_notify_prefs for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

alter table public.admin_notifications add column if not exists silent boolean not null default false;
comment on column public.admin_notifications.silent is
  'A receipt: something that already happened and needs nothing. Listed, but no sound, toast, push or badge.';

create or replace function public.notify_quiet_now()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare p public.admin_notify_prefs; t time; wraps boolean;
begin
  select * into p from public.admin_notify_prefs where id = 1;
  if p.id is null then return jsonb_build_object('quiet', false); end if;
  if p.dnd_until is not null and p.dnd_until > now() then
    return jsonb_build_object('quiet', true, 'why', 'dnd', 'until', p.dnd_until, 'urgent_through', p.urgent_through);
  end if;
  if p.quiet_on then
    t := (now() at time zone 'America/Los_Angeles')::time;
    wraps := p.quiet_start > p.quiet_end;
    if (not wraps and t >= p.quiet_start and t < p.quiet_end)
       or (wraps and (t >= p.quiet_start or t < p.quiet_end)) then
      return jsonb_build_object('quiet', true, 'why', 'quiet_hours', 'until', p.quiet_end, 'urgent_through', p.urgent_through);
    end if;
  end if;
  return jsonb_build_object('quiet', false, 'urgent_through', p.urgent_through);
end $$;

create or replace function public.admin_notifications_classify()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if new.silent is not true then
    new.silent :=
      new.severity = 'success'
      or new.title ~* '^(done on the mac mini|checked)\s*:'
      or new.title ~* '(is working again|working again)$'
      or new.title ~* '^fixed\s*:';
  end if;
  return new;
end $$;

drop trigger if exists admin_notifications_classify on public.admin_notifications;
create trigger admin_notifications_classify before insert on public.admin_notifications
  for each row execute function public.admin_notifications_classify();

update public.admin_notifications
   set silent = true
 where silent = false
   and (severity = 'success'
        or title ~* '^(done on the mac mini|checked)\s*:'
        or title ~* '(is working again|working again)$'
        or title ~* '^fixed\s*:');
update public.admin_notifications set read_at = now()
 where silent = true and read_at is null and created_at < now() - interval '1 hour';
