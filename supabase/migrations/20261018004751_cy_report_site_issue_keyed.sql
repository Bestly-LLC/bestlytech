-- STEP 1 of 4 for closing the cy_report_site_issue anon-writer finding (supa:Bestly:rpc:anon_writer:cy_report_site_issue).
-- ADDITIVE ONLY. Plan: docs/cy-report-lockdown-opusplan.md
--
-- cy_report_site_issue(p_domain, p_reason, p_version, p_platform) is a SECURITY DEFINER writer callable with the
-- publishable key. Its only callers are the shipped Cookie Yeti extensions (cy-failsafe.js, Chrome MV3 and the Safari
-- Web Extension for Mac + iOS, both 1.2.5), confirmed in the extension source and in cy_site_guard_reports
-- (36 rows, all 1.2.5 safari, 2026-09-29 to 2026-10-17). 3 reports in 7 days switch Cookie Yeti off on a site for
-- every user, so an unauthenticated writer can switch it off anywhere.
--
-- This adds a keyed twin, cy_report_site_issue_k(p_key, ...). Keys live as sha256 only in cy_report_keys, one row per
-- extension release so a key can be retired without touching the others. A wrong, missing or retired key writes
-- nothing. The body then runs the unchanged cy_report_site_issue().
-- Until a key row exists the twin refuses every call, so this migration changes nothing for live users.
-- NOTE: the key ships inside the extension, so it is a rotatable gate, not a secret. See the plan, section "Limits".
--
-- UNDO: drop function if exists public.cy_report_site_issue_k(text, text, text, text, text);
--       drop table if exists public.cy_report_keys;
--       do $$ begin delete from public.security_public_rpcs where fn = 'cy_report_site_issue_k'; end $$;

create table if not exists public.cy_report_keys (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  label text not null,                 -- e.g. 'ext-1.2.6'
  active boolean not null default true,
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
alter table public.cy_report_keys enable row level security;
revoke all on table public.cy_report_keys from public, anon, authenticated;

create or replace function public.cy_report_site_issue_k(
  p_key text, p_domain text, p_reason text, p_version text default null, p_platform text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_key is null or length(p_key) < 32 or length(p_key) > 200
     or not exists (select 1 from cy_report_keys
                    where active and key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex')) then
    return jsonb_build_object('ok', false, 'error', 'bad key');
  end if;
  return public.cy_report_site_issue(p_domain, p_reason, p_version, p_platform);
end $$;
revoke all on function public.cy_report_site_issue_k(text, text, text, text, text) from public;
grant execute on function public.cy_report_site_issue_k(text, text, text, text, text) to anon, authenticated, service_role;

insert into public.security_public_rpcs (fn, why) values
  ('cy_report_site_issue_k', 'Cookie Yeti extension page-guard reports (key-checked, sha256 per release in cy_report_keys)')
on conflict (fn) do nothing;
