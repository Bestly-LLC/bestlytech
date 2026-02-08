

## Add NeckPilot Product Page

Create a new "Coming Soon" product landing page for NeckPilot and register it across all product touchpoints in the site.

---

### 1. New Page: `src/pages/NeckPilot.tsx`

A premium product page with a calm, Apple-adjacent aesthetic using soft blues and subtle aviation theming:

- **Color palette**: Soft blues (`hsl(210 40% ...)`) and neutral tones -- distinct from HOKU's golden warmth and InventoryProof's deep blue tech feel
- **Hero section**: "Coming Soon" badge, headline "Fly Aware. Adjust Early.", subtitle about posture awareness powered by AirPods, CTA "Join the Waitlist" using the existing `WaitlistForm` component
- **How It Works**: 3-step horizontal flow (Connect AirPods, Start a Flight, Monitor + Adjust) with aviation-inspired step numbering
- **Key Features grid**: 6 `GlowCard` items covering AirPods tracking, phone fallback, Live Activities, "Flying Too Long" alerts, session monitoring, and privacy-first design
- **Who It's For**: Clean list/card section targeting desk workers, students, AirPods users, and anyone with screen-related neck fatigue
- **Aviation-themed copy**: Use metaphors like "flight," "cruising altitude," "course correction" throughout
- **Privacy callout**: Prominent section emphasizing no cameras, no recordings, no biometric storage
- **CTA footer**: "Start your first flight." with waitlist form and link back to all products
- **Legal notice**: Standard Bestly product disclaimer linking to Terms and Privacy

### 2. Update `src/App.tsx`

- Import `NeckPilot` page component
- Add route: `<Route path="/neckpilot" element={<NeckPilot />} />`

### 3. Update `src/pages/Products.tsx`

Add NeckPilot to the `products` array:
- `id: "neckpilot"`
- `name: "NeckPilot"`
- `description: "Posture awareness powered by AirPods. Real-time feedback and gentle alerts when you've been flying too long."`
- `category: "App"`
- `status: "Coming Soon"`
- `icon: Smartphone` (or a relevant lucide icon like `Plane` / `Navigation`)

Update the product card link logic to include `neckpilot` routing to `/neckpilot`.

### 4. Update `src/components/ProductsDropdown.tsx`

Add NeckPilot entry to the dropdown products array:
- `name: "NeckPilot"`
- `description: "Posture awareness powered by AirPods"`
- `href: "/neckpilot"`
- `icon: Navigation` (aviation-themed lucide icon)

### Technical Details

**Icons used** (from lucide-react): `Navigation`, `Headphones`, `Activity`, `Bell`, `Timer`, `ShieldCheck`, `Smartphone`, `Monitor`, `Wifi`

**No new dependencies needed** -- everything uses existing components (`Layout`, `SEOHead`, `AnimatedSection`, `GlowCard`, `GradientText`, `WaitlistForm`, `Button`, `Badge`).

**No database changes required.**

