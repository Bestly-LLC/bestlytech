-- STEP 1 of 2 for closing the ltx_report anon-writer finding (supa:Bestly:rpc:anon_writer:ltx_report). ADDITIVE ONLY.
--
-- ltx_report(p_event, p_detail) is a SECURITY DEFINER writer callable with the publishable key. Its only caller is the
-- AWS Lambda bestly-ltx-dispatch (tools/ltx-box/dispatch-lambda.py: hourly credits, start_requested, start_failed),
-- confirmed from the API edge logs on 2026-10-17 (apikey prefix sb_publishable, from AWS us-west-2). Its only guard is
-- p_detail.instance_id, which is not a secret.
--
-- This adds a keyed twin, ltx_report_k(p_key, p_event, p_detail), same idea as ltx_key_ok() for the GPU box: the Lambda
-- gets its own random key (env LTX_REPORT_KEY, generated inside AWS, never shown), and only its sha256 is stored here in
-- ltx_box.report_key_hash. A wrong or missing key writes nothing. The body then runs the unchanged ltx_report().
-- It stays callable with the publishable key on purpose (the Lambda has no Supabase login), so it is allow-listed.
--
-- STEP 2 (separate migration, after the Lambda's hourly report is seen arriving through ltx_report_k):
--   revoke execute on function public.ltx_report(text, jsonb) from public, anon;
--   delete from public.security_public_rpcs where fn = 'ltx_report';   (run in the SQL editor: the cloud connector hangs on DELETE)
--
-- UNDO: drop function if exists public.ltx_report_k(text, text, jsonb);
--       delete from public.security_public_rpcs where fn = 'ltx_report_k';
--       alter table public.ltx_box drop column if exists report_key_hash;

alter table public.ltx_box add column if not exists report_key_hash text;

create or replace function public.ltx_report_k(p_key text, p_event text, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select report_key_hash into v_hash from ltx_box where id;
  if v_hash is null or p_key is null or length(p_key) < 32
     or encode(extensions.digest(p_key, 'sha256'), 'hex') <> v_hash then
    return jsonb_build_object('ok', false, 'error', 'bad key');
  end if;
  return public.ltx_report(p_event, p_detail);
end $$;
revoke all on function public.ltx_report_k(text, text, jsonb) from public;
grant execute on function public.ltx_report_k(text, text, jsonb) to anon, authenticated, service_role;

insert into public.security_public_rpcs (fn, why) values
  ('ltx_report_k', 'AWS Lambda bestly-ltx-dispatch reports GPU box events and AWS credits (key-checked, sha256 in ltx_box.report_key_hash)')
on conflict (fn) do nothing;
