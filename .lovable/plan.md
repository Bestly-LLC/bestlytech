

## Integrate Apple-Native Business Modernization Program

Create a dedicated service page for the Apple-Native Business Modernization Program and integrate it into the site's navigation and services ecosystem.

---

### 1. New Page: `src/pages/AppleModernization.tsx`

A comprehensive, premium-feeling service page with the following sections:

- **Hero**: Headline "Apple-Native Infrastructure for Local Businesses" with a subtitle emphasizing operational enablement over marketing. CTA links to `/hire`.
- **Program Overview**: Brief executive summary of what the program delivers (discovery, payments, identity, engagement, analytics).
- **Core Components (A-I)**: A grid of 9 service component cards using `GlowCard`, each with an icon, title, key deliverables (bullet list), and outcome statement. Components:
  - Apple Discovery Infrastructure
  - App Clips (Instant Customer Experience)
  - Payments Modernization (Tap to Pay)
  - Digital ID Verification
  - Brand Trust and Identity
  - Customer Experience Automation
  - Commerce and Ordering
  - Operational Analytics
  - Apple-Ready Certification (marked as optional)
- **Service Tiers**: 4-tier pricing/packaging section (Presence Setup, Conversion Stack, Commerce and Identity Stack, Enterprise Modernization) displayed as stacked cards showing what each tier includes, with each tier building on the previous.
- **Target Verticals**: A compact grid showing ideal business types (bars, restaurants, retail, salons, fitness, events, hospitality).
- **CTA Section**: "Ready to Modernize?" with link to `/hire`.

### 2. Route Registration: `src/App.tsx`

- Import the new `AppleModernization` page component.
- Add route: `<Route path="/apple-modernization" element={<AppleModernization />} />`

### 3. Services Page Update: `src/pages/Services.tsx`

- Add a new entry to the `services` array for "Apple Business Modernization" with the `Apple` icon (using a relevant Lucide icon like `Smartphone` or `MapPin`) and a short description.
- Add a featured callout card below the services grid linking to `/apple-modernization` to highlight it as a flagship program.

### 4. Header Navigation: `src/components/layout/Header.tsx`

- Add `/apple-modernization` to the `isProductsActive` check or ensure the "Services" nav link highlights when on this route. No new top-level nav item needed -- it is discoverable via the Services page.

---

### Technical Details

**New file:**
- `src/pages/AppleModernization.tsx` -- follows the same pattern as existing pages (Layout, SEOHead, AnimatedSection, GlowCard, GradientText). Uses Lucide icons throughout (MapPin, Smartphone, CreditCard, ShieldCheck, Fingerprint, Mail, Repeat, ShoppingCart, BarChart3, Award, etc.).

**Modified files:**
- `src/App.tsx` -- add import and route
- `src/pages/Services.tsx` -- add service entry and featured callout card linking to the new page

**No database or backend changes required.** This is purely a frontend content page.

The page will follow existing design conventions: `GlowCard` for component cards, `AnimatedSection` for scroll animations, `GradientText` for headline accents, consistent spacing and typography, and the same CTA button styles used across the site.

