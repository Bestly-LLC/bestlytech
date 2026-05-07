# DNS + Cert + Migration runbook

**Date:** 2026-04-30
**Context:** Follow-up to admin opusplan. Things that need credentials I don't have, plus the strategic call on DreamHost.

---

## Reality check first

The original ask had three items that don't match what's actually deployed:

| Asked for | Actual state | What this means |
|---|---|---|
| "Restart hoascope.com vhost" | hoascope.com → Namecheap parking page (162.255.119.152). NO DreamHost vhost exists. | Nothing to restart — the site was never built/deployed. The "outage" is just Namecheap showing a parked-domain page. |
| "CNAME app.hoascope.com → app-hoascope.vercel.app" | NXDOMAIN, AND no Vercel deployment named anything-hoascope exists. Only one Vercel project: `bestlytech`. | Adding a CNAME points to a non-existent target. Step zero is *building the app*, then deploying to Vercel, then wiring DNS. |
| "DreamHost cookieyeti.com cert chain" | Cert is the DreamHost default `sni.dreamhost.com` cert, not a chain problem. Let's Encrypt was never provisioned (or expired and reverted). | The fix is "click Add HTTPS in DreamHost panel," not chain repair. |

What's actually authoritative right now (verified live):

| Domain | NS | Hosting reality |
|---|---|---|
| bestly.tech | Cloudflare (`reza/sean.ns.cloudflare.com`) | Vercel `bestlytech` project — healthy |
| cookieyeti.com | DreamHost (`ns1-3.dreamhost.com`) | DreamHost shared, broken cert |
| hoascope.com | Namecheap (`dns1-2.registrar-servers.com`) | Namecheap parking page |
| app.hoascope.com | — | NXDOMAIN |

---

## Item 1: status.bestly.tech subdomain

**Goal:** Point `status.bestly.tech` at the Vercel `bestlytech` project so the public status page lives at its proper URL.

### 1A. Add domain to Vercel
Open: https://vercel.com/rrzp8zxhm7-5602s-projects/bestlytech/settings/domains

Click **Add Domain** → enter `status.bestly.tech` → **Add**. Vercel will then show you the exact DNS record to add. It'll be one of:

- **CNAME** `status` → `cname.vercel-dns.com`  *(typical for subdomain on a project that uses the apex elsewhere)*
- **A** `status` → `76.76.21.21`  *(less common alternative)*

### 1B. Add the DNS record on Cloudflare
Open: https://dash.cloudflare.com/?to=/:account/bestly.tech/dns/records

Click **Add record**:

| Field | Value |
|---|---|
| Type | CNAME |
| Name | status |
| Target | cname.vercel-dns.com |
| Proxy status | **DNS only** (grey cloud) — Vercel needs to see the request to issue Let's Encrypt |
| TTL | Auto |

**Why DNS-only:** Cloudflare's orange-cloud proxy interferes with Vercel's automatic Let's Encrypt issuance. Once issued, you can flip to proxied if you want CF features, but easiest path is to leave grey.

### 1C. Verify
After ~1 min, run:
```
dig +short status.bestly.tech CNAME
# expect: cname.vercel-dns.com.

curl -I https://status.bestly.tech/
# expect: HTTP/2 200, then page renders
```

The Status.tsx route is already shipped (in P3) — once DNS propagates, the page will render automatically at `status.bestly.tech` because Vercel will recognize the domain as bound to the bestlytech project.

---

## Item 2: cookieyeti.com cert

**Diagnosis:** The cert being served is `CN=sni.dreamhost.com` — DreamHost's default fallback. Let's Encrypt was never provisioned, or the auto-renew failed and the panel-level toggle is off.

