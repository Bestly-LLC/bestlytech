-- Mercury tokens: one write-only paste box for BOTH tokens (Penny's page, /admin/cost-cutter).
--
--   mercury_tokens_save(p_business, p_personal)  admin only. Value goes straight into Vault. A null or blank
--                                                argument leaves that token alone.
--   mercury_tokens_status()                      admin only. Saved-at time + a short state note per token.
--                                                NEVER returns a value.
--
-- Vault names:
--   pi:mercury_api_token            business (Bestly LLC). DO NOT RENAME: the live Pi jobs (penny_bank,
--                                   settlement-mercury, mercury-sync) read exactly this name, through
--                                   pi_secret_get and mercury_token_t.
--   pi:mercury_personal_api_token   personal. NEW. Nothing reads it yet: this migration is the credential
--                                   path only, and no Pi job uses it.
--
-- The older mercury_token_save() / mercury_token_status() (20261011070200) are left in place and still work for
-- the business token; the page no longer calls them. Drop them in a later migration once nothing references them.
--
-- WHY A SEPARATE PERSONAL TOKEN: Penny looks for savings across Bestly spending; Jared wants her to see his
-- personal Mercury account too. It is NOT confirmed that Mercury Personal issues API tokens at all (Mercury's docs
-- reach API tokens "via your company logo", which suggests business accounts). The save path is built so the
-- personal token can be absent forever and nothing breaks: a missing token is just "not saved".
--
-- PRIVACY: personal financial data is more sensitive than business data. Anything Penny (or any agent) derives from
-- the personal token must be written to bestly_private_memory, NOT the shared bestly_memory, because several shared
-- areas are visible to Eli. Likewise nothing derived from it belongs in spend_merchants / cost_cutter_* tables
-- until a separate decision is made about how personal and business spend are kept apart.
--
-- ACCESS NOTE: pi_secret_get is limited to `pi:` names, so any service-role caller can read
-- pi:mercury_personal_api_token the same way it can read every other pi: secret. That is the existing trust model,
-- not a new hole, but it is why the token should be read-only on the Mercury side.
--
-- NOT APPLIED by the agent that wrote it. Review, then apply with apply_migration.
-- Until it is applied the card on /admin/cost-cutter shows "Token storage isn't set up yet" and nothing else changes.
--
-- UNDO:
--   drop function if exists public.mercury_tokens_save(text, text);
--   drop function if exists public.mercury_tokens_status();
--   -- and, only if a personal token was saved, remove it in Supabase Vault (name pi:mercury_personal_api_token).
--   -- Do NOT touch pi:mercury_api_token.
--
-- No new table, no emails or phones, so no privacy_data_map row. Neither function is called with the publishable
-- key, so neither belongs on security_public_rpcs.

-- ---------------------------------------------------------------- admin page: status only
create or replace function public.mercury_tokens_status()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_biz_at timestamptz;
  v_per_at timestamptz;
  v_job record;
  v_biz jsonb;
  v_per jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.team_is_admin(), false) then
    raise exception 'admin only';
  end if;

  select coalesce(s.updated_at, s.created_at) into v_biz_at from vault.secrets s where s.name = 'pi:mercury_api_token';
  select coalesce(s.updated_at, s.created_at) into v_per_at from vault.secrets s where s.name = 'pi:mercury_personal_api_token';
  select last_run_at, last_ok, last_summary into v_job from public.pi_jobs where job = 'penny_bank';

  -- Business: the only honest signal is whether the Pi's penny_bank job ran after the token was saved.
  if v_biz_at is null then
    v_biz := jsonb_build_object('saved_at', null, 'state', 'missing',
      'note', 'Nothing saved yet. Penny only sees what Bestly''s own apps spend.');
  elsif v_job.last_run_at is null or v_job.last_run_at < v_biz_at then
    v_biz := jsonb_build_object('saved_at', v_biz_at, 'state', 'saved',
      'note', 'Saved. The next bank run will try it.');
  elsif coalesce(v_job.last_ok, false) then
    v_biz := jsonb_build_object('saved_at', v_biz_at, 'state', 'working', 'checked_at', v_job.last_run_at,
      'note', left(coalesce(nullif(btrim(v_job.last_summary), ''), 'The last bank run worked.'), 160));
  else
    v_biz := jsonb_build_object('saved_at', v_biz_at, 'state', 'trouble', 'checked_at', v_job.last_run_at,
      'note', left(coalesce(nullif(btrim(v_job.last_summary), ''), 'The last bank run failed.'), 160));
  end if;

  -- Personal: no job reads it yet, so the most this can truthfully say is "saved". It is never "working".
  if v_per_at is null then
    v_per := jsonb_build_object('saved_at', null, 'state', 'missing',
      'note', 'Nothing saved. Optional: Mercury may not offer API tokens on a personal account.');
  else
    v_per := jsonb_build_object('saved_at', v_per_at, 'state', 'saved',
      'note', 'Saved. Nothing uses it yet, so it is untested.');
  end if;

  return jsonb_build_object('business', v_biz, 'personal', v_per);
