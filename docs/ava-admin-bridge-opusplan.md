# Ava ↔ /admin bridge — Opus plan (2026-10-13)

## Goal
When Jared calls Ava (personal agent `agent_0301m44te1qffk08jd2cqwtgy1th`, line (816) 429-9495), she can read admin status, read metrics, and start/pause call operations — by voice, near-instantly.

## Ground truth (verified 2026-10-13)
- Ava has **no webhook tools** today: only system tools end_call, transfer_to_number (+18165007236), play_keypad_touch_tone. tool_ids = [].
- Ava's call-start hook: `https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/ava-assistant?hook=init` (header x-ava-init). Post-call webhook id b1889b1006864bd2bf02162e44380136.
- Agent auth off; allowlist bestly.tech, admin.bestly.tech.
- No ElevenLabs workspace secret exists for an admin bridge yet (only SIP trunk creds).
- Supabase project rcqfqhguwpmaarseifqg. Relevant tables: voice_agents, agent_calls, ava_calls, ava_errands, ava_followups, agent_lead_queue, pipeline_all, hunter_campaigns, hunter_call_outcomes, hunter_health, maya_leads, rg_leads, tenants, ai_spend, ai_spend_mix_today, system_alert_state.
- Repo Bestly-LLC/bestlytech (main). Pattern to copy: Leo's trip-voice webhook tools (secret header + conversation check). Memory protocol: read/write `bestly_memory`, secrets only in Supabase Vault.

## Design

### 1. Base URL (speed over pretty)
`https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/ava-admin`
- Direct Supabase URL, no Vercel proxy hop: Ava must answer near-instantly. Not guest-facing, so the short-link rule doesn't apply.
- One edge function `ava-admin`, `verify_jwt: false` (auth is our own header).

| Tool name (ElevenLabs) | Method + path | Purpose |
|---|---|---|
| `admin_status` | GET `/status?q=` | Overall admin health, or look up one tenant / lead / contact by name or phone |
| `call_ops` | POST `/calls` | Start, pause, resume a campaign or agent queue; place one outbound call by an agent |
| `admin_metrics` | GET `/metrics?range=` | Calls, minutes, spend, lead pipeline counts per agent |

### 2. Auth (three layers)
1. **Header** `Authorization: Bearer <AVA_ADMIN_SECRET>` — random 48-hex secret.
   - Stored in Supabase Vault as `ava_admin_bridge_secret`.
   - Stored in ElevenLabs as a **workspace secret** named `ava_admin_bridge_secret`; tools reference it by secret_id (never pasted inline). Create via ElevenLabs API `POST /v1/convai/secrets` using the ElevenLabs key from Vault. Record the secret_id in bestly_memory.
   - Compare in constant time.
2. **Conversation check** — every call carries `conversation_id` (dynamic var `system__conversation_id`, constant assignment, not LLM-filled). Server GETs `/v1/convai/conversations/{id}` and requires agent_id = Ava and status in-progress. Cache 60 s per id so only the first tool call pays the lookup.
3. **Caller gate** — `caller_id` from `system__caller_id`. Jared's numbers only: +18165007236, +14242349256. Anyone else (Mom, unknown) → `{ok:false, reason_code:"not_jared", say:"That's something only Jared can pull up."}`. Web calls from admin.bestly.tech: allow when ava-assistant init hook already marked the session as Jared (reuse its flag; read how init identifies him).
   - Write ops (`call_ops`) additionally require `confirmed: true`, which the prompt only sets after reading the action back and hearing a yes.
   - Known gap → flag to Ares: caller ID can be spoofed. Mitigation now: writes are capped (below) and every write pushes a notification signed by Ava.

### 3. Request schemas
**GET /status**
- `conversation_id` string (required, dynamic var)
- `caller_id` string (required, dynamic var)
- `q` string (optional) — name, phone, or company. Empty = overall health.

