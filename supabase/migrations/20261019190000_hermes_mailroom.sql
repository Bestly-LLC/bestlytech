-- Hermes, Mail Clerk: Bestly's physical mail at the iPostal1 virtual mailbox (2026-10-19, Jared).
-- One file: tables + RLS + approval guard, helpers, RPCs, Needs you rows, interrupt rule, watchdog, Team card.
--
-- Autonomy: "sort free, ask to spend". Hermes reads, names, labels, files and logs on its own. Every PAID iPostal1 action (open and
-- scan, shred, forward, recycle, check deposit, package handling) is a row in hermes_actions that starts as 'proposed' and can only
-- become 'approved' through hermes_action_decide() called by a signed-in admin (the tap). The guard trigger below refuses every other
-- path, including the service key the Pi holds.
-- Privacy: no person's email address or phone is stored here (only the sender DOMAIN of an alert, and company names read from
-- envelopes), so there is nothing for privacy_data_map to map. The login lives only in Vault (pi:ipostal1_login).

create table if not exists public.hermes_state (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  cred_state text not null default 'missing' check (cred_state in ('missing','saved','working','rejected','trouble')),
  cred_saved_at timestamptz,
  cred_note text,
  last_login_ok_at timestamptz,
  last_login_fail_at timestamptz,
  guard_beat_at timestamptz,
  guard_moved_run bigint not null default 0, -- messages moved since the guard service last started
  last_poll_at timestamptz,
  last_note text,
  baseline_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.hermes_state (id) values (true) on conflict do nothing;

create table if not exists public.hermes_items (
  id uuid primary key default gen_random_uuid(),
  msg_id text not null unique,
  mailbox_uid bigint,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  from_domain text,
  subject text,
  event text not null default 'other' check (event in ('arrived','package','payment','security','receipt','account','other','unverified')),
  mail_type text check (mail_type in ('bill','check','government','bank','legal','junk','package','other')),
  label text,
  sender text,
  summary text,
  amount_cents integer,
  due_date date,
  has_image boolean not null default false,
  verified boolean not null default false,
  confidence numeric,
  ai text,
  item_ref text,
  priority boolean not null default false,
  status text not null default 'filed' check (status in ('filed','asked','acted','ignored')),
  is_test boolean not null default false,
  details jsonb not null default '{}'::jsonb
);
create index if not exists hermes_items_received_idx on public.hermes_items (received_at desc);

create table if not exists public.hermes_actions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.hermes_items(id) on delete cascade,
  action text not null check (action in ('scan','shred','forward','recycle','deposit_check','package')),
  reason text,
  est_cost text,
  priority boolean not null default false,
  bundle text,
  status text not null default 'proposed' check (status in ('proposed','approved','declined','running','done','failed','expired')),
  proposed_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  started_at timestamptz,
  finished_at timestamptz,
  lease_until timestamptz,
  attempts integer not null default 0,
  result jsonb,
  error text
);
create unique index if not exists hermes_actions_one_open on public.hermes_actions (item_id, action) where status in ('proposed','approved','running');
create index if not exists hermes_actions_status_idx on public.hermes_actions (status, proposed_at);

create table if not exists public.hermes_logins (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  purpose text not null check (purpose in ('view','action')),
  action_id uuid,
  ok boolean not null,
  egress_ip text,
  session_tag text,
  note text
);
create index if not exists hermes_logins_at_idx on public.hermes_logins (at desc);

alter table public.hermes_state enable row level security;
alter table public.hermes_items enable row level security;
alter table public.hermes_actions enable row level security;
alter table public.hermes_logins enable row level security;

revoke all on public.hermes_state, public.hermes_items, public.hermes_actions, public.hermes_logins from anon, authenticated;
grant select on public.hermes_state, public.hermes_items, public.hermes_actions, public.hermes_logins to authenticated;

create policy hermes_state_admin_read on public.hermes_state for select to authenticated using (public.team_is_admin());
create policy hermes_items_admin_read on public.hermes_items for select to authenticated using (public.team_is_admin());
create policy hermes_actions_admin_read on public.hermes_actions for select to authenticated using (public.team_is_admin());
create policy hermes_logins_admin_read on public.hermes_logins for select to authenticated using (public.team_is_admin());

