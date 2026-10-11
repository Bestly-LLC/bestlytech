-- Penny (Cost Cutter) gets an admin page: /admin/cost-cutter. This is the DB side. Part A of plan/penny-v2-opusplan (spend_merchants,
-- cost_cutter_lessons / _questions / _avenues / _settings, cost_cutter_discover / _answer / _feedback / _ask_next, crons, heal) was built on
-- Oct 10 straight in the database; this file adds only what the page needs. DB-only and inert: nothing is sent, spent or filed.
--
-- 1. Mercury read-only token: a write-only field (CLAUDE.md "secrets get a UI"). The page can save a token into Vault and read back only
--    "saved at"; nobody (this build included) ever sees the value. Saved as Vault secret 'pi:mercury_api_token'.
--    The Pi jobs that need it (penny_bank, settlement-mercury) fetch it with mercury_token_t(p_token), which needs the house
--    db-watchdog token the Pi already holds. It is on the public-key allowlist (security_public_rpcs) so Ares's Auto-Fixer leaves it alone.
-- 2. cost_cutter_admin(): one read for the whole page. cost_cutter_setting_set(): bounded numbers. cost_cutter_finding_set(): done / parked.
-- 3. cost_cutter_ask_next(): the Needs-you card now opens the Cost Cutter page (was /admin), so Keep / Cut / Not sure is one tap away.
--
-- UNDO: drop the four new functions; select cost_cutter_ask_next definition from 20261011070200 history (only the url changed back to '/admin');
--       delete from public.security_public_rpcs where fn = 'mercury_token_t'; the Vault secret can be removed in Supabase Vault.

create or replace function public.mercury_token_save(p_value text)
returns timestamptz language plpgsql security definer set search_path to 'public', 'vault' as $$
declare v_id uuid; v_val text := btrim(coalesce(p_value, ''));
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  if length(v_val) < 20 or length(v_val) > 600 or v_val ~ '\s' then
    raise exception 'That does not look like a Mercury token. Paste the whole token with no spaces.';
  end if;
  select id into v_id from vault.secrets where name = 'pi:mercury_api_token';
  if v_id is null then
    perform vault.create_secret(v_val, 'pi:mercury_api_token', 'Mercury read-only API token for Penny and Bank Watch (saved from /admin/cost-cutter)');
  else
    perform vault.update_secret(v_id, v_val, 'pi:mercury_api_token');
  end if;
  return now();
end $$;

create or replace function public.mercury_token_status()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'vault' as $$
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  return jsonb_build_object('saved', exists (select 1 from vault.secrets where name = 'pi:mercury_api_token'),
                            'saved_at', (select updated_at from vault.secrets where name = 'pi:mercury_api_token'));
end $$;

-- Pi side: same trust as the other *_t functions (house db-watchdog token). Returns null until a token is saved.
create or replace function public.mercury_token_t(p_token text)
returns text language plpgsql stable security definer set search_path to 'public', 'vault', 'extensions' as $$
begin
  if not public.db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = 'pi:mercury_api_token');
end $$;

revoke all on function public.mercury_token_save(text), public.mercury_token_status() from public, anon;
grant execute on function public.mercury_token_save(text), public.mercury_token_status() to authenticated;
grant execute on function public.mercury_token_t(text) to anon, authenticated;
insert into public.security_public_rpcs (fn, why)
values ('mercury_token_t', 'Pi jobs (penny_bank, settlement-mercury) fetch the saved read-only Mercury token; gated by the db-watchdog token')
on conflict do nothing;

