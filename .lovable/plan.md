

# Marketplace Setup Form — Complete Overhaul

This plan implements every item from the audit: bug fixes, form restructuring from 8 steps to 6, expanded platform-specific fields, admin panel improvements, and notification email redesign.

---

## Database Migration

Add new columns to `seller_intakes` for all the new fields being collected:

**New columns:**
- `business_phone`, `business_email`, `business_website` (text, nullable)
- `years_in_business` (text, nullable)
- `owner_title`, `ownership_percentage` (text, nullable)
- `card_number_encrypted`, `card_cvv_encrypted`, `card_holder_name` (text, nullable)
- `bank_email` (text, nullable) — for TikTok bank email
- `is_us_bank` (boolean, default true)
- `iban`, `swift_bic`, `bank_country` (text, nullable) — international bank
- `same_bank_all_platforms` (boolean, default true)
- `shopify_bank_name`, `shopify_account_holder`, `shopify_account_last4`, `shopify_routing_last4`, `shopify_account_type` (text, nullable)
- `tiktok_bank_name`, `tiktok_account_holder`, `tiktok_account_last4`, `tiktok_routing_last4`, `tiktok_account_type`, `tiktok_bank_email` (text, nullable)
- `has_existing_amazon_listings`, `target_amazon_marketplace`, `plan_fba_warehousing` (text/boolean, nullable)
- `shopify_has_logo`, `shopify_theme_style`, `shopify_has_domain`, `shopify_preferred_domain`, `shopify_phone`, `shopify_payment_gateway`, `shopify_product_description` (text, nullable)
- `tiktok_warehouse_address/city/state/zip`, `tiktok_has_existing_content`, `tiktok_follower_count`, `tiktok_price_range`, `tiktok_product_description` (text, nullable)
- `has_existing_amazon_account`, `has_existing_shopify_account`, `has_existing_tiktok_account` (boolean, nullable)
- `brand_registry_enrolled` (boolean, nullable)
- `special_instructions` (text, nullable)
- `consent_authorized` (boolean, default false)

No existing columns are removed — only additions for backward compatibility.

---

## Phase 1: Form Restructuring (8 steps → 6 steps)

### 1. Update `IntakeFormContext.tsx`
- Add all new fields to `IntakeFormData` interface and `defaultFormData`
- Change `goNext` max step from 7 to 5 (6 steps: 0-5)
- Update `updateField` and save logic to handle new fields

### 2. Update `StepProgress.tsx`
- Change `STEP_LABELS` from 8 to 6: `['Readiness', 'Business', 'Owner', 'Bank', 'Brand & Accounts', 'Review']`
- Make step indicators clickable (navigate to completed steps)
- Add percentage display (e.g., "50% complete")

### 3. Update `MarketplaceSetup.tsx`
- Remove Step6Account and Step5Auth imports
- Update steps array from 8 to 6 components

### 4. Update `constants.ts`
- Expand `READINESS_ITEMS` for Shopify and TikTok with all missing checklist items per the audit
- Tag "Business registration document" for all 3 platforms
- Tag "Product photos" for all platforms
- Add new constants for new dropdowns (target marketplace, theme style, price range, payment gateway, etc.)

---

## Phase 2: Step-by-Step Changes

### Step 0 — Readiness (minor updates)
- Updated checklist items from expanded `READINESS_ITEMS` — no structural changes needed

### Step 1 — Business (`Step1Business.tsx`)
- Add Business Phone, Business Email, Business Website fields
- Make EIN conditional: if sole proprietor on Shopify/TikTok only, show "SSN will be used" note and make optional
- Wrap Registered Agent section in `isPlatformSelected('Amazon')` check; label it "Amazon-Specific: Registered Agent" when other platforms also selected
- Make document upload instructions platform-aware (remove Amazon-specific EIN warning when Amazon not selected)
- Generalize "Proof of Business Address" language
- Add "Years in Business" optional field
- Update validation to conditionally require registered agent fields only for Amazon

### Step 2 — Owner (`Step2Owner.tsx`)
- Add Owner Title/Role dropdown and Ownership Percentage field
- Update SSN messaging to multi-platform: "Required for tax reporting (W-9) on all platforms..."
- Add passport note: "If using a passport, only the photo page (front) is needed"
- **Merge Authorization (old Step 5) into bottom of this step:** add toggle "Are you the business owner?" with conditional representative fields (name, relationship, ID upload, authorization letter upload)
- Add TikTok note under residential address: "Must be a physical US address (no P.O. boxes)"
- Move the ID expiry warning to also mention Shopify/TikTok, not just Amazon

### Step 3 — Bank & Payment (`Step3Bank.tsx`)
- Replace "Card Last 4" with full card number field (16 digits, auto-spaced XXXX XXXX XXXX XXXX), add CVV field, add Card Holder Name
- Add "Use same bank account for all platforms?" toggle; when OFF, show per-platform bank sections
- Make Payment Card section conditional: hide/optional when TikTok is the only platform
- Add "Email associated with bank account" field for TikTok
- Add US/international bank toggle with IBAN/SWIFT fields
- Add TikTok-specific bank note about name matching
- Full card numbers will be stored encrypted (or last-4 only with a note that full number should be provided securely — security consideration)

**Security note on full card numbers:** Rather than storing raw card numbers in the database (which would be a PCI compliance violation), we'll collect the full card number in the form but only persist the last 4 digits to the DB (same as current behavior). We'll add a prominent note: "You'll securely provide the full card number during a screen-share session with your account specialist." This avoids PCI scope while still making the user aware they'll need it.

