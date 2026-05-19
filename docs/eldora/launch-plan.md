# Eldora Luxe — Five-Item Launch Plan

**Compiled:** 2026-05-18
**Status:** Draft for execution

This plan attacks five remaining launch blockers in order of unblocking value.
Items 1 and 5 are completed in this session as drafts/verification; items 2,
3, and 4 are prepared with everything ready except your hands.

---

## 1. Legal Trio — DRAFTED ✓

Three documents written, saved as separate markdown files in
`docs/eldora/`:

- `privacy-policy.md` — GDPR + CCPA + UAE-aware, identifies our actual data processors (Stripe, IGI, GIA, Klaviyo, insured carriers, Lovable, Cloudflare, AWS), 30-day response SLA on data-subject requests, cookies section with Plausible (not Google Analytics)
- `terms-of-service.md` — splits two paths cleanly: **ready-to-ship** (14-day returns) vs. **bespoke commission** (50% non-refundable deposit at CAD lock, 8–14 week lead time, no returns / exchange-for-credit only). Includes the **dynamic-pricing clause** ("Material costs are dynamic — gold prices, government-set tariffs, and currency exchange (notably INR / USD) can shift…"), JAMS arbitration, EU consumer-protection carve-out, 1-year warranty + Lifetime Care Promise
- `accessibility-statement.md` — WCAG 2.1 AA conformance target, EN 301 549, Section 508, ADA Title III; marked as "partially conformant pending audit"

### What's left on this item

1. **You answer six placeholder fields** in the drafts:
   - Registered business address (Emporeko Global)
   - Governing-law jurisdiction (typically Delaware if Bestly LLC is the operator; UAE if Emporeko is UAE-based)
   - Arbitration city
   - Concierge phone number
   - Wire-transfer threshold (recommend $10,000)
   - DPO contact (only if EU-required; below the threshold for most small DTC operations)

2. **Counsel review** — budget $1,500–$3,000 for a jewelry-and-eCommerce attorney to review all three. Use a US firm with experience in luxury goods; LegalZoom won't catch the FTC disclosure nuance. Recommended: a fixed-fee online consultation through Avvo or UpCounsel.

