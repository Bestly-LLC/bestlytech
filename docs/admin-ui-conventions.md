# Admin UI conventions

Applies to everything under `/admin`. Based on Apple's Human Interface Guidelines and the
ui-ux-pro-max checklist; written after the 2026-09 audit.

## Actions and buttons
- **One primary action per page** (solid). At most one or two secondary actions (outline) beside it.
- **Everything else goes in the "More" menu** — `ActionMenu` from `@/components/admin/ActionMenu`.
  Exports, maintenance jobs, rarely used tools, and refresh when the page already auto-polls.
- **Order by task, not by when it was built.** Group menu items (`group: "Export"`, `"Maintenance"`).
- **Row actions:** one `ActionMenu` per row. No rows of three or four icon buttons.
- **Bulk actions** appear only when rows are selected, in a bar above the table.
- **Destructive:** last, in red, separated, and always behind an `AlertDialog` confirm.
- **Every async action** disables itself and shows progress while running, then a toast that says
  what happened. Errors say what failed and how to recover.
- **Every write verifies it did something.** Supabase returns success when RLS matches 0 rows, so
  chain `.select("id")` on update/delete and treat an empty result as a failure.
- Icon-only buttons need `aria-label` and a tooltip. Minimum hit area `h-9 w-9` (36px at 100%).

## Type, colour, sizing
- **rem only.** No `[..px]` Tailwind values: the header's text-size control scales the root font
  size, and px values would not follow it.
- Text on the black shell: body `text-white/70`+, secondary `text-white/55` minimum (AA 4.5:1).
  `text-white/20–40` is for decorative icons and dividers only.
- Semantic status colour always comes with a word or icon (never colour alone).

## States
- Loading: skeletons in the final layout; the Bestly mark (`BrandLoader`) only for whole-page waits.
- Empty: `EmptyState` with what will appear here and, if there is one, the action that fills it.
- Error: inline message with **Retry**; keep showing the last good data when there is some.
