-- ltx_report: step 2 of 2. The public key can no longer write LTX box events.
--
-- Step 1 (20261017120000_ltx_report_keyed.sql) added the keyed twin ltx_report_k. On 2026-10-17 the
-- AWS Lambda bestly-ltx-dispatch got LTX_REPORT_KEY (sha256 in ltx_box.report_key_hash) and the code
-- that calls ltx_report_k. The 2026-10-18 00:07 UTC hourly credits row landed through it: the deployed
-- code only calls ltx_report_k when the key is set, and ltx_report_k writes nothing on a wrong key.
-- Nothing else calls ltx_report with the public key (ltx_report_k is its only SQL caller and runs as
-- definer). service_role and authenticated keep execute.
--
-- Its security_public_rpcs row is removed below so Ares's audit treats any future anon grant as a finding.

revoke execute on function public.ltx_report(text, jsonb) from public, anon;

do $$ begin delete from public.security_public_rpcs where fn = 'ltx_report'; end $$;
