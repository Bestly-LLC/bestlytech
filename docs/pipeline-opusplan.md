# Pipeline — opusplan (2026-10-12)

One page, `/admin/pipeline`, replaces Leads + Hunter + Jev scores as the place Jared watches leads go from found to called.
Planned by Opus, built by Sonnet agents. Design: Apple design skill first, then a UI UX Pro Max pass.

## Jared's answers (decisions, do not re-ask)
- Name: **Pipeline**. Sidebar keeps the Agents group too.
- Old CRM leads (All leads, In-House Cloud, Marketplace, Hire Requests) stay, as a **tab** on Pipeline.
- Handoff: **auto + manual override**. Hunter keeps handing off nightly; Jared can send or pull back any lead.
- Agents in Pipeline: **queue + call stats only**; tapping an agent opens its full page.
- Top of page: **Today at a glance** gauges.
- Layout: **one scroll, 4 zones**: Today → Flow → Agents → Leads. Settings behind a **gear → side sheet**.
- Charts: 14-day funnel, lead quality gauge, source performance, calls & outcomes per agent.
- Send a lead: **tap lead → "Send to" picker** (works on phone).
- Cross-send allowed: **any lead to any lead-taking agent**.
- Qualified = current rules (landline, not DNC/opted out, fit ≥ minimum, scored).
- New agents: opt-in **"Takes leads from Pipeline"** switch.
- Pull back: **ask each time** (Requalify / Archive / Do not call).
- Alerts owner: **Hunter**.
- Agents shown: Maya, Reese (lead callers); **Leo** (support, calls stats only, no leads);
  **Ava = errands**: personal call tasks ("settle my LADWP bill this week"), no KPIs, no leads.

## Zones (top to bottom)
1. **Header**: title, health chip (hunter_health), gear (settings sheet), tabs: Pipeline | Inbound (old CRM).
2. **Today**: 5 ring gauges — Found, Qualified, Queued, Called, Booked (today, with a goal ring = campaign daily targets).
   Plus a Lead quality gauge (avg reach odds × fit).
3. **Flow**: 14-day stacked funnel chart; Source performance bars (leads found / qualified per source, 14 days).
4. **Agents**: one card per lead-taking agent (Maya, Reese, + opt-in template agents): queue depth vs target bar,
   calls today, outcomes donut/bars (answered, voicemail, booked, not interested), next call time, "Open" link.
   Leo card: calls this week, top questions, no queue. Ava card: Errands list + "New errand" (who/number, what, by when)
   with "Call now" (existing Ava personal call, edge fn action "call" with the reason) — no metrics.
5. **Leads**: segmented filter (Qualified · Queued · Called · All), owner filter, search. Row = company, category, city,
   reach-odds ring, fit, owner chip, status. Tap → sheet: details, Apollo company info, score breakdown,
   **Send to [agent buttons]**, **Pull back** (asks: Requalify / Archive / Do not call).

## Settings sheet (gear)
Sections, existing components moved in as-is: Hunter (pause, min fit, line-type cap), Campaigns, Sources, Jev (JevCard),
Apollo (ApolloCard + per-agent nightly caps), Agents taking leads (switch per voice_agent).

## Data (backend agent)
New migration `2026101303xxxx_pipeline.sql`. All admin-guarded (`team_is_admin()`), SECURITY DEFINER, revoke anon.
- `voice_agents.takes_leads boolean default false`; set true for maya + reese.
- `agent_lead_queue(id, agent_slug, lead_table, lead_id, status queued|called|done|pulled, queued_at, note)` for template
  agents (non-Maya/Reese). privacy_data_map rows if it holds personal columns (it should not: ids only).
- `ava_errands(id, title, who, phone, details, due_by date, status open|calling|done|cancelled, last_call_id, created_at, done_at)`
  + privacy_data_map rows for phone (action delete).
