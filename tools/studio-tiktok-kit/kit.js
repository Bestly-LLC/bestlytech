/* TikTok posting kit: tap-to-copy cards, a checklist, and "I posted it".
   One module for Studio's "Post to TikTok" panel and the standalone phone page (bestly.tech/k/<code>).
   TKKit.mount(root, api, opts)
     api.load()                  -> Promise<{ok, kit}|{ok:false,error}>
     api.check(post, key, on)    -> Promise<{ok, checks}>
     api.posted(post)            -> Promise<{ok}>
     opts.page                   -> true on the standalone page (frosted dock for the big button)
     opts.onPosted(kit)          -> called after "I posted it" lands
   Never uploads anything. The only thing it can change is the checklist and in_drafts -> posted. */
(function (root) {
  "use strict";
  var TIKTOK_URL = "https://www.tiktok.com/";   // no documented tiktok:// scheme for Inbox or Drafts; the https link opens the app
  var I = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>'
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function when(iso) {
    try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles", hour12: true }) + " PT"; }
    catch (e) { return ""; }
  }
  function legacyCopy(text) {
    return new Promise(function (ok, no) {
      var t = document.createElement("textarea");
      t.value = text; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
      document.body.appendChild(t); t.focus(); t.select(); t.setSelectionRange(0, t.value.length);
      var good = false; try { good = document.execCommand("copy"); } catch (e) { good = false; }
      document.body.removeChild(t);
      good ? ok() : no(new Error("copy refused"));
    });
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  /* The search string to type into TikTok's location picker. The geocoded label reads
     "Doral, Miami-Dade County, Florida"; TikTok's picker wants the city and the state, so
     drop the county. Two parts or one part are already what the picker wants. */
  function placeSearch(k) {
    var q = String(k.place || k.place_search || "").trim();
    var parts = q.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    // "City, County, State" -> "City, State"; "City, Region, Country" -> "City, Country"
    return parts.length >= 3 ? parts[0] + ", " + parts[parts.length > 3 ? parts.length - 2 : parts.length - 1] : q;
  }

  function steps(k) {
    var place = placeSearch(k);
    var s = [
      { id: "caption", t: "Paste caption", s: "Tap the caption box in TikTok, then Paste. The hashtags are already in it." },
      { id: "ai", t: "Turn on “AI-generated content”", s: "On the post screen, tap More options, then switch it on." }
    ];
    if (place) s.push({ id: "location", t: "Tag location", s: "Tap Location and search “" + place + "”." });
    s.push(k.cover_custom
      ? { id: "cover", t: "Upload the cover", s: "Tap Edit cover, tap Upload, choose the saved image." }
      : { id: "cover", t: "Pick the cover", s: "Tap Edit cover and pick the frame with the headline." });
    s.push({ id: "duet", t: "Turn Duet and Stitch on", s: "In More options, allow Duet and Stitch." });
    s.push({ id: "post", t: "Post", s: "Tap Post in TikTok, then tap I posted it here." });
    return s;
  }

  function mount(el, api, opts) {
    opts = opts || {};
    var kit = null, poll = null, armed = false, armTimer = null;
    el.classList.add("tkk");
    if (opts.page) el.classList.add("k-page");
    el.innerHTML = '<div class="k-load">Loading the kit</div>';

    function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }
    function failView(r) {
      stopPoll();
      var e = r && r.error;
      el.innerHTML = '<div class="k-err">' + (
        e === "expired" ? "This link has expired. Open the post in Studio and a fresh one is made for you."
        : e === "not_found" ? "This link is not valid. Open the post in Studio for the right one."
        : "The kit would not load. Check your connection and try again.") + '</div>';
    }
    function load() {
      return api.load().then(function (r) {
        if (r && r.ok && r.kit) { kit = r.kit; draw(); }
        else if (r && r.ok) { el.innerHTML = ""; if (opts.onEmpty) opts.onEmpty(); }
        else if (!kit) failView(r);
      }).catch(function () { if (!kit) failView(null); });
    }

    function card(id, label, valueHtml, extra, cls) {
      return '<div class="k-card" role="button" tabindex="0" data-copy="' + id + '" aria-label="Copy ' + esc(label) + '">' +
        '<div class="k-top"><span class="k-lbl">' + esc(label) + '</span>' +
        '<span class="k-copy"><span class="k-do">' + I.copy + 'Copy</span><span class="k-did">' + I.check + 'Copied</span></span></div>' +
        '<div class="k-val ' + (cls || "") + '">' + valueHtml + '</div>' + (extra || "") + '</div>';
    }

    function draw() {
      var k = kit, st = k.status, checks = k.checks || {};
      el.classList.toggle("is-posted", st === "posted");
      if (opts.onKit) opts.onKit(k);
      if (st === "posted") {
        el.innerHTML = '<div class="k-posted">' + I.check + '<b>Marked as posted</b><span>' + esc(k.title) + (k.posted_at ? ' &middot; ' + esc(when(k.posted_at)) : '') + '</span></div>' +
          '<div class="k-cards" style="display:grid;gap:10px">' + cardsHtml(k) + '</div>';
        stopPoll();
        return;
      }
      var live = st === "in_drafts";
      var out = '';
      if (!live) {
        out += '<div class="k-wait"><b>Still on its way to TikTok.</b> The video has not landed in your drafts yet, so there is nothing to finish. ' +
          'This fills in on its own, or <button type="button" data-act="refresh">check now</button>.</div>';
      }
      out += '<div class="k-cards" style="display:grid;gap:10px">';
      out += '<a class="k-open" href="' + TIKTOK_URL + '" target="_blank" rel="noopener">Open TikTok' + I.ext + '</a>';
      out += '<p class="k-hint">Tap the caption card to copy it, then paste it in the caption box.<br>Your draft is waiting in TikTok: Inbox, then Drafts.</p>';
      out += cardsHtml(k);
      out += '</div>';
      out += listHtml(k, checks);
      if (live) {
        var dock = '<button type="button" class="k-done" data-act="posted">' + I.check + 'I posted it</button>' +
          '<p class="k-note" data-role="postnote">Marks this clip posted in Studio. Nothing is uploaded or sent.</p>';
        out += opts.page ? '<div class="k-dock">' + dock + '</div>' : dock;
      }
      el.innerHTML = out;
      if (!live && !poll) poll = setInterval(function () { api.load().then(function (r) { if (r && r.ok && r.kit && r.kit.status !== st) { kit = r.kit; draw(); } }).catch(function () {}); }, 15000);
      if (live) stopPoll();
    }

    function cardsHtml(k) {
      var h = '', place = placeSearch(k);
      /* One card, one tap, one paste: the hashtag line rides along with the caption. TikTok takes them as
         text in the caption box, so splitting them into a second card only ever cost a second copy. */
      h += card("caption", "Caption + hashtags", esc(k.all || k.caption || "(No caption.)"), k.chars ? '<div class="k-count">' + esc(String(k.chars).replace(/\B(?=(\d{3})+(?!\d))/g, ",")) + '&nbsp;of&nbsp;2,200 characters with the hashtags</div>' : "");
      if (place) {
        var full = k.place && k.place !== place ? '<div class="k-sub">' + esc(k.place) + '</div>' : '';
        h += card("place", "Location to tag", esc(place), full + '<div class="k-sub">Copies the place name. Type it into TikTok’s location search and pick the match.</div>');
      }
      h += coverHtml(k);
      return h;
    }

    function coverHtml(k) {
      if (!k.cover) return '';
      var body = k.cover_custom
        ? '<div class="k-ctitle">Custom cover' + (k.headline ? ': “' + esc(k.headline) + '”' : '') + '</div>' +
          '<div class="k-cnote">TikTok lets you upload it. Save it to Photos, then in TikTok tap Edit cover, then Upload.</div>' +
          '<button type="button" class="k-save" data-act="save">' + I.down + 'Save cover image</button>' +
          '<div class="k-cnote" data-role="savenote" aria-live="polite"></div>'
        : '<div class="k-ctitle">Pick the frame with the headline</div>' +
          '<div class="k-cnote">In TikTok tap Edit cover and slide to the frame that looks like this one. It is the first frame of the clip.</div>';
      return '<div class="k-cover"><img src="' + esc(k.cover) + '" alt="The cover frame" decoding="async"><div class="k-cbody">' + body + '</div></div>';
    }

    function listHtml(k, checks) {
      var s = steps(k), n = s.filter(function (x) { return checks[x.id]; }).length;
      return '<div class="k-list" role="group" aria-label="Steps in TikTok"><div class="k-lhead"><span class="k-lbl">Finish in TikTok</span>' +
        '<span class="k-n" data-role="count">' + n + '&nbsp;of&nbsp;' + s.length + '&nbsp;done</span></div>' +
        s.map(function (x) {
          var on = !!checks[x.id];
          return '<button type="button" class="k-step' + (on ? ' on' : '') + '" role="checkbox" aria-checked="' + on + '" data-step="' + x.id + '">' +
            '<span class="k-box">' + I.check + '</span><span class="k-st"><b>' + esc(x.t) + '</b><i>' + esc(x.s) + '</i></span></button>';
        }).join("") + '</div>';
    }

    function flash(node) {
      node.classList.add("copied");
      clearTimeout(node._t);
      node._t = setTimeout(function () { node.classList.remove("copied"); }, 1800);
    }
    function failCopy(node) {
      var v = node.querySelector(".k-val");
      if (v) { var r = document.createRange(); r.selectNodeContents(v); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      var l = node.querySelector(".k-copy .k-do");
      if (l) { l.lastChild.nodeValue = "Hold to copy"; setTimeout(function () { l.lastChild.nodeValue = "Copy"; }, 2500); }
    }
    function doCopy(node) {
      var id = node.getAttribute("data-copy"), k = kit, text;
      if (id === "caption") text = k.all || k.caption || "";   // caption and hashtags in one paste
      else if (id === "tags") text = k.hashtags || "";
      else if (id === "place") text = placeSearch(k);
      else text = k.all || "";
      copyText(text).then(function () { flash(node); }, function () { failCopy(node); });
    }

    function setCount() {
      var c = el.querySelector('[data-role="count"]'); if (!c) return;
      var s = steps(kit), n = s.filter(function (x) { return (kit.checks || {})[x.id]; }).length;
      c.innerHTML = n + '&nbsp;of&nbsp;' + s.length + '&nbsp;done';
    }
    function toggle(btn) {
      var key = btn.getAttribute("data-step"), on = !btn.classList.contains("on");
      kit.checks = kit.checks || {}; kit.checks[key] = on;
      btn.classList.toggle("on", on); btn.setAttribute("aria-checked", String(on)); setCount();
      api.check(kit.post, key, on).then(function (r) {
        if (!(r && r.ok)) { kit.checks[key] = !on; btn.classList.toggle("on", !on); btn.setAttribute("aria-checked", String(!on)); setCount(); }
      }).catch(function () {});
    }

    function saveCover(btn) {
      var note = el.querySelector('[data-role="savenote"]'), url = kit.cover;
      function fallback() {
        if (note) note.textContent = "Press and hold the picture, then tap Save to Photos.";
        var img = el.querySelector(".k-cover img"); if (img) img.scrollIntoView({ block: "nearest", behavior: "smooth" });
        window.open(url, "_blank", "noopener");
      }
      fetch(url).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.blob(); }).then(function (b) {
        var f = new File([b], "cover.jpg", { type: b.type || "image/jpeg" });
        if (navigator.canShare && navigator.canShare({ files: [f] })) {
          if (note) note.textContent = "Choose Save Image in the share sheet.";
          return navigator.share({ files: [f] });
        }
        throw new Error("no share");
      }).catch(function (e) { if (e && e.name === "AbortError") return; fallback(); });
    }

    function posted(btn) {
      var checks = kit.checks || {}, s = steps(kit);
      var open = s.filter(function (x) { return x.id !== "post" && !checks[x.id]; }).length;
      var note = el.querySelector('[data-role="postnote"]');
      if (open && !armed) {
        armed = true; btn.classList.add("ask");
        btn.innerHTML = I.check + 'Tap again to confirm';
        if (note) note.textContent = open + ' step' + (open === 1 ? ' is' : 's are') + ' not ticked. Tap again if it is posted.';
        clearTimeout(armTimer);
        armTimer = setTimeout(function () { armed = false; btn.classList.remove("ask"); btn.innerHTML = I.check + 'I posted it'; if (note) note.textContent = "Marks this clip posted in Studio. Nothing is uploaded or sent."; }, 6000);
        return;
      }
      btn.disabled = true;
      api.posted(kit.post).then(function (r) {
        if (r && r.ok) {
          kit.status = "posted"; kit.posted_at = new Date().toISOString(); kit.checks = kit.checks || {}; kit.checks.post = true;
          draw(); if (opts.onPosted) opts.onPosted(kit);
        } else {
          btn.disabled = false;
          if (note) note.textContent = r && r.error === "not_in_drafts" ? "This clip is not in your TikTok drafts, so it cannot be marked posted." : "That did not save. Try again.";
        }
      }).catch(function () { btn.disabled = false; if (note) note.textContent = "That did not save. Check your connection and try again."; });
    }

    el.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-copy],[data-step],[data-act]") : null;
      if (!t || !el.contains(t)) return;
      if (t.hasAttribute("data-copy")) return doCopy(t);
      if (t.hasAttribute("data-step")) return toggle(t);
      var a = t.getAttribute("data-act");
      if (a === "save") return saveCover(t);
      if (a === "posted") return posted(t);
      if (a === "refresh") return load();
    });
    el.addEventListener("keydown", function (e) {
      if ((e.key === "Enter" || e.key === " ") && e.target.getAttribute && e.target.getAttribute("role") === "button" && e.target.hasAttribute("data-copy")) {
        e.preventDefault(); doCopy(e.target);
      }
    });

    load();
    return { reload: load, destroy: stopPoll };
  }
  root.TKKit = { mount: mount };
})(typeof window !== "undefined" ? window : this);
