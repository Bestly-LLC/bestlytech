

# Tesla Rentals Photos + Cookie Yeti Fix

## 1. Add Tesla car photos to vehicle cards

- Copy the two uploaded AVIF images into `src/assets/`:
  - `tesla-model-3.avif` (blue car)
  - `tesla-model-y.avif` (other car)
- Update `src/pages/TeslaRentals.tsx`:
  - Import both images
  - Replace the `image: null` in the vehicles array with the imported assets
  - Replace the Zap icon placeholder with an actual `<img>` tag showing the car photo
  - Change Model 3 range from `"263 mi range"` to `"Unlimited Miles"`

## 2. Keep trip count and ratings up to date

There's no API available from Turo to auto-pull stats. Two practical options:
- **Manual update** (simplest): Update the hardcoded values in the vehicles array and stats whenever you check Turo
- **Admin-editable** (recommended): Store the stats in a database table so you can update them from the admin panel without code changes. This would involve creating a `tesla_rental_stats` table and a small admin UI to edit trip count/rating.

I'll implement the admin-editable approach with a simple database table.

## 3. Fix Cookie Yeti backend (401 errors)

The Community Learning dashboard buttons (Maintenance, Run AI, Reset) are failing because:

**Problem A — `run-pattern-maintenance` and `reset-failed-patterns`**: These functions require an `x-maintenance-secret` header, but the admin UI sends `Authorization: Bearer <token>` instead. Fix: update these functions to accept either the maintenance secret OR a valid admin Bearer token.

**Problem B — `ai-generate-pattern`**: Uses `auth.getClaims(token)` which is not a real Supabase JS v2 method. Fix: replace with `auth.getUser(token)` which is the correct method, then read `user.id` instead of `claims.sub`.

### Files to modify
- `src/pages/TeslaRentals.tsx` — Add car photos, update range text
- `src/assets/tesla-model-3.avif` — New file (copied from upload)
- `src/assets/tesla-model-y.avif` — New file (copied from upload)
- `supabase/functions/ai-generate-pattern/index.ts` — Replace `getClaims` with `getUser`
- `supabase/functions/run-pattern-maintenance/index.ts` — Accept admin Bearer token as alternative auth
- `supabase/functions/reset-failed-patterns/index.ts` — Same fix as maintenance

### Database (optional for live stats)
- Create `tesla_rental_stats` table with columns: `id`, `vehicle_name`, `rating`, `trips`, `updated_at`
- Add admin RLS policies
- Update TeslaRentals page to fetch from this table with hardcoded fallbacks

