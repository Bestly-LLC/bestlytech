

# Admin Panel Audit & Fixes

## Findings

| Page | Archive | Delete | Bulk Actions | Other Issues |
|------|---------|--------|-------------|--------------|
| **Submissions** | No | No | Status only | Missing archive + delete |
| **Contacts** | Via status dropdown | No | None | No bulk actions, no delete |
| **Hire Requests** | Via status dropdown | No | None | No bulk actions, no delete |
| **Waitlist** | No | No | None | No actions at all — read-only |
| **CY Subscribers** | No | No | None | Read-only list |
| **CY Granted Access** | N/A | Yes ✓ | Yes (bulk delete) ✓ | Good |
| **Submission Detail** | No | No | N/A | No archive/delete from detail view |

## Plan

### 1. Submissions — Add Archive & Delete (`AdminSubmissions.tsx`)
- Add "Archive" and "Delete" to the bulk action bar (alongside existing "Mark Submitted", etc.)
- Archive = set status to "Archived", Delete = hard delete from `seller_intakes` + associated `intake_documents`
- Add "Archived" to the STATUSES filter array
- Add per-row action menu (three-dot `DropdownMenu`) with Archive and Delete options
- Delete shows a confirmation dialog

### 2. Contacts — Add Delete & Bulk Actions (`AdminContacts.tsx`)
- Add checkbox column for multi-select (like Submissions has)
- Add bulk action bar: "Mark Read", "Mark Replied", "Archive", "Delete"
- Add per-row delete button (trash icon) with confirmation
- Delete = hard delete from `contact_submissions`

### 3. Hire Requests — Add Delete & Bulk Actions (`AdminHireRequests.tsx`)
- Add checkbox column for multi-select
- Add bulk action bar: "Mark Contacted", "Archive", "Delete"
- Add per-row delete button with confirmation

### 4. Waitlist — Add Delete (`AdminWaitlist.tsx`)
- Add checkbox column for multi-select
- Add bulk delete action
- Add per-row delete button with confirmation

### 5. Submission Detail — Add Archive & Delete (`AdminSubmissionDetail.tsx`)
- Add Archive and Delete buttons to the detail page header
- Delete navigates back to `/admin/submissions` after confirmation

### Technical Details

- All delete operations use `supabase.from(table).delete().in("id", ids)` or `.eq("id", id)`
- For submission deletes, also cascade-delete from `intake_documents` and `intake_validations`
- All deletes wrapped in `AlertDialog` confirmation
- Bulk action bars follow the existing pattern from `AdminSubmissions.tsx`
- Import `Trash2, Archive, MoreHorizontal` from lucide-react as needed
- Add `DropdownMenu` for per-row actions on Submissions (archive/delete in one menu)

### Files Modified
- `src/pages/admin/AdminSubmissions.tsx`
- `src/pages/admin/AdminContacts.tsx`
- `src/pages/admin/AdminHireRequests.tsx`
- `src/pages/admin/AdminWaitlist.tsx`
- `src/pages/admin/AdminSubmissionDetail.tsx`

