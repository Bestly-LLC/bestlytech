-- Hunter Phase 1.5: worker functions for the scorer (service role only) and the Jev key.
--   hunter_secret(name)        reads 'jev_api_key' from Vault for the scorer. Service role only; the page can never read it.
--   hunter_score_queue(...)    the leads that need a fresh score (older than 7 days or never), with the compact input the
--                              scorer shows the model. No phone, email or person name goes into an input.
--   hunter_jev_key_put         admin-only, write-only: saves the key in Vault (name jev_api_key); turning Jev off is the 'jev' source switch.
--                              home_hub_vault_put only accepts home_hub_* names, so this is its twin for Hunter's one secret.

create or replace function public.hunter_secret(p_name text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not public.hunter_worker_ok() then raise exception 'not allowed'; end if;
  if p_name <> 'jev_api_key' then raise exception 'hunter_secret: % is not a Hunter secret', p_name; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1);
end $$;

create or replace function public.hunter_score_queue(p_maya int default 0, p_reese int default 0, p_all boolean default false, p_lead uuid default null)
returns table(owner text, lead_table text, lead_id uuid, input jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hunter_worker_ok() then raise exception 'not allowed'; end if;
  return query
  (select 'maya'::text, 'maya_leads'::text, l.id,
          jsonb_build_object('company', l.company, 'category', l.category, 'city', l.city, 'state', l.state, 'hours', l.business_hours,
            'line_type', l.line_type, 'site', l.site_status, 'site_summary', l.fit_reason, 'fit_score', l.fit_score,
            'has_website', l.website is not null, 'call_attempts', l.call_attempts, 'last_called_at', l.last_called_at, 'status', l.status)
     from maya_leads l
    where (p_lead is not null and l.id = p_lead)
       or (p_lead is null and p_maya > 0 and (l.status in ('checked','queued') or (p_all and l.status <> 'opted_out'))
           and not exists (select 1 from hunter_lead_scores s where s.owner = 'maya' and s.lead_id = l.id and s.scored_at > now() - interval '7 days'))
    order by (l.status = 'queued') desc, l.fit_score desc nulls last, l.created_at
    limit case when p_lead is not null then 1 else greatest(p_maya, 0) end)
  union all
  (select 'reese'::text, 'rg_leads'::text, r.id,
          jsonb_build_object('company', r.company, 'category', r.category, 'state', r.state, 'timezone', r.timezone,
            'contact_title', r.contacts->0->>'title', 'line_type', r.line_type, 'call_attempts', r.call_attempts,
            'site_model', r.site_model, 'roof_volume', r.roof_volume, 'footprint', r.footprint, 'risk_tier', r.risk_tier,
            'angle', left(r.pitch, 220), 'rg_priority', r.priority)
     from rg_leads r
    where (p_lead is not null and r.id = p_lead)
       or (p_lead is null and p_reese > 0 and r.phone is not null and r.line_type in ('landline','voip') and not r.dnc
           and not exists (select 1 from rg_dnc d where d.phone = r.phone)
           and r.call_status not in ('booked','not_interested','do_not_call','wrong_number','in_progress')
           and not exists (select 1 from hunter_lead_scores s where s.owner = 'reese' and s.lead_id = r.id and s.scored_at > now() - interval '7 days'))
    order by r.priority desc, r.created_at
    limit case when p_lead is not null then 1 else greatest(p_reese, 0) end);
end $$;

create or replace function public.hunter_jev_key_put(p_value text) returns timestamptz
language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid; v_cur text; v text := btrim(coalesce(p_value, ''));
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if length(v) < 12 or length(v) > 400 or v ~ '\s' then raise exception 'That does not look like a Jev key.'; end if;
  select s.id, d.decrypted_secret into v_id, v_cur from vault.secrets s join vault.decrypted_secrets d on d.id = s.id where s.name = 'jev_api_key';
  if v_id is null then perform vault.create_secret(v, 'jev_api_key', 'Hunter: Jev (TypeSafe AI) API key');
  elsif v_cur is distinct from v then perform vault.update_secret(v_id, v, 'jev_api_key', 'Hunter: Jev (TypeSafe AI) API key');
  end if;
  update hunter_sources set enabled = true, fail_streak = 0, last_error = null, cursor = '{}'::jsonb where slug = 'jev';
  return now();
end $$;

revoke all on function public.hunter_secret(text) from public, anon, authenticated;
revoke all on function public.hunter_score_queue(int, int, boolean, uuid) from public, anon, authenticated;
revoke all on function public.hunter_jev_key_put(text) from public, anon;
grant execute on function public.hunter_secret(text) to service_role;
grant execute on function public.hunter_score_queue(int, int, boolean, uuid) to service_role;
grant execute on function public.hunter_jev_key_put(text) to authenticated, service_role;
