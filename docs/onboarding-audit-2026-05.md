# Onboarding audit, 2026-05

A cross-cutting audit of what Bestly has actually committed to publicly about three products — ParentIQ, SchoolPilot, and HOAscope (still labelled "HOA Cure" in the marketing config) — measured against the three feature inventories Jared just produced. The intent is to give Eli a clean read on what the public site says, what code actually exists, and what we'd be lying about if we walked into a partner conversation tomorrow.

## Summary

Half-aligned, leaning fragmented. The three inventories are coherent on their own — privacy-first, on-device-where-possible, subscriber-funded, no data sale — and they speak in a recognisable Bestly voice. The public surface around them is not. SchoolPilot and HOA Cure exist as cards on `/products` with feature bullets that predate the inventories and don't match them. ParentIQ doesn't exist in the bestlytech repo at all — no card, no route, no asset, no SEO description. HOAscope is named "HOAscope" in the status page (`/status` already lists `hoascope.com` and `app.hoascope.com` as monitored services) but "HOA Cure" everywhere else, and the runbook docs already note both `hoascope.com` and `app.hoascope.com` are unbuilt — `hoascope.com` is a Namecheap parking page and `app.hoascope.com` is NXDOMAIN. Bottom line: the inventories are the most current, most opinionated documents Bestly has on these products, and the rest of the org's "story" is older, thinner, and in HOAscope's case actively contradicted by the operator-facing infra docs.

## Per-product findings

### ParentIQ

**What's documented.** Only one document touches ParentIQ: `/Users/jared/Developer/bestlytech/docs/parentiq-feature-inventory.md`. The inventory is explicit that "ParentIQ is not yet in the bestlytech repo or on the products page; this is the ground-up proposal. Nothing about it has shipped, nothing has been promised externally." That self-description matches reality. There is no entry in `src/config/products.ts`, no asset (`src/assets/` has icons for schoolpilot and hoacure but nothing parentiq-shaped), no route in `src/App.tsx`, no mention in `src/pages/Index.tsx`, `Products.tsx`, `About.tsx`, `PressKit.tsx`, or `Links.tsx`, and no domain referenced in `Status.tsx`.

**What's actually shipped.** Nothing. There is no app, no marketing page, no waitlist surface, no domain probe.

**Gaps between what's promised and what exists.** None — because nothing has been promised. The inventory's own framing ("ground-up proposal") is the true state of the world. The gap is internal: the one inventory that's furthest along (most opinionated, most prescriptive, most product-shaped) is also the one with the least surface area in the rest of the org. If Eli starts outreach on ParentIQ before a holding page exists, the first thing a prospect googles will return nothing.

**Contradictions.** The inventory leans hard on on-device AI ("Voice transcription (whisper-cpp class), log parsing, and the privacy-sensitive pre-filter all run on-device") and a Bestly-controlled cloud proxy. Nothing about ParentIQ contradicts the rest of the public site, but the on-device language is significantly more aggressive than anything currently published — `InHouseCloud.tsx` markets "Local AI (1B–8B models)" as an enterprise infrastructure outcome, not a phone-side feature. ParentIQ would be the first Bestly product to operationalise on-device AI for a consumer use case. That is a positioning move, not a bug, but it should be a deliberate one rather than a quiet one.

**Action items specific to ParentIQ.** Decide whether ParentIQ gets a `/parentiq` holding page, an entry in `products.ts` with status "Coming Soon," or stays dark until v1 of the app is real. The inventory's open question 8 ("standalone bestly product, app on products page, or both") is unanswered, and the answer dictates whether Eli can talk about it at all.

### SchoolPilot

**What's documented.** The inventory at `/Users/jared/Developer/bestlytech/docs/schoolpilot-feature-inventory.md` is the longest of the three, written as a pilot proposal for a K-12 superintendent. The marketing config has a card:

```ts
{
  id: "schoolpilot",
  name: "SchoolPilot",
  description: "Navigate school life with ease — schedules, grades, and assignments in one place.",
  href: "/products",
  status: "In Development",
  features: ["Unified schedule view", "Grade tracking & GPA", "Assignment reminders", "Parent & student modes"],
}
```

`Products.tsx` renders that card, and the page's SEO description (`Products.tsx:31`) explicitly names SchoolPilot in the public meta tag served to search engines and social cards. The page has no SchoolPilot detail route — `href` is `/products`, which means the "Learn More" button on the SchoolPilot card just bounces the visitor back to the same page they're on.

**What's actually shipped.** Marketing copy and an icon. There is no `schoolpilot.com` probe in `Status.tsx`, no `/schoolpilot` route in `App.tsx`, no SchoolPilot folder under `src/`, no Supabase table that mentions it. The expectation that "code lives in separate Lovable projects" is consistent with the bestlytech repo containing only marketing — confirmed for SchoolPilot.

