# Vera, the Privacy Clerk — opusplan (2026-10-10)

Planned by Opus, executed by Sonnet. Jared, Oct 10 4:46 PM: "Build it" — the Privacy Clerk that carries out the privacy requests Maya takes on the phone.

## The flow in plain words

1. Maya files a privacy ticket (`support_tickets.kind = 'privacy'`, `privacy_action` delete | export | correct | opt_out). That already works.
2. **Vera** opens a privacy case and emails the person a short link: `bestly.tech/p/<8 chars>`. One button: "Yes, this was me."
3. When they confirm, Vera searches every Bestly system for their email and phone and lists what she found, sorted into: **Delete**, **Blank out**, **Keep (with the legal reason)**, **Your call**.
4. Jared gets one push signed "Vera:" and taps **Delete now** on the ticket in `/admin/maya` (deleting data is on his ask-first list; Vera never deletes on her own).
5. Vera deletes, emails the person what was done, closes the ticket, and keeps a minimal audit record (CCPA requires keeping request records for 24 months), with their email and phone replaced by a hash.

Opt-out requests skip step 4 (nothing is deleted; Vera adds them to the suppression list and confirms). Correction requests stop after step 3 and go to Jared as a card with the details. Export requests build a JSON file the person downloads from the same short link after Jared's tap.

## Hard rules for whoever executes this

1. **Supabase MCP SQL calls whose text contains the object-removal keyword (d-r-o-p) get cancelled. Never write it,** not even in comments. Keep each MCP SQL call to one or two statements. Statements containing DELETE may trigger an approval prompt for Jared: if a call comes back `{"status":"cancelled"}`, retry once smaller, then skip and report. Never UPDATE `bestly_memory`; insert new rows.
2. **Do not touch Maya's ElevenLabs agent (prompt, tools, KB) or the billing tables** (`maya_verifications`, `maya_billing_actions`, `maya_pay_links`, `maya_refund_*`, `maya_billing_*`). A parallel session owns Maya's billing work. Vera is server-side only and works off `support_tickets`.
3. Admin RPCs: SECURITY DEFINER, first line `if not team_is_admin() then raise exception 'not allowed'; end if;`, revoke from public/anon/authenticated, grant to authenticated. The public verify path goes through an edge function with the service role, never an anon-callable RPC.
4. **Owner guard:** Vera refuses to scan or delete for any email ending `@bestly.tech`, Jared's addresses found in `mail_contacts`/`partners` as owner, or phones whose last 10 digits are `8165007236`, `8164299495`, `2136410074`, `4242349256`. Such a case goes to Jared as a card instead.
5. **Blast guard:** if any single table would lose more than 25 rows for one person, stop the whole run and raise `privacy.guard` to Jared. The executed counts must equal the scanned counts or the run rolls back.
6. Matching is exact: email = `lower(trim(col)) = lower(trim(email))`; phone = last 10 digits of `regexp_replace(col, '\D', '', 'g')` equal the person's last 10 digits (ignore phones with fewer than 10 digits).
7. UI: load `.claude/skills/apple-design` first, then a `ui-ux-pro-max` pass. Admin dark, public page light. 12-hour times. Never truncate text with "...". Numbers never split from units. No emoji. Short links only (`bestly.tech/p/xxxxxxxx`), never raw function URLs in emails.
8. Every alert signed `Vera: ...`; use `bestly_raise` / `scout_notify` like `maya-watch`. Interrupts only for the 4 kinds (`docs/autonomy-opusplan.md`): a person waiting on a decision counts; routine progress goes to the recap as `success`.
9. Commit and push to `main` (CLAUDE.md). `git pull --rebase origin main` first. Append-only migrations, matching what you applied.

## Phase 1 — data

Migration `supabase/migrations/20261011010000_privacy_clerk.sql`.

**`privacy_data_map`** (table_name text, column_name text, match_kind text `email|phone`, action text `delete|blank|keep|review`, reason text, enabled bool default true, primary key (table_name, column_name)). Admin-only RLS. `delete` removes the whole row; `blank` sets that column (and any other mapped personal columns on the row) to null; `keep` never changes anything and shows the reason; `review` is shown to Jared unchecked and only changes if he ticks it (then it is treated as `delete`).

Seed it from this decision table (verify each column exists first; skip any that do not):

