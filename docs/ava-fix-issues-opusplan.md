# Ava fixes issues by voice — Opus plan (2026-10-13)

> **Build split (2026-10-13 1:10 PM).** The safety check refused the voice-yes grant (section 3): letting a phone call, where caller ID can be faked, unlock write-capable Scout runs weakens security.
> - **Phase A (building now):** `list`, `retry`, `ask_scout` (autopilot only, writes stay blocked), `check`. For `approve` and `undo`, Ava does **not** run anything. She says "That one needs your tap" and puts a one-tap card in the "Ava (voice)" thread and Needs you, linked to the existing Fix Ladder "Yes, do it" button. No change to admin-chat's autopilot rules.
> - **Phase B (on hold for Jared):** voice approvals and undo through a grant. These need a stronger identity check than caller ID (a spoken PIN, a passkey tap on his phone, or a callback check) before they can be built.

Jared, 1:00 PM: "I want her to be able to fix issues also."

## What it means in practice
On a call, Jared says "what's broken?" / "fix the Pi thing" / "yes, do it". Ava:
1. **Lists** what's open, one line each, most urgent first.
2. **Retries** an incident up the Fix Ladder ("try again").
3. **Approves** a fix the ladder already wrote and parked at `needs_yes` (his spoken yes = the one tap in the alert pane).
4. **Hands anything else to Scout** ("Scout, make the Maya page load faster") as a background job, then reports back.
5. **Checks** a job she started and tells him the result on the same call, or after.
6. **Undoes** an automatic fix that kept an undo (security_autofix_log and friends).

She never writes the fix herself. Every fix runs through the machinery that already exists: `fix-ladder`, Scout (`admin-chat`), and the Auto-Fixer undo log. Ava is the voice front door.

## Ground truth (verified 2026-10-13)
- Bridge live: `ava-admin` edge function, tools `admin_status` / `call_ops` / `admin_metrics` attached to Ava (agent version `agtvrsn_1601m4vctk91e1mbjvf82pb6z1kd`). Auth: raw secret in `Authorization`, live-conversation check, caller must be +18165007236 or +14242349256. Log `ava_admin_bridge_log`, state `ava_admin_bridge_state`, watchdog cron `ava-admin-bridge-selftest` (:17 hourly). Memory row `ava/admin-bridge-2026-10-13`.
- `monitor_issues` right now: 11 open at `needs_yes`, 1 at `claude`, 1 at `scout`, 165 fixed. So approvals are the biggest win on day one.
- `fix-ladder` (POST, service key OK): `op:"retry", key` re-climbs one incident. Tick climbs auto → free_ai → scout → needs_yes / claude.
- A `needs_yes` incident carries `scout_ask` (the one action, plain words). Today the pane's "Yes, do it" sends `Yes, do it: <scout_ask>` to Scout as Jared (admin JWT, not autopilot), so write tools are allowed.
- `admin-chat` on the service path runs as **autopilot**: `AUTOPILOT_NEVER` blocks commit_files / db_write / mac_run. That is correct for unattended runs and must stay that way.
- Precedent: `voice-ask` (wall "Hey Scout") already routes voice to admin-chat on autopilot and logs every turn into a "Hey Scout (voice)" chat.
- Autonomy guardrails (docs/autonomy-opusplan.md): never automatic = money moves, deleting data, anything a client/customer sees, legal/registrar in someone else's account, turning on paid AI.
- Known wart: `ava-assistant` `setup()` PATCHes Ava's prompt and wipes the Admin bridge block; the hourly selftest re-adds it.

## Design