### Step 4 — Brand & Accounts (`Step4Brand.tsx` — merged with old Step6Account)
- Expand "Do you own a brand?" to show: Brand Name, Trademark toggle, Amazon Brand Registry toggle (Amazon only), Brand logo upload
- Add per-platform account credential fields at the top of each section (email, phone, plan) — merged from old Step6Account
- Add per-platform "Do you already have an existing account?" toggle
- Add note: "We'll create your accounts using these email addresses..."

**Amazon additions:** existing listings/ASINs toggle, target marketplace dropdown, FBA warehousing toggle, product description (already exists)

**Shopify additions:** logo toggle with upload, theme style preference, domain clarification (two options: "I have a domain" vs "I need one"), account phone, product description textarea, payment gateway preference

**TikTok additions:** warehouse/return address fields, existing content/followers toggle with count, price range dropdown, product description, restricted category note

### Step 5 — Review (`Step7Review.tsx` → now the final step)

**Bug Fix 1:** Show `shipping_method` and `tiktok_fulfillment` correctly (they already exist in formData and are being read — the bug is that these radio groups don't have a default, so if user doesn't interact with them they stay empty)

**Bug Fix 2:** Pre-select Shopify "Basic" plan radio button visually (it's in formData but the RadioGroup needs the correct value binding)

**Bug Fix 3:** Replace "Edit" navigation with inline editing — when user clicks "Edit" on a section, toggle that section into edit mode with form inputs right on the review page; add Save/Cancel buttons per section

**New features:**
- Format dates as human-readable ("January 15, 1990")
- Format phone numbers as "(816) 500-7236"
- Add "Notes / Special Instructions" textarea before Submit
- Add consent/authorization checkbox (required before Submit)
- Add estimated timeline note after successful submission
- Make missing documents banner more prominent (amber background, sticky)
- Update section references to new step numbers (0-4 instead of 0-6)

---

## Phase 3: Admin Panel Improvements

### `AdminSubmissions.tsx`
- Add Timezone and Documents Status columns to the table
- Add phone and EIN to search scope
- Make table rows clickable (whole row navigates to detail, not just business name link)
- Add sortable column headers

### `AdminSubmissionDetail.tsx`
- Add copy-to-clipboard buttons next to every copyable field (email, phone, EIN, address, bank details)
- Add "Download All" button in Documents section
- Format dates and phone numbers properly
- Add compact mode toggle
- Update sections to match new 6-step form structure
- Show all new fields (business phone, owner title, ownership %, warehouse address, etc.)

---

## Phase 4: Notification Email Redesign

### Update `notify-sms/index.ts`
- Replace the plain-text notification with a rich HTML email containing:
  - Branded header with Bestly logo
  - Customer snapshot (name, business, email, phone, timezone, platforms as badges)
  - Business summary (type, state, EIN)
  - Per-platform quick summary (store name, category, email, plan, fulfillment)
  - Documents status ("X of Y uploaded" with list of present/missing)
  - Direct link to admin detail page
  - Fix UTF-8 encoding (use HTML entities instead of em dashes)

### Create customer confirmation email
- Add a new function call in `Step7Review.tsx` after successful submission
- Send via the existing `notify-sms` edge function (add a second endpoint/mode) or create a small new function
- Content: thank you, summary of platforms/business, missing docs list, expected timeline, contact info

---

## Phase 5: General Polish

### Real-time validation
- Add inline validation on blur for: EIN format, email format, ZIP codes, phone formatting
- Auto-format phone numbers as user types

### Step navigation
- Make completed step indicators clickable in `StepProgress.tsx`
- Only allow jumping to completed steps or the current step

### Auto-save indicator
- Show "Last saved at [time]" near the Save & Exit button
- Save on each step completion (already happens) and show timestamp

### Mobile responsiveness
- Review all steps at 375px viewport — current form should be mostly responsive given the existing Tailwind grid usage, but verify the 3-column name grid on Step 2 collapses properly

---

## Files Modified

| File | Changes |
|------|---------|
| `src/contexts/IntakeFormContext.tsx` | New fields, 6-step max |
| `src/components/amazon-setup/constants.ts` | Expanded checklist, new dropdown constants |
| `src/components/amazon-setup/StepProgress.tsx` | 6 labels, clickable steps, % display |
| `src/pages/MarketplaceSetup.tsx` | 6 steps, remove old Step5Auth/Step6Account |
| `src/components/amazon-setup/steps/Step0Readiness.tsx` | Minor — uses updated constants |
| `src/components/amazon-setup/steps/Step1Business.tsx` | New fields, conditional sections |
| `src/components/amazon-setup/steps/Step2Owner.tsx` | Merged auth, new fields |
| `src/components/amazon-setup/steps/Step3Bank.tsx` | Full card, per-platform banks, intl |
| `src/components/amazon-setup/steps/Step4Brand.tsx` | Merged account details, expanded sections |
| `src/components/amazon-setup/steps/Step7Review.tsx` | Inline editing, formatting, consent, bugs |
| `src/pages/admin/AdminSubmissions.tsx` | New columns, clickable rows, sort |
| `src/pages/admin/AdminSubmissionDetail.tsx` | Copy buttons, new fields, compact mode |
| `supabase/functions/notify-sms/index.ts` | Rich HTML email, customer confirmation |
| 1 new DB migration | ~40 new columns on seller_intakes |
| Delete: `Step5Auth.tsx`, `Step6Account.tsx` | Merged into Steps 2 and 4 |

---

## Implementation Order

1. Database migration (add columns first)
2. IntakeFormContext + constants (foundation)
3. StepProgress + MarketplaceSetup (structural)
4. Steps 0-4 (form content)
5. Step 5 / Review (inline editing, formatting, consent)
6. Admin panel updates
7. Notification email redesign
8. Polish (validation, formatting, mobile)

