

## Marketplace Setup Form Audit & Fixes

After reviewing all 8 steps, the context providers, upload component, storage bucket, and RLS policies, here are the issues found and the plan to fix them.

---

### Issues Found

**Bug 1 — Document removal/replacement broken (Critical)**
The `intake_documents` table has no public DELETE or UPDATE RLS policy. When a user clicks the X button to remove a document (or tries to re-upload the same type), the database record delete silently fails. The storage file gets removed, but the DB record stays — causing ghost entries and blocking re-uploads.

**Bug 2 — Upload progress bar is hardcoded**
`DocumentUpload.tsx` line 126 shows `<Progress value={70} />` — a static 70% bar. There's no actual progress tracking, which makes it look broken on slow connections.

**Bug 3 — No file type/size validation on the bucket**
The storage bucket has no `allowed_mime_types` or `file_size_limit` configured server-side. The client-side 10MB check can be bypassed. Should add server-side constraints.

---

### Plan

**1. Add missing RLS policies for `intake_documents` (database migration)**
- Add a public DELETE policy scoped to draft intakes: `DELETE WHERE EXISTS (SELECT 1 FROM seller_intakes WHERE id = intake_documents.intake_id AND status = 'Draft')`
- Add a public UPDATE policy with the same draft-only scope
- This lets users manage their documents while the intake is still in draft, consistent with the existing `seller_intakes` policies

**2. Fix DocumentUpload progress indicator**
- Replace the fake `value={70}` progress bar with an indeterminate loading state (animated bar or spinner) since the Supabase storage SDK doesn't expose upload progress events
- This is more honest UX than a frozen 70% bar

**3. Add server-side file constraints to the storage bucket**
- Set `file_size_limit` to 10MB (matching client-side check)
- Set `allowed_mime_types` to `['application/pdf', 'image/jpeg', 'image/png']` (matching the `accept` prop)
- This prevents bypassing client-side validation

**4. Improve upload error messages**
- In `DocumentUpload.tsx`, catch common Supabase storage errors and show user-friendly messages (e.g., "File too large", "Invalid file type") instead of raw error strings

### Files Modified
- `src/components/amazon-setup/DocumentUpload.tsx` — progress fix + better error messages
- 1 database migration — RLS policies + bucket constraints

