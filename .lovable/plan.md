

# Product Status Audit — Fix All Pages

## Current vs Correct Statuses

| Product | Current (wrong) | Correct |
|---------|-----------------|---------|
| Cookie Yeti | Coming Soon | Coming Soon ✓ |
| InventoryProof | In Development | **Active** |
| HOKU | In Development | **Coming Soon** |
| NeckPilot | In Development | In Development ✓ |

## Files to Update

### 1. `src/pages/Products.tsx`
- Line 46: InventoryProof `"In Development"` → `"Active"`
- Line 55: HOKU `"In Development"` → `"Coming Soon"`

### 2. `src/pages/PressKit.tsx`
- Line 44: InventoryProof `"In Development"` → `"Active"`
- Line 52: HOKU `"In Development"` → `"Coming Soon"`

### 3. `src/config/products.ts` & `src/pages/Links.tsx`
- These only carry name/description/href — no status field, so no changes needed.

Two files, four line changes total.

