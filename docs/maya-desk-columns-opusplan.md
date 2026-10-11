# Maya Desk: 3 collapsible columns — opusplan (2026-10-10)

Planned by Opus, executed by Sonnet. Jared, Oct 10 5:32 PM: port Ava's layout to Maya as a custom **3-column** page, **Sales · Service · Messages**, all collapsible.

Replaces the segmented control on `/admin/maya` (`src/pages/admin/MayaDesk.tsx`, built in `docs/maya-desk-opusplan.md`). Same data, same RPCs, same edge functions. **Frontend only, no SQL, no edge function changes** (if you find a missing field, stop and report it rather than changing the backend).

## Layout

```
┌ Header: Maya · Sales & Service · (213) 641-0074 · LineStatus · stat chips (Open, Overdue, Leads, Privacy) ┐
├──────────────── Sales ───────────────┬──────────────── Service ─────────────┬──────────────── Messages ────────────┤
│ Demo requests (open leads)           │ Needs follow-up (support, billing,   │ Recent calls: time, length, caller,  │
│ Contacted / Not a fit / Spam         │ call back, privacy + Vera's panel)   │ one-line summary, ticket chips;      │
│ Closed leads (collapsed group)       │ Done (collapsed group, Reopen)       │ tap = transcript sheet               │
└──────────────────────────────────────┴──────────────────────────────────────┴──────────────────────────────────────┘
```

- **Desktop (≥ 1280px, `xl:`)**: three equal columns side by side (`xl:grid-cols-3`, `items-start`), each column its own scroll-free card stack. A collapsed column becomes just its 56px header row, and the open columns keep their width (no reflow jumps: keep the 3-column grid; a collapsed column simply has a short card).
- **Tablet (`lg:` to `xl:`)**: two columns: Service | Messages, then Sales spans full width below. (Service first because it holds people waiting.)
- **Phone**: one column, stacked in this order: **Service, Sales, Messages**. Each collapsible.
- Each column is a `CollapsibleSection` from `src/components/admin/roofguard/CollapsibleSection.tsx` (reuse it, do not fork it): ids `maya-col-sales`, `maya-col-service`, `maya-col-messages`; all `defaultOpen` true; it already remembers open/closed per section in localStorage with try/catch. Note its header comment says always-open areas don't use it; for this page Jared explicitly wants all three collapsible, so use it and add a one-line comment in MayaDesk saying so.
- Column header: icon (lucide `TrendingUp` for Sales, `LifeBuoy` for Service, `MessagesSquare` for Messages), title, `badge` = count pill (Sales: open leads; Service: open tickets, orange when any overdue; Messages: calls today), and the closed-state `summary` line: Sales "2 demo requests · newest 4:04 PM", Service "3 open · 1 overdue · 1 privacy", Messages "5 calls today · last 4:04 PM" (12-hour times; show "Nothing waiting" / "No calls yet" when empty).
- Inside a column, groups that are secondary (Closed leads, Done) are a small disclosure row ("Done · 12") that expands in place; collapsed by default.
- Ticket cards: reuse `src/components/admin/maya/TicketCard.tsx` unchanged (it carries Vera's `PrivacyCasePanel` for privacy tickets). Calls: reuse `MayaCalls.tsx` list rows and the existing transcript sheet.
- Remove the segmented control and its saved-segment localStorage key (leave old keys alone; just stop reading them).
- Keep the counts polling (60 s, paused while hidden) and drive all three badges from `admin_maya_counts` plus the loaded lists.
- Empty states per column, plain words: Sales "No demo requests yet. Maya pitches the Bestly Agent when a caller runs a business." Service "Nothing waiting. Maya has it covered." Messages "No calls yet."
- Loading: skeleton rows per column; errors: plain text + Retry per column (one column failing never blanks the others).

## Rules

- Load `.claude/skills/apple-design/SKILL.md` first, then a `ui-ux-pro-max` pass (Skill tool) on the result.
- Admin dark shell; match Ava's page cards (`rounded-3xl bg-white/[0.03] ring-1 ring-white/10`), spacing and type scale.
- Never truncate with "..." (no `truncate`, `line-clamp` on names, issues, summaries); numbers never split from units (`whitespace-nowrap` on "3 min", "45 days", "4:04 PM"); 12-hour times; no emoji.
- 44px minimum hit targets; header buttons keyboard and screen-reader friendly (CollapsibleSection already is).
- Do not touch Ava's or Reese's pages, Maya's ElevenLabs agent, billing tables, or any backend.
- `npx tsc --noEmit -p tsconfig.app.json` (ignore pre-existing errors you didn't cause) and `npm run build` must pass.
- Render check: run `npm run build && npx vite preview`, then with Playwright (Chromium at `/opt/pw-browsers`, do not install browsers) mount the page in isolation if the admin route needs auth: create a throwaway `src/dev/MayaDeskPreview.tsx` only if needed, screenshot desktop 1440×900 and phone 390×844 with mocked data, look at both screenshots, fix what looks wrong, then delete the throwaway file before committing. If isolation is too invasive, skip screenshots and say so.
- One commit (`Maya Desk: Sales, Service, Messages columns`), `git pull --rebase origin main`, `git push origin main`, attribution lines as instructed.
- Insert (never update) a `bestly_memory` row: area `maya`, key `maya/desk-columns-2026-10-11`, what changed and the commit.
