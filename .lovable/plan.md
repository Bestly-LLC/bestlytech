

# Redesign Cookie Yeti Pricing: 3-Tier Layout

## What changes

Replace the current 2-card (Free + Lifetime) pricing layout with 3 cards: **Free**, **Monthly ($0.99/mo)**, and **Yearly ($7.99/yr, highlighted)**.

### CONFIG update (lines 39-42)
- Change `pricing` to: `free: "Free"`, `monthly: "$0.99"`, `yearly: "$7.99"`
- Remove `lifetime`

### Subtitle (line 313)
- Change to: `"Choose the plan that works for you"`

### Grid layout (line 317)
- Change from `grid-cols-1 md:grid-cols-2` to `grid-cols-1 md:grid-cols-3`
- Change `max-w-4xl` to `max-w-5xl`

### Three cards

1. **Free** — plain card (no highlight)
   - Subtitle: "Try before you upgrade"
   - Features: Limited daily site handling, Basic preferences, Works on popular sites
   - Button: outline "Get Started Free"

2. **Monthly $0.99/mo** — plain card
   - Subtitle: "Billed monthly"
   - Features: Unlimited sites, Saved preferences, No daily limits, Cancel anytime
   - Button: outline "Subscribe Monthly"

3. **Yearly $7.99/yr** — highlighted card (border-2 border-primary, "Recommended" badge, "Save 33%" badge)
   - Subtitle: "Save 33%"
   - Features: Unlimited sites, Saved preferences, No daily limits, Priority support
   - Button: primary "Subscribe Yearly"

### Disclaimer (line 381)
- Change to: `"* Prices may vary by platform and region."`

### Imports
- May need `Infinity` icon import (already used), plus `Headphones` or `Star` for "Priority support"

