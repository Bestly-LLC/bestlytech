-- Track C (montage-opusplan): the Pi's free-AI ladder reads the Fireworks key through pi_secret.
-- pi_secret has a hard-coded allowlist; add 'fireworks_api_key' to whatever the live definition is right now
-- (read it, patch it, re-run it) so a concurrent edit by another agent is never overwritten.
-- Until Jared puts the key in Vault the function returns NULL and the ladder skips the rung silently.
do $$
declare
  def text;
  new_def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname = 'pi_secret' and p.pronamespace = 'public'::regnamespace;
  if def is null then
    raise exception 'pi_secret not found';
  end if;
  if def like '%''fireworks_api_key''%' then
    return;  -- already allowed
  end if;
  new_def := replace(def, '''Scout-FreeLLM'',', '''Scout-FreeLLM'',''fireworks_api_key'',');
  if new_def = def then
    raise exception 'could not patch pi_secret allowlist (anchor not found)';
  end if;
  execute new_def;  -- CREATE OR REPLACE keeps the existing grants (service_role only)
end $$;
