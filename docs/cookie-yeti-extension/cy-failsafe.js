/*
 * Cookie Yeti — click fail-safe + page guard (drop into the Safari (Mac + iOS) and Chrome content scripts).
 * Keep this file byte-identical in chrome-extension/ and the Safari extension Resources/.
 *
 * CY-FAILSAFE-01 fixes the open/close "death cycle": the extension clicked a learned selector that
 * wasn't a cookie button (a menu, a settings link, an admin row), which opened something; the user
 * closed it; the extension clicked again. Four guards:
 *
 *   1. Only click a pattern selector inside a real cookie/consent banner (isCookieBannerTarget).
 *   2. At most 1 automatic click per selector per page, and 3 per site per 10 minutes.
 *   3. After a click, watch 8 seconds. If the button comes back or a new dialog opens, or the user
 *      presses Escape, treat it as a loop: stop on this site and tell the server.
 *   4. Only learn from a manual dismissal when the thing closed is a cookie banner.
 *
 * CY-GUARD-01 (1.2.5) makes that self-healing everywhere, not just for pattern clicks:
 *
 *   5. Scroll guard: if the page jumps (>120 px) within 2 s of anything Cookie Yeti did and the user
 *      didn't scroll, put the page back where it was and stop on this site.
 *   6. Heuristic clicks get the same 8-second watch as pattern clicks, and a budget of 4 per site
 *      per 10 minutes. Popups that keep reopening pause the site.
 *   7. A paused site stays paused for 3 days on this device (not just this tab), and is reported to
 *      the server (cy_report_site_issue). 3 reports in 7 days switch the site off for every user for
 *      14 days (doubling on repeat), then it retries by itself. The extension pulls that list every
 *      12 hours (cy_site_guard_list). Bestly's own sites are always off.
 *
 * No dependencies. Works in MV3 content scripts and Safari Web Extension content scripts.
 */
