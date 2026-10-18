-- Track A of the Trustpilot-on-bestly.tech plan: the Pi's Review Reader (Maya's tool) writes real Trustpilot "new review"
-- emails into public.trustpilot_reviews and tells the recap. Code: tools/trustpilot-reader/ (Pi job trustpilot_reviews).
--
-- How it reads mail: NOT a second IMAP session. The Pi mail_bridge (every 5 min) already copies jared@bestly.tech into
-- bestly_mail, so the reader parses those rows. It then re-checks each candidate's own headers with one IMAP BODY.PEEK
-- fetch (Authentication-Results must show dkim=pass for trustpilot.com), so a forged email can never put a review on the
-- public site. Nothing is ever moved, deleted or marked read.
--
-- 1. trustpilot_ingest_review: insert-once by Message-ID, and only on a real insert the one recap note (silent bell row,
--    signed Maya, severity success; a 3-star or lower review is info, not good news). The text goes straight to the bell
--    instead of through notify_route, because review wording like "refund" or "$5" would trip interrupt_class() and ring
--    his phone. A new review is never one of the 4 interrupt kinds.
-- 2. trustpilot_reader_flag: a quiet warning bell signed Maya when an email looks like a review but cannot be read or verified.
-- 3. pi_jobs heartbeat (max gap 2 hours; pi_jobs_watch pings Scout if it goes quiet, a failed run pings Scout at once).
-- 4. Team card "Review Reader" under Maya (tool_of), pulse reads the pi_jobs row.
--
-- privacy_data_map: no row on purpose. That map only knows match_kind email or phone and matches people by those; the
-- table holds neither (reviewer_first_name is a public Trustpilot attribution). Nothing for Vera to delete by email.
--
-- UNDO: drop function public.trustpilot_ingest_review(text,int,text,text,text,timestamptz,text);
--       drop function public.trustpilot_reader_flag(text,text,text);
--       delete from public.pi_jobs where job = 'trustpilot_reviews';
--       update public.bestly_agents set status = 'retired' where slug = 'review-reader';
--       delete from public.notification_owners where prefix = 'trustpilot-reader';
--       and remove the crontab line "run.sh trustpilot_reviews" on bestly-pi.

create or replace function public.trustpilot_ingest_review(
  p_msg_id text, p_stars int, p_title text, p_snippet text, p_name text, p_received_at timestamptz, p_alert text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(p_msg_id, '') = '' or p_msg_id like 'test-%' then raise exception 'bad msg_id'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'bad stars'; end if;
  insert into public.trustpilot_reviews (msg_id, stars, title, snippet, reviewer_first_name, received_at)
  values (p_msg_id, p_stars::smallint, nullif(btrim(p_title), ''), nullif(btrim(p_snippet), ''),
          nullif(btrim(p_name), ''), coalesce(p_received_at, now()))
  on conflict (msg_id) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;
  insert into public.admin_notifications (kind, title, body, url, severity, dedupe_key, silent, agent_slug)
  values ('trustpilot', left(coalesce(nullif(p_alert, ''), 'Maya: new Trustpilot review'), 200),
          left(coalesce(nullif(btrim(p_snippet), ''), ''), 500), '/admin',
          case when p_stars >= 4 then 'success' else 'info' end,
          'trustpilot-review-' || p_msg_id, true, 'maya')
  on conflict (dedupe_key) do nothing;
  return true;
end $$;

create or replace function public.trustpilot_reader_flag(p_key text, p_title text, p_body text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_notifications (kind, title, body, url, severity, dedupe_key, silent, agent_slug)
  values ('trustpilot', left(p_title, 200), left(coalesce(p_body, ''), 500), '/admin', 'warning',
          'trustpilot-reader-' || left(coalesce(p_key, md5(p_title)), 150), true, 'maya')
  on conflict (dedupe_key) do nothing;
end $$;

revoke all on function public.trustpilot_ingest_review(text,int,text,text,text,timestamptz,text) from public, anon, authenticated;
revoke all on function public.trustpilot_reader_flag(text,text,text) from public, anon, authenticated;
grant execute on function public.trustpilot_ingest_review(text,int,text,text,text,timestamptz,text) to service_role;
grant execute on function public.trustpilot_reader_flag(text,text,text) to service_role;

insert into public.pi_jobs (job, description, max_gap_min, enabled)
values ('trustpilot_reviews',
        'Maya (Review Reader): every 15 min. Reads Trustpilot new-review emails already copied into bestly_mail, checks they really come from trustpilot.com (DKIM), and files each review once into trustpilot_reviews. Free, no AI unless the parser fails, never touches mail. Pi job tools/trustpilot-reader.',
        120, true)
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, enabled = true;

select public.team_onboard($j$[
 {"slug":"review-reader","name":"Review Reader","role":"Files new Trustpilot reviews","tool_of":"maya","dept":"sales","runs_on":"pi","icon":"star",
  "welcome":false,"schedule":"every 15 min","admin_url":"/admin/maya","sort":60,
  "what_it_does":"Every 15 minutes it looks for a Trustpilot new-review email in Jared's inbox, checks the email really came from Trustpilot, and saves the stars, title, text and first name once. The site and the email badge show the review on their own. It never moves, deletes or opens mail, and never makes up a rating: if it cannot read one it says so and saves nothing. Each new review becomes one quiet line in the evening recap, signed Maya.",
  "pulse":{"src":"pi_job","key":"trustpilot_reviews","gap":120,"alert":true},
  "owns":["trustpilot-reader"]}
]$j$::jsonb);
