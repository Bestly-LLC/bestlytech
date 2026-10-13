# Maya sells Bestly Agent on the website, start to finish

Planned with Opus 2026-10-12, built with Sonnet. Jared: "make a plan for maya to learn her pricing ... updates to her page with costs, make it so she is integrated and is a full stack sales person on the site and can guide customers through the full sales cycle."

## Jared's decisions (2026-10-12)

- **Three plans, monthly, no setup fee:**
  - **Lite** $49/mo, 30 minutes included, extra minutes $1.00
  - **Starter** $199/mo, 150 minutes included, extra minutes 75¢
  - **Growth** $499/mo, 500 minutes included, extra minutes 50¢
- Extra-minute prices raised the same day (Jared picked it): the old 20¢/15¢/12¢ made Lite cheapest up to 2,670 minutes and Growth's extras sold at our own cost (about 12¢ a minute). New ladder: Lite under 270 minutes, Starter 270 to 650, Growth above.
- **30-day money-back guarantee.** Cancel anytime.
- **Maya goes all the way to payment:** recommends a plan, opens secure Stripe checkout, then walks the buyer through the setup questions.

## The sales cycle Maya runs (website)

1. **Discover**: what the business does, calls per day, how long a call runs, which apps they use, what calls should end in (booking, ticket, transfer).
2. **Show**: play the closest industry demo on /agent (existing show_section / demo controls), point at the apps directory for their software.
3. **Price**: drive the plan picker with their numbers; it recommends the cheapest plan for their minutes and shows the monthly total with extra minutes.
4. **Close**: read back plan, price, "no setup fee, 30-day money back, cancel anytime". After a clear yes, fill name, email, business name, phone into the checkout card and tell them to tap **Pay securely**. (The visitor taps; Maya never opens a payment page by herself, and never takes card details by voice.)
5. **Onboard**: after payment the buyer lands on /agent/welcome. Maya (or the buyer by typing) fills the setup questions; Send saves them; she books the kickoff with the existing appointments link.
6. **Not ready?** Offer the contact form (fill_contact_form, category sales) or the kickoff call, never pressure.

## Build

### 1. One source of truth for prices

`supabase/functions/_shared/agent-plans.ts`: plain TS, no Deno or npm imports, so the site imports the same file (`import { AGENT_PLANS } from "../../../supabase/functions/_shared/agent-plans"` from src; Vite root is the repo).

```ts
export type AgentPlanId = "lite" | "starter" | "growth";
export type AgentPlan = { id: AgentPlanId; name: string; monthlyCents: number; includedMinutes: number; extraCentsPerMinute: number; blurb: string; lookupKey: string };
export const AGENT_PLANS: AgentPlan[] = [ ...the 3 plans... ];   // lookupKey: "bestly_agent_lite_monthly" etc.
export const AGENT_TERMS = { setupFeeCents: 0, moneyBackDays: 30, cancelAnytime: true };
export function monthlyCost(plan, minutes): number          // cents: monthly + max(0, minutes - included) * extra
export function recommendPlan(minutes): { plan, cents, alternatives: {plan, cents}[] }   // cheapest total; tie -> bigger plan
export function minutesFromCalls(callsPerDay, avgMinutes, daysPerMonth = 22): number   // business days default
export function pricingSentence(): string                    // plain-English summary used in Maya's prompt
```

Nothing else in the repo hard-codes these numbers. The server never trusts a price from the browser.

### 2. Pricing on /agent (`#pricing`, new section before `#questions`)

