# Opusplan: Products on the Team page

**Status:** PLAN → building now (2026-10-05). Planned by Opus, built by Sonnet agents.
**Asked by Jared (2026-10-05):** "look through all of the Bestly products we have shipped and what we have coming … next to
the org chart, our products and what AI employees are responsible for those apps … each app needs someone on marketing,
someone on updates and security … Ares should be in charge of security for the apps and reviewing them … products reporting
through the employees up to Scout, up to me … visualized in the Teams page. Apple design, then a UI UX Pro pass."

## TL;DR

- **New employee: Atlas, Head of Product.** Reports to Scout. Owns every product end to end and its **Updates** duty
  (is it up, what version is out, is anything broken). Runs **Product Watch** every 30 min (SQL, in Supabase, free).
- **Every product has three duties with a named owner:** **Marketing** (Spark's team), **Updates** (Atlas),
  **Security** (Ares). Client sites skip Marketing (that's the client's job).
- **Reporting line:** product → its duty owners → **Atlas** → **Scout** → **Jared**. Problems become `monitor_issues`
  signed by the duty owner (e.g. "Ares: HOKU has a red security finding"), which already climb the Fix Ladder to Scout.
- **Team page gets a People | Products switch.** Products view: a small "how products report" diagram, then a card per
  product showing its three duties, who owns each, and whether it's healthy. Tap a person → their card. Tap a product → details
  and reassign.
- **Self-healing watchdog to Scout:** Product Watch raises and auto-resolves issues; Atlas's own card is watched by Team Watch
  (pulse on the `product-watch` cron); hosts Ares audits that belong to no product show up as "not on a product yet".

## 1. The roster (seed)

Lead for every product: `atlas`. Security owner: `security-auditor` (Ares) for everything except ideas.
Updates owner: `atlas`. Marketing: `daily-post` (Social Poster, under Spark) where a posting channel exists, else `spark`.

| slug | name | kind | status | platforms | url | Ares audits (assets) | marketing (tools) | social brand |
|---|---|---|---|---|---|---|---|---|
| cookie-yeti | Cookie Yeti | app | live | Chrome, Safari, iPhone, Mac | /cookie-yeti (App Store id6759732250) | – (none yet) | daily-post (pi-cy-maker, cy-pipeline, pi-brand-maker) | cookieyeti |
| inventory-proof | InventoryProof | app | live | iPhone | https://inventoryproof.com | – (none yet) | daily-post (pi-brand-maker) | inventoryproof |
| parentiq | ParentIQ | web | live | Web | https://parentiq.io | parentiq.io, www.parentiq.io | spark | – |
| captains-log | Captain's Log | app | live | iPhone, Web | https://captainslog-command.higgsfield.app | – | spark | – |
| in-house-cloud | In-House Cloud | service | live | Nextcloud | /in-house-cloud | cloud.bestly.tech | spark | – |
| bestly-studio | Bestly Studio | service | live | Web | https://studio.bestly.tech | studio.bestly.tech, review.bestly.tech, Vercel bestly-review (Studio) | spark | – |
| bestly-platform | bestly.tech & Admin | web | live | Web | https://bestly.tech | bestly.tech, www.bestly.tech, Bestly, Supabase Bestly, github:bestlytech, Bestly team, bestly-pi | spark | – |
| vesta | Vesta | app | beta | iPhone, Web | https://vesta.bestly.tech | vesta.bestly.tech, app.bestly.tech, vesta-app.bestly.tech, vesta-beta.vercel.app, Supabase Vesta | spark | – |
| hoku | HOKU | physical | building | Skincare | https://hoku-clean.com | hoku-clean.com, www.hoku-clean.com | daily-post (pi-hoku-maker, hoku-post-check) | hoku |
| content-service | Social Content Service | service | building | Instagram, Facebook, TikTok | – | – | daily-post | client-re-demo |
| arrivekey | Arrivekey | app | building | iPhone (TestFlight) | – | – | spark | – |
| schoolpilot | SchoolPilot | app | building | iPhone, Web | https://school-pilot-nine.vercel.app | school-pilot.vercel.app, school-pilot-nine.vercel.app, Supabase schoolpilot | spark | – |
| hoascope | HOAscope | web | building | Web | https://hoascope.com | hoascope.com, www.hoascope.com | spark | – |
| confesh | Confesh | app | building | iPhone | – | – | spark | – |
| neckpilot | NeckPilot | app | planned | iPhone, AirPods | /neckpilot | – | spark | – |
| el-dora | El D'Ora | client | live | Shopify | https://eldoraluxe.com | eldoraluxe.com, www.eldoraluxe.com | (none: client) | – |
| purely-hunza | Purely Hunza | client | live | Web | https://purelyhunza.com | purelyhunza.vercel.app | (none) | – |
| golden-hour-garden | Golden Hour Garden Design | client | live | Web | https://goldenhourgardendesign.com | goldenhourgardendesign.com, www.goldenhourgardendesign.com | (none) | – |
| the-shift-shop | The Shift Shop | client | live | Shopify, Amazon, TikTok Shop | https://theshift.shop | – | (none) | – |
| bestly-wall | Bestly Wall (projection mapping) | idea | idea | – | – | – | – | – |
| curbcite | CurbCite | idea | idea | – | – | – | – | – |
| pettv | Pet TV | idea | idea | Apple TV | – | – | – | – |
| runon | RunOn | idea | idea | – | – | – | – | – |

Left unmapped on purpose: `quoterra-a7eff299.vercel.app` (unknown) — it shows as "not on a product yet" so Jared can place it.
Monitor-issue key prefixes per product: bestly-studio `studio`, vesta `vesta`, bestly-platform `admin`, in-house-cloud `partner.cloud`.

## 2. Data model (migration `20261005180000_team_products.sql`)

```
team_products(slug pk, name, kind text check in (app,web,service,physical,client,idea),
  status text check in (live,beta,building,planned,idea,paused,retired), platforms text[], url, store_url,
  icon text, blurb text, assets text[] default '{}', social_brand text, monitor_prefixes text[] default '{}',
  release_source text, lead_slug text default 'atlas', sort int, created_at, updated_at)
team_product_duties(product_slug fk, duty text check in (marketing,updates,security), agent_slug text,
  tools text[] default '{}', note text, updated_at, primary key (product_slug, duty))
product_watch_state(id int pk default 1, checked_at, red int, raised int, resolved int, error text)
```
RLS on, admin-only select (`team_is_admin()`); writes only through security-definer functions.

**Duty rules** (`product_status()` → jsonb per product; one place, used by both the page and the watchdog):

- *Required duties:* client → updates + security. idea → none. Everything else → all three.
- *Owner check (all duties):* required duty with no row, or owner not `active`/`new` → **red**, "No one owns this".
- *Security:* no assets → live/beta **yellow** "Not in the nightly audit yet", else grey "Audit starts at launch".
  Open red finding on its assets (`security_findings.status='open'`) → **red**; open yellow → **yellow** "N to fix";
  latest finished `security_audit_runs` older than 36 h → **yellow** "Audit hasn't run since …"; else **green**
  "All clear · checked 1:06 AM".
- *Updates:* release_source `cy_extension_releases` → any `rejected` red, else green with "1.2.5 live on iPhone, Mac · in review on Chrome".
  Hosts in assets: latest audit `inventory.fingerprints[host].status` ≠ 200 → **red** "site is down". Open `monitor_issues`
  whose key starts with a monitor prefix → yellow (severity critical/error → red). Live/beta with nothing to check → green "No problems reported".
  building/planned with nothing → grey "Not shipped yet".
- *Marketing:* client → not required. social_brand → posts with status `posted` in last 7 days; last post > 7 days red, > 3 days
  yellow (live/beta/building), else green "N posts this week · last 1:02 PM". No brand → live/beta yellow "No marketing running yet",
  else grey "Starts at launch".
- *Overall:* worst of the required duties (red > yellow > green > grey). Headline = the worst duty's sentence.
- All times 12-hour, America/Los_Angeles. Numbers joined to units with U+00A0.

**RPC contract — `admin_products()` returns jsonb** (admin only):
```json
{ "checked_at": "...", "audit_at": "...",
  "products": [ { "slug","name","kind","status","platforms":[],"url","store_url","icon","blurb","sort","lead_slug",
                  "assets":[], "health":"green|yellow|red|grey", "headline":"...",
                  "duties":[ {"duty":"marketing|updates|security","required":true,"agent_slug":"spark"|null,
                              "tools":["pi-cy-maker"], "health":"...", "detail":"...", "note":null } ] } ],
  "unmapped_hosts": ["quoterra-a7eff299.vercel.app"] }
```
Duties always come back in the order marketing, updates, security (not-required ones included with `required:false`, `health:'grey'`).
Agent names/icons/health come from `admin_org_chart` on the page (lookup by slug), not from this RPC.

**Writes (admin only, security definer, verify a row changed):**
- `admin_product_duty_set(p_product text, p_duty text, p_agent text, p_tools text[] default null)` — upsert.
- `admin_product_set(p_slug text, p_patch jsonb)` — name, status, url, store_url, blurb, platforms, assets, social_brand.

## 3. Watchdog → Scout

`product_watch()` (security definer), called by `product_watch_safe()` (catches errors into `product_watch_state.error`):
1. Sync `notification_owners`: upsert prefix `product.<duty>.<slug>` → duty owner (so the bell/push is signed by them);
   prefix `product` → atlas. **No DELETEs** (they get cancelled in this project).
2. For each required duty: red → `bestly_raise('product.<duty>.<slug>', 'problem', 'warning', '<Owner name>: <Product> — <detail>', body, 'product')`;
   not red and an open issue exists → raise `'resolved'`. Unowned duty → key `product.unowned.<slug>` signed by Atlas.
3. Write counts to `product_watch_state`.
Cron `product-watch` at `11,41 * * * *` → `select public.product_watch_safe()`.
Atlas pulse: `{"src":"cron","job":"product-watch","gap":45,"alert":true}`, so Team Watch reports Atlas if the watcher stops.

## 4. Onboarding (CLAUDE.md rule: card the day it goes live)

`team_onboard` Atlas: slug `atlas`, role **Head of Product**, reports_to `scout`, dept `product`, runs_on `cloud`,
icon `package`, schedule "every 30 min", admin_url `/admin/team?view=products`, owns `["product"]`, welcome false
(the welcome email is sent after the `package` mascot GIF is deployed). Ares's `what_it_does` gains "…and owns security for every
Bestly product." via `admin_agent_set`.

## 5. The page (Apple HIG, then ui-ux-pro-max)

- **Segmented control** under the header: `People | Products`, state in `?view=products`. Products view hides the people filters.
- **"How products report" strip:** You → Scout → Atlas (Head of Product). Beside Atlas, dashed lines to the functional leads:
  Spark (Marketing), Ares (Security). Each is tappable (opens their card). Vertical on phones.
- **Filter chips:** All · Live · Coming · Needs a look · Client sites · Ideas (counts, number+word never split).
- **Product cards** in sections Live / Coming next / Client sites, grid 1 / 2 / 3 columns. Card = app icon squircle (image from
  `config/products.ts` when the id matches, else a lucide icon on a tint), name, status pill (word + colour), platforms,
  health line (icon + word), then an inset grouped list of the duties: duty icon (Megaphone / RefreshCw / ShieldCheck),
  duty name, detail sentence (wraps, never "…"), owner mascot + name + health dot on the right. Row tap → owner's sheet.
  Footer: "Atlas → Scout → You".
- **Ideas:** one compact list, no duties.
- **Not on a product yet:** card listing `unmapped_hosts` ("Ares checks these every night, but they don't belong to a product").
- **Product sheet** (tap card title): links, every duty with an owner picker (employees only, not tools), assets list.
- **Person sheet:** new "Looks after" section listing their products and duty.
- **People view:** new department "Product" (Atlas) in `DEPTS`.
- House rules: 12-hour times, U+00A0 between number and unit, no ellipsis truncation, 44 px targets, light (`bento:`) and dark
  tokens from `laxUi`, `motion-safe:` for animation, aria labels, `supabase.rpc.bind(supabase)`.

## 6. Open after v1

- A real release-review step (Atlas logs a release, Ares signs off before it ships) — needs App Store Connect / Vercel deploy hooks.
- Add inventoryproof.com, Cookie Yeti, Captain's Log, The Shift Shop to Ares's nightly audit (they show "Not in the nightly audit yet").