3. **Publish** — once finalized, drop the three docs into the Lovable repo as `/privacy`, `/terms`, `/accessibility` routes. Wire the footer links to those absolute paths (task #60 — currently the footer links route to whatever page you're on, which is broken).

---

## 2. Trademark + Social Handles

### 2a. USPTO trademark — filing pack

**File at:** `teas.uspto.gov` → TEAS Plus form
**Cost:** $250 per class × 2 classes = **$500 total** filing fee
**Timeline:** ~12 months to registration if uncontested; you get "applied for" status and can use ™ immediately (the ® symbol comes only after registration)

**Mark to file:** `EL D'ORA` (word mark — covers all stylized presentations)

Consider a second filing for `ELDORA LUXE` if you want both protected. $500 more.

**Applicant:** Emporeko Global, [address]. (Bestly LLC is the technology partner per the footer — Emporeko owns the brand, so it should be the applicant.)

**International Classes to file in:**

- **Class 14** — "Jewelry; precious stones; lab-grown diamonds; rings; necklaces; bracelets; earrings; pendants; brooches; chains; cufflinks; tie clips; jewelry boxes" (covers everything in the Heritage Modern line except the clutch)
- **Class 18** — "Handbags; clutch purses; leather goods" (for the Marquise Clutch and future leather pieces)

**Goods and services description (paste exactly):**

> Class 14: Jewelry, namely, rings, necklaces, bracelets, earrings, pendants, and chains, made wholly or principally of precious metals and lab-grown diamonds; precious gemstones, including laboratory-grown diamonds; jewelry boxes; jewelry chains.
>
> Class 18: Handbags; clutch purses; leather goods, namely, evening clutches with precious metal hardware.

**First use anywhere:** [DATE — earliest dated marketing material, brochure, or ad video]
**First use in commerce:** [DATE — first paid customer transaction; if pre-launch, file as "intent-to-use" 1(b)]

**Specimen required:** for the in-commerce filing you'll need a photo of a piece with the EL D'ORA mark visible (on the tag, the certificate, the gift box, or the product itself) OR a marketing webpage showing the mark with a "buy" or "commission" CTA. The current eldoraluxe.com qualifies — screenshot the home page with the wordmark and price/commission button visible.

**Owner of filing:** Emporeko Global (entity type: LLC / corporation / sole prop — confirm)

**Filing path if you want me to draft the full form responses:** reply with the entity type, address, first-use dates, and your USPTO.gov account email; I'll prepare the field-by-field copy you paste.

### 2b. Social handles

External probes (Instagram, TikTok, X, Threads) were inconclusive — those platforms block scraping and return 200/302/403 regardless of whether a handle is taken. To get a real answer I'd need to log into each as you, which I can't do.

**5-minute fix on your end:** open each of these in your browser. If you see a profile page with posts, it's taken; if you see "User not found" or "This page isn't available," it's open.

| Platform | URL to check | What to grab |
|---|---|---|
| Instagram | instagram.com/eldoraluxe | @eldoraluxe |
| Instagram | instagram.com/eldora_luxe | fallback |
| TikTok | tiktok.com/@eldoraluxe | @eldoraluxe |
| Pinterest | pinterest.com/eldoraluxe | (highest-converting platform for fine jewelry, BTW) |
| YouTube | youtube.com/@eldoraluxe | @eldoraluxe |
| Threads | threads.net/@eldoraluxe | @eldoraluxe |
| X / Twitter | x.com/eldoraluxe | @eldoraluxe (less critical for luxury) |
| LinkedIn (company) | linkedin.com/company/eldora-luxe | branded page for press |

**Whichever variant is open across the most platforms** — claim that one everywhere for consistency. Don't mix `@eldoraluxe` on IG with `@eldora_luxe` on TT, that's lifetime brand drag. If `eldoraluxe` is taken anywhere, switch the entire kit to `eldoramaison` (your second-best fallback that ladders with "Maison de Haute Joaillerie").

**Time investment:** about 10 minutes to claim them all once you've decided. Just need an email and password manager per platform. **Do this today.** Squatters move fast on newly-launched luxury brands.

---

## 3. Stripe + Payments + Insured Shipping

### 3a. Stripe high-ticket underwriting

Stripe holds the first $25,000+ in transactions for review when AOV is high and you're a new account. Start underwriting NOW so it's done by launch.

**Steps:**

1. **Open / re-use Stripe account** for Emporeko Global. If a Bestly LLC Stripe account exists already, create a **Connected account** rather than running Eldora through Bestly's account — keeps the financials separate and avoids commingling.
2. **Activate** with full KYB: EIN, articles of organization, bank account, beneficial-ownership info, photo ID for control person.
3. **Add Stripe Tax** (automatic sales-tax calculation across US states + VAT/GST for international).
4. **Submit pre-emptive risk review** through dashboard support: tell them you'll have AOV $3K–$15K, expected volume X/month, jewelry vertical. Get the approval letter before the first transaction; otherwise the first $25K can get held for 7 days.
5. **Optional but recommended:** enable **Affirm** and **Klarna** as payment methods. A $4K ring at $200/mo is dramatically easier to sell than the same ring at $4K upfront. Affirm has a "luxury" tier specifically.

### 3b. Insured shipping

Three vendors that cover high-value jewelry. Pick one as the primary plus one backup.

| Vendor | Specialty | Insurance limit | Typical cost for a $5K ring, US domestic | Notes |
|---|---|---|---|---|
| **Malca-Amit** | Diamond / luxury logistics, white-glove | $25M | $45–$80 per shipment | Industry standard for high-end jewelry. Their staff hand-carry; requires an account |
| **Brink's** | Armored logistics, B2B + DTC jewelry | $10M | $60–$120 | More overkill for sub-$50K parcels but very reliable |
| **FedEx Custom Critical (Valuable Cargo)** | FedEx's luxury shipping arm | $10M | $35–$60 | Cheapest of the three; works well up to $50K per parcel |
| **Parcel Pro (by USPS)** | DTC-friendly jewelry-specific carrier | $100K per parcel | $20–$35 | Good for the $1K–$10K range; international limited |

**Recommendation for launch:** open a **Parcel Pro** account for everything under $10K, and a **Malca-Amit** account for everything over $10K (engagement rings, high jewellery, bespoke commissions). Hardcode a routing rule in the order-management flow: AOV gate decides carrier.

### 3c. Jeweler's block insurance (the inventory policy)

Different from shipping insurance — covers inventory in your atelier, in transit between Rohit's workshop and Paris/Dubai, on customer try-on, on photography, on the bench during repair. Without this, one loss eats the year.

**Brokers to call (Lloyd's syndicates write the underlying policy):**

1. **Jewelers Mutual Group** — US-headquartered, the largest jewelry-specific insurer. They have a "JewelersChoice" product specifically for new luxury startups under $10M annual revenue. **(800) 558-6411** or `jewelersmutual.com`. Typical quote: $3,500–$8,000/year for $250K coverage.
2. **Glencairn Underwriting** (Lloyd's syndicate) — covers higher-value bespoke operations. Reach via brokers like **Brown & Brown** or **Marsh McLennan Jewelry Specialty**.
3. **Lockton Affinity – Jewelry Block** — middle of the road, good for $500K–$5M inventory tiers.

**Get three quotes**, choose on the basis of: (a) inventory value covered, (b) deductible per loss, (c) coverage for in-transit, (d) coverage during customer try-on at Dubai or Paris, (e) coverage during photography. Don't optimize for the cheapest premium — the cheap policies have $5K deductibles that wipe out the cost savings on the first incident.

**Timeline to bind:** 2–3 weeks from first call. Start this week.

### 3d. AML / KYC for high-value sales

The FinCEN Patriot Act rules require that dealers in precious metals, stones, and jewels file an **AML compliance program** if annual sales exceed $50,000. For luxury bespoke at $5K+ AOV, you'll cross that threshold quickly. The program is essentially documentation, not heavy operational lift:

- Written AML policy (template available from Jewelers Vigilance Committee)
- Designated AML compliance officer (can be you initially)
- Customer ID verification for transactions over $10,000 (or any structured to evade reporting)
- File Form 8300 with IRS for any cash transaction over $10,000

**One-time setup:** ~$500–$1,500 if you use a consultant; free if you DIY using JVC templates. **Action: subscribe to Jewelers Vigilance Committee** ($395/year membership) — they provide the templates and ongoing legal updates.

---

## 4. Per-Pillar URLs

### The problem

Right now, all five collection links in nav + footer route to `/shop`:

- `/shop?collection=traditional` would let the URL pre-filter the catalog
- The current implementation routes everything to flat `/shop` and lets the in-page filter button do the work
- Bad for SEO (Google can't index per-pillar landing pages)
- Bad for marketing (you can't send IG ad traffic directly to "Generational Beauty" — they all hit the same page)

### The fix

Need to do three things in the Lovable codebase:

**(i) Add five new URL routes:**
- `/pillars/traditional`
- `/pillars/for-all`
- `/pillars/for-him`
- `/pillars/generational-beauty`
- `/pillars/rebel`

Each route is a copy of `/shop` pre-filtered to that pillar, with its own SEO meta + a pillar-specific hero (the brand-voice paragraph from your pillar briefs).

**(ii) Add a per-pillar hero with the brand voice:**
The Heritage Modern brief I read earlier IS the voice template — short intro paragraph, era inspiration, two-line description per piece. Each pillar should have its own ~100-word intro at the top of its URL.

**(iii) Update internal links:**
The nav + footer links currently href `/shop` for every collection. Change them to the per-pillar URLs.

### How I'd execute this

Lovable typically syncs to a GitHub repo. **Tell me where the El Dora Lovable repo lives** (e.g., `Bestly-LLC/eldora-luxe`) and I'll write the React Router + page-component changes as a PR you merge. About a 60-minute task.

Alternative: in the Lovable IDE, ask Lovable's AI to "Add five new routes /pillars/[slug] each rendering Shop component pre-filtered to that slug, with a pillar-specific hero" — they're fast at this kind of refactor.

### SEO meta per pillar (paste-ready)

| Slug | Title | Meta description |
|---|---|---|
| `traditional` | Traditional Collection · Classic Diamond Jewelry · El D'Ora | Timeless settings for engagements, anniversaries, and heirloom moments. Lab-grown diamonds, IGI-certified, set in 18K gold by master jewelers. |
| `for-all` | For All · Gender-Neutral Fine Jewelry · El D'Ora | Pieces crafted for any wearer. Sustainably made, lab-grown diamonds, refined silhouettes that move between formal and everyday. |
| `for-him` | For Him · Men's Fine Jewelry · El D'Ora | Bold chains, signet rings, and statement pieces in recycled 18K gold. Crafted in the Place Vendôme tradition with lab-grown stones. |
| `generational-beauty` | Generational Beauty · Heirloom Jewelry · El D'Ora | Pieces designed to be passed down. Mid-century-inspired silhouettes, lifetime resizing, lifetime care. |
| `rebel` | Rebel · Architectural Diamond Jewelry · El D'Ora | Sculptural, masculine-modern designs. Unisex inlay bands, ear cuffs, and pieces that break with convention. |

---

## 5. AI Design Studio Backend — VERIFIED ✓

The wizard at `/custom` IS wired to a real backend, not a wireframe. The "Generate" step posts to a **Supabase Edge Function**:

```
https://hcmizelavsrrqzqufiep.supabase.co/functions/v1/generate-jewelry-design
```

So the customer-facing promise on the homepage ("AI Design Studio") and the FAQ ("How does the AI Design Studio work?") is grounded in a real service. This is great news.

### What's still unknown and worth checking before launch

1. **What does it return?** Image render, STEP file URL, bespoke quote, or just a "we'll contact you" confirmation? Need to complete the wizard once and inspect the response.
2. **What does it call under the hood?** OpenAI / Claude / Replicate / Zoo.dev? You should know which APIs are charged per generation so you can model unit cost.
3. **Rate limits + budget cap.** A Supabase Edge Function with no rate limit is one viral TikTok away from a $5K bill. Set a per-IP and a per-day cap before the first paid ad.
4. **Lead capture wired to the generation?** When a customer completes the wizard, does their email/contact land in your CRM (Klaviyo, HubSpot, manual spreadsheet) alongside the design they generated? If not, the highest-intent leads you'll ever capture are leaking out.
5. **Cost-per-generation.** At minimum log the input/output tokens or generation seconds. Without telemetry you'll find out you spent $400/day on demo-only traffic.

### Verification action (do this with me)

Reply "**verify Design Studio**" and I'll click through the entire wizard end-to-end on your live site, capture the request/response payload, audit the Edge Function source if it's in a connected GitHub repo, and report back on the five questions above. Takes ~5 minutes.

---

## What I need from you to move further

In order of unblocking value:

1. **Six legal-doc placeholders** filled in (registered address, governing-law jurisdiction, arbitration city, concierge phone, wire-transfer threshold, DPO contact if EU) — this unblocks publishing the legal trio.
2. **Confirm the Lovable repo location** (GitHub URL) — unblocks me writing the per-pillar URL PR.
3. **Confirm entity for trademark filing** (Emporeko Global is my assumption; LLC vs corporation matters) — unblocks me drafting the TEAS Plus field copy.
4. **Decision on Stripe Connected vs. new account, and whether you want Affirm/Klarna enabled** — unblocks me writing the Stripe onboarding checklist.
5. **5 minutes of your time** to claim the social handles across IG / TT / Pinterest / YT / Threads / LinkedIn before someone else does.

Reply with any subset of those answers and I'll close those tasks the same session.