### 1. One new tool: `fix_issue`  →  POST `/fix` on `ava-admin`
Same auth stack as the other three (secret, live call, Jared's number). Body:
```json
{
  "conversation_id": "dynamic var system__conversation_id",
  "caller_id": "dynamic var system__caller_id",
  "action": "list | retry | approve | ask_scout | check | undo",
  "issue": "string, optional — what Jared called it ('the Pi', 'Maya site'); server matches it",
  "ask": "string, optional — required for ask_scout: the job in his words",
  "job_id": "string, optional — for check; defaults to the last job in this call",
  "confirmed": "boolean — required true for retry, approve, ask_scout, undo"
}
```
Response is the bridge's normal `{ok, say, data, next}` / `{ok:false, reason_code, say}`.

**Matching `issue`:** fuzzy match over open `monitor_issues` (title, area, key) + open Needs-you cards (`admin_today_rows()`) + recent auto-fixes with an undo. 1 hit → go. 2–3 → `reason_code:"ambiguous"`, `data.choices` (short names) so she asks "Which one?". 0 → `not_found`.

### 2. Actions
| action | does | say (example) |
|---|---|---|
| `list` | open incidents + Needs-you cards, deduped, needs_yes first, max 3 spoken, total count | "Three things. The Pi's Pi-hole stopped reporting, I have a fix ready. Maya's site is slow. El Dora's domain needs you. Want me to do the Pi one?" |
| `retry` | `fix-ladder` `{op:"retry", key}` | "Kicked it back to the ladder. I'll check in a minute." |
| `approve` | only for `fix_stage = needs_yes`. Reads `scout_ask`, preview first (confirmed false → read it back), then on yes mints a **voice-yes grant** (below) and starts Scout with `Yes, do it: <scout_ask>` | preview: "The fix is: restart the Pi-hole stats job and repoint it to port 8080. Want it?" / after: "On it. Scout's running it now." |
| `ask_scout` | starts a Scout job on **autopilot** (no write grant) with his words + "From Ava, Jared on the phone". Anything that needs writes comes back NEEDS_YES and becomes a new approvable item | "Scout's looking. Give it a couple of minutes." |
| `check` | reads the job: running / FIXED / NEEDS_YES / STUCK + the one-line result | "Done. Pi-hole stats are flowing again." / "Scout needs one yes: …" |
| `undo` | reverses an automatic fix that has an undo record (Auto-Fixer `security_autofix_log`, fix-ladder log entries with undo). Preview, then yes | "Put it back the way it was." |

All writes: preview first (`confirmed:false` → `reason_code:"not_confirmed"` + the read-back line), then the real call only with `confirmed:true` after a clear yes. Same 2-minute idempotency as `call_ops`.

### 3. The voice-yes grant (the one real change to Scout)
Problem: approving needs a write-capable Scout run, but the service path is autopilot (writes blocked), and we must not open autopilot up.
Fix: a **single-use, narrow grant**.
- Table `ava_fix_grants`: id, issue_key, action_text (= scout_ask, exact), conversation_id, created_at, expires_at (+10 min), used_at, result.
- `ava-admin` inserts the grant, then calls `admin-chat` (service key) with `{ op:"send", autopilot:true, voice_grant:<id>, text:"Yes, do it: <scout_ask>", thread:<Ava voice thread> }`.
- `admin-chat`: if `voice_grant` is present, look it up; valid only if unused, unexpired, and `text` matches `Yes, do it: ${action_text}` exactly. Then run that one turn with Jared's yes semantics (same tools and confirmation rules as the pane's "Yes, do it"), mark `used_at`. Anything else in that run that needs a *different* yes still stops at NEEDS_YES. No grant / bad grant → plain autopilot, unchanged.
- Paid AI: the grant never turns paid AI on. It follows the Paid AI master switch exactly like the pane does (free ladder first, paid only if the switch is on).

### 4. Guardrails (in code, not just prompt)
- **Never approvable by voice** (Ava says "That one needs your tap in admin," and the card stays in Needs you): `scout_ask` or the incident touches money (refunds, payments, Stripe, Mercury, CDTFA), deleting data, anything a client/customer sees (emails/texts out, client portal, public site copy), registrar/legal in someone else's account, turning on paid AI. Classify with a keyword + area check in `ava-admin`; when unsure, refuse voice approval. (Caller ID can be spoofed — this keeps the blast radius small. Flag stays with Ares.)
- Max 10 approvals + 10 Scout jobs per day through Ava.
- Every approve / undo / ask_scout posts a note signed by **Ava** (normal `notify_route`, info class — it lands in the bell + 7 PM recap, no push). Result notes are signed by whoever fixed it (Scout / the owner), as today.
- Every Ava-started Scout job lands in one admin chat thread **"Ava (voice)"** so Jared can follow up there; unread result = purple dot, NEEDS_YES / STUCK = orange dot (his dot rule).
- `ava_admin_bridge_log` logs every fix op (op, issue_key, grant id, ok, ms).

### 5. Getting the answer back
- Scout jobs run in the background; the tool call returns within ~1 s with a `job_id` (thread + message id). Never block the call past the 8 s timeout.
- **During the call:** prompt says after starting a job, keep chatting; if Jared asks "did it work?" call `check`. Optional: one `check` on her own after ~60 s if the call's still going.
- **After the call:** the result is already in the "Ava (voice)" thread with the right dot. If the job ends NEEDS_YES or STUCK and the call is over, the note is signed by Ava and says what she needs; it does not push unless it's one of the 4 interrupt classes (`interrupt_class()` decides, no wording tricks).