| Action | Table.column (match) | Reason shown |
|---|---|---|
| delete | activation_codes.email, activation_code_attempts.email, contact_submissions.email, waitlist_subscribers.email, device_registrations.email, granted_access.email, hire_requests.email, cloud_leads.contact_email, cloud_leads.contact_phone, email_unsubscribe_tokens.email, mail_contacts.email, webauthn_challenges.email, shop_abandoned_checkouts.email, guest_entry_attempts.phone_digits | — |
| blank | email_send_log.recipient_email, notify_outbox.to_email, shop_notifications.to_email, shield_url_reports.reporter_email, cloud_shield_requests.requester_email, webhook_events.email, support_tickets.email + .phone (also blank name and issue on that row; never the privacy ticket being worked) | Send log kept without the address |
| keep | suppressed_emails.email | Keeps you off our email list |
| keep | rg_dnc.phone | Keeps you off our call list |
| keep | shop_orders.email/phone, hoku_orders.email/phone | Sales tax records (4 years) |
| keep | subscriptions.email | Billing record; cancel the plan separately |
| keep | spam_claims.contact_email, spam_report_targets.email | Legal claim records |
| review | ava_calls.phone, ava_calls.counterpart_phone, ava_contacts.phone, ava_followups.phone, ava_live_watch.phone, rg_calls.counterpart_phone, rg_calls.meeting_email, rg_calls.to_number, rg_leads.phone, rg_followups.to_number, turo_trips.guest_phone, lax_guest_links.email, approval_clients.contact_email, client_people.email, partners.email, claim_shops.email, claim_shops.phone, seller_intakes.client_email, seller_intakes.client_phone, cloud_deals.primary_contact_email | Your call |

**`privacy_cases`**: id uuid pk, ticket_code text unique references `support_tickets(code)`, action text, email text, phone text, email_hash text, phone_hash text, token text unique (8 chars from `23456789abcdefghjkmnpqrstuvwxyz`), token_expires_at, verify_sent_at, reminded_at, verified_at, verified_ip text, scan jsonb, scanned_at, review_ticked text[], approved_at, executed_at, result jsonb, export_path text, confirm_sent_at, status text check in (`awaiting_verification`, `no_email`, `verified`, `ready`, `approved`, `done`, `could_not_verify`, `needs_jared`, `cancelled`), note text, created_at, updated_at. Admin-only RLS.

**Functions** (one MCP call each):
- `privacy_scan(p_case uuid) returns jsonb` (security definer, not granted to anyone but the service role and admins via the RPCs below). For each enabled map row: count matches with the rules in Hard rule 6, using `format('%I', ...)` and checking the table/column exist in `information_schema.columns`. Returns `{items:[{table, column, action, reason, count}], total, places}` for count > 0 only. Applies the owner guard.
- `privacy_execute(p_case uuid) returns jsonb`: requires status `approved`. Re-scans, applies the blast guard, then deletes / blanks per map (review rows only if in `review_ticked`), all in one transaction; compares counts with the approved scan; returns per-table counts. On mismatch: raise exception (rolls back) and the caller raises `privacy.guard`.
- `privacy_export(p_case uuid) returns jsonb`: the matched rows as JSON (only mapped tables, all actions including keep), personal columns included, for export requests.
- `privacy_redact(p_case uuid)`: after the confirmation email is sent, set `email_hash = encode(digest(lower(email),'sha256'),'hex')`, `phone_hash` likewise on the last 10 digits, null out `email`, `phone`, `scan` row samples (keep counts), and blank name/email/phone/issue on the privacy ticket itself, leaving code, kind, privacy_action, dates.
- Admin RPCs: `admin_privacy_case(p_code text)` (case + scan for the ticket), `admin_privacy_approve(p_code text, p_review text[] default '{}')` (status ready → approved, stores ticks, then calls the clerk via `invoke_edge_function('privacy-clerk', '{"run":"execute","code":"..."}')`), `admin_privacy_resend(p_code)` (new token, clears verify_sent_at), `admin_privacy_cancel(p_code, p_note)`, `admin_privacy_mark_verified(p_code, p_note)` (Jared verified them some other way, e.g. by phone).

## Phase 2 — the public confirm page and link

