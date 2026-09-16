# Cookie Yeti extension: click fail-safe

**Problem.** Users (Jared included) hit an open/close loop: Cookie Yeti clicks a button, a menu
or panel opens, the user closes it, Cookie Yeti clicks again. The only way out was switching the
extension off for that site.

**Cause.** `report-dismissal` turned one manual close of any overlay into a live pattern for
everyone. Examples that were live: Shopify *Settings* and *More actions*, Canva *More actions*,
Stripe *Create profile*, eBay's footer link, and the domain rows in Bestly's own admin.

## Already fixed on the server (2026-09-16, no app update needed)

- 42 bad patterns switched off (`cy_pattern_quarantine_log` keeps their previous state).
- `cy_pattern_gate` trigger: a pattern whose selector isn't a cookie control stays off until the
  robot browser proves the button is inside a cookie banner and clicking closes it.
- `report-dismissal` / `process-dismissal-consensus` learn only from cookie banners, never from
  bestly.tech.
- New `report-pattern-loop` endpoint for the extension (below).

Patterns reach installed extensions through their normal pattern fetch, so the server fix lands
as soon as each install refreshes its pattern cache.

## Extension change (needs a release)

`cy-failsafe.js` in this folder. Add it to the content scripts **before** the main script in
both builds (Safari Web Extension resources for Mac + iOS, and the Chrome MV3 `manifest.json`),
set `ANON_KEY` to the anon key the extension already uses, then wire three calls:

```js
// Wherever a pattern is applied automatically:
const el = document.querySelector(pattern.selector);
if (el && CookieYetiFailsafe.beforeAutoClick(location.hostname, pattern.selector, el)) {
  el.click();
  CookieYetiFailsafe.afterAutoClick(location.hostname, pattern.selector);
}

// Wherever a manual dismissal is reported to report-dismissal:
if (CookieYetiFailsafe.shouldLearnDismissal(bannerEl, clickedEl)) {
  reportDismissal(/* existing call */);
}

// Popup (optional): show "Paused on this site because it kept reopening" with a Resume button.
const info = CookieYetiFailsafe.pausedInfo(hostname);   // null when not paused
CookieYetiFailsafe.resume(hostname);
```

Also skip auto-clicking entirely on `bestly.tech` and its subdomains.

## Release

Paste `RELEASE-PROMPT.md` into Claude on the Mac (also behind **Copy Mac prompt** on
/admin/cookie-yeti). It wires this file in, tests, bumps versions, uploads to App Store Connect
(Mac + iOS) and the Chrome Web Store, submits for review, and writes progress to
`cy_extension_releases`. The Cookie Yeti admin page shows each store's status; the bell pings on every
change. When it needs a hand (2FA, a file drag) the card says so and **Done** tells the Mac to carry on.
The first loop report from an installed extension raises "fail-safe is working in the wild".

After approval, test on bestly.tech/admin/cookie-yeti and admin.shopify.com: nothing opens on its own.