### 6. ElevenLabs config
- Create webhook tool `fix_issue` (POST `/fix`), same header secret reference (`ava_admin_bridge_secret`, secret_id `vo5pDuehb8dEUvLmbbUX`), same dynamic-var assignments and placeholder defaults, timeout 8 s, pre_tool_speech auto.
- LLM params: `action` (enum), `issue`, `ask`, `job_id`, `confirmed` with clear descriptions.
- Attach alongside the 3 existing tool_ids; keep end_call / transfer_to_number / play_keypad_touch_tone and workspace_overrides untouched. Record version before/after.
- Extend the existing "Admin bridge (Jared only)" prompt block (don't touch the rest): when he asks what's broken → `list`; offer the top fixable one; read back before any change; only `confirmed:true` after a clear yes; if a fix "needs your tap in admin", say exactly that; never read out keys, IDs, code or JSON.

### 7. Fix the prompt-wipe wart
`ava-assistant` `setup()` must preserve the marked Admin bridge block (re-append it after its PATCH, using the same `MARKER` / `PROMPT_BLOCK` source — move them to `_shared/ava-admin-prompt.ts` so both functions import one copy). The selftest repair stays as the backstop.

### 8. Watchdog (extend, don't add a new cron)
`ava-admin/selftest` (cron `ava-admin-bridge-selftest`, :17 hourly) also checks: `fix_issue` tool attached; `/fix` `list` returns ok via the selftest stub; a fake grant is refused by admin-chat (send a bad grant id → must come back autopilot/blocked); `ava_fix_grants` has no unused grant older than 1 hour (expire them). Auto-repair as today; `bestly_raise('ava.admin-bridge', …)` signed by Ava if repair fails. Update Ava's bridge team card `pulse` / `tool_of` to mention fix jobs.

### 9. Ship
- Migration `supabase/migrations/20261013210000_ava_fix_issues.sql`: `ava_fix_grants` (RLS on, admin read only), any helper SQL (issue matching view, undo lookup), team card update. No new email/phone columns (caller_id already mapped) — if one is added, add `privacy_data_map` rows.
- `ava-admin` new route + `admin-chat` grant check (bump its version note in the header comment; keep an `_undo_admin-chat_vNN` copy like prior changes).
- Tests (real, no live harm):
  - `/fix list` with the selftest stub → real open items.
  - `approve` with `confirmed:false` on a real needs_yes item → read-back line only, nothing runs.
  - Guardrail: an item touching money/client/delete → `reason_code:"needs_tap"`.
  - Grant: bad / expired / mismatched-text grant → admin-chat stays autopilot (writes blocked). Valid grant path proven on a harmless incident only if one exists at needs_yes whose `scout_ask` is a read-only or self-contained restart; otherwise leave it for Jared's first call and say so.
  - `undo` preview only.
- Commit + push to main. bestly_memory row `ava/fix-issues-2026-10-13` (tool id, grant table, guardrail list, versions, undo steps).

## Defaults taken (Jared can change)
- Voice yes approves everything except money / delete / client-facing / registrar / paid-AI — those still need his tap.
- No PIN; spoofing risk handled by the guardrail list + daily caps + Ava-signed notes.
- Paid AI is never turned on from a call.

---

# Phase B: approve and undo with a passkey tap (Opus plan, 2026-10-13 1:35 PM)

Jared picked **passkey tap**. Who holds authority is the key point: **the phone call never approves anything.** Ava only *requests* an approval. The approval happens on Jared's phone, in his signed-in admin session, behind Face ID (WebAuthn user verification). It is the same "Yes, do it" the Fix Ladder pane already has, reached faster. Caller-ID spoofing then gets an attacker nothing more than a push Jared ignores.

## Ground truth (verified 2026-10-13)
- Admin passkeys already exist: `src/lib/passkey.ts` plus the edge functions `webauthn-register` / `webauthn-authenticate` (Face ID / Touch ID, used by `AdminLogin`, `DeviceSignIn`, Settings).
- Browser push already exists: `push-subscribe` / `push-notify` (Safari + Chrome popups for the admin).
- Short guest links already route in `src/App.tsx` (`/t/:token`, `/g/:token`, `/d/:token`, `/p/:token`). Every link has to be short, per his rule.
- `ava-admin` `/fix` (Phase A, v4) returns `needs_tap` for approve and undo. Fix Ladder `needs_yes` incidents carry `scout_ask`. The pane's "Yes, do it" sends `Yes, do it: <scout_ask>` to Scout as Jared (admin JWT), which allows writes. The undo records are in `security_autofix_log` and wherever Phase A found them.

## Flow
1. On the call, Jared says "approve the Pi fix". Ava calls `fix_issue {action:"approve", issue, confirmed:true}` after reading it back.
2. `ava-admin` writes an `ava_approvals` row: id, short code (7 chars, as in `/t/abc1234`), kind approve|undo, issue_key, the exact action_text, conversation_id, expires_at (+10 min), status pending. It sends a **push** to Jared's subscribed devices: title "Ava: tap to approve", body = the action in plain words, link `bestly.tech/y/<code>`. It returns `{ok:true, say:"Sent to your phone. Tap it and Face ID it."}`.
3. `/y/:code` is a new tiny page (Apple design pass). It requires admin sign-in; if he's signed out it sends him to the passkey login and returns to `/y/:code`. It shows exactly what will run, who asked (Ava, from the call at 1:42 PM), and the expiry, with two buttons: **Approve** and **No**.
4. **Approve** runs a fresh passkey ceremony through `webauthn-authenticate`, with user verification **required**. A signed-in session alone is not enough; every approval needs its own Face ID. On success the page calls the RPC `ava_approval_decide(code, 'approve', <assertion proof>)`. The RPC is admin-guarded and checks that the assertion is fresh (under 60 s) and bound to this approval's challenge. The page then runs the approved action through the **same paths the admin already uses**:
   - approve → the same askScout "Yes, do it: <scout_ask>" call the Fix Ladder pane makes (admin JWT, so Jared really is present).
   - undo → the existing undo path for that record, called with the admin JWT.
5. Ava `check`s the approval on the call (`fix_issue {action:"check"}` reads approval status, then the Scout job). She says "Got your tap. Scout's on it," and later gives the result.
6. **No**, expiry, or a second use sets status declined, expired or used. Nothing runs.

## Guardrails
- **No change to admin-chat's autopilot rules.** No grant table and no service-path write mode. Everything that writes runs from Jared's authenticated browser.
- One push per approval. At most 5 pending approvals at a time and 20 a day. Codes are single-use, expire in 10 minutes, and are bound to one issue_key and one action_text. If the incident changed since the request (its scout_ask is different now), the page refuses and asks Ava to re-request.
- Push class: add a narrow, documented **`requested_now`** interrupt class to `interrupt_class()`. It applies only to `ava_approvals` pushes created during a verified live Ava call from Jared's number. Jared asked for it on the call, so it's a real person, him, waiting. No other source can use it.
- Paid AI is never switched on by this flow; Scout follows the master switch as usual.
- Every request and decision is logged (`ava_admin_bridge_log` plus an Ava-signed info note: "You approved X at 1:43 PM").
- Privacy: `ava_approvals` holds no phone or email. If it ends up holding one, add `privacy_data_map` rows.

## Watchdog (extend the existing :17 selftest)
- Expire stale pending approvals.
- Check that `/y/:code` renders (a GET of the page shell).
- Check that push-notify is reachable.
- Check that an expired or used code is refused by `ava_approval_decide`.
- Repair or raise `ava.admin-bridge` as today, signed by Ava.

## Ship
- Migration `20261013220000_ava_passkey_approvals.sql`: table, RLS (admin only), the `ava_approval_decide` RPC, the `interrupt_class()` addition, and the team card pulse.
- `ava-admin` approve/undo now create the request instead of returning `needs_tap`. `check` covers approvals.
- Page `src/pages/AvaApprove.tsx` plus the route `/y/:code` in `src/App.tsx`. Use the Apple design skill, then UI UX Pro Max. Don't truncate text, don't split a number from its unit, and use 12-hour times.
- The prompt block learns: "Sent to your phone, tap and Face ID it", then check.
- Tests: create a request on a harmless incident and stop before tapping (Jared does the first real tap). Expired, used and mismatched codes must be refused. A signed-out visit must go to passkey login. tsc and build must be clean.
- Commit and push. Write the bestly_memory row `ava/passkey-approvals-2026-10-13`.
