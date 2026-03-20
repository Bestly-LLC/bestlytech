

# Apple-Style Scroll Reveal Animations Across All Pages

## Approach
Apple's signature effect: every heading, paragraph, and card block fades up into view as you scroll, with staggered timing. The site already has this on ~11 pages via `AnimatedSection`, but several pages have zero scroll animations. The fix is two-fold:

1. **Add `AnimatedSection` to all pages that currently lack it** — wrapping hero sections, content blocks, and cards
2. **Refine the animation timing** to feel more Apple-like — slightly slower ease, more stagger between elements

## Pages Already Done (11)
Index, About, Products, Services, Contact, Hire, InventoryProof, Hoku, NeckPilot, CookieYetiSupport, AppleModernization — these already use `AnimatedSection` throughout. Minor tweaks only if needed.

## Pages Needing Animations (8)

| Page | Content to animate |
|------|--------------------|
| `CookieYeti.tsx` (622 lines) | Hero, features grid, FAQ accordion, CTA sections |
| `PressKit.tsx` (408 lines) | Header, company info cards, product cards, media section |
| `PrivacyPolicy.tsx` (361 lines) | Page header, each policy section |
| `TermsOfService.tsx` (355 lines) | Page header, each terms section |
| `DeveloperCompliance.tsx` (286 lines) | Page header, compliance sections |
| `CookieYetiPrivacy.tsx` (180 lines) | Page header, policy sections |
| `ProductLegal.tsx` (211 lines) | Page header, legal sections |
| `ReportSite.tsx` (231 lines) | Page header, form section |

## Animation Tuning (`tailwind.config.ts`)
- Slow `fade-in-up` from `0.6s` → `0.7s` with a smoother `cubic-bezier(0.25, 0.1, 0.25, 1)` easing (Apple's signature curve)
- Slow `fade-in` from `0.5s` → `0.6s` with same easing
- Reduce `translateY` on `fade-in-up` from `20px` → `16px` for subtlety

## Implementation Pattern
For each page, import `AnimatedSection` and wrap:
- The hero/page header in `<AnimatedSection>`
- Each major content section or card group with incremental `delay` values (0, 80, 160, etc.)
- Legal/policy pages: header animates, then each `<section>` or content block staggers in

No structural changes — just wrapping existing JSX blocks.

## Files Changed

| File | Change |
|------|--------|
| `tailwind.config.ts` | Refine fade-in/fade-in-up timing to Apple-style easing |
| `src/pages/CookieYeti.tsx` | Add AnimatedSection to all sections |
| `src/pages/PressKit.tsx` | Add AnimatedSection to all sections |
| `src/pages/PrivacyPolicy.tsx` | Add AnimatedSection to header + sections |
| `src/pages/TermsOfService.tsx` | Add AnimatedSection to header + sections |
| `src/pages/DeveloperCompliance.tsx` | Add AnimatedSection to header + sections |
| `src/pages/CookieYetiPrivacy.tsx` | Add AnimatedSection to header + sections |
| `src/pages/ProductLegal.tsx` | Add AnimatedSection to header + sections |
| `src/pages/ReportSite.tsx` | Add AnimatedSection to header + form |