- `src/components/agentDemo/AgentPricing.tsx`. Heading "Simple monthly plans". Three cards from AGENT_PLANS: name, big price "$49 /month", "30 minutes of calls included", "Extra minutes 20¢ each". Starter marked "Most popular" only as a label (no fake stats).
- Under the cards a strip: "No setup fee · 30-day money back · Cancel anytime".
- **Plan picker** (`AgentPlanPicker`): "About how many calls a day?" and "About how long is a call?" (minutes) steppers/sliders, plain numbers, US format. Shows "About 330 minutes a month" and "Best fit: Starter, about $226 a month" with the other two plans' totals underneath. The fit card glows (feathered Maya glow, like the calculator).
- **Checkout card** (`AgentCheckoutCard`) opens under the chosen plan (button "Choose Lite"): fields name, email, business name, phone (optional), the read-back line "Lite, $49 a month, no setup fee, 30-day money back, cancel anytime", the consent line from `CallConsentNote` when a phone is given, and a primary button **Pay securely** that calls `agent-checkout` and then `window.location.assign(url)` (same tab; it is the visitor's own tap). Small print: "Payments are handled by Stripe. Bestly never sees your card."
- FAQ additions in `#questions`: what counts as a minute (time on a call, rounded up to the next minute), what happens past my minutes (billed at the plan's extra-minute rate on the next bill), how the money back works (email or call within 30 days of paying, full refund), can I switch plans (yes, any time).
- Hero / CTA: add a "See prices" link to `#pricing`.
- No "..." truncation, numbers never wrap away from their unit (`whitespace-nowrap` on "$49 /month", "20¢"), feathered edges, light mode (public site).

### 3. The plan bridge (same pattern as calcBridge.ts / formBridge.ts)

`src/components/agentDemo/planBridge.ts`:

```ts
type PlanApi = {
  setUsage(v: { callsPerDay?: number; avgMinutes?: number; minutes?: number }): { say: string; recommended: AgentPlanId };
  choose(plan: AgentPlanId): { say: string };
  fillCheckout(v: { name?; email?; company?; phone? }): Promise<{ say: string; missing: string[] }>;
  element(which: "pricing" | "picker" | "checkout"): HTMLElement | null;
};
registerPlans(api) -> unregister; getPlans(ms) -> Promise<PlanApi | null>;
export const PLAN_CHANGED = "maya:plan-changed";   // debounced 1.2 s, visitor's own edits only
```

Typing into checkout fields reuses the formBridge typing helper (export it if it is private). Visitor edits after Maya's fill win unless Maya passes a different value.

### 4. Maya's tools (presenter.ts) and ElevenLabs

New client tools (create in ElevenLabs via MCP `agents_create_tool`, type client, expects_response true, timeout 15 s), then attach through maya-watch SITE_TOOLS (deployed after the site ships):

- `agent_pricing` params: `calls_per_day` (number), `avg_minutes` (number), `minutes` (number), `plan` (lite|starter|growth). Navigates to /agent#pricing if needed, spotlights, sets usage, optionally chooses a plan. Returns `say` with the recommendation and totals in words ("about two hundred twenty-six dollars a month").
- `agent_checkout` params: `plan`, `name`, `email`, `company`, `phone`. Chooses the plan, opens the checkout card, types the fields, returns what is filled and missing plus: "Read back the plan and price, no setup fee, 30-day money back, cancel anytime. After a clear yes, tell them to tap Pay securely. Never ask for card numbers."
- `agent_setup` params: the setup fields (below) + `submit` boolean. Only works on /agent/welcome. Same fill/read-back/submit-after-yes rules as fill_contact_form.

MayaScreen listens for `PLAN_CHANGED` (and the setup form's FORM_CHANGED) and sends contextual updates.

### 5. Checkout: `agent-checkout` edge function (new, verify_jwt false)

- Origin allowlist bestly.tech / www.bestly.tech (+ localhost in dev only), body `{ plan, name, email, company, phone?, conversation_id? }`, validate lengths and email.
- Rate limit: 5 sessions per email per hour and 20 per IP per hour (in-memory plus an `agent_orders` count check).
- Stripe key from Vault (`stripe_secret` RPC, same as maya-billing). Find the price by `lookup_keys[]=bestly_agent_<id>_monthly`; if missing, create Product "Bestly Agent <Name>" and a monthly Price with that lookup_key (idempotent, `Idempotency-Key` header). Price amount always from AGENT_PLANS.
- Creates a Checkout Session: mode subscription, the plan price, `customer_email`, `allow_promotion_codes` false, `billing_address_collection` auto, `metadata` + `subscription_data.metadata` = `{ product: "bestly_agent", plan, order_id }`, `consent_collection.terms_of_service: "required"` with custom text linking /terms, success_url `https://bestly.tech/agent/welcome?o=<order token>`, cancel_url `https://bestly.tech/agent#pricing`.
- Writes an `agent_orders` row (status `checkout_started`) before returning `{ url }`.
- `?ping=1` (GET): checks the key and that the 3 prices resolve, creates nothing; used by the watchdog.
- Never logs the key; errors raise `maya.sales` via `bestly_raise`, signed by Maya.

### 6. Database (migration `20261012..._agent_orders.sql`, append-only)

- `agent_orders`: id uuid, token text unique (48-hex, for the welcome link), plan, monthly_cents, status (`checkout_started` | `paid` | `setup_done` | `refunded` | `cancelled`), name, email, phone, company, conversation_id, stripe_session_id, stripe_customer_id, stripe_subscription_id, paid_at, setup jsonb default '{}', setup_done_at, kickoff_at, created_at. RLS on; service role only; admin read policy via `team_is_admin()`.
- `privacy_data_map` rows: email (delete), phone (delete), name (blank). Billing records may need keeping: action `review` for the row itself with reason "tax records for paid orders".
- RPC `agent_order_admin()` (admin-guarded) for the admin card.
- No public-key RPCs (the welcome page talks to an edge function), so nothing new on `security_public_rpcs`.

### 7. After payment

- **stripe-webhook**: in `checkout.session.completed`, if `metadata.product === "bestly_agent"`: conditional update `agent_orders` to paid (idempotent on `paid_at is null`), save customer + subscription ids, queue the `agent-welcome` email (idempotency key `agent-paid-<order id>`), and alert Jared as **money** news via `bestly_raise` (`kind` success, signed "Maya: new Bestly Agent customer, <Company>, <Plan> $<price>/mo"). Bail out before the Cookie Yeti path. Also handle `customer.subscription.deleted` for these (status cancelled). **Deploy rule: fetch the deployed source and diff it against the repo first; if deployed has changes the repo doesn't, stop and report.**
- **Email template** `agent-welcome.tsx` (registry): "You're in. Here's what happens next", the setup link, the 30-day money-back promise, the kickoff booking link, (213) 641-0074. Bestly brand voice, no emoji.
- **/agent/welcome?o=<token>** (`src/pages/AgentWelcome.tsx`): `agent-onboard` edge function (verify_jwt false, token-bound like cloud-intake) GET returns plan + company + status; PATCH auto-saves setup; POST submits. Setup questions (plain words, one per row):
  1. Business name and website
  2. The phone number callers use today, and whether to forward it or get a new one
  3. Business hours and time zone
  4. What should most calls end in (book an appointment, take a message, open a ticket, transfer to a person)
  5. Who to transfer to, and their number
  6. Which apps she should use (search box reusing the integrations list)
  7. Top 5 questions callers ask, with answers
  8. Anything she must never say or do
  9. Voice preference (warm, calm, upbeat) and name (Maya or another)
- The page registers itself with formBridge as id `agent-setup` so `agent_setup` can fill it. After submit: "Book your kickoff call" button (Nextcloud Appointments link already used on GetStarted) and a short "what happens next" list (we build it, you test it, go live, usually within a few days). Status on POST: `setup_done`, alert `maya.sales` success "setup answers in".
- If the order is still `checkout_started` (webhook not in yet), the page polls every 5 s for up to 60 s, then shows "Payment is still confirming. You'll get an email in a minute."

### 8. Maya's instructions (maya-watch PRESENTER_BLOCK)

Add a "Selling Bestly Agent" part, built from `pricingSentence()` so the numbers always match the page (maya-watch imports `../_shared/agent-plans.ts`):
- The cycle above, one question at a time.
- Prices exactly as the plans file; never invent discounts, trials or custom prices; anything custom goes to the contact form for Jared.
- Always say "no setup fee, 30-day money back, cancel anytime" before checkout.
- Never take card details by voice or in chat; the buyer taps Pay securely.
- After payment, walk the setup questions on /agent/welcome with agent_setup, then offer the kickoff booking.
- On a phone call (not the website): she can explain prices and send them to bestly.tech/agent#pricing; no checkout on the phone.

### 9. Watchdog (self-healing, Scout)

maya-watch (already on Maya's team card) gains:
- heals the 3 new tool ids in SITE_TOOLS and the selling block;
- hourly `agent-checkout?ping=1`; 2 failures in a row → `maya.sales` problem alert ("Maya can't take payments: <reason>"), resolved when it passes;
- paid orders with no setup after 3 days → `maya.sales` note in the recap (not an interrupt).
Update Maya's `team_onboard` card: `tool_of` adds agent-checkout and agent-onboard, `owns` adds `maya.sales`.

### 10. Admin

Small "Agent orders" card on /admin/maya (dark admin shell): newest first, plan, company, status, paid date, setup done, link to the Stripe customer. Uses `agent_order_admin()`.

## Not in this round (say so plainly in the copy and to Jared)

- **Extra-minute billing is manual for now.** Minutes are counted per customer agent already (agent_calls); turning them into Stripe usage records is phase 2. Until then Jared adds overage as an invoice item. The copy says extra minutes are "billed on your next bill", which stays true.
- No annual plans, coupons or trials.

## Verify

tsc (`npx tsc --noEmit -p tsconfig.app.json`, ignore WowButton), build, eslint. Headless: /agent#pricing at 390 px and 1440 px (cards, picker at 3 inputs, checkout card), the bridge via `?mayatest=1` hooks; route-intercept `agent-checkout` so no Stripe session is made in tests; /agent/welcome with a stubbed `agent-onboard`. Apple design pass, then ui-ux-pro-max. After deploy: `agent-checkout?ping=1` ok; one real Checkout Session created and NOT paid (just opened) to confirm the Stripe page shows the right plan and price, then let it expire. Never pay, never call, never text in tests.
