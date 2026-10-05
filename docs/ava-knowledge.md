# What Ava can say (ava_knowledge)

## What she may say, and where it comes from
On a call, an Ava (Jared's personal one, or RoofGuard's) may say only what is in the `ava_knowledge` table, plus the caller's own contact or lead row and the clock. For anything else she takes a message. RoofGuard Ava reads rows with `scope in ('roofguard','both')`; the personal Ava reads `('personal','both')`. Jared edits the list in `/admin` (RoofGuard > What Ava can share, `KnowledgeList` in `src/components/admin/roofguard/AvaShared.tsx`).

## Eli suggests, Jared approves
Eli sees every live RoofGuard fact in the partner portal (Ava > What Ava says) and can suggest new ones. A suggestion is never live on its own:

1. Eli saves it through `ava_knowledge_propose`. The row is stored with `status = 'pending'` and `active = false`.
2. Jared gets a quiet alert (`rg:knowledge`, signed by partner-scout) and sees the fact under "Suggested by Eli" with Approve / Decline.
3. Approve makes it `live` and `active`. Decline marks it `declined` (kept, with Jared's optional note, so Eli sees why). Either way Eli gets a push.
4. Eli can edit or withdraw a suggestion while it is still pending. He can never change a live fact, scope, status or `active`.

Partners have no rights on the table. All partner access is through SECURITY DEFINER functions (`ava_knowledge_partner_list`, `_propose`, `_withdraw`; Jared's are `_review` and `_pending_count`), and each re-checks the caller's role. Migration: `supabase/migrations/20261005130000_ava_knowledge_partner.sql`.

## Why a pending fact can never reach a call
Three independent layers:
- **Trigger** `ava_knowledge_guard` forces `active = false` on every insert and update unless `status = 'live'`. It cannot be bypassed from the client.
- **Every reader filters** `status = 'live'` as well as `active`: `knowledge()` in `roofguard-caller` and in `ava-assistant`. No SQL function or view reads the table. A new reader must add the same filter.
- **No partner write path** except the functions above, which only ever write pending rows.

## The hard-rule screen
`src/lib/roofguardRules.ts` (`checkRoofguardFact`) is a deterministic checker, no AI. It shows plain-English warnings to Eli as he types and to Jared on the review card. Warnings never block a save. It screens for the rules in `docs/roofguard/caller-agent.md`:
- the word "replace" or "replacement" (the term is roof renewal)
- calling RoofGuard insurance, coverage or a policy (a sentence saying it is NOT insurance is fine)
- naming or hinting at customers, partners, testimonials or "companies like yours"
- a deadline, limited spots, a discount or special offer
- a price, dollar amount, percentage, or a savings, income or ROI claim