-- The tap. A paid action becomes 'approved' ONLY inside hermes_action_decide() for a signed-in admin. Nothing else, not even the
-- Pi's service key, can do it. It also only runs after approval, and only moves forward.
create or replace function public.hermes_actions_guard() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'proposed' then raise exception 'a paid iPostal1 action always starts as proposed'; end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      if old.status = 'running' and coalesce(current_setting('hermes.retry', true), '') = 'ok' then
        null; -- the runner puts back an action whose click never happened (login or screen problem); same approval stands
      elsif old.status = 'proposed' and coalesce(current_setting('hermes.tap', true), '') = 'ok'
            and auth.uid() is not null and coalesce(public.has_role(auth.uid(), 'admin'::app_role), false) then
        new.decided_by := auth.uid(); new.decided_at := now();
      else
        raise exception 'a paid iPostal1 action needs Jared''s tap in Needs you';
      end if;
    elsif new.status = 'running' then
      if old.status <> 'approved' or old.decided_by is null then raise exception 'only an approved action can run'; end if;
    elsif new.status = 'declined' then
      if old.status <> 'proposed' then raise exception 'only a proposed action can be declined'; end if;
      new.decided_at := now(); new.decided_by := coalesce(auth.uid(), old.decided_by);
    elsif new.status in ('done') and old.status <> 'running' then
      raise exception 'only a running action can finish';
    end if;
  end if;
  new.decided_by := case when old.decided_by is not null then old.decided_by else new.decided_by end;
  return new;
end $$;
create or replace trigger hermes_actions_guard_trg before insert or update on public.hermes_actions
  for each row execute function public.hermes_actions_guard();

-- helpers ---------------------------------------------------------------------------------------------------------------
create or replace function public.hermes_name(t text, n int default 40) returns text
language sql immutable set search_path to 'public' as $$
  select coalesce(nullif(btrim(left(regexp_replace(coalesce(t, ''), '[^A-Za-z0-9&.,''\- ]+', ' ', 'g'), n)), ''), 'an unknown sender')
$$;

create or replace function public.hermes_ask_title(p_type text, p_action text, p_sender text) returns text
language sql immutable set search_path to 'public' as $$
  select case
    when p_action = 'deposit_check' then 'Hermes: Check from ' || p_sender || '. OK to deposit?'
    when p_type = 'bill' then 'Hermes: Bill from ' || p_sender || '. OK to open and scan?'
    when p_type = 'bank' then 'Hermes: Bank letter from ' || p_sender || '. OK to open and scan?'
    when p_type = 'government' then 'Hermes: Government notice from ' || p_sender || '. OK to open and scan?'
    when p_type = 'legal' then 'Hermes: Legal notice from ' || p_sender || '. OK to open and scan?'
    when p_action = 'package' then 'Hermes: Package from ' || p_sender || '. OK to handle it?'
    when p_action = 'recycle' then 'Hermes: Junk from ' || p_sender || '. OK to recycle?'
    else 'Hermes: Letter from ' || p_sender || '. OK to open and scan?' end
$$;

-- one notification, signed Hermes (or Ares for security). Push only when the title is one of the interrupt kinds (see interrupt_class).
create or replace function public.hermes_alert(p_tag text, p_title text, p_body text, p_url text, p_mark_read boolean default false)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.notify_route(left(p_title, 180), left(coalesce(p_body, ''), 400), 'time-sensitive',
                              case when p_title like 'Ares:%' then 'Ares' else 'Hermes' end,
                              case when coalesce(p_url, '') like '/%' then 'https://bestly.tech' || p_url else coalesce(nullif(p_url, ''), 'https://bestly.tech/admin') end,
                              null, p_tag, null, null, false, now());
  if p_mark_read then
    update public.admin_notifications set read_at = now() where dedupe_key = p_tag and read_at is null;
  end if;
exception when others then
  raise warning 'hermes_alert failed: %', sqlerrm;
end $$;

-- finished work: a silent success row, which the 7 PM recap groups under the employee ("Hermes: 3 done (...)")
create or replace function public.hermes_done(p_tag text, p_title text, p_body text default null, p_agent text default 'hermes')
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.admin_notifications (kind, title, body, url, severity, dedupe_key, silent, agent_slug)
  values ('hermes', left(p_title, 200), left(coalesce(p_body, ''), 500), '/admin/team', 'success', p_tag, true, p_agent)
  on conflict (dedupe_key) do nothing;
exception when others then
  raise warning 'hermes_done failed: %', sqlerrm;
end $$;

revoke all on function public.hermes_alert(text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.hermes_done(text, text, text, text) from public, anon, authenticated;
grant execute on function public.hermes_alert(text, text, text, text, boolean) to service_role;
grant execute on function public.hermes_done(text, text, text, text) to service_role;