create or replace function public.cost_cutter_admin()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'vault' as $$
declare v jsonb;
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  select jsonb_build_object(
    'settings', jsonb_build_object('min_monthly_usd', public.cost_cutter_setting('min_monthly_usd', 3),
                                   'push_min_monthly_usd', public.cost_cutter_setting('push_min_monthly_usd', 25)),
    'token', jsonb_build_object('saved', exists (select 1 from vault.secrets where name = 'pi:mercury_api_token'),
                                'saved_at', (select updated_at from vault.secrets where name = 'pi:mercury_api_token')),
    'feed', jsonb_build_object(
      'waiting_on_token', exists (select 1 from public.monitor_issues where key = 'cost.feed' and status = 'open'),
      'job', (select jsonb_build_object('last_run_at', last_run_at, 'ok', last_ok, 'summary', last_summary) from public.pi_jobs where job = 'penny_bank'),
      'bank_merchants', (select count(*) from public.spend_merchants where source = 'pi'),
      'last_bank_update', (select max(updated_at) from public.spend_merchants where source = 'pi')),
    'question', (select to_jsonb(x) from (
        select c.id, c.merchant, c.question, c.options, c.asked_at, s.est_monthly_usd, s.guess
          from public.cost_cutter_questions c left join public.spend_merchants s on s.merchant = c.merchant
         where c.status = 'asked' order by c.asked_at limit 1) x),
    'queued', (select count(*) from public.cost_cutter_questions where status = 'queued'),
    'findings', coalesce((select jsonb_agg(to_jsonb(x) order by x.saving desc nulls last, x.created_at desc) from (
        select id, kind, title, detail->>'why' as why, detail->>'todo' as todo, monthly_saving_usd as saving, created_at
          from public.cost_cutter_findings where status = 'open' and kind <> 'new_avenue' limit 20) x), '[]'::jsonb),
    'merchants', coalesce((select jsonb_agg(to_jsonb(x) order by x.est_monthly_usd desc nulls last, x.merchant) from (
        select merchant, source, status, cadence, est_monthly_usd, last_seen, guess, keep_until
          from public.spend_merchants limit 60) x), '[]'::jsonb),
    'avenues', coalesce((select jsonb_agg(to_jsonb(x) order by x.first_seen desc) from (
        select name, kind, first_seen from public.cost_cutter_avenues where watched order by first_seen desc limit 12) x), '[]'::jsonb),
    'lessons', coalesce((select jsonb_agg(to_jsonb(x) order by x.decided_at desc) from (
        select subject, decision, reason, decided_at from public.cost_cutter_lessons order by decided_at desc limit 8) x), '[]'::jsonb),
    'saved_monthly_usd',
      coalesce((select sum(monthly_saving_usd) from public.cost_cutter_findings where status = 'done'), 0)
    + coalesce((select sum(est_monthly_saving_usd) from public.cost_cutter_paused), 0)
  ) into v;
  return v;
end $$;

create or replace function public.cost_cutter_setting_set(p_key text, p_value numeric)
returns numeric language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  if p_key = 'min_monthly_usd' and (p_value < 0 or p_value > 100) then raise exception 'Between $0 and $100 a month'; end if;
  if p_key = 'push_min_monthly_usd' and (p_value < 5 or p_value > 1000) then raise exception 'Between $5 and $1,000 a month'; end if;
  if p_key not in ('min_monthly_usd', 'push_min_monthly_usd') then raise exception 'Unknown setting'; end if;
  insert into public.cost_cutter_settings (key, value) values (p_key, to_jsonb(p_value))
    on conflict (key) do update set value = excluded.value;
  return p_value;
end $$;

create or replace function public.cost_cutter_finding_set(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if not public.team_is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('done', 'parked', 'open') then raise exception 'Unknown status'; end if;
  update public.cost_cutter_findings set status = p_status, updated_at = now() where id = p_id;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'finding not found'; end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

revoke all on function public.cost_cutter_admin(), public.cost_cutter_setting_set(text, numeric), public.cost_cutter_finding_set(uuid, text) from public, anon;
grant execute on function public.cost_cutter_admin(), public.cost_cutter_setting_set(text, numeric), public.cost_cutter_finding_set(uuid, text) to authenticated;

-- Same body as before; only the card's url changes from /admin to the page where the three buttons live.
create or replace function public.cost_cutter_ask_next()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare q record; v_title text; v_body text; v_guess text;
begin
  with x as (update cost_cutter_questions c set status = 'expired'
              where c.status = 'queued'
                and not exists (select 1 from spend_merchants s where s.merchant = c.merchant and s.status = 'unknown')
              returning 1)
  select 1 from x limit 1 into v_title;

  if exists (select 1 from cost_cutter_questions where status = 'asked') then
    return jsonb_build_object('asked', null, 'reason', 'waiting on an answer');
  end if;
  select c.*, s.est_monthly_usd into q
    from cost_cutter_questions c join spend_merchants s on s.merchant = c.merchant
   where c.status = 'queued' and s.status = 'unknown'
   order by s.est_monthly_usd desc nulls last, c.created_at limit 1;
  if not found then
    return jsonb_build_object('asked', null, 'reason', 'nothing queued');
  end if;
  update cost_cutter_questions set status = 'asked', asked_at = now() where id = q.id;
  update spend_merchants set status = 'asked', updated_at = now() where merchant = q.merchant;
  v_title := 'Penny: ' || split_part(q.question, ' Looks like:', 1);
  v_guess := nullif(trim(substr(q.question, strpos(q.question, ' Looks like:'))), '');
  v_body := case when strpos(q.question, ' Looks like:') > 0 then v_guess || ' ' else '' end
            || 'Answer Keep it, Cut it, or Not sure and Penny files it. Waiting on you.';
  insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key, silent)
  values ('penny', left(v_title, 200), left(v_body, 500), '/admin/cost-cutter', 'penny:q:' || q.id::text, 'warning',
          'penny:q:' || q.id::text, false)
  on conflict (dedupe_key) do nothing;
  return jsonb_build_object('asked', q.merchant, 'question_id', q.id, 'title', v_title);
end $$;
