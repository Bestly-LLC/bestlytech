

## Mobile Optimization for Community Learning Panel

The page currently uses full `<Table>` components everywhere, which overflow or become unreadable on mobile. The fix is to convert all data-heavy sections to a card-based layout on small screens, matching the pattern already used in other admin pages (Dashboard, Contacts, Hire Requests).

### Problem Areas

1. **Tabs bar** (line 719-727): 7 horizontal tabs with icons and text — overflows on mobile, no scroll indicator
2. **Health indicator cards** (line 654-715): `grid-cols-2 lg:grid-cols-4` works but the 5th/6th cards orphan awkwardly
3. **Permanently Failed alert** (line 624-642): Button row wraps poorly on narrow screens
4. **PageHeader actions** (line 613-621): "Add Pattern" + "Refresh" buttons crowd the title
5. **All 7 tables** (Domains, Recent, AI Candidates, AI Log, Gen Results, Dismissals, User Reports): Standard `<Table>` components with 5-8 columns that are unreadable below 768px
6. **AI Generator header** (line 905-937): Title + 3 buttons in a `flex-row` — wraps messily
7. **Dismissals actions bar** (line 1319-1338): Same `flex-row` crowding issue
8. **Filter buttons** in Pending Candidates (line 1009-1019): Tiny touch targets

### Changes

**File:** `src/pages/admin/CommunityLearning.tsx`

1. **Tabs**: Add `overflow-x-auto` with horizontal scroll + hide scrollbar CSS, shrink text on mobile (`text-xs`), hide tab icons below `sm`

2. **PageHeader actions**: Stack vertically on mobile via `flex-col sm:flex-row`

3. **Permanently Failed alert**: Wrap content with `flex-wrap` and make buttons full-width on mobile

4. **Health indicators grid**: Change to `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4` so 6 cards flow evenly

5. **All tables → mobile card layout**: For each table section, add a `md:hidden` card-based layout and `hidden md:block` on the table. Each card shows the key info (domain, status, badges) in a stacked format with proper touch targets. This covers:
   - Domains table (6 columns → card with domain header + stats grid)
   - Recent patterns table (10 columns → card with domain, selector, action, confidence)
   - Pending Candidates table (8 columns → card with domain, status, CMP, re-run button)
   - AI Generation Log table (8 columns → card with domain, status, timestamp)
   - Gen Results table (5 columns → card)
   - Dismissals table (5 columns → card with domain, selectors)
   - User Reports table (5 columns → card with domain, report count, status)

6. **AI Generator header**: `flex-col sm:flex-row` for title/buttons, button group wraps with `flex-wrap gap-2`

7. **Dismissals header**: Same `flex-col sm:flex-row` treatment

8. **Filter buttons**: Increase touch target size on mobile (`py-2 px-3` on small screens)

### Approach

Use the established `md:hidden` / `hidden md:block` pattern from the other admin pages. Mobile cards will be simple `<div>` blocks with consistent padding, borders, and the same badge/color system. No new components needed — just responsive alternatives inline.

This is a large file (1466 lines) so edits will be focused on the JSX return section (lines 609-1466), converting each table section one at a time.

