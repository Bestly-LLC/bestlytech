

# SaaS-Style Smooth Page Transitions

## Problem
When clicking nav links, the page "flashes" because:
1. `PageTransition` uses `key={location.pathname}`, which **unmounts and remounts** the entire component tree (including Layout/Header/Footer) on every route change
2. The `animate-page-enter` animation starts from `opacity: 0`, causing a visible flash

The Header/Footer re-render on every navigation because `<Layout>` is embedded inside each page component rather than wrapping routes at the app level.

## Solution
Restructure so the Header and Footer are persistent (never unmount), and only the inner page content crossfades.

### 1. Move Layout to wrap Routes in `App.tsx`
- Create a new `<AppLayout>` component that renders Header + `<Outlet />` + Footer
- Use it as a layout route wrapping all public pages
- The `/links` route and admin routes stay outside (they already skip Layout)
- This means Header/Footer **never unmount** during navigation

### 2. Remove `<Layout>` from every page component
- Every public page currently imports and wraps with `<Layout>`. Remove that wrapper from all ~20 page files, keeping just the inner content.

### 3. Rework `PageTransition` for crossfade (not remount)
- Instead of using `key` to force remount (which destroys and recreates DOM), use a CSS transition that fades content in without the opacity-0 flash
- Use `useLocation` to trigger a brief fade transition on the `<main>` content only
- Animation: quick 150ms opacity transition (no translateY jump) — feels instant like a SaaS app

### 4. Keep ScrollToTop behavior
- `ScrollToTop` stays as-is (scrolls to top on route change)

## Files Changed

| File | Change |
|------|--------|
| `src/App.tsx` | Add layout route with `<Outlet>`, remove `<PageTransition>` wrapper around all routes |
| `src/components/layout/Layout.tsx` | Refactor to use `<Outlet>` instead of `children` prop |
| `src/components/PageTransition.tsx` | Replace key-based remount with a subtle opacity transition (no flash) |
| `src/pages/Index.tsx` | Remove `<Layout>` wrapper |
| `src/pages/About.tsx` | Remove `<Layout>` wrapper |
| `src/pages/Products.tsx` | Remove `<Layout>` wrapper |
| `src/pages/CookieYeti.tsx` | Remove `<Layout>` wrapper |
| `src/pages/CookieYetiPrivacy.tsx` | Remove `<Layout>` wrapper |
| `src/pages/InventoryProof.tsx` | Remove `<Layout>` wrapper |
| `src/pages/Hoku.tsx` | Remove `<Layout>` wrapper |
| `src/pages/NeckPilot.tsx` | Remove `<Layout>` wrapper |
| `src/pages/PressKit.tsx` | Remove `<Layout>` wrapper |
| `src/pages/PrivacyPolicy.tsx` | Remove `<Layout>` wrapper |
| `src/pages/TermsOfService.tsx` | Remove `<Layout>` wrapper |
| `src/pages/DeveloperCompliance.tsx` | Remove `<Layout>` wrapper |
| `src/pages/Contact.tsx` | Remove `<Layout>` wrapper |
| `src/pages/ProductLegal.tsx` | Remove `<Layout>` wrapper |
| `src/pages/ReportSite.tsx` | Remove `<Layout>` wrapper |
| `src/pages/Hire.tsx` | Remove `<Layout>` wrapper |
| `src/pages/Services.tsx` | Remove `<Layout>` wrapper |
| `src/pages/AppleModernization.tsx` | Remove `<Layout>` wrapper |
| `src/pages/MarketplaceSetup.tsx` | Remove `<Layout>` wrapper |
| `src/pages/CookieYetiSupport.tsx` | Remove `<Layout>` wrapper |
| `src/pages/NotFound.tsx` | Remove `<Layout>` wrapper (if present) |
| `tailwind.config.ts` | Soften `page-enter` animation (150ms, opacity only) |

## Result
- Header and footer stay mounted — zero flash
- Only the `<main>` content area transitions with a subtle 150ms fade
- Feels like a single-page SaaS app
- No layout shift, no white flash