- Route `/p/:token` in `src/App.tsx` → `src/pages/PrivacyConfirm.tsx` (light public site layout, no Maya widget, no tracking). States: loading; "Confirm your request" (shows "You asked Bestly to delete your data on Oct 10" from the case, and the reference code, one big button **Yes, this was me**, small line "Didn't ask for this? Close this page and nothing will change."); confirmed ("Thanks. We'll email you when it's done, within 45 days and usually much sooner."); expired/invalid ("This link has expired. Call (213) 641-0074 or email privacy@bestly.tech."); for a finished export: **Download my data** button.
- Edge function `supabase/functions/privacy-verify/index.ts`, verify_jwt **false** (add to `supabase/config.toml`). `GET ?t=` returns only `{status, action, requested_on, code}` for a valid unexpired token (no email or phone ever returned). `POST {t}` sets `verified_at`, `verified_ip`, status `verified`, then kicks `privacy-clerk` (`{"run":"case","code":...}`). `GET ?t=&download=1` streams the export JSON once the case is `done` and the action is `export` (private Storage bucket `privacy-exports`, file deleted 7 days after first download or 30 days after creation, whichever comes first). Rate limit: 20 requests per token per hour (count in a small table or in `privacy_cases`), wrong tokens get a flat 404 after a 300 ms delay.

## Phase 3 — Vera's worker

Edge function `supabase/functions/privacy-clerk/index.ts` (verify_jwt true, called by cron through `invoke_edge_function` and by the RPCs). Cron `privacy-clerk` every 10 minutes at minute 2 (`2-59/10 * * * *`), created inside `if not exists (select 1 from cron.job where jobname = 'privacy-clerk')`.

Each tick, for every open privacy ticket and case:
1. Ticket with no case → create the case. If no email → status `no_email`, raise `Vera: <name/phone> asked to <action> their data but left no email. Call them back to get one.` (person waiting). Owner-guard hit → `needs_jared`.
2. `awaiting_verification` and not sent → send template `privacy-verify` through `send-transactional-email` (idempotency key `privacy-verify-<code>-<token>`). Not verified after 3 days → one reminder (key `privacy-remind-<code>`). Not verified after 14 days → status `could_not_verify`, raise to Jared with the suggested next step (call them back, or close it as unverifiable). Never email a denial on her own.
3. `verified` → by action:
   - delete / export → `privacy_scan`, status `ready`, push `Vera: <name> confirmed. Tap to delete their data: <N> records in <M> places.` (export: "Tap to send their data file"). Link `/admin/maya`.
   - opt_out → insert into `suppressed_emails` (and `rg_dnc` if a phone), send template `privacy-done` (opt-out wording), status `done`, redact, close ticket, recap as `success`.
   - correct → status `needs_jared` with the ticket's issue text.
4. `approved` → delete: `privacy_execute`; delete Maya ElevenLabs conversations whose caller number matches (list `GET /v1/convai/conversations?agent_id=agent_3701m4jbjnyef6ga4ys73xtbz37s`, read `metadata.phone_call.external_number`, `DELETE /v1/convai/conversations/{id}`), plus the ticket's own `conversation_id`; then send `privacy-done` with the per-place counts and the keep reasons; redact; close the ticket (`status = 'done'`, note `Vera: deleted N records`). Export: `privacy_export` → upload JSON to the private bucket → `privacy-done` (export wording, with the same short link and "Download my data") → status `done` (redact only after the download or expiry).
5. Errors: retry next tick; after 3 failed ticks on the same case raise `privacy.clerk` with the error in plain words. Resolve it when the case moves.
6. Map completeness check once a day (first tick after 7:00 AM Pacific): any `public` base table with a column matching the email/phone pattern used in this plan that is not in `privacy_data_map` → raise `Vera: <table>.<column> holds personal data and isn't on my map yet.` (not an interrupt; recap).

Write a `privacy_clerk_state` row (single row: last_tick_at, last_ok_at, last_error) every tick for the team pulse.

**Email templates** (`supabase/functions/_shared/transactional-email-templates/`, register in `registry.ts`; from `Bestly Privacy <privacy@bestly.tech>`, replyTo `privacy@bestly.tech` **only if that mailbox or alias really receives mail** (check `bestly-mail-ingest`, the mail setup notes in bestly_memory, and the privacy contact address in `src/pages/PrivacyPolicy.tsx`); otherwise use the address the privacy policy already tells people to write to, everywhere this plan says privacy@bestly.tech (emails and the confirm page); Bestly brand voice, plain words for the least-informed reader, no emoji):