**Gaps between what's promised and what exists.** The marketing card frames SchoolPilot as a parent/student app ("Parent & student modes") with grade tracking and assignment reminders. The inventory frames it as a district-grade, superintendent-greenlightable platform with five distinct stakeholder views (parents, students, teachers, building admins, district admins), a 6-week implementation timeline, FERPA/COPPA compliance, an equity dashboard, integrations with PowerSchool/Skyward/Infinite Campus/Canvas/Schoology/Clever/ClassLink, and a pricing model in the $3-$5 per student per year range. These are different products in scope and buyer. The card describes a consumer student-life app; the inventory describes a B2B-to-K12 platform sale. If a superintendent reads the marketing card before the inventory, they will reasonably assume SchoolPilot is not built for them.

**Contradictions.** "Grade tracking & GPA" on the card implies SchoolPilot is the gradebook. The inventory is emphatic that it is not: "What it is not: a replacement SIS, a replacement LMS, a gradebook…" — the inventory positions SchoolPilot as a read layer above the SIS. The card's bullet is wrong by the inventory's own definition.

**Action items specific to SchoolPilot.** Rewrite the card to match the inventory's positioning ("a calm parent and student view of school life across whatever the district already runs"). Drop or rephrase "Grade tracking & GPA." Either give SchoolPilot a real `/schoolpilot` detail page that mirrors the inventory's executive summary or change the card's "Learn More" target to a generic "in development" affordance — sending visitors back to `/products` is worse than nothing.

### HOAscope (still "HOA Cure" in marketing)

**What's documented.** `/Users/jared/Developer/bestlytech/docs/hoascope-feature-inventory.md` is the canonical product doc. It opens with an explicit naming caveat: "the marketing config still lists this product as 'HOA Cure.' We're calling it HOAscope going forward." The marketing config (`src/config/products.ts:93-101`) still says:

```ts
{
  id: "hoa-cure",
  name: "HOA Cure",
  description: "Simplify HOA management. Violations, dues, and community comms — finally under control.",
  href: "/products",
  image: hoacureIcon,
  status: "In Development",
  features: ["Violation tracking", "Automated dues collection", "Community announcements", "Board meeting tools"],
}
```

The asset filename is `hoacure-icon.png`. The Products.tsx SEO description names "HOA Cure" in the meta tag. PressKit.tsx does not include this product at all (its hardcoded array is just Cookie Yeti, InventoryProof, HOKU, NeckPilot).

**What's actually shipped.** This is the most contradictory surface across the org. Three different docs/files speak with three different names and three different positions:

- `src/config/products.ts` and the resulting `Products.tsx` card: "HOA Cure," in development, nothing more.
- `src/pages/Status.tsx` lines 65-80: monitors `hoascope.com` ("HOAscope Site") and `app.hoascope.com` ("HOAscope App") on the public status page. The names already match the new naming convention.
- `docs/admin-opusplan.md` and `docs/dns-cert-migration-runbook.md`: confirm `hoascope.com` is a Namecheap parking page and `app.hoascope.com` is NXDOMAIN. The runbook explicitly says "there's no `hoascope` app deployed anywhere" and recommends not adding the `app.hoascope.com` CNAME until the app exists.

The net effect: the public marketing page calls it "HOA Cure" with a "Coming Soon"-class status; the public status page calls it "HOAscope" and probes two domains that do not exist; the operator runbook acknowledges the domains are not ready. A determined visitor going from Products → Status would see two product names and a status page reporting outages on a product that has not been built.

**Gaps between what's promised and what exists.** The inventory describes a 30-feature operating system across six product areas, a two-state-first compliance strategy (Davis-Stirling and Florida Chapter 720), MVP scoped at four months around dues + payment portal, and a flat-fee-per-association pricing model ($99-$499/mo plus custom). The marketing card promises "Violation tracking, Automated dues collection, Community announcements, Board meeting tools" with no compliance, no pricing, no positioning. The card is approximately right in spirit but a generation older than the inventory's thinking, particularly on (a) which workflow is the wedge (the inventory says dues, not violations) and (b) who the buyer is (the inventory says self-managed boards, not property managers).

**Contradictions.** The biggest one is the name. The product page says "HOA Cure"; the status page says "HOAscope"; the inventory says "HOAscope." A visitor who notices both will reasonably wonder which is real. Past that, the marketing card's lead bullet ("Violation tracking") implies violations are the headline workflow; the inventory explicitly recommends dues first because "dues are the boring workflow that drives renewal" and "violations are sexier and more differentiated, but they're an emotional purchase."