(function (root) {
  "use strict";

  var SB = "https://rcqfqhguwpmaarseifqg.supabase.co";
  var LOOP_ENDPOINT = SB + "/functions/v1/report-pattern-loop";
  var SITE_ISSUE_ENDPOINT = SB + "/rest/v1/rpc/cy_report_site_issue";
  var GUARD_LIST_ENDPOINT = SB + "/rest/v1/rpc/cy_site_guard_list";
  var ANON_KEY = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw";
  var STORE_KEY = "__cookieYetiFailsafe";
  var LOCAL_KEY = "cyGuard";
  var WATCH_MS = 8000;        // how long a click is watched for the banner coming back / Escape
  var OPENED_BY_CLICK_MS = 1500; // a dialog that opens this soon after our click was opened by it
  var SITE_WINDOW_MS = 10 * 60 * 1000;
  var SITE_MAX_CLICKS = 3;
  var HEURISTIC_MAX_CLICKS = 4;
  var LOCAL_PAUSE_MS = 3 * 24 * 60 * 60 * 1000;
  var LIST_TTL_MS = 12 * 60 * 60 * 1000;
  var YANK_PX = 120;             // a jump this big right after our action, with no user input, is a yank
  var ACTION_WINDOW_MS = 2000;
  var USER_QUIET_MS = 800;
  var ALWAYS_OFF = { "bestly.tech": true };

  // Consent-manager ids/classes. Guarded so "sticky", "sketch", "trusted" don't match.
  var KEY = /cookie|consent|gdpr|ccpa|onetrust|optanon|didomi|cookiebot|cybot|usercentrics|truste-|trustarc|quantcast|qc-cmp|sp_message|sourcepoint|osano|iubenda|(^|[^a-z])cky-|cmplz|complianz|termly|klaro|(^|[^a-z])ketch|borlabs|axeptio|tarteaucitron|guce-/i;
  // What a banner actually says. The bare word "cookie" isn't enough: footers link "Cookie policy".
  var TEXT = /(we|site|website|this site|our partners)\s+(and our partners\s+)?uses?\s+cookies|cookies? (to|for|help|and similar)|(accept|reject|allow|decline)( all)? cookies|necessary cookies|cookie (settings|preferences|choices)|manage (cookies|consent|preferences)|your consent|consent to|datenschutz|einwilligung|tracking technolog|your privacy choices|we value your privacy/i;

  var ext = null;
  try {
    ext = (typeof browser !== "undefined" && browser.storage) ? browser : ((typeof chrome !== "undefined" && chrome.storage) ? chrome : null);
  } catch (e) { ext = null; }

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

  // ── Device-wide memory (extension storage): local pauses + the server's learned off-list ──
  var local = { off: {}, list: null }; // off: domain -> {until, reason}; list: {at, domains: {d: untilMs}}
  function localGet() {
    return new Promise(function (resolve) {
      try {
        if (!ext) return resolve(null);
        var done = function (v) { resolve((v && v[LOCAL_KEY]) || null); };
        var r = ext.storage.local.get(LOCAL_KEY, done);
        if (r && typeof r.then === "function") r.then(done, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }
  function localSave() {
    try {
      if (!ext) return;
      var o = {}; o[LOCAL_KEY] = local;
      var r = ext.storage.local.set(o);
      if (r && typeof r.catch === "function") r.catch(function () {});
    } catch (e) { /* ignore */ }
  }
  function pruneLocal() {
    var now = Date.now();
    Object.keys(local.off || {}).forEach(function (d) { if (!(local.off[d].until > now)) delete local.off[d]; });
  }

  function refreshList() {
    try {
      return fetch(GUARD_LIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON_KEY },
        body: "{}",
      }).then(function (r) { return r.ok ? r.json() : null; }).then(function (rows) {
        if (!Array.isArray(rows)) return;
        var domains = {};
        rows.forEach(function (row) {
          if (!row || !row.domain) return;
          var t = row.off_until === "infinity" ? Infinity : Date.parse(row.off_until);
          domains[String(row.domain).toLowerCase()] = isNaN(t) ? Infinity : t;
        });
        local.list = { at: Date.now(), domains: domains };
        localSave();
      }).catch(function () {});
    } catch (e) { return Promise.resolve(); /* offline or blocked: keep the cached list */ }
  }

  var ready = localGet().then(function (v) {
    if (v && typeof v === "object") { local.off = v.off || {}; local.list = v.list || null; }
    pruneLocal();
    if (!local.list) {
      // First run on this device: wait briefly for the learned list so a known-bad site is left alone.
      return Promise.race([refreshList(), new Promise(function (r) { setTimeout(r, 1500); })]);
    }
    if (!(Date.now() - local.list.at < LIST_TTL_MS)) refreshList();
  }).catch(function () {});

  function cleanHost(h) { return String(h || "").toLowerCase().replace(/^www\./, ""); }
  // Matches the host and every parent domain (app.example.com -> example.com).
  function matchHost(host, test) {
    var h = cleanHost(host);
    while (h) {
      if (test(h)) return true;
      var i = h.indexOf(".");
      if (i < 0) break;
      h = h.slice(i + 1);
      if (h.indexOf(".") < 0) break; // never match a bare TLD
    }
    return false;
  }

  /** Should Cookie Yeti leave this site completely alone right now? */
  function siteBlocked(host) {
    host = cleanHost(host || (root.location && root.location.hostname));
    if (!host) return false;
    var now = Date.now();
    var s = state();
    return matchHost(host, function (d) {
      if (ALWAYS_OFF[d]) return true;
      if (s.paused && s.paused[d]) return true;
      var o = local.off && local.off[d];
      if (o && o.until > now) return true;
      var until = local.list && local.list.domains && local.list.domains[d];
      return !!until && until > now;
    });
  }

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

  // Version and browser family only: no user id, no page URL beyond the domain already reported.
  function buildInfo() {
    var version = null, platform = "unknown";
    try {
      var api = (typeof browser !== "undefined" && browser.runtime) ? browser : (typeof chrome !== "undefined" ? chrome : null);
      if (api && api.runtime && api.runtime.getManifest) version = api.runtime.getManifest().version || null;
      var url = api && api.runtime && api.runtime.getURL ? api.runtime.getURL("") : "";
      platform = url.indexOf("safari-web-extension://") === 0 ? "safari" : url.indexOf("chrome-extension://") === 0 ? "chrome" : "unknown";
    } catch (e) { /* ignore */ }
    return { version: version, platform: platform };
  }

  function post(url, body) {
    try {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: ANON_KEY },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(function () {});
    } catch (e) { /* never break the page */ }
  }

  function reportLoop(domain, selector, reason) {
    var info = buildInfo();
    post(LOOP_ENDPOINT, { domain: domain, selector: selector, reason: reason, version: info.version, platform: info.platform });
  }

  var reportedSite = {};
  function reportSite(domain, reason) {
    if (reportedSite[domain + "|" + reason]) return; // once per page per reason
    reportedSite[domain + "|" + reason] = true;
    var info = buildInfo();
    post(SITE_ISSUE_ENDPOINT, { p_domain: domain, p_reason: reason, p_version: info.version, p_platform: info.platform === "unknown" ? null : info.platform });
  }

  function pauseSite(domain, selector, reason) {
    domain = cleanHost(domain);
    var s = state();
    s.paused = s.paused || {};
    s.paused[domain] = { at: Date.now(), selector: selector, reason: reason };
    save(s);
    local.off = local.off || {};
    local.off[domain] = { until: Date.now() + LOCAL_PAUSE_MS, reason: reason };
    pruneLocal();
    localSave();
    if (selector && selector.indexOf("heuristic:") !== 0 && selector !== "scroll") reportLoop(domain, selector, reason);
    reportSite(domain, reason);
    try { console.log("[Cookie Yeti] Page guard: paused on " + domain + " (" + reason + ")"); } catch (e) { /* ignore */ }
  }

  // ── Guard 5: scroll guard ──────────────────────────────────────────────────
  var lastUser = 0, lastAction = 0, lockedAtAction = false, restoring = false;
  var positions = (typeof WeakMap !== "undefined") ? new WeakMap() : null;
  function scrollLocked() {
    try {
      var b = getComputedStyle(document.body), h = getComputedStyle(document.documentElement);
      return b.position === "fixed" || /hidden|clip/.test(b.overflow + b.overflowY) || /hidden|clip/.test(h.overflow + h.overflowY);
    } catch (e) { return false; }
  }
  function noteUser(e) { if (!e || e.isTrusted !== false) lastUser = Date.now(); }
  /** Call right before Cookie Yeti changes the page (click, hide). */
  function markAction() {
    lastAction = Date.now();
    lockedAtAction = scrollLocked(); // a banner that locked scrolling may legitimately restore it
  }
  function onScroll(e) {
    if (!positions) return;
    var t = e.target;
    var isDoc = !t || t === document || t === document.documentElement || t === document.body;
    var key = isDoc ? document : t;
    var cur = isDoc ? { x: root.scrollX || 0, y: root.scrollY || 0 } : { x: t.scrollLeft || 0, y: t.scrollTop || 0 };
    var prev = positions.get(key) || { x: 0, y: 0 };
    positions.set(key, cur);
    if (restoring || !lastAction || lockedAtAction) return;
    var now = Date.now();
    if (now - lastAction > ACTION_WINDOW_MS || now - lastUser < USER_QUIET_MS) return;
    if (Math.abs(cur.y - prev.y) <= YANK_PX && Math.abs(cur.x - prev.x) <= YANK_PX * 2) return;
    // Cookie Yeti's action moved the page: put it back and stand down on this site.
    restoring = true;
    try { if (isDoc) root.scrollTo(prev.x, prev.y); else { t.scrollTop = prev.y; t.scrollLeft = prev.x; } } catch (err) { /* ignore */ }
    positions.set(key, prev);
    setTimeout(function () { restoring = false; }, 100);
    pauseSite(cleanHost(root.location && root.location.hostname), "scroll", "scroll_jump");
  }
  try {
    ["wheel", "touchstart", "touchmove", "keydown", "pointerdown", "mousedown"].forEach(function (type) {
      document.addEventListener(type, noteUser, { capture: true, passive: true });
    });
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  } catch (e) { /* ignore */ }

  /** Call right before an automatic pattern click. Returns false when the click must not happen. */
  function beforeAutoClick(domain, selector, el) {
    if (siteBlocked(domain)) return false;
    var s = state();
    if (!isCookieBannerTarget(el)) return false;
    if ((pageClicks[selector] || 0) >= 1) return false;
    var now = Date.now();
    var recent = ((s.clicks || {})[domain] || []).filter(function (t) { return now - t < SITE_WINDOW_MS; });
    if (recent.length >= SITE_MAX_CLICKS) { pauseSite(domain, selector, "too_many_clicks"); return false; }
    dialogsBeforeClick[selector] = openDialogs(); // clicks can open a dialog synchronously
    markAction();
    return true;
  }

  /**
   * Call right after an automatic click. Watches for the loop and pauses the site if it happens.
   * el (optional): the clicked element, for clicks that have no selector (heuristic clicks).
   */
  function afterAutoClick(domain, selector, el) {
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
    function target() {
      if (el) return el;
      try { return document.querySelector(selector); } catch (e) { return null; }
    }

    function check() {
      // The banner went away and came back: something (the site or our pattern) keeps reopening it.
      var again = target();
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
    function onKey(e) { if (e.key === "Escape" && e.isTrusted !== false) loop("user_escape"); }
    document.addEventListener("keydown", onKey, true);

    var timer = setTimeout(stop, WATCH_MS);
  }

  // ── Guard 6: heuristic (non-pattern) clicks ──────────────────────────────────
  var heuristicSeq = 0;
  /** Before a heuristic click. Returns a watch key, or null when the click must not happen. */
  function beforeHeuristicClick(domain, el) {
    domain = cleanHost(domain);
    if (siteBlocked(domain)) return null;
    var s = state();
    var now = Date.now();
    s.hclicks = s.hclicks || {};
    var recent = (s.hclicks[domain] || []).filter(function (t) { return now - t < SITE_WINDOW_MS; });
    if (recent.length >= HEURISTIC_MAX_CLICKS) { pauseSite(domain, "heuristic:budget", "too_many_clicks"); return null; }
    s.hclicks[domain] = recent.concat(now).slice(-10);
    save(s);
    var key = "heuristic:" + (++heuristicSeq);
    dialogsBeforeClick[key] = openDialogs();
    markAction();
    return key;
  }
  function afterHeuristicClick(domain, key, el) {
    if (!key) return;
    domain = cleanHost(domain);
    // afterAutoClick also counts the click toward the pattern budget; undo that for heuristics.
    afterAutoClick(domain, key, el);
    var s = state();
    if (s.clicks && s.clicks[domain]) { s.clicks[domain].pop(); save(s); }
  }

  /** Guard 4: call before reporting a manual dismissal to report-dismissal. */
  function shouldLearnDismissal(closedEl, clickedEl) {
    if (siteBlocked()) return false;
    return isCookieBannerTarget(clickedEl || closedEl) ||
      (!!closedEl && (KEY.test((closedEl.id || "") + " " + (closedEl.className || "")) || TEXT.test((closedEl.innerText || "").slice(0, 4000))));
  }

  /** For the popup: is Cookie Yeti paused on this site right now, and why? */
  function pausedInfo(domain) {
    domain = cleanHost(domain);
    var s = state();
    return (s.paused || {})[domain] || (local.off || {})[domain] || null;
  }
  function resume(domain) {
    domain = cleanHost(domain);
    var s = state();
    if (s.paused) delete s.paused[domain];
    if (s.clicks) delete s.clicks[domain];
    if (s.hclicks) delete s.hclicks[domain];
    save(s);
    if (local.off) { delete local.off[domain]; localSave(); }
  }

  root.CookieYetiFailsafe = {
    ready: ready,
    siteBlocked: siteBlocked,
    markAction: markAction,
    isCookieBannerTarget: isCookieBannerTarget,
    beforeAutoClick: beforeAutoClick,
    afterAutoClick: afterAutoClick,
    beforeHeuristicClick: beforeHeuristicClick,
    afterHeuristicClick: afterHeuristicClick,
    shouldLearnDismissal: shouldLearnDismissal,
    pausedInfo: pausedInfo,
    resume: resume,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