**POST /calls** (JSON body)
```json
{
  "conversation_id": "string, required",
  "caller_id": "string, required",
  "action": "start_campaign | pause_campaign | resume_campaign | place_call",
  "agent": "maya | reese | ava | leo",
  "campaign": "string, optional — name or id; required for *_campaign",
  "to": "string, optional — E.164 or contact name; required for place_call",
  "purpose": "string, optional — one sentence, required for place_call",
  "confirmed": "boolean, required — must be true"
}
```
Limits: max 20 place_call per day via this bridge; campaigns respect existing agent caps (Ava $5/day etc.). Idempotency key = conversation_id + action + target (ignore duplicate within 2 min).

**GET /metrics**
- `conversation_id`, `caller_id` (required)
- `range` = `today | yesterday | 7d | 30d` (default today)
- `agent` = `all | ava | maya | reese | leo` (default all)

### 4. Response format (built for voice)
```json
{
  "ok": true,
  "say": "One or two short sentences Ava reads as-is. 12-hour times, no IDs, no jargon.",
  "data": { "...": "compact facts for follow-up questions" },
  "next": "optional one-line suggested follow-up"
}
```
Errors: `{ "ok": false, "reason_code": "not_jared | bad_secret | stale_call | not_found | ambiguous | limit_hit | upstream_down", "say": "..." }` — always HTTP 200 for tool-level failures so Ava speaks the `say`; 401 only for bad secret.
- `ambiguous` returns up to 3 `data.choices` (name + one detail) so Ava can ask "Which one?"
- Times: America/Los_Angeles, 12-hour ("3:05 PM"). Money "$4.20". Counts as words-friendly numbers.
- Keep `say` under ~200 chars; keep total payload < 2 KB.
- Target p95 < 600 ms. Use parallel queries; no LLM inside the function.

Examples:
- status (no q): `"All green. 2 things need you: a Turo claim reply and a RoofGuard callback. Maya's on, Reese is paused."`
- metrics today: `"Today: 14 calls, 38 minutes, $3.10 spent. Maya booked 1 demo. Pipeline has 22 qualified leads."`
- call_ops start: `"Done. Reese's Tuesday campaign is running, 40 leads queued."`

### 5. ElevenLabs config
- Create 3 workspace webhook tools (`agents_create_tool`), attach by `tool_ids` to Ava.
- `conversation_id` / `caller_id` → dynamic-variable assignments, not LLM params.
- Auth header uses the workspace secret reference.
- `response_timeout_secs` 8; `pre_tool_speech` auto (filler OK per Jared); `disable_interruptions` false.
- Ensure Ava has dynamic var placeholders for `system__caller_id` on web calls (defaults so web sessions don't fail like Leo's did).
- Prompt: append one short "Admin bridge" block (don't rewrite the rest — Jared owns tone): when Jared asks about the business, call the tools; read `say` verbatim; for call_ops read the action back and only set confirmed=true after a clear yes; never mention tools, IDs or JSON. Save the previous version id for undo.

### 6. Watchdog (required) — owned by Ava, alerts to Scout
- pg_cron hourly (off the :00): call `ava-admin/selftest` (internal op, service-role auth) → exercises status + metrics against a fixed test conversation stub, checks p95 and that Ava still has the 3 tool_ids and the secret still matches.
- On failure: auto-recover (re-attach tool_ids, re-sync secret from Vault to ElevenLabs), then `bestly_raise('ava.admin-bridge', ...)` signed by Ava if recovery failed.
- No Claude scheduled tasks.

### 7. Writes back
- Migration file in repo `supabase/migrations/2026101320xxxx_ava_admin_bridge.sql` (log table `ava_admin_bridge_log`: ts, conversation_id, caller_id, op, args, ok, reason_code, ms).
- Function source in `supabase/functions/ava-admin/`; commit to main.
- bestly_memory row `ava/admin-bridge-2026-10-13`: URLs, tool ids, secret_id (not the value), agent version ids before/after, undo steps.
- Admin: small "Admin bridge" card on /admin/ava showing last 10 log rows + health light (optional if time allows; don't block on it).

## Out of scope / defaults taken
- Direct Supabase URL rather than bestly.tech/api/... (latency).
- Reads are Jared-only too (Mom can still leave messages; she can't hear the business).
- No PIN (Jared hates friction); spoof risk flagged to Ares instead.
