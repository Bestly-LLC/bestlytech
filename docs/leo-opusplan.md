# Leo — Turo trip helper (voice): status and next steps

Created 2026-10-10 from the agent template (`agent-hub create`, spec in `docs/agents/leo.spec.json`). Trip-page button and key tools added 2026-10-11. Spent nothing, no number bought.

## Live today

| Piece | Value |
|---|---|
| Admin page | `/admin/agents/leo` (AgentDesk). Service + Messages only; no Sales column (Leo doesn't sell) |
| ElevenLabs agent | `agent_2501m4mb0gppf23943pftcjqem0a` ("Leo (Turo) [leo]"), auth on: signed sessions only, bestly.tech origins, trust context low |
| Voice / LLM | Maya's defaults (`cjVigY5qzO86Huf0OWal`, `qwen35-397b-a17b`), Pacific timezone |
| Where guests reach him | "Talk to Leo" row at the top of the Ask sheet on personal trip links (`/t/:token`, `/lax/t/:token`) and the demo pages. Not on driver pages or the token-less `/lax` page |
| Tools (all `trip-voice?tool=`) | `trip_status`, `key_fix` (check_key, resend_key, make_key_now, refresh_car), `job_status`, `extra_driver` (status, check, resend, notify_host), `notify_host`, `file_ticket`, plus `end_call` |
| Knowledge | "Leo KB - starter": Blue Steel house rules, key flow, Supercharging billing, return-charge rule |
| Team card | slug `leo`, dept `turo`, reports to jared |
| Limits | 3 at once, 100 a day on ElevenLabs; $10 a day cap in app; 8 voice sessions per trip per hour |

## How the trip page talks to Leo (security)

1. The page posts its trip token to `trip-voice` `{op:"session"}`. The function checks the trip with `lax_agent_diag`, rate-limits, asks ElevenLabs for a signed URL, and stores a random key `tv_<48 hex>` in `trip_voice_sessions` (45 minutes).
2. The page starts the call with the signed URL and passes only the key as the dynamic variable `trip_key`. The trip token never reaches ElevenLabs, its logs or transcripts.
3. Each tool call carries `trip_key` and `system__conversation_id`. The first call checks with ElevenLabs that the conversation is a live Leo call under 2 hours old and binds the key to it; later calls must come from that conversation.
4. Tools run the same token-scoped, rate-limited SQL as the text helper (`lax_agent_diag`, `lax_agent_act`, `lax_agent_job`, `lax_agent_driver`; `lax_demo_tool` on demo pages, which never touch the real car). Nothing new can touch a key that the text helper couldn't.

Tickets: `leo_file_ticket` writes `support_tickets` with `source = 'agent:leo'`, product Turo, and pings Jared signed "Leo:" (a guest waiting is one of the 4 kinds of news). Maya's ticket RPCs now skip `agent:%` sources; `admin_agent_tickets` / `admin_agent_ticket_counts` serve other agents. Maya's old `file_ticket` tool was removed from Leo: it rejects any call that isn't Maya's.

CSP: trip pages (`/(t|lax|d)/:path*`, `/lax`) got their own CSP that allows `wss://api.elevenlabs.io`. The SDK's audio worklets and resampler are self-hosted in `public/vendor/elevenlabs/` (from `@elevenlabs/client` 1.27.0 and `libsamplerate-js` 2.1.2) because the CSP blocks `blob:` worklets and jsDelivr. Update those files when the SDK is upgraded.

iPhone audio: iOS only plays sound from an AudioContext unlocked inside a tap, and `@elevenlabs/client` arms that unlock as a side effect of being imported. Importing it after the tap (the first version did) left the speaker silent: ElevenLabs generated Leo's voice but the phone never played it. `LeoVoice` now imports the SDK when the sheet opens (never on page load) and lets the SDK ask for the mic itself. Closing the sheet hangs up.

UI (2026-10-11): ElevenLabs-widget style white card (gradient orb, black "Call Leo" pill, mute + End while live, last 6 lines of the call), two suggestions from the trip's stage and key state (`leoSuggestions` in `AskSheet.tsx`) that start a call and ask that question. The page button and sheet title read "Talk to our team 24/7". Mood tags the voice model writes ("[sad]") are stripped from the on-screen transcript and discouraged in the prompt.

Watchdog: Switchboard (`agent-watch`) re-attaches Leo's `tool_ids` and webhook every 10 minutes; `trip-voice` raises `agent.line.leo` (signed "Leo:") when ElevenLabs refuses a session or a ticket can't be saved.

## Next

1. **Live charging numbers.** A `trip_charging` tool reading what the Charging card shows (stops, cost so far, return-at level), so Leo says the guest's own totals.
2. **Driver pages.** Extra drivers' own pages (`/d/:token`) don't show Leo yet; the session check would need to accept driver tokens.
3. **Phone line.** Leo is web-only. Giving him a number means tools see `trip_key = none` and fall back to messages unless the caller can be matched to a trip.
