-- Bestly Labs + "For our next call" agenda in the partner portal (Jared, 2026-10-10).
--
-- labs_items      New tech Jared wants Eli to remember and help bring to market (Ajax, JEV,
--                 projection mapping...). Every partner can read; only the admin writes.
-- partner_agenda  Things to discuss on the next call with a partner. Jared adds for any partner,
--                 a partner adds for their own call. Either side ticks "Discussed" or removes
--                 (soft: status 'removed', so Undo works). Nothing is ever hard-deleted here.
--
-- Writes go through SECURITY DEFINER RPCs for signed-in users only (no anon), so Ares's
-- Auto-Fixer has nothing to lock and nothing is added to security_public_rpcs.

create table if not exists public.labs_items (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 1 and 80),
  tagline     text not null default '' check (length(tagline) <= 160),
  detail      text not null default '' check (length(detail) <= 4000),
  stage       text not null default 'idea' check (stage in ('idea', 'testing', 'building', 'ready')),
  links       jsonb not null default '[]'::jsonb check (jsonb_typeof(links) = 'array'),
  sort        int not null default 100,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.partner_agenda (
  id            uuid primary key default gen_random_uuid(),
  roster        text not null,
  title         text not null check (length(btrim(title)) between 1 and 200),
  note          text not null default '' check (length(note) <= 1000),
  labs_id       uuid references public.labs_items(id) on delete set null,
  added_by      text not null,
  status        text not null default 'open' check (status in ('open', 'discussed', 'removed')),
  sort          int not null default 100,
  created_at    timestamptz not null default now(),
  discussed_at  timestamptz
);
create index if not exists partner_agenda_roster_idx on public.partner_agenda (roster, status, sort, created_at);

alter table public.labs_items enable row level security;
alter table public.partner_agenda enable row level security;

drop policy if exists labs_items_read on public.labs_items;
create policy labs_items_read on public.labs_items for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role) or public.partner_roster_name() is not null);

drop policy if exists partner_agenda_read on public.partner_agenda;
create policy partner_agenda_read on public.partner_agenda for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role) or roster = public.partner_roster_name());

revoke all on public.labs_items, public.partner_agenda from anon;
grant select on public.labs_items, public.partner_agenda to authenticated;

/* ───── Labs: admin writes ───── */

create or replace function public.labs_save(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not public.has_role(auth.uid(), 'admin'::app_role) then raise exception 'Only Jared can edit Bestly Labs'; end if;
  if v_id is null then
    insert into public.labs_items (name, tagline, detail, stage, links, sort)
    values (btrim(p->>'name'), coalesce(p->>'tagline', ''), coalesce(p->>'detail', ''),
            coalesce(nullif(p->>'stage', ''), 'idea'), coalesce(p->'links', '[]'::jsonb),
            coalesce((p->>'sort')::int, 100))
    returning id into v_id;
  else
    update public.labs_items set
      name    = coalesce(btrim(p->>'name'), name),
      tagline = coalesce(p->>'tagline', tagline),
      detail  = coalesce(p->>'detail', detail),
      stage   = coalesce(nullif(p->>'stage', ''), stage),
      links   = coalesce(p->'links', links),
      sort    = coalesce((p->>'sort')::int, sort),
      active  = coalesce((p->>'active')::boolean, active),
      updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;

/* ───── Agenda: Jared for anyone, a partner for their own call ───── */

create or replace function public.partner_agenda_add(p_title text, p_note text default '', p_roster text default null, p_labs_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_me text := public.partner_roster_name();
  v_roster text;
  v_id uuid;
begin
  if v_admin then
    v_roster := lower(coalesce(nullif(btrim(p_roster), ''), v_me));
    if v_roster is null or not exists (select 1 from public.partners where roster_name = v_roster) then
      raise exception 'Pick which partner this is for';
    end if;
  elsif v_me is not null then
    v_roster := v_me;
  else
    raise exception 'Not a partner';
  end if;
  insert into public.partner_agenda (roster, title, note, labs_id, added_by)
  values (v_roster, btrim(p_title), coalesce(btrim(p_note), ''), p_labs_id, coalesce(v_me, 'jared'))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.partner_agenda_set(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('open', 'discussed', 'removed') then raise exception 'Unknown status'; end if;
  update public.partner_agenda
     set status = p_status,
         discussed_at = case when p_status = 'discussed' then now() else null end
   where id = p_id
     and (public.has_role(auth.uid(), 'admin'::app_role) or roster = public.partner_roster_name());
  if not found then raise exception 'Agenda item not found'; end if;
end $$;

revoke all on function public.labs_save(jsonb) from public, anon;
revoke all on function public.partner_agenda_add(text, text, text, uuid) from public, anon;
revoke all on function public.partner_agenda_set(uuid, text) from public, anon;
grant execute on function public.labs_save(jsonb) to authenticated;
grant execute on function public.partner_agenda_add(text, text, text, uuid) to authenticated;
grant execute on function public.partner_agenda_set(uuid, text) to authenticated;

/* ───── Seed: what Jared named on 2026-10-10 ───── */

insert into public.labs_items (name, tagline, detail, stage, sort)
select * from (values
  ('Projection mapping', 'Turn any wall, cake or stage into a moving picture, using one small projector.',
   'Jared already runs it at home: a pocket projector paints a live wall display (clock, alerts, a sky map of planes and traffic) onto the strip above his desk, driven by our own software instead of a pricey app.' || E'\n\n' ||
   'Where it could go: a mobile projection service for weddings (cake projections), graduations, parties, festivals and gender reveals, and the mapping app itself for other small operators.',
   'testing', 10),
  ('Ajax', '', '', 'idea', 20),
  ('JEV', '', '', 'idea', 30)
) as s(name, tagline, detail, stage, sort)
where not exists (select 1 from public.labs_items l where l.name = s.name);

insert into public.partner_agenda (roster, title, note, added_by, sort)
select 'eli', 'Bestly Labs: the new tech on the shelf', 'Walk through Labs and pick what to bring to market first.', 'jared', 10
where exists (select 1 from public.partners where roster_name = 'eli')
  and not exists (select 1 from public.partner_agenda where roster = 'eli' and title = 'Bestly Labs: the new tech on the shelf');