### Option A: Just fix it on DreamHost (5 min)
1. Open https://panel.dreamhost.com/?tree=domain.manage
2. Find row for `cookieyeti.com`
3. Click **Add HTTPS** in the "HTTPS" column (or "Manage" if there's a stale cert there)
4. Pick **Let's Encrypt** (free)
5. Wait 5–10 min for issuance
6. Verify with:
   ```
   echo | openssl s_client -servername cookieyeti.com -connect cookieyeti.com:443 2>/dev/null | openssl x509 -noout -subject -issuer
   # expect: subject=CN = cookieyeti.com  issuer=… Let's Encrypt
   ```

If `Add HTTPS` is greyed out or fails: the most common reason is the domain is set up as a "fully hosted" domain but the Apache vhost was deleted. In Domains → Manage → Edit, confirm "Web Hosting" is enabled. If not, click Edit and re-create the vhost (it's idempotent), then retry the cert.

### Option B: Migrate cookieyeti.com to Vercel/Cloudflare Pages (30 min) — recommended
See Item 4.

---

## Item 3: app.hoascope.com (and hoascope.com)

**Step zero: there's nothing to point this at.**

There's no `hoascope` app deployed anywhere. The only Vercel project on the team is `bestlytech`. Before we add DNS, we need:

1. Decide what `app.hoascope.com` actually serves. Options:
   - A standalone Vite/Next app for the HOAscope member portal (new repo, new Vercel project)
   - A subdomain rewrite to a path under bestly.tech (`app.hoascope.com` → `bestly.tech/hoascope`)
   - A separate Cloudflare Pages site

2. Once that exists, add DNS records:

For `hoascope.com` (the marketing site) at **Namecheap**:
- Open: https://ap.www.namecheap.com/Domains/DomainControlPanel/hoascope.com/advancedns
- Replace any `URL Redirect Record` entries with:

  | Type | Host | Value |
  |---|---|---|
  | CNAME | www | `cname.vercel-dns.com` |
  | A | @ | `76.76.21.21` |

For `app.hoascope.com`:

  | Type | Host | Value |
  |---|---|---|
  | CNAME | app | `cname.vercel-dns.com` |

**Recommendation:** don't add the `app.hoascope.com` CNAME until the app exists. CNAME-ing to a 404 just means probe-external SSH still flags it as `down` — same outcome as NXDOMAIN.

---

## Item 4: keep DreamHost or migrate? — **Migrate.**

### Recommendation: **migrate cookieyeti.com (and eventually hoascope.com) off DreamHost.**

### Reasoning

DreamHost made sense as a one-time Apache parking spot. It's now actively producing operator pain:

1. **Cert renewal roulette.** What you're seeing today (Let's Encrypt unconfigured, default SNI cert served) is a class of problem that recurs. Vercel/Cloudflare Pages issue and renew certs without operator action.
2. **No infra observability.** DreamHost gives you no API to probe vhost health from your admin. Your status page would show "ok/down" but not "why" or how to fix without an SSH session.
3. **Cost vs value.** Vercel/Cloudflare Pages are free for static sites. DreamHost shared is ~$2.59/mo + ongoing config debt.
4. **Workflow alignment.** cookieyeti.com is presumably a marketing/install landing page — exactly the kind of thing that lives next to bestly.tech as a sister Vercel project, sharing the same theme tokens, deploy flow, and observability you just built.
5. **One status page surface.** You already have `external_health` probes for cookieyeti and hoascope. After migration they'll naturally read from the same admin panel and the same `/status` page.

### What "migrate" looks like — three small projects

**A. cookieyeti.com → Vercel `cookieyeti-site` project** (~30 min)
1. Create a new repo `cookieyeti-site` (or a `sites/cookieyeti` folder in this monorepo)
2. Pull the existing cookieyeti.com HTML/CSS/images out of DreamHost (`scp` from the DH server, or just rebuild)
3. `vercel link` + `vercel deploy --prod`
4. On DreamHost: change cookieyeti.com nameservers from `ns{1,2,3}.dreamhost.com` to Cloudflare (or leave on DreamHost and just add A record pointing at `76.76.21.21` + CNAME `www` → `cname.vercel-dns.com`). I recommend moving NS to Cloudflare so DNS lives next to bestly.tech.
5. Cancel the DreamHost hosting line item.

**B. hoascope.com → Cloudflare Pages or Vercel `hoascope-site` project**

Same pattern. Since hoascope.com is currently a parking page, the migration is just "build a real site" + deploy — no migration of existing content needed.

**C. app.hoascope.com → standalone Vercel app**

This is the actual member portal — separate React app, separate project. Wire DNS to that.

### What stays on DreamHost (if anything)

If you have other domains there (parked sites, email-only domains, etc.) you can keep DH for those and only migrate cookieyeti. But long-term, cancelling DreamHost entirely simplifies the operator surface — one less panel, one less cert renewal calendar, one less authentication flow.

---

## Suggested execution order

1. **Today (10 min):** Item 1 — wire `status.bestly.tech` to Vercel + Cloudflare. This unblocks the status page being public-facing.
2. **Today (5 min):** Item 2 Option A — fix cookieyeti.com Let's Encrypt cert in DreamHost panel. Buys time while migration is planned.
3. **This week (30–60 min):** Item 4A — migrate cookieyeti.com to Vercel. After this, retire DreamHost row for cookieyeti.com.
4. **When the app is built:** Item 3 — add app.hoascope.com DNS records.
5. **Later:** Item 4B — decide whether hoascope.com gets a real site or stays parked.

I'll happily drive Items 1 and 2 step-by-step in your browser session if you point me at the logged-in tab. The DNS adds need ~3 clicks each in panels I can't authenticate myself into.
