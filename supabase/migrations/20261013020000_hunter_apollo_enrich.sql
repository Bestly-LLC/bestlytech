-- Hunter: nightly Apollo enrichment (free plan can't search, but it can enrich leads Hunter already found).
--   Reese: rg_leads with a named contact + website -> Apollo people/match -> work email, title, LinkedIn onto contacts[0].
--   Maya:  maya_leads (checked/queued) with a website -> Apollo organizations/enrich -> size, industry, main phone if missing.
-- Each owner uses its own Apollo key and its own nightly cap (credits never mix). One row per lead tried, so nothing is paid for twice.
alter table public.hunter_settings add column if not exists apollo_cap_maya int not null default 5 check (apollo_cap_maya between 0 and 200);
alter table public.hunter_settings add column if not exists apollo_cap_reese int not null default 5 check (apollo_cap_reese between 0 and 200);

create table if not exists public.hunter_apollo_enrich (
  owner text not null check (owner in ('maya','reese')),
  lead_id uuid not null,
  status text not null,            -- found | none | error
  found jsonb,                     -- what Apollo returned that we kept (may hold a work email)
  tried_at timestamptz not null default now(),
  primary key (owner, lead_id)
);
alter table public.hunter_apollo_enrich enable row level security;

insert into public.privacy_data_map(table_name, column_name, match_kind, action, reason, enabled)
values ('hunter_apollo_enrich', 'found', 'email', 'delete', 'Apollo lookup cache; the lead row keeps what matters', true)
on conflict do nothing;

update public.hunter_sources set enabled = true, notes = 'Enriches leads Hunter already found (free plan cannot search)' where slug = 'apollo';

create or replace function public.hunter_apollo_caps_set(p_maya int default null, p_reese int default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  update hunter_settings set apollo_cap_maya = coalesce(least(greatest(p_maya,0),200), apollo_cap_maya),
    apollo_cap_reese = coalesce(least(greatest(p_reese,0),200), apollo_cap_reese), updated_at = now() where id = true;
end $$;
revoke all on function public.hunter_apollo_caps_set(int,int) from public, anon;
grant execute on function public.hunter_apollo_caps_set(int,int) to authenticated, service_role;

-- 5:50 AM Pacific, after the night's scoring
select cron.schedule('hunter-apollo-enrich', '50 12 * * *',
  $$select public.invoke_edge_function('hunter-apollo', '{"op":"enrich"}'::jsonb, 150000)$$);
