-- 2026-10-26 TikTok production-review watchdog (Spark, Studio's AI employee).
-- Why: Studio's TikTok app (developer app 7656531505153427476, "Bestly Studio") is in review for production. The result
-- arrives as email from noreply@dev.tiktok.com ("Your app status update"). Nobody should have to refresh the portal.
-- What it does (free, in the database, no Claude, no paid AI): every 15 minutes it looks at the copy of jared@bestly.tech
-- that mail_bridge keeps in bestly_mail, files each new dev.tiktok.com status email once, and tells Jared:
--   rejected -> one warning signed Spark (key studio:tiktok-review) with the next step
--   approved -> one "success" note signed Spark with the exact next steps. It does NOT flip the sandbox flags by itself:
--               production needs the production client key and secret, which only the TikTok portal shows, and flipping
--               tt_production_approved with sandbox keys still in Vault would break every client's connect.
--   anything else from dev.tiktok.com -> one info note with the first words of the email, so a person reads it.
-- Sender is matched on the exact address; a forged email can only cause a note, never a flag change.
-- Undo: select cron.unschedule('tiktok-review-watch'); drop function public.tiktok_review_watch(); drop table public.tiktok_review_seen;

create table if not exists public.tiktok_review_seen (
  mail_id uuid primary key,
  verdict text not null,
  subject text,
  seen_at timestamptz not null default now()
);
alter table public.tiktok_review_seen enable row level security;
revoke all on public.tiktok_review_seen from anon, authenticated;

create or replace function public.tiktok_review_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare m record; v text; b text; n_new int := 0; last_v text;
begin
  for m in
    select id, sent_at, subject, body_text from bestly_mail
     where sent_at >= timestamptz '2026-10-26 18:00:00+00'
       and from_addr = 'noreply@dev.tiktok.com'
       and not exists (select 1 from tiktok_review_seen s where s.mail_id = bestly_mail.id)
     order by sent_at
  loop
    b := lower(regexp_replace(coalesce(m.body_text, ''), '&#\d+;|\s+', ' ', 'g'));
    v := case
           when b like '%not approved%' or b like '%sorry to inform%' or b like '%rejected%' then 'rejected'
           when b like '%approved%' then 'approved'
           else 'other' end;
    insert into tiktok_review_seen (mail_id, verdict, subject) values (m.id, v, m.subject);
    n_new := n_new + 1; last_v := v;
    if v = 'approved' then
      perform public.notify_route(
        'TikTok approved Bestly Studio',
        'Spark: TikTok approved the Studio app for production. Next: put the production client key and secret into Studio (studio-social tiktok_setup), then set studio_flags tt_production_approved and tt_direct_post_all to true, then re-run the Minute Money Daily TikTok connect (build/mtd-desk-cron-2026-10-26).',
        'success', 'Spark', 'https://bestly.tech/admin', 'studio:tiktok-review', 'studio-tiktok-review');
      perform public.bestly_raise('studio:tiktok-review', 'resolved', 'info', 'TikTok approved Bestly Studio', 'Spark: production approved. Credentials swap and flag flip are the next steps.', 'ops');
    elsif v = 'rejected' then
      perform public.bestly_raise('studio:tiktok-review', 'problem', 'warn', 'TikTok did not approve Bestly Studio',
        'Spark: TikTok sent a "not approved" result for the Studio app. Open the app in the TikTok developer portal, tap See why, fix what it names, and resubmit. The Minute Money Daily TikTok connect stays blocked until it is approved.', 'ops');
    else
      perform public.notify_route('TikTok sent a note about Bestly Studio',
        'Spark: ' || left(regexp_replace(coalesce(m.body_text, ''), '&#\d+;|\s+', ' ', 'g'), 240),
        'info', 'Spark', 'https://bestly.tech/admin', 'studio:tiktok-review', 'studio-tiktok-review');
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'new', n_new, 'last', last_v);
exception when others then
  perform public.bestly_raise('studio:tiktok-review', 'problem', 'warn', 'TikTok review watcher hit an error', 'Spark: ' || left(sqlerrm, 200), 'ops');
  return jsonb_build_object('ok', false, 'error', left(sqlerrm, 200));
end $$;

revoke all on function public.tiktok_review_watch() from public, anon, authenticated;

select cron.unschedule('tiktok-review-watch') where exists (select 1 from cron.job where jobname = 'tiktok-review-watch');
select cron.schedule('tiktok-review-watch', '4-59/15 * * * *', 'select public.tiktok_review_watch()');

select public.team_onboard('[{
  "slug": "tiktok-review-watch", "name": "TikTok Review Watch", "role": "Watches TikTok''s review of Bestly Studio",
  "what_it_does": "Checks Jared''s mail copy every 15 minutes for TikTok''s review result on the Bestly Studio app (from noreply@dev.tiktok.com). A not-approved result raises a warning with the next step. An approved result sends one good-news note with the exact steps to move Studio from sandbox to production. It never changes a flag on its own.",
  "tool_of": "spark", "runs_on": "cloud", "schedule": "every 15 min", "icon": "eye", "admin_url": "/admin/team", "sort": 63,
  "pulse": {"src": "cron", "job": "tiktok-review-watch", "gap": 30, "issues": ["studio:tiktok-review"]},
  "owns": ["studio:tiktok-review"]
}]'::jsonb);
