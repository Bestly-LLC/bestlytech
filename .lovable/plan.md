

# Admin Dashboard Audit — Issues Found

After reviewing all admin files, here are the issues I identified:

---

## 1. Security: Admin check uses hardcoded email (Medium Risk)

`useAdminAuth.ts` checks `user?.email === "jaredbest@icloud.com"` on the client side. While RLS policies also enforce this server-side (which is good), the client-side check is brittle. This is acceptable for a single-admin setup but worth noting — no code change needed unless you want a `user_roles` table.

## 2. `fetchAll` dependency array is empty (Bug)

In `CommunityLearning.tsx` line 117, `useCallback` for `fetchAll` has `[]` as deps, but line 86 checks `if (!overview) setLoading(true)` — `overview` is stale inside the callback since it's closed over the initial `null`. After the first load, subsequent calls to `fetchAll` (e.g. after running the fixer) will never show loading, which is the *desired* behavior now, but the logic is accidentally correct. The `overview` ref will always be the initial `null` on the first render when `fetchAll` is created, so the guard works on first call but breaks if `fetchAll` is ever recreated. **Should use a ref instead of state for the "has loaded once" check.**

## 3. Bulk revoke in `CYGrantedAccess.tsx` does sequential deletes (Perf)

Lines 68-74: The `bulkRevoke` function loops through selected IDs and does individual `delete().eq("id", id)` calls. Should use a single `.in("id", [...ids])` call like `AdminSubmissions` does for bulk updates.

## 4. `useAdminRealtime` has stale dependency

Line 41 in `useAdminRealtime.ts`: `tables.join(",")` in the deps array — this creates a new string each render if the `tables` array reference changes. The hook callers in `AdminDashboard` and `CYDashboard` create new array literals on every render (e.g. `tables: ["seller_intakes"]`), so the channel gets torn down and recreated every render. **Should memoize the tables array at call sites or stabilize inside the hook.**

## 5. No error handling on several Supabase queries

Multiple pages silently swallow errors — `CYSubscribers`, `CYGrantedAccess`, `AdminDashboard`, `AdminSubmissions` all call `.select()` but never check for `error`. If a query fails, data silently becomes empty.

## 6. Missing `waitlist_subscribers` RLS for admin read

The `waitlist_subscribers` table has no admin read policy — only `service_role` can read. If you ever want to display waitlist data in admin, you'd need to add an admin RLS policy.

---

## Proposed Fixes

| # | Fix | File |
|---|-----|------|
| 2 | Replace `overview` state check with a `hasLoadedRef` to correctly track first load | `CommunityLearning.tsx` |
| 3 | Replace sequential delete loop with single `.delete().in("id", [...ids])` | `CYGrantedAccess.tsx` |
| 4 | Stabilize `tables` array inside `useAdminRealtime` using `useRef` + comparison | `useAdminRealtime.ts` |
| 5 | Add basic error toasts on failed queries in `AdminDashboard`, `AdminSubmissions`, `CYSubscribers`, `CYGrantedAccess` | Multiple files |

These are all small, targeted fixes — no UI changes, no database migrations.

