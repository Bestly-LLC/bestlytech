# Leo — Turo trip helper (voice): status and next steps

Created 2026-10-10 from the agent template (`agent-hub create`, spec in `docs/agents/leo.spec.json`). Spent nothing, no number bought.

## Live today

| Piece | Value |
|---|---|
| Admin page | `/admin/agents/leo` (AgentDesk; all four status lights green after first sync) |
| ElevenLabs agent | `agent_2501m4mb0gppf23943pftcjqem0a` ("Leo (Turo) [leo]") |
| Voice / LLM | Maya's defaults (`cjVigY5qzO86Huf0OWal`, `qwen35-397b-a17b`) |
| Line | Web only (no phone number) |
| Tools | `end_call`, Maya's `file_ticket` (use_ticket_desk) |
| Knowledge | "Leo KB - starter": Blue Steel house rules, key flow, Supercharging billing, return-charge rule |
| Team card | slug `leo`, dept `turo` (moved by hand: live agent-hub v2 ignores `spec.dept`), reports to jared |
| Limits | 3 concurrent, 100 calls a day on ElevenLabs; $10 a day cap in app |

Purpose is `Turo`, not `Bestly`: the Turo fleet is Jared's own business, and the card belongs with Claims Closer and the other Turo employees.

## Not done by `create` (tailoring, needs code)

1. **On the trip pages.** Leo is not embedded yet. Add a "Talk to Leo" voice button next to the existing text helper (`src/pages/lax/AskSheet.tsx`) using the ElevenLabs web SDK with the agent id above. Pass the trip token as a dynamic variable so tools can be scoped to that guest. Never put the trip token in a URL query string.
2. **Real key tools.** The text helper (`lax-ask`) already has `diagnose`, `check_key`, `resend_key`, `make_key_now`, `refresh_car`, `job_status`, driver tools and `notify_host`. Expose the same RPCs to Leo as ElevenLabs server tools behind a small token-scoped edge function (reuse `lax-ask` `runTool`, same per-guest limits: resend max twice per 6 hours). Then update Leo's prompt: drop "You cannot make, re-send, or check keys yourself".
3. **Live charging numbers.** A `trip_charging` tool reading what the Charging card shows (stops, cost so far, return-at level) so Leo can say the guest's own totals instead of pointing at the card.
4. **Ticket desk split.** With `tickets` on, Leo's page shows Maya's Sales and Service columns and Maya's copy ("Maya has it covered", her Done count). Guest tickets should land in a Turo view, not Maya's queue: filter the ticket columns by `agent_slug` and take the column copy from the agent name.
5. **Header title.** The admin header reads "Not found" on `/admin/agents/:slug`; the route title map needs the agent name.

Build order: 4 and 5 (small, UI), then 2, then 1, then 3. Plan with Opus, build with Sonnet, stay on the template (no custom page needed).
