# RoofGuard: what a buyer takes (split-off map)

Kept separate on purpose (Jared, 2026-10-04) so RoofGuard's owners can buy this piece cleanly. Personal Ava (`ava_*`, `ava-assistant`, `/admin/ava`) is **not** part of it.

## Goes with RoofGuard

| Piece | Where |
|---|---|
| Leads, calls, openers, DNC, holidays, settings, follow-ups, scorecard | tables `rg_*` (`rg_leads`, `rg_calls`, `rg_openers`, `rg_dnc`, `rg_holidays`, `rg_settings`, `rg_followups`, `rg_pitch_templates`, `rg_enrich_runs`) |
| Database logic | functions `rg_*` (queue, board, KPIs, costs, watchdogs, follow-ups, weekly review) |
| Phone finder | edge fn `roofguard-enrich` |
| Caller (RoofGuard Ava) | edge fn `roofguard-caller`, its ElevenLabs agent "RoofGuard caller (Ava)", its Telnyx outbound profile + SIP connection |
| Schedules | crons `roofguard-*` (enrich, watch, watch-calls, dial, daily-report, followups, pace, weekly-review) |
| Admin UI | `/admin/roofguard` (`src/pages/admin/RoofGuard.tsx`, `src/components/admin/roofguard/*`) |
| Partner demo | the "Ava" tile in the partner portal (`src/pages/partner/PartnerAva.tsx`) |
| Docs | `docs/roofguard/*` |
| Vault secrets | `elevenlabs_webhook_secret`, `telnyx_sip_password` (the buyer brings their own `elevenlabs_api_key` / `telnyx_api_key`) |

## Shared today, split at handoff

- **ElevenLabs and Telnyx accounts** are Jared's. A buyer opens their own, pastes their keys into Setup, and re-runs it. The agent, trunk and number get rebuilt in their accounts. Call history stays in `rg_calls`.
- **Phone number:** RoofGuard needs its own (the old one, (816) 429-9495, became personal Ava's line on 2026-10-04 before any prospect was called). Buy it in the buyer's Telnyx account, or port it there.
- **Platform plumbing** (`invoke_edge_function`, `bestly_raise`, `scout_notify`, `has_role`) is Bestly's. A standalone copy needs small stand-ins.

## Steps for a split

1. Export the `rg_*` schema and data (pg_dump `-t 'rg_*'`) into the buyer's Supabase project.
2. Deploy `roofguard-enrich` and `roofguard-caller` there, plus the `roofguard-*` crons.
3. Copy `src/components/admin/roofguard/*` and `RoofGuard.tsx` into their admin (or ship as a standalone page).
4. They paste their ElevenLabs and Telnyx keys, buy or port a number, and run Setup.
5. Remove RoofGuard from Bestly (sidebar entry, route, partner tile, crons).
