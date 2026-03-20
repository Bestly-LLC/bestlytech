

# Replace Homepage Metrics with Real, Evergreen Data

## Problem
The current metrics (`3 Products Shipped`, `100% Privacy Score`, `0 User Data Sold`) are hardcoded and partially inaccurate (there are 4 products in `products.ts`, not 3).

## Solution
Make the metrics derive from real data:

1. **"4 Products Built"** — dynamically count from `src/config/products.ts` (currently 4, auto-updates when products are added/removed)
2. **"0 User Data Sold"** — this is factual and evergreen (Bestly's privacy stance), keep it
3. **"100% Privacy First"** — reword from "Privacy Score" (which sounds made-up) to a commitment statement

## Changes

### `src/pages/Index.tsx` (lines 1-70)
- Import `products` from `@/config/products`
- Change metrics array to:
  - `{ value: products.length, label: "Products Built", suffix: "" }`
  - `{ value: 0, label: "User Data Sold", suffix: "" }`
  - `{ value: 100, label: "Privacy First", suffix: "%" }`

One file, ~3 line changes. The product count stays accurate automatically as the products config evolves.