- `pipeline_overview() returns jsonb`:
  { today:{found,qualified,queued,called,booked,targets:{queued}}, quality:{avg_reach, avg_fit, n},
    funnel14:[{day,found,qualified,queued,called,booked}], sources14:[{source,found,qualified}],
    agents:[{slug,name,purpose,kind:'leads'|'support'|'errands',page_url,queued,target,calls_today,
             outcomes:{answered,voicemail,booked,not_interested,other},next_call_at}], health:{ok,problems,checked_at} }
  Maya = maya_leads (+ agent calls tables already used by AgentDesk); Reese = rg_leads + rg_calls; Leo = agent_calls by slug.
  Use 12-hour local display on the client; return timestamptz.
- `pipeline_leads(p_status text, p_owner text, p_q text, p_limit int, p_offset int) returns jsonb` — union of maya_leads
  and rg_leads normalized to {lead_table, id, owner, company, category, city, state, phone_present, line_type, fit,
  reach (hunter_lead_scores.p_reach_dm), priority, status (qualified|queued|called|booked|archived|dnc|new), apollo
  (hunter_apollo_enrich.found), updated_at}. No phone numbers or emails returned in the list.
- `pipeline_lead(p_table, p_id) returns jsonb` — full detail for the sheet (incl. score row, apollo, call history counts).
- `pipeline_send(p_table text, p_id uuid, p_agent text) returns jsonb`:
  - maya_leads → maya: status 'queued', queued_at now.
  - rg_leads → reese: call_status 'not_called' (if not terminal), next_call_at now(), priority = greatest(priority, 90).
  - cross (maya_leads → reese / rg_leads → maya): insert a copy into the target table with the mappable columns
    (company, phone, website, category, city/state, line_type), queued the same way, and mark the source row archived
    (maya: status 'rejected', reject_reason 'sent to reese'; rg: call_status 'not_interested'? NO — add rg_leads.archived boolean).
  - template agent with takes_leads: insert agent_lead_queue row.
  - Refuse DNC / opted-out / missing phone with a plain message.
- `pipeline_pull(p_table, p_id, p_to text 'requalify'|'archive'|'dnc')`.
- `ava_errand_put(...)`, `ava_errand_set(p_id, p_status)`, `ava_errands_list()`.
- Wire Jev priority into Reese's dialer: `rg_next_call_batch` orders by coalesce(hunter_reese_priority(id), priority).
  Only if that function signature allows it cleanly; otherwise note it.
- Add `security_public_rpcs`? NO — admin only.
- Team card: Hunter already exists; extend its `owns` to 'pipeline' alerts if team_onboard supports update.
- Regenerate types into src/integrations/supabase/types.ts.

## Frontend (UI agent)
- `src/pages/admin/Pipeline.tsx` + `src/components/admin/pipeline/*` (TodayGauges, FlowCharts, AgentCards, AvaErrands,
  LeadsList, LeadSheet, SendToPicker, PullBackDialog, PipelineSettingsSheet).
- Route `/admin/pipeline`; redirect `/admin/leads`, `/admin/leads/hunter`, `/admin/leads/hunter/scores` → `/admin/pipeline`
  (keep `/admin/pipeline?tab=inbound` → old AdminLeads tabs content).
- Sidebar: replace Leads/Hunter/Jev scores with one **Pipeline** entry (keep the leads badge). Agents group unchanged.
- Rules: dark admin; numbers never wrap from units (`whitespace-nowrap` on value+unit); no "..." truncation (shorten/wrap
  instead); feathered soft edges on any glow/animation; 12-hour times; US units; 44px+ tap targets; reduced-motion respected;
  works at 375px width; no emoji.
- Charts: lightweight inline SVG or recharts if already a dependency (check package.json first).

## Watchdog
Hunter's existing `hunter-watch` covers sources/scoring/Apollo. Add: Ava errand due today and still open at 5 PM → raise
"Hunter"? No — errands are Ava's: raise as `ava.errand` signed Ava. Pipeline RPC errors surface in the page's alert row.

## Done means
Type-check clean, `npm run build` passes, migration applied, page loads at 375px and desktop, send + pull back verified on a
real lead (then reverted), committed and pushed to main.
