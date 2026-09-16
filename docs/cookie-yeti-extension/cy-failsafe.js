/*
 * Cookie Yeti — click fail-safe (drop into the Safari (Mac + iOS) and Chrome content scripts).
 *
 * Fixes the open/close "death cycle": the extension clicked a learned selector that wasn't a
 * cookie button (a menu, a settings link, an admin row), which opened something; the user closed
 * it; the extension clicked again. Four guards:
 *
 *   1. Only click inside a real cookie/consent banner (isCookieBannerTarget).
 *   2. At most 1 automatic click per selector per page, and 3 per site per 10 minutes.
 *   3. After a click, watch 8 seconds. If the button comes back or a new dialog opens, or the user
 *      presses Escape / closes something, treat it as a loop: stop on this site for the session
 *      and tell the server (report-pattern-loop), which switches the pattern off for everyone
 *      until the robot browser re-checks it.
 *   4. Only learn from a manual dismissal when the thing closed is a cookie banner.
 *
 * No dependencies. Works in MV3 content scripts and Safari Web Extension content scripts.
 */
(function (root) {
  "use strict";

  var LOOP_ENDPOINT = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/report-pattern-loop";
  var ANON_KEY = "PASTE_THE_SAME_SUPABASE_ANON_KEY_THE_EXTENSION_ALREADY_USES";
  var STORE_KEY = "__cookieYetiFailsafe";
  var WATCH_MS = 8000;        // how long a click is watched for the banner coming back / Escape
  var OPENED_BY_CLICK_MS = 1500; // a dialog that opens this soon after our click was opened by it
  var SITE_WINDOW_MS = 10 * 60 * 1000;
  var SITE_MAX_CLICKS = 3;

  // Consent-manager ids/classes. Guarded so "sticky", "sketch", "trusted" don't match.
  var KEY = /cookie|consent|gdpr|ccpa|onetrust|optanon|didomi|cookiebot|cybot|usercentrics|truste-|trustarc|quantcast|qc-cmp|sp_message|sourcepoint|osano|iubenda|(^|[^a-z])cky-|cmplz|complianz|termly|klaro|(^|[^a-z])ketch|borlabs|axeptio|tarteaucitron|guce-/i;
  // What a banner actually says. The bare word "cookie" isn't enough: footers link "Cookie policy".
  var TEXT = /(we|site|website|this site|our partners)\s+(and our partners\s+)?uses?\s+cookies|cookies? (to|for|help|and similar)|(accept|reject|allow|decline)( all)? cookies|necessary cookies|cookie (settings|preferences|choices)|manage (cookies|consent|preferences)|your consent|consent to|datenschutz|einwilligung|tracking technolog|your privacy choices|we value your privacy/i;

  var memory = {}; // fallback when sessionStorage is blocked
  function state() {
    try { var raw = sessionStorage.getItem(STORE_KEY); return raw ? JSON.parse(raw) : memory; } catch (e) { return memory; }
  }
  function save(s) {
    memory = s;
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* private mode: in-memory only */ }
  }
  var pageClicks = {}; // selector -> count, this page load only
  var dialogsBeforeClick = {}; // selector -> dialogs open just before our click

  function visible(el) {
    if (!el || !el.isConnected) return false;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function overlayOf(el) {
    for (var a = el; a && a !== document.body; a = a.parentElement) {
      var cs = getComputedStyle(a);
      if (cs.position === "fixed" || a.getAttribute("role") === "dialog" || a.getAttribute("role") === "alertdialog" ||
          a.tagName === "DIALOG" || a.getAttribute("aria-modal") === "true") return a;
    }
    return null;
  }

  /** Guard 1: is this element part of a cookie/consent banner? */
  function isCookieBannerTarget(el) {
    if (!el) return false;
    for (var a = el; a && a !== document.body; a = a.parentElement) {
      var idc = (a.id || "") + " " + (typeof a.className === "string" ? a.className : "") + " " +
        (a.getAttribute("aria-label") || "") + " " + (a.getAttribute("data-testid") || "");
      if (KEY.test(idc)) return true;
    }
    var overlay = overlayOf(el);
    return !!overlay && TEXT.test((overlay.innerText || "").slice(0, 4000));
  }

  function openDialogs() {
    return Array.prototype.filter.call(
      document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog[open]'), visible);
  }

  function reportLoop(domain, selector, reason) {
    try {
      fetch(LOOP_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: "Bearer " + ANON_KEY },
        body: JSON.stringify({ domain: domain, selector: selector, reason: reason }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* never break the page */ }
  }

  function pauseSite(domain, selector, reason) {
    var s = state();
    s.paused = s.paused || {};
    s.paused[domain] = { at: Date.now(), selector: selector, reason: reason };
    save(s);
    reportLoop(domain, selector, reason);
  }

  /** Call right before an automatic click. Returns false when the click must not happen. */
  function beforeAutoClick(domain, selector, el) {
    var s = state();
    if (s.paused && s.paused[domain]) return false;
    if (!isCookieBannerTarget(el)) return false;
    if ((pageClicks[selector] || 0) >= 1) return false;
    var now = Date.now();
    var recent = ((s.clicks || {})[domain] || []).filter(function (t) { return now - t < SITE_WINDOW_MS; });
    if (recent.length >= SITE_MAX_CLICKS) { pauseSite(domain, selector, "too_many_clicks"); return false; }
    dialogsBeforeClick[selector] = openDialogs(); // clicks can open a dialog synchronously
    return true;
  }

  /** Call right after an automatic click. Watches for the loop and pauses the site if it happens. */
  function afterAutoClick(domain, selector) {
    pageClicks[selector] = (pageClicks[selector] || 0) + 1;
    var s = state();
    s.clicks = s.clicks || {};
    s.clicks[domain] = ((s.clicks[domain] || []).concat(Date.now())).slice(-10);
    save(s);

    var dialogsBefore = dialogsBeforeClick[selector] || [];
    var clickedAt = Date.now();
    var goneOnce = false;
    var done = false;
    function stop() { if (done) return; done = true; obs.disconnect(); document.removeEventListener("keydown", onKey, true); clearTimeout(timer); }
    function loop(reason) { if (done) return; stop(); pauseSite(domain, selector, reason); }

    function check() {
      // The banner went away and came back: something (the site or our pattern) keeps reopening it.
      var again = document.querySelector(selector);
      var shown = !!again && visible(again);
      if (!shown) goneOnce = true;
      else if (goneOnce) return loop("came_back");
      // Our click opened a non-cookie dialog (a menu, drawer or settings panel), not a dismissal.
      if (Date.now() - clickedAt <= OPENED_BY_CLICK_MS) {
        var fresh = openDialogs().filter(function (d) { return dialogsBefore.indexOf(d) === -1; });
        for (var i = 0; i < fresh.length; i++) {
          if (!TEXT.test((fresh[i].innerText || "").slice(0, 4000)) && !KEY.test(fresh[i].id + " " + fresh[i].className)) {
            return loop("opened_dialog");
          }
        }
      }
    }
    var obs = new MutationObserver(check);
    check(); // the click may already have opened something
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "aria-hidden"] });

    // The user undoing our click (Escape) is the clearest "that was wrong" signal.
    function onKey(e) { if (e.key === "Escape") loop("user_escape"); }
    document.addEventListener("keydown", onKey, true);

    var timer = setTimeout(stop, WATCH_MS);
  }

  /** Guard 4: call before reporting a manual dismissal to report-dismissal. */
  function shouldLearnDismissal(closedEl, clickedEl) {
    return isCookieBannerTarget(clickedEl || closedEl) ||
      (!!closedEl && (KEY.test((closedEl.id || "") + " " + (closedEl.className || "")) || TEXT.test((closedEl.innerText || "").slice(0, 4000))));
  }

  /** For the popup: is Cookie Yeti paused on this site right now, and why? */
  function pausedInfo(domain) { var s = state(); return (s.paused || {})[domain] || null; }
  function resume(domain) { var s = state(); if (s.paused) delete s.paused[domain]; if (s.clicks) delete s.clicks[domain]; save(s); }

  root.CookieYetiFailsafe = {
    isCookieBannerTarget: isCookieBannerTarget,
    beforeAutoClick: beforeAutoClick,
    afterAutoClick: afterAutoClick,
    shouldLearnDismissal: shouldLearnDismissal,
    pausedInfo: pausedInfo,
    resume: resume,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
