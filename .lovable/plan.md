

# Multi-Platform Dynamic Intake System

## Core Concept

Instead of picking ONE platform, Step 0 lets the customer check multiple platforms (Amazon, Shopify, TikTok Shop). Steps 1-3 and 5 (Business, Owner, Bank, Authorization) are **shared** — collected once. Steps 4 and 6 become **dynamic**, showing platform-specific sections only for selected platforms. Step 7 review groups everything by platform.

---

## What's Shared vs Platform-Specific

```text
SHARED (collect once)              PLATFORM-SPECIFIC (per selection)
─────────────────────              ─────────────────────────────────
Step 0: Contact info               Step 0: Readiness checklist items
Step 1: Business info, EIN, agent  Step 4: Brand/product details
Step 2: Owner identity, ID docs    Step 6: Account credentials & plan
Step 3: Bank & payment             Step 7: Review sections
Step 5: Authorization/rep
```

---

## Database Changes (1 migration)

Add new columns to `seller_intakes`:

```sql
-- Multi-platform selection (replaces single platform text)
selected_platforms text[] DEFAULT '{}'::text[],

-- Shopify-specific fields
shopify_store_name text,
shopify_email text,
shopify_plan text DEFAULT 'Basic',
shopify_domain text,
shipping_method text,
has_existing_shopify boolean DEFAULT false,
existing_shopify_url text,

-- TikTok-specific fields  
tiktok_shop_name text,
tiktok_email text,
tiktok_phone text,
tiktok_category text,
tiktok_fulfillment text,
has_tiktok_creator boolean DEFAULT false,
tiktok_handle text
```

Keep the existing `platform` column for backward compatibility (set to first selected platform or 'Multi').

---

## Step-by-Step Changes

### Step 0 — Readiness (modified)
- Replace single platform dropdown with **multi-select checkboxes**: Amazon, Shopify, TikTok Shop
- Dynamically build the readiness checklist based on selected platforms:
  - **Amazon**: State registration doc, EIN, bank statement, credit card, ID
  - **Shopify**: Business registration (if not already listed), payment method, product photos
  - **TikTok**: Government ID, business license, bank account, product samples/photos
  - Deduplicate items that overlap (e.g., "Government-issued ID" appears once even if Amazon + TikTok both need it)
- Contact info section stays the same

### Step 4 — Brand & Product (modified)
- Render **tabbed or stacked sections** per selected platform:
  - **Amazon section** (if selected): Store name, UPCs, diversity certs, brand/trademark, product category, fulfillment (FBA/FBM/Both) — existing fields
  - **Shopify section** (if selected): Store name, existing store URL toggle, Shopify plan preference (Basic/Shopify/Advanced), custom domain, shipping method (self/3PL/dropship), product photos needed
  - **TikTok section** (if selected): Shop name, TikTok handle, TikTok creator account toggle, product category (TikTok-specific categories), fulfillment (self/TikTok fulfillment), content/sample readiness
- Shared brand fields (brand name, trademark) shown once at top if any platform selected

### Step 6 — Account Details (modified)
- Render per-platform account credential sections:
  - **Amazon**: Email, phone, seller plan (Professional/Individual) — existing
  - **Shopify**: Email, Shopify plan, existing store URL (if has_existing_shopify), domain preference
  - **TikTok**: Email, phone, TikTok handle
- Each section clearly labeled with platform icon/badge

### Step 7 — Review (modified)
- Shared sections (Contact, Business, Owner, Bank, Auth) shown once
- Platform-specific sections grouped under platform headers with badges
- Missing docs checklist accounts for all selected platforms

### StepProgress (modified)
- Step labels become dynamic: "Brand & Product" shows platform badges next to it
- No change in step count (still 8 steps, 0-7)

---

## Form Context Changes

- Add `selected_platforms: string[]` to `IntakeFormData` and all new Shopify/TikTok fields
- Update `defaultFormData` with new field defaults
- Helper: `isPlatformSelected(platform: string)` for conditional rendering
- Update save payload to include new fields

---

## Constants Updates

Add to `constants.ts`:
- `SHOPIFY_PLANS`: Basic, Shopify, Advanced
- `TIKTOK_CATEGORIES`: platform-specific product categories
- `SHIPPING_METHODS`: Self-ship, 3PL, Dropship
- Platform-specific readiness checklist items as separate arrays
- `PLATFORM_OPTIONS` with labels and icons

---

## New Files
- None — all changes are modifications to existing step components, context, and constants

## Modified Files (~8)
- `src/contexts/IntakeFormContext.tsx` — new fields, `selected_platforms`
- `src/components/amazon-setup/constants.ts` — new platform constants
- `src/components/amazon-setup/steps/Step0Readiness.tsx` — multi-select + dynamic checklist
- `src/components/amazon-setup/steps/Step4Brand.tsx` — platform-tabbed brand/product sections
- `src/components/amazon-setup/steps/Step6Account.tsx` — platform-tabbed account sections
- `src/components/amazon-setup/steps/Step7Review.tsx` — multi-platform review
- `src/components/amazon-setup/StepProgress.tsx` — platform badges
- `src/pages/AmazonSetup.tsx` — minor title update ("Marketplace Setup")
- 1 SQL migration for new columns

