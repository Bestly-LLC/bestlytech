-- 2026-10-03 (APPLIED LIVE via SQL; this file is the record): FreeLLM back in Scout's free ladder.
-- FreeLLMAPI runs on the Mac mini (launchd tech.bestly.freellmapi -> ~/freellmapi/start.sh, which passes ENCRYPTION_KEY
-- from server/data/.encryption-key; production mode crashed without it). The cloud reaches it through Tailscale Funnel,
-- /v1 ONLY (key-locked; the admin UI stays private): https://jareds-mac-mini.taile42611.ts.net/v1 = Vault freellm_base_url.
-- Mac self-heal: ~/bin/freellm-watch.sh every 5 min (launchd tech.bestly.freellm-watch): app, Tailscale up, Funnel /v1.
-- Cloud alarm: freellm_watch() every 10 min, two misses -> bestly_raise ai.freellm.

-- Jared saved the key as "Scout-FreeLLM": accept it as freellm_api_key.
create or replace function public.llm_keys()
returns jsonb language sql stable security definer set search_path = public, vault as $$
  select coalesce(jsonb_object_agg(case when name = 'Scout-FreeLLM' then 'freellm_api_key' else name end, decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets
   where name in ('groq_api_key','cloudflare_ai_token','cloudflare_account_id','gemini_api_key','openrouter_api_key','freellm_api_key','freellm_base_url','Scout-FreeLLM');
$$;

create table if not exists public.freellm_watch_state (id boolean primary key default true check (id), last_req bigint, fails int not null default 0,
  last_ok_at timestamptz, last_status text, updated_at timestamptz default now());
insert into public.freellm_watch_state (id) values (true) on conflict do nothing;
alter table public.freellm_watch_state enable row level security;

create or replace function public.freellm_watch() returns jsonb
language plpgsql security definer set search_path = public, vault as $$
declare st record; r record; ok boolean; base text; k text; v_status text;
begin
  select * into st from freellm_watch_state where id;
  if st.last_req is not null then
    select status_code, error_msg into r from net._http_response where id = st.last_req;
    if found then
      ok := r.status_code = 200;
      v_status := coalesce(r.status_code::text, left(r.error_msg, 80));
      if ok then
        update freellm_watch_state set fails = 0, last_ok_at = now(), last_status = v_status, updated_at = now() where id;
        update llm_providers set last_ok_at = now() where name = 'freellm';
        if exists (select 1 from monitor_issues where key = 'ai.freellm' and status = 'open') then
          perform bestly_raise('ai.freellm', 'resolved', 'info', 'FreeLLM is reachable again', null, 'ai', null, true);
        end if;
      else
        update freellm_watch_state set fails = fails + 1, last_status = v_status, updated_at = now() where id;
        if st.fails + 1 >= 2 then
          perform bestly_raise('ai.freellm', 'problem', 'warning', 'FreeLLM on the Mac mini is not reachable',
            format('The cloud can''t reach it (%s). The Mac mini fixes itself every 5 min (app, Tailscale, Funnel); if this stays open, the Mac mini is probably asleep or offline.', v_status),
            'ai', null, false);
        end if;
      end if;
    end if;
  end if;
  select decrypted_secret into base from vault.decrypted_secrets where name = 'freellm_base_url';
  select decrypted_secret into k from vault.decrypted_secrets where name in ('freellm_api_key', 'Scout-FreeLLM') order by name = 'freellm_api_key' desc limit 1;
  if base is null or k is null then return jsonb_build_object('ok', false, 'why', 'no base url or key'); end if;
  update freellm_watch_state set last_req = net.http_get(rtrim(base, '/') || '/v1/models',
      headers := jsonb_build_object('Authorization', 'Bearer ' || k), timeout_milliseconds := 30000), updated_at = now() where id;
  return (select to_jsonb(s) - 'last_req' from freellm_watch_state s where id);
end $$;
revoke all on function public.freellm_watch() from public, anon, authenticated;
grant execute on function public.freellm_watch() to service_role;
select cron.schedule('freellm-watch', '*/10 * * * *', $$select public.freellm_watch()$$);
