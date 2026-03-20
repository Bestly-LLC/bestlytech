

# Cookie Yeti "Coming Soon" + Press Kit Fixes

## Changes

### 1. Copy uploaded asset
- `user-uploads://iphone-app-store-android-coming-soon.jpg` → `src/assets/coming-soon-appstore.jpg`

### 2. `src/pages/CookieYeti.tsx`
- Hero: "Available Now" → "Coming Soon" (amber styling)
- Replace download buttons with the uploaded App Store coming soon image + a "Coming Soon to Chrome Desktop" badge
- Platform Availability section: green "Live" → amber "Coming Soon"
- Final CTA: replace download buttons with coming soon badges
- CONFIG: set `available: false`

### 3. `src/pages/PressKit.tsx`
- **Fix invalid email**: Replace `press@bestly.tech` (line 257/260) with `support@bestly.tech`
- Cookie Yeti status: `"Active"` → `"Coming Soon"`
- Add NeckPilot to the products array with status "In Development"

| File | Action |
|------|--------|
| `src/assets/coming-soon-appstore.jpg` | New asset |
| `src/pages/CookieYeti.tsx` | Convert to "Coming Soon" |
| `src/pages/PressKit.tsx` | Fix email, update status, add NeckPilot |

