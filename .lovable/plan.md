

# Admin Dashboard Enhancement Plan

This is a large set of 8 features. I'll break them into logical phases to implement across the admin suite.

---

## 1. Real-time Notifications
- Subscribe to `seller_intakes`, `subscriptions`, and `granted_access` tables using Supabase Realtime
- Show toast notifications when new records arrive while the admin is viewing the dashboard
- Add a pulsing badge on sidebar items when new items come in since last visit
- **DB change**: Enable realtime on `seller_intakes`, `subscriptions`, `granted_access` tables

## 2. Activity Feed / Audit Log
- Create a new `admin_activity_log` table to track key events (new submission, access granted, pattern maintenance run, etc.)
- Add a unified timeline card on the main `AdminDashboard` page showing the latest ~20 events across all areas
- Populate via database triggers on key tables (inserts on `seller_intakes`, `granted_access`, `pattern_fix_log`)
- **DB change**: New `admin_activity_log` table with columns: `id`, `event_type`, `description`, `metadata (jsonb)`, `created_at`. RLS: admin-only read, service_role write.

## 3. Data Export (CSV)
- Add a "Export CSV" button to the Submissions, Subscribers, and Granted Access table pages
- Client-side CSV generation from the already-fetched data arrays (no new backend needed)
- Use a small utility function that converts JSON array to CSV and triggers a download

## 4. Dark Mode Toggle in Admin
- Already have `ThemeToggle` component using `next-themes`
- Add it to the admin header bar (in `AdminLayout.tsx`) next to the Home/Logout buttons

## 5. Keyboard Shortcuts
- Add a `useHotkeys` custom hook or use `@tanstack/react-query` patterns
- Implement `Cmd+K` / `Ctrl+K` to open a command palette (ties into feature 8)
- `Cmd+/` to toggle sidebar
- Show a small "?" keyboard shortcut hint in the sidebar footer

## 6. Dashboard Date Range Picker
- Add a date range picker component to `AdminDashboard` and `CYDashboard`
- Filter stat cards and recent tables by selected range (Last 7 days, 30 days, 90 days, custom)
- Use existing shadcn Calendar + Popover components

## 7. Bulk Actions on Submissions
- Add checkboxes to `AdminSubmissions` table rows (same pattern as `CYGrantedAccess`)
- Show a floating action bar when items are selected with status change options
- Batch update via Supabase `.in('id', [...ids])` queries

## 8. Search & Command Palette (Cmd+K)
- Create a `CommandPalette` component using shadcn's `command` (already installed)
- Global overlay triggered by `Cmd+K`
- Sections: Navigate (admin pages), Search (submissions by name/email, subscribers by email), Actions (grant access, toggle sidebar)
- Mount in `AdminLayout` so it's available on all admin pages

---

## Implementation Order

I recommend implementing in this order to build on dependencies:

1. **Dark mode toggle** — smallest change, immediate value
2. **CSV export** — client-side only, no DB changes
3. **Date range picker** — UI-only enhancement
4. **Bulk actions on submissions** — follows existing pattern from Granted Access
5. **Command palette + keyboard shortcuts** — combined since Cmd+K is the palette
6. **Real-time notifications** — DB migration + realtime subscriptions
7. **Activity feed** — new table + triggers + UI

## Database Migrations Needed

```sql
-- For realtime notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_intakes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subscriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.granted_access;

-- For activity feed
CREATE TABLE public.admin_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  description text NOT NULL,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read activity log"
  ON public.admin_activity_log FOR SELECT TO authenticated
  USING ((auth.jwt() ->> 'email') = 'jaredbest@icloud.com');

CREATE POLICY "Service role manages activity log"
  ON public.admin_activity_log FOR ALL TO public
  USING (auth.role() = 'service_role');

-- Trigger to auto-log new submissions
CREATE OR REPLACE FUNCTION public.log_new_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO admin_activity_log (event_type, description, metadata)
  VALUES ('new_submission',
    'New intake from ' || coalesce(NEW.client_name, NEW.business_legal_name, 'Unknown'),
    jsonb_build_object('intake_id', NEW.id, 'status', NEW.status, 'platform', NEW.platform));
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_log_submission
  AFTER INSERT ON seller_intakes
  FOR EACH ROW EXECUTE FUNCTION log_new_submission();

-- Similar triggers for granted_access inserts and pattern_fix_log
```

## Files to Create/Modify

| File | Change |
|------|--------|
| `src/components/admin/AdminLayout.tsx` | Add ThemeToggle, mount CommandPalette |
| `src/components/admin/CommandPalette.tsx` | **New** — Cmd+K command bar |
| `src/components/admin/ExportButton.tsx` | **New** — reusable CSV export button |
| `src/hooks/useKeyboardShortcuts.ts` | **New** — global hotkey listener |
| `src/hooks/useAdminRealtime.ts` | **New** — realtime subscription hook |
| `src/pages/admin/AdminDashboard.tsx` | Add date range picker, activity feed, realtime |
| `src/pages/admin/AdminSubmissions.tsx` | Add checkboxes, bulk actions bar, export button |
| `src/pages/admin/CYDashboard.tsx` | Add date range picker, realtime |
| `src/pages/admin/CYSubscribers.tsx` | Add export button |
| `src/pages/admin/CYGrantedAccess.tsx` | Add export button |
| `src/components/admin/DateRangeFilter.tsx` | **New** — reusable date range picker |
| `src/components/admin/ActivityFeed.tsx` | **New** — timeline component |

This is a significant set of enhancements. Shall I proceed with implementing all of them in the order listed above?

