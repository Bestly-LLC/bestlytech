# Phone agents: the template

Short version: a new phone agent is a row in `voice_agents`, an ElevenLabs agent, and the shared `AgentDesk` page. Nobody copies Ava's or Reese's pages. Plan and rules: `docs/agent-template-opusplan.md`.

## What the template gives every agent

- A page at `/admin/agents/:slug` (`src/pages/admin/AgentDesk.tsx`, parts in `src/components/admin/agent/`): orb tinted by `orb_hue`, line number, status lights, live call banner, spend chip and cap, Settings.
- Calls: every finished call is logged (`agent_calls`) by the post-call webhook, numbered per agent, with transcript, recording, summary, caller data and cost.
- The Coach (`agent-coach`) scores each call over 20 seconds with free AI and proposes playbook lines. Nothing reaches the prompt until Approve.
- Switchboard (`agent-watch`) checks every 10 minutes: agent exists, webhook attached, tools attached, number assigned, last calls synced, spend under the cap. It fixes what it can and raises alerts signed with the agent's name.
- Voice picker with preview, Knowledge editor, Prompt editor with "Improve with free AI", and the Tailor card.
- Optional modules by `voice_agents.modules`: `tickets` and `privacy` (Maya's ticket desk), `calls`, `coach`, `voice`, `knowledge`, `spend`.

## Make one (the + button)

Sidebar, Agents group, the + (or "New agent" on any agent page) opens `/admin/agents/new`. Phone first, one screen:

1. Who is it for (Personal, Bestly, RoofGuard, A client business, Something else), a name (3 free-AI ideas), a short name (the slug).
2. Quick bits: tap what it does (answers questions, takes messages, books appointments, qualifies leads, sells, support tickets, privacy requests, outbound script, website chat).
3. One line about the job, then Autofill with free AI (`free-llm` `{op:"run", paid:"never"}`). Greeting, script, knowledge starter, call fields, Team card and orb color land in editable boxes. "Use the template (no AI)" builds the same boxes from the quick bits. If free AI fails twice, Scout (paid, only when tapped) or Copy for Claude, and a paste box to bring the JSON answer back.
4. Voice (Maya's by default), 5. Line (Web only, a spare number from `numbers_free`, or ask Scout), 6. Create.

Create calls `agent-hub` action `create`. It is idempotent per slug, so Retry just runs it again and finished steps report done: agent made, voice set, knowledge added, number assigned, calls hooked up (`setup`), Team card (`team_onboard`, with the pulse reading `agent_health`). It never buys a number and never spends money. A new agent also gets a daily limit of 100 calls and 3 at once on the voice platform, and a $10 daily spend cap in this app.

Making the agent is free. Calls cost about $0.12 a minute (editable per agent).

## Tailor it (template to custom)

The Tailor card on every agent page. Tone, script or knowledge changes: "Try with free AI" hands the request to the Prompt section. Anything the template cannot do (a custom tool, a page, a workflow): Copy build prompt for Claude, or Ask Scout (paid). The prompt tells Claude to plan with Opus in `docs/<slug>-opusplan.md`, build with Sonnet, stay on the template unless a custom page is truly needed, and if so add `src/pages/admin/agents/<Slug>.tsx` and point `voice_agents.page_url` at it, like RoofGuard.

## Where the code lives

| Piece | Where |
|---|---|
| Registry and data | `voice_agents`, `agent_calls`, `agent_reviews`, `agent_playbook`, `agent_health`; `admin_agent*` RPCs |
| Voice platform door | `supabase/functions/agent-hub` (webhook, setup, sync, live, audio, voices, knowledge, prompt, playbook, numbers_free, create) |
| Watchdog and coach | `agent-watch`, `agent-coach` (Team cards Switchboard and Coach) |
| Pages | `AgentDesk.tsx`, `AgentNew.tsx`, `src/components/admin/agent/*` |

## Legacy vs template

Ava (`/admin/ava`) and Reese (`/admin/roofguard`) are `legacy` rows in `voice_agents`: they show in the sidebar and the registry but keep their own pages, tables and functions. Do not fork them and do not migrate them without a plan. Maya is a template agent at `/admin/maya` (the URL renders AgentDesk). Everything new starts from the template.