end $$;
revoke all on function public.mercury_tokens_status() from public, anon;
grant execute on function public.mercury_tokens_status() to authenticated, service_role;

-- ---------------------------------------------------------------- admin page: write-only save
create or replace function public.mercury_tokens_save(p_business text default null, p_personal text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_biz text := nullif(btrim(p_business), '');
  v_per text := nullif(btrim(p_personal), '');
  v_id uuid;
  v_other text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.team_is_admin(), false) then
    raise exception 'admin only';
  end if;

  -- People copy "Bearer <token>" out of Mercury's examples; the Pi adds the prefix itself.
  if v_biz is not null then v_biz := nullif(btrim(regexp_replace(v_biz, '^bearer\s+', '', 'i')), ''); end if;
  if v_per is not null then v_per := nullif(btrim(regexp_replace(v_per, '^bearer\s+', '', 'i')), ''); end if;

  -- Shape checks first, so a bad paste changes nothing. Error text never contains the value.
  if v_biz is not null and (length(v_biz) < 20 or length(v_biz) > 600 or v_biz ~ '\s') then
    raise exception 'that does not look like the business Mercury token';
  end if;
  if v_per is not null and (length(v_per) < 20 or length(v_per) > 600 or v_per ~ '\s') then
    raise exception 'that does not look like the personal Mercury token';
  end if;

  -- The two accounts must never share one token (a paste into the wrong box would silently mix them).
  if v_biz is not null and v_per is not null and v_biz = v_per then
    raise exception 'the business and personal tokens are the same string; paste each in its own box';
  end if;
  if v_per is not null and v_biz is null then
    select decrypted_secret into v_other from vault.decrypted_secrets where name = 'pi:mercury_api_token';
    if v_other is not null and v_other = v_per then
      raise exception 'that is the business token; the personal box needs the personal one';
    end if;
  end if;
  if v_biz is not null and v_per is null then
    select decrypted_secret into v_other from vault.decrypted_secrets where name = 'pi:mercury_personal_api_token';
    if v_other is not null and v_other = v_biz then
      raise exception 'that is the personal token; the business box needs the business one';
    end if;
  end if;

  if v_biz is not null then
    select id into v_id from vault.secrets where name = 'pi:mercury_api_token';
    if v_id is null then
      perform vault.create_secret(v_biz, 'pi:mercury_api_token',
        'Mercury read-only API token, Bestly LLC business account (Penny, Bank Watch, mercury-sync). Written by /admin/cost-cutter.');
    else
      perform vault.update_secret(v_id, v_biz);
    end if;
  end if;

  if v_per is not null then
    select id into v_id from vault.secrets where name = 'pi:mercury_personal_api_token';
    if v_id is null then
      perform vault.create_secret(v_per, 'pi:mercury_personal_api_token',
        'Mercury read-only API token, Jared''s PERSONAL account. Private: derived data goes to bestly_private_memory only. Written by /admin/cost-cutter.');
    else
      perform vault.update_secret(v_id, v_per);
    end if;
  end if;

  return public.mercury_tokens_status();
end $$;
revoke all on function public.mercury_tokens_save(text, text) from public, anon;
grant execute on function public.mercury_tokens_save(text, text) to authenticated, service_role;