**Action items specific to HOAscope.** This is the urgent rename. Update `products.ts` to `name: "HOAscope"` and `id: "hoascope"`, rename the asset file from `hoacure-icon.png` to `hoascope-icon.png`, fix the Products.tsx SEO meta description that names "HOA Cure," and decide whether to keep the `hoa-cure` id around for any external link compatibility or do a clean swap. Separately, decide whether `hoascope.com` should be unmonitored on the status page until a real site is deployed there — currently the public status page is reporting "Outage" or "Checking" on services that were never built, which undermines the credibility of the whole status page.

## Cross-cutting observations

**All three are marked "In Development" but only HOAscope has any infrastructure footprint at all, and that footprint is wrong.** SchoolPilot and ParentIQ have no domains and no routes; HOAscope has two domains being publicly probed by `Status.tsx` against operator docs that say nothing has been deployed. "In Development" is being used as a synonym for "we have a marketing card" rather than a statement about engineering progress.

**Confesh is also "In Development" in the marketing config but has shipped privacy and support pages.** `src/pages/ConfeshPrivacy.tsx` and `src/pages/ConfeshSupport.tsx` exist, with on-device language already published. None of the three products in this audit have equivalent legal/support surfaces. Before any of the three goes public — even as a holding page — they need at least a privacy stance page that matches their inventory, because the existing master `PrivacyPolicy.tsx` and the App Store privacy review process both expect product-specific disclosures.

**The "marketing only, code lives in separate Lovable projects" expectation is confirmed.** No SchoolPilot, ParentIQ, or HOAscope application code exists in the bestlytech repo. Assets and config entries only.

**Brand voice and privacy stance are consistent across the three inventories.** All three: subscriber-funded or institutional-paid, never ad-funded; explicit "no data sale, ever" stance; reference to Bestly's In-House Cloud as an institutional tier. Tone is recognisably the same — "the unloved middle," "the surveillance problem we have to keep front of mind," "a parent app that pretends to be calm while running on top of seven dashboards." Voice is aligned. The drift is between the inventories and the older marketing copy, not between the inventories themselves.

**ParentIQ is the only one of the three that pushes on-device AI heavily, and that is more aggressive than anything Bestly has previously claimed for a consumer product.** `InHouseCloud.tsx` advertises "Local AI (1B-8B models)" but as a feature of the Bestly enterprise appliance, not as a phone-side capability. The other consumer-app pages (`CookieYeti.tsx`, `NeckPilot.tsx`, `Hoku.tsx`) lean on privacy and "no tracking" rather than on-device inference specifically. ParentIQ would be the first Bestly consumer app to claim on-device speech transcription and on-device pre-filtering. This is a defensible position but it should be socialised with the rest of the brand voice before the marketing site repeats it.

**Press kit is stale.** `PressKit.tsx` lists Cookie Yeti, InventoryProof, HOKU, and NeckPilot — none of the three audit products. If the press kit is the canonical document we point external press at, it implicitly claims SchoolPilot, HOAscope, and ParentIQ don't exist. That may be the right move (don't tell the press about products that aren't built) but it should be a deliberate one.

**The status page is doing too much, too early.** `Status.tsx` probes `hoascope.com` and `app.hoascope.com` against domains the runbook says are not deployed. A new visitor checking the status page right now sees red dots on services that were never built. This is worse than not listing them at all — it damages the credibility of every other green dot on that page.

## Action items

