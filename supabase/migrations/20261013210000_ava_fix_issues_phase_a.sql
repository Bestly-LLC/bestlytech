-- 2026-10-13 Ava can read and route issues by voice, Phase A (docs/ava-fix-issues-opusplan.md, "Build split" note).
-- New: POST /fix on the ava-admin edge function (list / retry / ask_scout / check; approve and undo only hand Jared a tap) and
-- a fourth ElevenLabs tool, fix_issue, on Ava. NO new write privilege anywhere:
--   retry      = the Fix Ladder's own "Try again" (service key, same call the alert pane makes)
--   ask_scout  = admin-chat on autopilot (writes blocked in code there), logged in one reusable admin chat "Ava (voice)", max 10 a day
--   approve / undo never execute (reason_code needs_tap); the voice-yes grant (plan section 3) and ava_fix_grants are NOT built (Phase B, on hold).
-- No new tables or columns, so nothing new for privacy_data_map (ava_admin_bridge_log.caller_id is already mapped) and no new cron:
-- the existing hourly selftest (ava-admin-bridge-selftest, :17) also checks /fix and that fix_issue is attached.

-- 1. The bridge state now lists four tools (admin_status, call_ops, admin_metrics + fix_issue); the selftest re-attaches any that go missing.
update public.ava_admin_bridge_state
   set tool_ids = (select array_agg(distinct t) from unnest(tool_ids || array['tool_3201m4ve727be7qteyqc9y4recdr']) t),
       updated_at = now()
 where id and not (tool_ids @> array['tool_3201m4ve727be7qteyqc9y4recdr']);

-- 2. Team card: the Admin Bridge now also lists issues, retries them and hands Scout read-only jobs. Same slug, same owner (Ava), same pulse.
select public.team_onboard('[{
  "slug": "ava-admin-bridge",
  "name": "Admin Bridge",
  "role": "Ava''s line into the admin",
  "what_it_does": "Lets Ava answer Jared when he calls and asks about the business: what needs him, how the agents did today, what is broken, and start or pause Maya''s campaigns or place one call. For issues she can list what is open, send one back up the Fix Ladder (Try again), or hand Scout a read-only question and read the answer back (10 a day, writes stay blocked). She can never approve or undo a fix by voice: she says it needs his tap and leaves a one-tap note in the Ava (voice) chat. Only Jared''s two numbers get in, every change is read back and needs a yes, calls through it are capped at 20 a day, and every action rings a quiet note signed Ava. Checks itself hourly at :17 (the tools are still on Ava, the shared secret still matches, the answers are fast, an approve never runs); fixes what it can and tells Jared as Ava if it cannot. Log of the last actions is on /admin/ava.",
  "tool_of": "ava",
  "runs_on": "cloud",
  "schedule": "live on every call Jared makes to Ava; self-test hourly at :17",
  "icon": "plug",
  "admin_url": "/admin/ava",
  "sort": 60,
  "pulse": {"src": "cron", "job": "ava-admin-bridge-selftest", "gap": 130}
}]'::jsonb);
