

# Phase 3 + 4: Admin Dashboard, Validation, and Cookie Yeti Admin

This is a large implementation covering the admin dashboard, validation edge function, enhanced client-side validation, and Cookie Yeti subscriber management.

---

## Database Changes (1 migration)

1. **RLS policies for admin access** on `granted_access` and `subscriptions`:
   - Add policy allowing `jaredbest@icloud.com` (via `auth.jwt() ->> 'email'`) full access to `granted_access` (insert/update/delete)
   - Add similar admin read policy on `subscriptions`
   - Add admin ALL policy on `seller_intakes`, `intake_documents`, `intake_validations`, `setup_guidance` for the admin email

2. **Enable Supabase Auth** (already available via Lovable Cloud) — no table changes needed since we are not storing profiles (admin is checked by email match only).

---

## Phase 3: Admin Dashboard

### Authentication
- **Login page** at `/admin/login` using Supabase Auth email/password
- After login, check if `user.email === 'jaredbest@icloud.com'` — if not, show "Access Denied"
- Auth context/hook: `useAdminAuth` — wraps `onAuthStateChange`, provides `user`, `loading`, `isAdmin`, `signOut`
- Protected route wrapper component `AdminRoute` that redirects to `/admin/login` if not authenticated/admin

### Layout
- `AdminLayout` component with:
  - Top nav: "Bestly Admin" left, user email + Logout right
  - Left sidebar (shadcn Sidebar, collapsible on mobile) with sections:
    - **Amazon**: Dashboard, Submissions, Setup Guide
    - **Cookie Yeti** (❄️ icon): CY Dashboard, Subscribers, Granted Access
  - Main content area

### Pages (all under `/admin/*`)

**Amazon Dashboard** (`/admin`):
- 4 stat cards: Total Submissions, New This Week, Needs Review, Approved
- Recent Submissions table (last 5)

**Submissions List** (`/admin/submissions`):
- Data table with columns: Business Name (link), Contact Name, Client Contact, Platform badge, Status badge, Submitted Date, Last Updated
- Filters: status dropdown, platform dropdown, search input
- Sort by column headers, pagination (20/page)

**Submission Detail** (`/admin/submissions/:id`):
- Header: business name, status badge, status change dropdown + save
- 10 expandable card sections: Client Contact, Business Info, Owner Info, Bank & Payment, Brand & Product, Authorization, Documents (with download/preview), Validation Warnings (with resolve), Setup Operator Guide (from `setup_guidance`), Admin Notes
- Document preview modal for images/PDFs
- Copy email/phone buttons

**Setup Guide** (`/admin/guide`):
- Platform tabs (Amazon, Shopify, TikTok)
- Grouped by section, each item shows field/guidance/recommendation/reason
- Inline editing + "Add New Entry" button

### Cookie Yeti Admin Pages

**CY Dashboard** (`/admin/cookie-yeti`):
- 5 stat cards: Total Premium, Paid Subscribers, Granted Access, Monthly Plans, Yearly Plans
- Two side-by-side sections: Recent Subscribers, Recently Granted
- Floating "Grant Access" FAB that opens a dialog

**Subscribers** (`/admin/cookie-yeti/subscribers`):
- Table: Email, Plan badge, Status badge, Stripe Customer ID (truncated + copy), Period End, Created
- Filters: status, plan, search by email
- Click row → Sheet panel with full details

**Granted Access** (`/admin/cookie-yeti/granted`):
- "Grant Premium Access" card at top: email input, reason, granted_by (auto-filled), Grant button
- Table below: Email, Reason, Granted By, Date, Revoke button (with confirmation)
- Search, sort, pagination, bulk revoke with checkboxes

---

## Phase 4: Validation

### Client-Side Validations (inline on form steps)
Add field-level validation (red error on blur) and cross-field warnings (yellow alerts) to existing step components:
- EIN format, DOB 18+, ID expiry future, phone US format, email format, routing 9 digits, ZIP 5 digits, card last4 4 digits, SSN format
- Cross-field: address mismatch warning, agent state vs registration state, bank name match, ID expiry <6mo, missing SSN for US resident, missing docs, DL back, store name check

### Server-Side Validation (Edge Function)
- Create `supabase/functions/validate-intake/index.ts`
- Accepts `intake_id`, reads submission + documents, runs 15 checks, deletes old validations, inserts new ones into `intake_validations`
- Called on form submit (after status → Submitted) and from admin "Run Validation" button

### Form Submission Flow Update
- On Step 7 Submit: run client-side validation first → block if critical errors → allow with acknowledgment for warnings → on success call `validate-intake` edge function → update status

---

## Routes to Add (in App.tsx)

```
/admin/login
/admin           (dashboard)
/admin/submissions
/admin/submissions/:id
/admin/guide
/admin/cookie-yeti
/admin/cookie-yeti/subscribers
/admin/cookie-yeti/granted
```

## New Files (~20+)

- `src/hooks/useAdminAuth.ts`
- `src/components/admin/AdminRoute.tsx`
- `src/components/admin/AdminLayout.tsx`
- `src/components/admin/AdminSidebar.tsx`
- `src/pages/admin/AdminLogin.tsx`
- `src/pages/admin/AdminDashboard.tsx`
- `src/pages/admin/AdminSubmissions.tsx`
- `src/pages/admin/AdminSubmissionDetail.tsx`
- `src/pages/admin/AdminSetupGuide.tsx`
- `src/pages/admin/CYDashboard.tsx`
- `src/pages/admin/CYSubscribers.tsx`
- `src/pages/admin/CYGrantedAccess.tsx`
- `supabase/functions/validate-intake/index.ts`

## Summary
- 1 SQL migration (admin RLS policies)
- 1 new edge function (`validate-intake`)
- ~15 new React components/pages
- Updates to existing step components for inline validation
- Route additions to App.tsx
- Config update for `validate-intake` in `supabase/config.toml`