1. **Fix the HOA Cure → HOAscope rename across the site.** `src/config/products.ts:93-101` (id, name, image filename), `src/assets/hoacure-icon.png` → `hoascope-icon.png` (and the corresponding import on line 6), `src/pages/Products.tsx:31` SEO meta description. After the rename, the only file that should still contain the string "HOA Cure" is the inventory's own naming caveat sentence.
2. **Either ship a `/hoascope` detail page or change the card's `href`.** Currently `href: "/products"` makes "Learn More" loop back to itself. The lowest-effort fix is `href: "#"` plus disabling the Learn More button when status is "In Development"; the better fix is a real holding page.
3. **Same fix for SchoolPilot.** `href: "/products"` is also looping back. Either disable Learn More or build `/schoolpilot`.
4. **Rewrite the SchoolPilot card description and feature bullets to match the inventory's positioning.** Drop "Grade tracking & GPA" — the inventory is explicit that SchoolPilot is not a gradebook. Replace with "Equity-of-access dashboard for districts," "Reads from your existing SIS, LMS, and comms tools," or similar. Buyer is a superintendent, not a parent shopping the App Store.
5. **Decide on ParentIQ's public surface.** Either add a "Coming Soon" entry in `products.ts` (and the asset and the holding page) or do not mention ParentIQ on the public site until the app is real. Eli should not be sending external messages about a product that returns nothing on a Google search of the bestly.tech site.
6. **Remove `hoascope.com` and `app.hoascope.com` from the `Status.tsx` probe list until the sites exist.** `SERVICE_ORDER` currently includes both, and they will report `unknown` or `down` indefinitely. Either remove them or hide them behind a "not yet launched" filter until the runbook's "build the app" prerequisite is done.
7. **Update `PressKit.tsx`'s product array deliberately.** Either add the three products with their inventory descriptions, or document that the press kit intentionally omits in-development products. Today it does the latter implicitly.
8. **Decide privacy-policy strategy for the three.** Confesh has a product-specific privacy page; Cookie Yeti has one; the master `PrivacyPolicy.tsx` is generic. Each of the three audit products will need its own privacy page before App Store / Play Store / district procurement. Worth scaffolding now even if empty, so the inventories' privacy stances have a public home to point at.
9. **Decisions Jared needs to make before Eli does outreach:**
   - Naming: HOAscope confirmed? Greenlight the rename PR.
   - ParentIQ: keep the working name, or rename per the inventory's open question 7?
   - Public timing: are SchoolPilot and HOAscope "for sale to a pilot district/board today" or "in development, no commitments"? The marketing card says the latter; the inventories read like the former.
   - Pricing publish-or-not: each inventory has a recommended price; should it be on the marketing site, in the press kit, or kept private until the first two pilot conversations close?
   - Distribution: per ParentIQ's open question 8, do these three live as Bestly products under bestly.tech/products, as standalone domains, or both? HOAscope already has the standalone domain (parked); SchoolPilot does not; ParentIQ does not.

## Open questions surfaced by the audit

1. **What status does "In Development" actually communicate to a prospect?** Right now it covers everything from "we have an opinion" (ParentIQ, SchoolPilot) to "we have an opinion and a parked domain" (HOAscope) to "we have an opinion and an alpha build" (Confesh). If Eli is going to send these around, "In Development" is too coarse. Consider a sub-status: "Concept," "Pilot-ready," "Soft launch."
2. **Is the press kit's omission of these three products a feature or a bug?** It looks deliberate (only-shipping-products are listed) but it is not stated. Should the press kit note "additional products in development" without naming them, name them, or stay silent?
3. **Does Bestly want a single voice on local-AI claims across all consumer products?** ParentIQ pushes hardest. NeckPilot and Cookie Yeti are quieter on it. Without a deliberate stance, ParentIQ's marketing copy will read as a one-off.
4. **What's the threshold for putting a domain on the public status page?** Today `hoascope.com` and `app.hoascope.com` are listed despite never being deployed. The implicit policy is "anything we own"; the better policy might be "anything that has shipped." Worth a standing rule.
5. **Per HOAscope inventory open question 8 ("the hostile-board problem"), and ParentIQ inventory open question 2 ("liability surface"), and SchoolPilot's FERPA stance — these three products all sit on top of asymmetric power relationships (board over resident, parent over child, district over family).** Bestly's privacy stance is the same across the three, but the trust questions differ. Worth an explicit cross-product position before any of them hits the App Store or a district procurement office.
6. **Is "HOAscope" the right name?** The inventory makes it official without explaining the rename rationale. "Cure" implied a remedy/disease frame; "scope" implies surveillance, which is the opposite of the privacy stance. Worth confirming before the rename PR lands.
7. **Where does on-device AI compute happen for ParentIQ when the user is on Android?** The MVP is iOS-only, but the inventory's secondary persona includes Android. The on-device AI claim is portable in theory; in practice it depends on the device. This affects the marketing claim's truth value once the product expands beyond iOS.
8. **Do any of these three need a Bestly-site holding page before Eli sends them to a prospect?** A "we are building this, here is the inventory in PDF, here is the contact form" surface costs an afternoon and prevents the worst version of an outreach: a prospect googles SchoolPilot Bestly, sees the existing card, clicks Learn More, and is bounced back to the same page.

---

Top-three findings (100 words):

The HOA Cure / HOAscope split is the highest-priority fix — `src/config/products.ts` still names the product "HOA Cure" while `src/pages/Status.tsx` already publicly probes `hoascope.com` and `app.hoascope.com` (both unbuilt per the runbook), and the inventory has renamed it. Second, `Products.tsx`'s SchoolPilot card describes a different product than the inventory — it claims grade tracking the inventory explicitly disclaims — and "Learn More" loops back to `/products`. Third, ParentIQ has no public surface at all; before Eli does outreach, it needs at least a holding decision: card, page, or stay dark.
