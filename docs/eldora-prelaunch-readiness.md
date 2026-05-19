# Eldora Luxe — Pre-Launch Readiness Assessment

**Compiled:** 2026-05-18
**Sources read:** I2C Project Plan (Mar 11), Zoo vs Custom Proposal (Apr 8),
Pillar 4 — Heritage Modern collection brief, file inventory on cloud.bestly.tech
**Status:** Synthesis only — confirm with team before acting

---

## 1. What Eldora Luxe Is (as evidenced by the docs)

**Brand:** El D'Ora / "Eldora Luxe" — a luxury lab-grown gemstone jewelry house
with adjacent accessories (a clutch is in the Heritage Modern collection,
hinting that this is a broader fine-jewelry-plus-accessories brand, not
diamonds-only).

**Positioning:** cross-generational, era-inspired, sustainability-led —
recycled 18K gold, lab-grown stones, ethically sourced pearls and leather.
The brand voice in the Heritage Modern brief is excellent and reusable as-is
for product pages.

**Collection structure:** four "Pillars." Pillar 4 (Heritage Modern) has six
named SKUs already specified:

| SKU | Materials | Stone | Audience |
|---|---|---|---|
| Astoria Ring | 18K white gold + milgrain | ~3.5ct emerald-cut lab diamond | Cocktail-ring collectors |
| Belvedere Pearl Necklace | 18K yellow gold + Akoya pearls | Brilliant + marquise diamonds | Gala evenings |
| Regent Chain | Recycled 18K yellow gold Cuban link | none | Men's statement |
| Marquise Clutch | Calf leather + 18K-plated hardware | Pavé diamond clasp | Cross-generational evenings |
| Verdigris Bracelet | Brushed 18K gold cuff | Malachite inlay | Gender-neutral, bohemian |
| Starlight Earrings | 18K gold | Micro-pavé diamonds + pearls | Evening adornment |

Pillars 1–3 not yet read here — likely additional collections in the same
era-bridge format.

**Team:**
- **Jared** — owner / product / web / AI tooling (you)
- **Eli** — marketing / ads (per the `Projects/El Dora/Eli Sent/` folder + ~21 ad videos)
- **Cleo** — creative deliverables (per `Bestly/Cleo-Deliverables/`)
- **Rohit** — manufacturing / jeweler — refines CAD, runs production, owns the cost formula

**Production pipeline (decided March 11, 2026):**
1. AI-generated concept image (Midjourney / DALL-E)
2. → Zoo.dev Zookeeper AI agent → parametric STEP file (~6 min/design, $0.50/min)
3. → Jeweler refines the STEP
4. → Rohit's team manufactures using their working/forging cost formula
5. → Quality check + photography
6. → Ships to customer

Decision: **Use Zoo.dev directly via the $20/mo Plus plan**, not build a custom
tool, until volume justifies the $9–17.5K dev investment.

---

## 2. What's IN HAND (assets that exist)

