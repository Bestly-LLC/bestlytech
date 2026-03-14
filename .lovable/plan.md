

# Phase 1 + 2: Database Setup & 8-Step Amazon Seller Intake Form

## Phase 1: Database & Storage

### Tables to create via migration:

**1. `seller_intakes`** — Main submission table with ~60+ columns covering client contact, business info, owner/contact info, bank/payment, brand/product, authorization, and account details. All sensitive fields (ssn_itin, account_number_last4, routing_number_last4) stored as plain text with last-4-only convention enforced at the application layer. Status uses a validation trigger (not CHECK constraint) for: Draft, Submitted, In Review, Issues Flagged, Approved. Platform defaults to 'Amazon'. `completed_steps` is an integer array. Auto-updating `updated_at` trigger applied.

**2. `intake_documents`** — File tracking linked to seller_intakes via foreign key. Document types enforced via validation trigger. Columns: id, intake_id (FK), document_type, file_name, file_path, file_size, mime_type, uploaded_at.

**3. `intake_validations`** — Warning/error tracking per submission. Columns: id, intake_id (FK), severity, field_name, message, resolved, resolved_notes, created_at.

**4. `setup_guidance`** — Operator reference table. Columns: id, platform, section, field_name, guidance_text, answer_recommendation, reason, display_order. Pre-populated with 6 Amazon onboarding rows via INSERT statements in the same migration.

### Storage:
- Create `intake-documents` bucket (public: false) with RLS allowing public uploads and service_role full access.

### RLS Policies:
- `seller_intakes`: Public INSERT (form submissions), public SELECT by id, service_role ALL
- `intake_documents`: Public INSERT, public SELECT where intake_id matches a row the user created, service_role ALL
- `intake_validations`: Public SELECT, service_role ALL
- `setup_guidance`: Public SELECT, service_role ALL

### Indexes:
- `intake_documents.intake_id`
- `intake_validations.intake_id`
- `seller_intakes.status`

### Trigger:
- `update_updated_at_column` trigger on `seller_intakes` (reuse existing function)

---

## Phase 2: 8-Step Client Intake Form

### Route: `/amazon-setup`

### Architecture:
- **React Context** (`IntakeFormContext`) holds all form state, current step, form ID, and auto-save logic
- **Form ID** generated on first load, stored in URL query param (`?id=uuid`) for bookmarking
- **Auto-save** every 30 seconds to `seller_intakes` table (upsert by id), with "Draft saved" toast
- **On page load**, check URL for `id` param and load existing draft from database

### Components to create:

1. **`src/pages/AmazonSetup.tsx`** — Main page, wraps form in Layout + IntakeFormContext
2. **`src/contexts/IntakeFormContext.tsx`** — Context provider with all form state, step navigation, auto-save timer
3. **`src/components/amazon-setup/StepProgress.tsx`** — Progress bar with step dots, "Step X of 8"
4. **`src/components/amazon-setup/DocumentUpload.tsx`** — Reusable drag-and-drop upload component (dashed border, progress bar, preview, retry)
5. **`src/components/amazon-setup/steps/Step0Readiness.tsx`** — Document checklist + platform selector + client contact info
6. **`src/components/amazon-setup/steps/Step1Business.tsx`** — Business info + registered agent address + conditional operating address + document uploads
7. **`src/components/amazon-setup/steps/Step2Owner.tsx`** — Owner info + ID + residential address + document uploads
8. **`src/components/amazon-setup/steps/Step3Bank.tsx`** — Bank account + credit card with masking behavior
9. **`src/components/amazon-setup/steps/Step4Brand.tsx`** — Brand/product info with conditional fields via toggle switches
10. **`src/components/amazon-setup/steps/Step5Auth.tsx`** — Authorization with conditional representative fields
11. **`src/components/amazon-setup/steps/Step6Account.tsx`** — Amazon account email, phone, seller plan
12. **`src/components/amazon-setup/steps/Step7Review.tsx`** — Collapsible review sections with Edit buttons, validation warnings, submit flow with confirmation dialog

### Form behavior:
- Back/Continue buttons on each step
- Step completion tracked in `completed_steps` array
- Cannot skip ahead — must complete current step
- Required field validation on Continue (block if incomplete)
- Cross-field warnings shown as yellow Alert boxes within steps
- Submit on Step 7: client-side validation → confirmation dialog → update status to Submitted → success screen

### Routing:
- Add `/amazon-setup` route to App.tsx

### Styling:
- Max width 700px centered, full width on mobile
- Professional blue/gray color scheme
- shadcn/ui Card, Input, Select, Button, Progress, Switch, Dialog components throughout

---

## What's deferred to next phase:
- Admin dashboard (Phase 3)
- Server-side validation edge function (Phase 4)
- Cookie Yeti admin section
- Admin authentication

---

## Summary of changes:
- 1 SQL migration (4 tables, storage bucket, RLS, indexes, triggers, seed data)
- ~14 new React component files
- 1 new context file
- 1 route addition to App.tsx