`privacy-verify` — subject "Confirm your Bestly data request".
> Hi {first name or "there"},
> On {date} you asked Bestly to {delete your data | send you a copy of your data | stop sending you marketing | correct your data}. To make sure it was really you, tap the button below.
> [Yes, this was me] → bestly.tech/p/{token}
> If you didn't ask for this, ignore this email and nothing will change.
> This link works for 14 days. Your reference is {code}.

`privacy-done` — subject "Your Bestly data request is done".
> Delete: "We deleted your information from {M} places in our systems." Then, only if any keep rows matched: "We kept a few records because the law requires it: {reasons, one per line}. They're used for nothing else." 
> Export: "Your data file is ready. [Download my data] (works for 7 days)."
> Opt-out: "You're off our marketing list. You'll still get receipts and messages you ask for."
> Close: "Questions? Reply to this email or call (213) 641-0074. Reference: {code}."

## Phase 4 — the admin side (inside `/admin/maya`)

In `src/components/admin/maya/TicketCard.tsx`, privacy tickets get a **Privacy case** panel (new component `src/components/admin/maya/PrivacyCasePanel.tsx`) fed by `admin_privacy_case(code)`:
- Step tracker: Link sent → Confirmed → Found → Approved → Done (current step highlighted; times in 12-hour format).
- Found list grouped **Delete**, **Blank out**, **Keep** (reason under each), **Your call** (checkbox each, unchecked by default). Each row: friendly place name (map `ava_*` → "Ava call logs", `rg_*` → "RoofGuard (Reese)", `mail_contacts` → "Mail contacts", etc.; fall back to the table name) and count ("3 records").
- Primary button: **Delete now** (export: **Send their data**) → confirm sheet restating counts → `admin_privacy_approve`. Secondary: **Resend link**, **I verified them** (note required), **Cancel request** (note required).
- `no_email`, `could_not_verify`, `needs_jared` show the reason in plain words and the next step.
- The ticket stays in Needs follow-up until the case is done.

## Phase 5 — onboarding, watchdog, verify, ship

- `team_onboard`: slug `privacy-clerk`, name **Vera**, role **Privacy Clerk**, dept `ops`, reports_to `security-auditor` (Ares), runs_on `cloud`, schedule "every 10 min", admin_url `/admin/maya`, what_it_does in plain words, pulse `{"src":"at","table":"privacy_clerk_state","col":"last_tick_at","gap":30,"also":["privacy-clerk"],"alert":true}`, owns `["privacy"]`.
- `maya-watch` already flags privacy deadlines; leave it. Vera's own self-heal: retries, map check, and Team Watch on her pulse.
- **End-to-end test with fake data only** (email `privacy-test-<random>@example.com`, phone `+1 310 555 01xx`): insert rows into 2 delete tables, 1 blank table and 1 keep table; file a ticket through `maya_file_ticket` with `kind=privacy, privacy_action=delete` (it will push "Maya: ..." once, acceptable; title the name "Privacy Test"); run the clerk; verify via `POST` to `privacy-verify` with the token; confirm `ready` and correct counts; approve via `admin_privacy_approve` (run as postgres); run the clerk; assert delete rows gone, blank column null, keep row untouched, ticket closed, case `done` and redacted. Point the test email at a real inbox only if Jared asks; otherwise let `example.com` bounce and confirm the send was queued with the right template and link. Clean up test rows afterwards (keep the audit row, marked `note = 'test'`).
- `npx tsc --noEmit -p tsconfig.app.json` (ignore pre-existing errors you did not cause) and `npm run build` pass. `curl` checks: `privacy-verify` with a bad token → 404; `privacy-clerk` without auth → 401.
- Logical commits (`privacy clerk data + functions`, `privacy confirm page + emails`, `privacy case panel on Maya Desk`), pull --rebase, push.
- Insert `bestly_memory` rows: area `privacy`, key `privacy/vera-clerk-2026-10-11` (what shipped, IDs, test result, anything skipped) and area `house`, key `rule-privacy-map` ("Any new table holding emails or phones must get rows in privacy_data_map in the same migration; Vera flags it daily otherwise").
- Add one line to CLAUDE.md "rules of the road": the privacy map rule above.

## Out of scope

- Deleting data inside the iOS apps or browser extensions (Cookie Yeti keeps data on the device; InventoryProof's storage needs its own check — list it as a "Check the app" line in the done email only if a future map entry says so).
- Stripe customer deletion (billing records are kept; the plan is canceled separately).
- Verifying by phone or SMS.
