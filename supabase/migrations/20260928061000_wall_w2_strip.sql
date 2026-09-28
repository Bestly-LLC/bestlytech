-- Wall round 3, W2 (strip), 2026-09-27 night.
-- 1) wall_pi_nextcloud: the Pi reads Jared's Nextcloud calendar (cloud.bestly.tech) next to iCloud, so calls booked
--    there (e.g. "Eli x Jared") show on the wall. Same agent key as the other wall_pi_* RPCs; secrets stay in Vault.
-- 2) wall_pi_scout_items: the open Scout items behind the "N open" count, for the Scout card's bullet list.
-- 3) wall_clean_widgets: admin switches state.widgets {news,mail,turo$,air,energy,habits,leo,appstore} (missing = on)
--    and state.bookingDemo (ms) = "show a sample Turo booking pop-up". Chained into wall_admin_set.

create or replace function public.wall_pi_nextcloud(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'vault' as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'url', (select decrypted_secret from vault.decrypted_secrets where name = 'nextcloud_base_url' limit 1),
    'user', (select decrypted_secret from vault.decrypted_secrets where name = 'nextcloud_user' limit 1),
    'password', (select decrypted_secret from vault.decrypted_secrets where name = 'nextcloud_app_password' limit 1));
end $$;
revoke all on function public.wall_pi_nextcloud(text) from public;
grant execute on function public.wall_pi_nextcloud(text) to anon, authenticated;

create or replace function public.wall_pi_scout_items(p_token text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return coalesce((select jsonb_agg(x order by x.rk, x.opened_at desc) from (
    select left(title, 90) as title, severity, area, needs_jared is not null as needs_you, opened_at,
           case when needs_jared is not null then 0 when severity = 'error' then 1 when severity = 'warning' then 2 else 3 end as rk
      from monitor_issues where status = 'open' and key not like 'wall.test%'
     order by rk, opened_at desc limit 16) x), '[]'::jsonb);
end $$;
revoke all on function public.wall_pi_scout_items(text) from public;
grant execute on function public.wall_pi_scout_items(text) to anon, authenticated;

create or replace function public.wall_clean_widgets(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare out jsonb := '{}'::jsonb; w jsonb := '{}'::jsonb; k text;
begin
  if jsonb_typeof(p->'widgets') = 'object' then
    foreach k in array array['news','mail','turo$','air','energy','habits','leo','appstore'] loop
      if jsonb_typeof(p->'widgets'->k) = 'boolean' then w := w || jsonb_build_object(k, p->'widgets'->k); end if;
    end loop;
    out := out || jsonb_build_object('widgets', w);
  elsif p ? 'widgets' and jsonb_typeof(p->'widgets') = 'null' then
    out := out || '{"widgets": null}'::jsonb;
  end if;
  if jsonb_typeof(p->'bookingDemo') = 'number' then
    out := out || jsonb_build_object('bookingDemo', p->'bookingDemo');
  end if;
  return out;
end $$;

create or replace function public.wall_admin_set(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare w public.wall_state;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update wall_state
     set state = state || wall_clean_patch(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_toggles(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_tour(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_wake(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_widgets(coalesce(p_patch, '{}'::jsonb)),
         version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  return jsonb_build_object('state', w.state, 'version', w.version);
end $$;