- ✓ Brand name, voice, and four-pillar architecture
- ✓ Heritage Modern collection brief (6 SKUs, copy-ready)
- ✓ AI-generated concept renders (Batch 1, Batch 3) for at least 5 products
- ✓ Brand standards PDF exists in `Projects/El Dora - Pillar/` (1.6KB — placeholder-sized, **verify it's not stub**)
- ✓ Master El Dora PDF (15MB, 6 pages — likely the pitch deck or brand book)
- ✓ Pillar 2 PDF (18MB — fuller deck)
- ✓ Brochure template (`EL DOra New Brochure Blank.pdf`, 1.9MB)
- ✓ 21 ad videos already produced (7 sent to Eli, 14 not yet sent)
- ✓ Manufacturing partner identified (Rohit)
- ✓ Production tech path validated (Zoo.dev confirmed working)

---

## 3. What's MISSING for Launch (gap audit, by category)

### 3.1 Brand & Identity
| Item | Status | Risk if launching without it |
|---|---|---|
| Final logo (vector, all formats) | Unknown | Can't print on packaging, hangtags, or website |
| Wordmark vs. icon system | Unknown | Inconsistent presentation across channels |
| Trademark filed (USPTO) | Unknown | Brand-name squatters; can't enforce |
| Domain (eldora.com / eldoraluxe.com / eldd-ora) | Unknown | Hard to buy after launch buzz |
| Social handles secured (IG/TT/Pinterest/YT) | Unknown | Squatters take handles after first ad spend |
| Brand standards document (real, not stub) | Stub-sized | Vendors apply inconsistent styling |
| Press kit (single PDF + image folder) | Missing | Slows PR/journalist outreach |

### 3.2 Product Readiness
| Item | Status | Notes |
|---|---|---|
| CAD-ready STEP files per SKU | Partial — pipeline working but per-SKU status unknown | Need: a per-SKU checklist of "CAD locked vs. iterating" |
| First physical sample per SKU | Unknown | Required for product photography |
| Lab-grown stone certs (IGI / GIA) | Unknown | **Required by FTC for "lab-grown" claims; required by serious buyers** |
| Recycled-gold sourcing certificate (RJC chain-of-custody or equivalent) | Unknown | Substantiates sustainability claims |
| Final retail pricing per SKU | Unknown — Rohit's formula still pending per Mar 11 plan | Can't launch without prices |
| Made-to-order vs. ready-stock model | Undecided | Drives lead time, inventory cost, return policy |
| Ring sizers (mailed kit) | Unknown | Critical for rings sold online |
| Care guide per material (pearl, malachite, gold, leather) | Missing | Drives long-term satisfaction; reduces returns |

### 3.3 Web & eCommerce
| Item | Status | Notes |
|---|---|---|
| Platform choice (Shopify? Webflow + Stripe? Bestly Cloud-hosted?) | Unknown | Tradeoffs: Shopify = fastest launch, takes 2.9% + $0.30; custom = full control, more dev |
| Product photography (white + lifestyle) | Unknown | Without samples photographed, the site is renders only |
| Product page copy | Partial — Heritage Modern brief reusable | Pillars 1–3 still need copy |
| Brand story page | Brief exists, not on web | One paragraph from the Heritage Modern intro is ready |
| Email-capture landing page (pre-launch) | Missing | Should be live NOW for waitlist building |
| Size guide | Missing | |
| Return / exchange / repair policy | Missing | Legally required + buyer trust |
| Shipping policy + carriers (insured for high-value) | Missing | $5K rings can't ship UPS Ground uninsured |
| Lab-grown diamond education page | Missing | Major conversion lever — most luxury buyers don't yet trust lab-grown |
| Reviews / social proof plan | Pre-launch can't have reviews; need plan for collecting | |

### 3.4 Legal & Compliance
| Item | Status | Notes |
|---|---|---|
| Entity (LLC / DBA for Eldora Luxe) | Unknown | Probably DBA under Bestly LLC initially; verify |
| FTC lab-grown diamond disclosure compliance | Unknown | **MUST clearly disclose "lab-grown" in all marketing per 2018 FTC Jewelry Guides** |
| "Recycled gold" / "ethically sourced" claims substantiated | Unknown | FTC Green Guides require substantiation |
| Trademark registration | Unknown | |
| Terms of service | Missing | |
| Privacy policy | Missing | |
| Made-to-order terms (deposit, no refund after CAD finalized) | Missing | High-ticket custom requires clear cancellation terms |
| Sales tax (Stripe Tax / TaxJar / Avalara) | Unknown | Required in 45+ US states for online sales |

### 3.5 Payments & Pricing
| Item | Status | Notes |
|---|---|---|
| Payment processor (Stripe / Shopify Payments) | Unknown | High-ticket items may trigger underwriting review |
| Financing option (Affirm / Klarna / Bread) | Unknown | A $4-15K ring is much easier to sell at $200/mo |
| Currency support | Unknown | International luxury market — multi-currency worth considering |
| Deposit / payment plan terms | Missing | Custom commissions usually want 50% deposit |
| Insurance for in-transit pieces | Missing | Lloyd's or jeweler's block policy required for $$ pieces |

### 3.6 Operations
| Item | Status | Notes |
|---|---|---|
| Manufacturing SLA with Rohit | Unknown | "How fast can he turn an order?" sets the customer promise |
| Order management system | Missing | Even a Notion + Stripe spreadsheet works for first 50 orders |
| Packaging (box, pouch, polishing cloth, cert sleeve) | Unknown | Unboxing IS the luxury product for online jewelry |
| Customer service flow (email / chat / phone) | Missing | High-ticket buyers want a human reachable in <1 day |
| QA process pre-shipment | Unknown | |
| Repair / resize policy (lifetime? 1yr?) | Missing | Industry-standard for fine jewelry is lifetime repair |

### 3.7 Marketing & Launch
| Item | Status | Notes |
|---|---|---|
| 21 ad videos | ✓ exist | Need: status of each (approved? channel-mapped? not yet sent?) |
| Launch sequence plan (soft → preorder → public → ad scale) | Missing | |
| Email list / waitlist | Likely zero | Pre-launch capture is highest-ROI activity |
| Influencer / press outreach plan | Missing | Lab-grown jewelry has a small but engaged press pool |
| PR angle (vintage-inspired + sustainable + lab-grown) | Brief exists, no list of outlets | |
| Paid ad creative review + spending plan | Missing | |
| Organic IG content calendar | Missing | |
| Affiliate program (e.g., 10–15% for jewelry creators) | Missing | |

---

## 4. The "Cannot Launch Without These" Short List

If you launched tomorrow with what you have today, the eight things that
would block you or get you in trouble:

1. **No physical samples photographed** — site would be all renders. Renders don't convert at luxury price points.
2. **No final prices** — Rohit's cost formula still pending per March doc.
3. **No payment processor onboarded for high-ticket** — Stripe will hold first $25K+ transactions for review if you haven't done underwriting.
4. **No FTC-compliant "lab-grown" disclosure language locked in** — every marketing claim must say "laboratory-grown" or "lab-grown" clearly.
5. **No legal trio** (ToS, privacy, return policy) — you cannot accept money online without these.
6. **No domain + DNS + SSL** — assuming not bought yet.
7. **No certification for stones** — luxury buyers will ask within first 10 orders.
8. **No insured shipping** — first lost package eats a year of profit.

---

## 5. Recommended Sequence (8-week pre-launch plan)

| Week | Workstream | Owner | Deliverable |
|---|---|---|---|
| 1 | Pricing locked | Rohit + Jared | Per-SKU retail price sheet (uses Rohit's formula on each STEP volume) |
| 1 | Domain + trademark filed | Jared | eldoraluxe.com + USPTO Class 14 (jewelry) + Class 18 (leather goods, for clutch) |
| 1 | Pre-launch waitlist page live | Jared | One-pager on eldoraluxe.com that captures emails |
| 2 | First physical samples produced | Rohit | 6 Pillar-4 SKUs in hand |
| 2–3 | Product photography | Cleo or external | White + lifestyle per SKU; macro for stone closeups |
| 3 | Stone + gold certs collected | Rohit + Jared | IGI/GIA reports stored in Nextcloud per SKU |
| 3–4 | eCommerce platform built | Jared | Shopify or Bestly-Cloud-hosted store with 6 SKUs live |
| 4 | Legal trio drafted | Jared (using AI + counsel review) | ToS, privacy, returns/repair, shipping policy |
| 4–5 | Payments + insured shipping | Jared | Stripe approved for high-ticket, jeweler's block insurance bound |
| 5 | Education page (lab-grown explainer) | Jared + Cleo | "Why lab-grown" + "How we make them" + cert FAQ |
| 5–6 | Ad creative review | Eli | 21 existing ads sorted: launch-ready / needs edit / not-launch |
| 6 | Email sequence (welcome + abandoned cart + post-purchase) | Jared | Klaviyo / equivalent flows |
| 6–7 | Soft launch (waitlist only) | All | First 25 orders, real customer feedback |
| 7 | PR + influencer outreach | Eli | 20 hand-curated, story-aligned pitches |
| 8 | Public launch | All | Open store + ad spend on |

---

## 6. Critical Open Questions (need user input)

These can't be researched, only answered by you:

1. **Has Rohit delivered the material cost rates and forging formula** that was a March 11 action item?
2. **Is there an existing domain / Shopify setup I'm not seeing**, or are we starting from zero on web?
3. **Is Eldora Luxe filed as a separate entity** or running under Bestly LLC?
4. **Are the 21 ads marketing tests** or final launch creative?
5. **Have any physical samples been produced yet** from the Zoo.dev pipeline?
6. **What's the target launch date?** (drives priority of the 8-week plan above)
7. **Direct-to-consumer only, or also wholesale / boutique placements?**

---

## 7. Where the assets live (for future me / new collaborators)

```
cloud.bestly.tech/Projects/El Dora/             — main project + ad videos
cloud.bestly.tech/Projects/El Dora 2/           — newer brand PDF (15MB)
cloud.bestly.tech/Projects/El Dora - Pillar/    — brand standards, pillar collections, batch renders
cloud.bestly.tech/Projects/EL DOra New Brochure Blank.pdf  — brochure template
cloud.bestly.tech/Bestly/Other/Eldora_Luxe_Image_to_CAD_Project_Plan.docx  — technical roadmap
cloud.bestly.tech/Bestly/Cleo-Deliverables/Eldora_Luxe_Proposal_Zoo_vs_Custom.docx  — production tech decision doc
```

---

**Bottom line:** the brand is real, well-architected, and has substantial
creative and technical groundwork done. The launch gap is **operational**:
samples → photography → prices → legal trio → payments → insured shipping.
The 8-week sequence above gets you to a credible launch. If you compress to
6 weeks, you ship without lab-grown educational content and without an
influencer plan; if you stretch to 12 weeks, you can add reviews from soft-
launch buyers and Pillars 1–3 collections.
