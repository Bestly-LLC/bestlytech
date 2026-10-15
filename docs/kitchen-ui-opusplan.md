# Kitchen page: phone + desktop pass, lightning shortcut (opusplan, 2026-10-14)

Jared, 8:55 PM: "optimize the UI/UX for Kitchen for mobile and add a shortcut to the lightning shortcut panel for this.
we need optimized for desktop also. both. opusplan sonnet-execute"

Page: `src/pages/admin/HomeHubKitchen.tsx` (route `/admin/home-hub/kitchen`, Basil the Kitchen Manager).
Lightning panel: `QuickTools` in `src/components/admin/MobileNav.tsx` (phone only, `md:hidden`, 3-column grid, 7 tools).
Rules that apply: `.claude/skills/apple-design` first, then the ui-ux-pro-max pass (CLAUDE.md), `docs/admin-ui-conventions.md`
(rem only, one primary action, destructive behind a confirm, 44px phone targets, numbers never wrap from units),
dark admin + light "bento" theme designed together, quiet at rest, never truncate with "...".

## What's wrong today (measured on a 375 x 812 phone with real data)
| Where | Problem |
|---|---|
| Tonight | Three idea cards stack vertically: about 900px before the first stat. The list starts below two full screens. |
| Stat tiles | A 2 x 2 grid of tall tiles: about 300px for four numbers. |
| Tell Scout + Recent | Below a 119-item list on phones: effectively unreachable. Undo for a voice mistake is far away. |
| Add item | Primary button scrolls away with the header; the dialog is centered, far from the thumb. |
| On the way | Nothing tells you an order is coming or lets you say it arrived (the DB now has `basil_kitchen_arrived()`). |
| Filters | Live only in React state: back/forward and a shared link lose them; the lightning panel can't deep-link. |
| Desktop | Right column scrolls away with the list; rows are phone-sized on a 1440px screen; no keyboard path to search. |

## Build (one file each, keep the existing data flow and RPCs)

### A. Shared (phone and desktop)
1. **On-the-way banner.** When `counts.arriving > 0`, show a slim banner under the Tonight card:
   Truck icon, "N items on the way" (number + unit in one `whitespace-nowrap` span), and an outline button
   **"It's all here"** that calls `rpc("basil_kitchen_arrived")`, toasts "Got it. N items are in stock" with no undo
   (the Recent list has per-item undo), and reloads. Disable + spinner while running.
2. **URL state.** Mirror `query`, `loc`, `statusFilter` into `useSearchParams` (`?q=`, `?where=fridge`, `?status=low`),
   `replace: true` so typing does not flood history. Read them on mount. Invalid values fall back to defaults.
3. **Recent events from Basil.** `SOURCE_ICON` gets `basil: ChefHat` (label "By Basil"); events whose `said` starts
   with "delivered" read "<name> arrived".

### B. Phone (< 640px, `sm:` breakpoint)
1. **Tonight becomes a horizontal snap row**: `flex overflow-x-auto snap-x snap-mandatory`, each card `snap-start`
   at `w-[82%]` so the next card peeks (affordance), `scroll-px-4`, hidden scrollbar. From `sm:` up keep the
   current 3-column grid. Use-soon chips stay under it and may wrap.
2. **Stat tiles become one compact row of four**: `grid-cols-4`, `min-h-16`, number over a short label
   ("In stock", "Low", "Used up", "Coming"). Still toggle buttons with `aria-pressed`. From `sm:` up keep current tiles.
3. **Latest change strip** above the list (phone only): the newest undoable event as one line,
   "<name> <status word> · 2m ago" + an **Undo** text button (44px). Hidden when there is none. The full Recent
   and Tell Scout panels stay at the bottom.
4. **Add from the search bar**: on phones put a 44px "+" icon button (aria-label "Add item") at the end of the sticky
   search row, so adding is always one tap away. The header button stays for `sm:` up (hide it below `sm:`).
5. **Add sheet**: below `sm:` the add form opens in the bottom `Drawer` (`src/components/ui/drawer.tsx`, vaul:
   drag to dismiss, rubber-band built in); from `sm:` up keep the `Dialog`. Same form component inside both.
   Name field autofocuses; inputs stay `text-base` (16px, no iOS zoom).

### C. Desktop (>= 1280px, `xl:`)
1. **Sticky side column**: wrap Tell Scout + Recent in `xl:sticky xl:top-20 bento:xl:top-24 xl:self-start` so
   activity and undo stay in view while the long list scrolls.
2. **Denser rows**: `xl:py-2` on item rows, category + quantity on the same line as the name
   (`xl:flex-row xl:items-baseline xl:gap-2`), badges stay after the name.
3. **Keyboard**: "/" focuses search when focus is not already in a field (ignore when any modifier is held);
   Escape in the search clears it, a second Escape blurs. Show a quiet "/" key hint inside the search field on
   `xl:` only (`aria-hidden`).
4. **Two-column groups on very wide screens**: at `2xl:` render the location groups in `2xl:columns-2 2xl:gap-8`
   with `break-inside-avoid` per group, so a 1536px+ screen shows twice as many items. The sticky toolbar spans both.

### D. Lightning panel (`MobileNav.tsx` `TOOLS`)
Add two tools so the grid is a full 3 x 3:
- `{ label: "Kitchen", sub: "Pantry & dinner", icon: ChefHat, tint: "#FFD60A", to: "/admin/home-hub/kitchen" }`
- `{ label: "Groceries here", sub: "Mark order arrived", icon: PackageCheck, tint: "#AC8E68", run: ... }` where `run`
  calls `rpc("basil_kitchen_arrived")` and returns "Got it. N items are in stock." (N = `delivered`; "1 item is"
  when 1), "Nothing was on the way." when 0, or "Didn't go through: <error>". (Both tints are unused in TOOLS.)
Order: put Kitchen after Sky, Groceries here after Kitchen.

## Done means
- `npx tsc --noEmit -p tsconfig.app.json` clean (ignore the two WowButton errors) and `npm run build` passes.
- Screenshots with the mocked RPC harness (pattern below) at 375 x 812 dark, 390 x 844 light, 1440 x 900 dark
  and light, 1728 x 1117 dark (2xl): no horizontal page scroll, no clipped labels, no wrapped number/unit pairs.
- Reduced motion: the snap row and toolbar still work with `prefers-reduced-motion: reduce` (emulate in Playwright).
- Second pass with ui-ux-pro-max: touch targets, focus rings, aria on every new control, contrast in both themes.
- Commit with a clear message, rebase on `origin/main`, push to `main` (CLAUDE.md: always push).

### Preview harness (temporary, never commit)
`kitchen-preview.html` at the repo root loading `src/__kitchen_preview.tsx`, which renders `<HomeHubKitchen />` inside
`div.admin-shell` (add `admin-bento` + `bg-[#F3F2EE]` when `?light`) under a fake sticky header
`h-12 sm:h-14 bento:h-16`, with sonner's `<Toaster />`. Run `npx vite --host 127.0.0.1 --port 5199 --strictPort`.
Playwright: `chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })`; route `**/rest/v1/rpc/basil_kitchen*`
to mock JSON (`items`, `ideas`, `events`, `last_tick`, `now`); include a few `arriving` items so the banner shows.
Delete both harness files before committing.
