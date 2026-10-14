import sys, re
src = open("index.live.html", encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:80]!r}"
    src = src.replace(old, new)

# ---- CSS -------------------------------------------------------------
rep("@media (max-width:620px){ .vbar .vclock{display:none} }\n",
"""@media (max-width:620px){ .vbar .vclock{display:none} }
/* ── the phone video pass (Spark, 2026-10-14) ────────────────────────────
   · a slow load shows a ring instead of a frozen picture;
   · the Ask orb steps aside while a video plays, so nothing floats over it;
   · every control on a touch screen is a 44 pt target. */
.vwait::after{content:"";position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;
  border:3px solid rgba(255,255,255,.28);border-top-color:#fff;box-shadow:0 0 26px 10px rgba(0,0,0,.34);
  animation:vspin .85s linear infinite;pointer-events:none;z-index:3}
@keyframes vspin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){ .vwait::after{animation-duration:2.4s} }
@media (max-width:700px){ body.vplay #pill:not(.on){opacity:0;pointer-events:none;transition:opacity .22s var(--ease)} }
@media (pointer:coarse){
  .vbar{gap:6px}
  .vbar>button{min-width:44px;height:44px}
  .vbar .vscrub{height:44px}
  .vbar .vrate button{min-height:44px;min-width:44px}
  .vbar [data-v=stepb],.vbar [data-v=stepf]{display:none}   /* frame steps are a keyboard job */
  .player .vexp,.vth .vx{width:44px;height:44px}
}
""")
# the phone tab bar: text under it no longer shows through
rep("""    background:color-mix(in srgb, var(--side) 88%, transparent);
    -webkit-backdrop-filter:saturate(180%) blur(18px);""", """    background:color-mix(in srgb, var(--side) 95%, transparent);
    -webkit-backdrop-filter:saturate(180%) blur(18px);""")

# ---- vBust / reload: never touch a blob: or data: address ---------------
rep("""const vBust = u => { const a = String(u).split("#"), q = a[0];""",
    """const vLocal = u => /^(blob|data):/i.test(String(u || ""));
const vBust = u => { if(vLocal(u)) return String(u); const a = String(u).split("#"), q = a[0];""")

# ---- one player at a time, spinner, orb ---------------------------------
rep("""document.addEventListener("play", e => { if(vIs(e.target)) vWatch(e.target); }, true);""",
"""/* A phone gives a page only a handful of video decoders, and two clips talking
   at once is never what anyone wants: starting one pauses the rest. */
const vAnyPlaying = () => [...document.querySelectorAll("video:not(.orb)")].some(v => !v.paused && !v.ended);
const vPlayFlag = () => document.body.classList.toggle("vplay", vAnyPlaying());
const vSpin = (v, on) => { const box = vBox(v); if(box) box.classList.toggle("vwait", !!on); };
function vWaitOn(v){
  if(!vIs(v)) return; clearTimeout(v._vw);
  v._vw = setTimeout(() => { if(v.isConnected && !v.paused && v.readyState < 3 && !v.error) vSpin(v, true); }, 350);
}
function vWaitOff(v){ if(!vIs(v)) return; clearTimeout(v._vw); vSpin(v, false); }
document.addEventListener("play", e => {
  const t = e.target; if(!vIs(t)) return;
  document.querySelectorAll("video:not(.orb)").forEach(o => { if(o !== t && !o.paused){ try { o.pause(); } catch {} } });
  vWatch(t); vWaitOn(t); vPlayFlag();
}, true);
["waiting", "stalled"].forEach(ev => document.addEventListener(ev, e => vWaitOn(e.target), true));
["playing", "canplay", "pause", "ended", "error", "emptied"].forEach(ev => document.addEventListener(ev, e => { vWaitOff(e.target); if(vIs(e.target)) vPlayFlag(); }, true));
/* Back from another app, or the signal came back: a video that errored while
   nobody was looking gets its retry now, not when somebody notices. */
const vRecover = (all) => document.querySelectorAll(VSEL).forEach(v => {
  if(!vIs(v) || !v.getAttribute("src")) return;
  const s = v._vs;
  if(s && s.failed){ if(all) vRetry(v); }
  else if(v.error) vFail(v, "media_error_" + v.error.code);
});
document.addEventListener("visibilitychange", () => { if(!document.hidden){ vRecover(false); vPlayFlag(); } });
addEventListener("online", () => vRecover(true));""")

rep("""new MutationObserver(() => { document.querySelectorAll(".pwrap, .pwrapper").forEach(wireVbar); wireAudio(document); }).observe""",
    """new MutationObserver(() => { document.querySelectorAll(".pwrap, .pwrapper").forEach(wireVbar); wireAudio(document); vPlayFlag(); }).observe""")

# reload helper: a blob: address is reloaded in place
rep("""function vReload(v, s, resume){
  v.setAttribute("src", vBust(s.orig));""", """function vReload(v, s, resume){
  if(!vLocal(s.orig)) v.setAttribute("src", vBust(s.orig));""")

# ---- theatre close: a still never starts playing by itself ---------------
rep("""    if(playing) src.play().catch(() => {});
  }
}""", """    // the tap-to-fill still is muted and has no controls: it keeps the frame, it does not play on behind the page
    if(playing && !(src.closest && src.closest(".tap"))) src.play().catch(() => {});
  }
}""")
rep("""<video src="${esc(url)}" autoplay playsinline preload="auto"></video>${vbarHTML()}</div>""",
    """<video src="${esc(url)}" autoplay playsinline webkit-playsinline preload="auto"></video>${vbarHTML()}</div>""")

# ---- Play original: size guard on phones, signed links expire ------------
rep("""async function origURL(path, parts, mime, onProg){
  if(RAWPLAY[path]) return RAWPLAY[path];""", """async function origURL(path, parts, mime, onProg){
  // a signed link is only good for a while; a joined blob: file is ours and never expires
  if(RAWPLAY[path] && (/^blob:/.test(RAWPLAY[path].url) || Date.now() - RAWPLAY[path].at < 20 * 60e3)) return RAWPLAY[path];""")
rep("""if(urls.length === 1) return (RAWPLAY[path] = { url: urls[0], save: urls[0] });""",
    """if(urls.length === 1) return (RAWPLAY[path] = { url: urls[0], save: urls[0], at: Date.now() });""")
rep("""return (RAWPLAY[path] = { url, save: url });""", """return (RAWPLAY[path] = { url, save: url, at: Date.now() });""")
rep("""  if(b.dataset.url){ mountRec(box, b.dataset.url, title, autoplay, b.dataset.poster || ""); return; }
  const label = b.textContent;""", """  if(b.dataset.url){ mountRec(box, b.dataset.url, title, autoplay, b.dataset.poster || ""); return; }
  /* A recording over the part size is stored in slices and joined in the
     browser's memory. 130 MB on a phone is a long wait on a cellular signal and
     a tab iOS likes to kill, so a phone gets the converted copy first and can
     still ask for the original. */
  const rawBytes = Number(b.dataset.bytes) || 0, rawParts = Number(b.dataset.parts) || 1;
  if(!b.dataset.joined && b.dataset.fallback && rawParts > 1 && rawBytes > 40e6 && matchMedia("(pointer:coarse)").matches){
    mountRec(box, b.dataset.fallback, title, true, "", `The original is <span class="nw">${esc(fmtMB(rawBytes))}</span> in ${esc(numNoun(rawParts, "part"))}, so this phone plays the converted copy. <a href="#" data-joinorig>Join and play the original anyway</a>`);
    const j = box.querySelector("[data-joinorig]"); if(j) j.onclick = (e) => { e.preventDefault(); b.dataset.joined = "1"; playRec(b, title, autoplay); };
    return;
  }
  const label = b.textContent;""")
rep("""data-parts="${esc(String(u.parts || 1))}" data-mime="${esc(u.mime || "")}" data-fallback""",
    """data-parts="${esc(String(u.parts || 1))}" data-bytes="${esc(String(u.bytes || 0))}" data-mime="${esc(u.mime || "")}" data-fallback""")

# ---- Library: stills instead of live videos, and a cap on the rest -------
rep("""function postTile(it){
  const poster = it.media_type === "video" ? it.media_url : postPic(it);
  return `<button class="tile" data-tile="post:${esc(it.id)}">
    <span class="tthumb" ${poster ? `data-poster="${esc(poster)}" data-mime="${it.media_type === "video" ? "video/mp4" : "image/*"}"` : ""}>""",
"""function postTile(it){
  // a video post's own still (the board has it) is a 60 KB picture; its mp4 is 10-30 MB and a decoder
  const bi = BOARD.items.find(x => x.id === it.id) || {};
  const still = it.media_type === "video" ? (it.thumb_url || bi.thumb_url || "") : (postPic(it) || it.thumb_url || bi.thumb_url || "");
  const poster = still || (it.media_type === "video" ? it.media_url : "");
  return `<button class="tile" data-tile="post:${esc(it.id)}">
    <span class="tthumb" ${poster ? `data-poster="${esc(poster)}" data-mime="${still || it.media_type !== "video" ? "image/*" : "video/mp4"}"` : ""}>""")
rep("""    el.innerHTML = /^image/.test(el.dataset.mime) ? `<img src="${esc(u)}" alt="" loading="lazy">` : `<video src="${esc(u)}#t=0.5" muted playsinline preload="metadata"></video>`;
  });
}""", """    if(/^image/.test(el.dataset.mime)) el.innerHTML = `<img src="${esc(u)}" alt="" loading="lazy" decoding="async">`;
    else { el.textContent = "▶"; tvThumb(el, u); }
  });
}
/* Video tiles with no still. A phone gives a page only a handful of decoders and
   the rest paint black (and starve the player you open next), so a tile holds a
   live <video> only while it is on screen, and never more than TV_MAX at once. */
const TV_MAX = 8; let TV_IO = null;
function tvMount(el){
  if(!el._tvu || !el.isConnected || el.querySelector("video")) return;
  const live = [...document.querySelectorAll("[data-tvlive]")];
  live.slice(0, Math.max(0, live.length - TV_MAX + 1)).forEach(tvDrop);
  el.dataset.tvlive = "1";
  el.innerHTML = `<video src="${esc(el._tvu)}#t=0.5" muted playsinline preload="metadata" tabindex="-1" aria-hidden="true"></video>`;
}
function tvDrop(el){
  const v = el.querySelector("video"); if(!v) return;
  try { v.pause(); } catch {}
  v.removeAttribute("src"); try { v.load(); } catch {}
  delete el.dataset.tvlive; el.textContent = "▶";
}
function tvThumb(el, url){
  el._tvu = url;
  if(typeof IntersectionObserver !== "function"){ tvMount(el); return; }
  if(!TV_IO) TV_IO = new IntersectionObserver(es => es.forEach(e => { if(e.isIntersecting) tvMount(e.target); else tvDrop(e.target); }), { rootMargin: "120px 0px" });
  TV_IO.observe(el);
}""")
rep("""    el.innerHTML = isImg(el.dataset.mime) ? `<img src="${esc(r.url)}" alt="" loading="lazy" decoding="async">`
                                          : `<video src="${esc(r.url)}#t=0.5" muted playsinline preload="metadata"></video>`;""",
    """    if(isImg(el.dataset.mime)) el.innerHTML = `<img src="${esc(r.url)}" alt="" loading="lazy" decoding="async">`;
    else tvThumb(el, r.url);""")

# ---- the orbs: only the one on screen holds a decoder ----------------------
rep("""<div class="pillhead"><video class="sav orb" poster="/orb-poster.png" autoplay muted loop playsinline""",
    """<div class="pillhead"><video class="sav orb" poster="/orb-poster.png" preload="none" muted loop playsinline""")
rep("""if(matchMedia("(prefers-reduced-motion: reduce)").matches)
  document.querySelectorAll("video.orb").forEach(v => { v.removeAttribute("autoplay"); v.pause(); });""",
"""if(matchMedia("(prefers-reduced-motion: reduce)").matches)
  document.querySelectorAll("video.orb").forEach(v => { v.removeAttribute("autoplay"); v.pause(); });
/* An iPhone gives a page a handful of video decoders. The orb in the closed panel
   was playing all day for nobody, and the one on the pill kept running under a
   video someone was watching. Now the panel's orb plays only while the panel is
   open, and both rest while a post's video plays. */
(function(){
  const pill = document.getElementById("pill"), panel = document.getElementById("pillPanel"), still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(!pill || !panel) return;
  const go = (o, on) => { try { if(on && !still){ const p = o.play(); if(p && p.catch) p.catch(() => {}); } else o.pause(); } catch {} };
  const sync = () => {
    const quiet = document.body.classList.contains("vplay");
    pill.querySelectorAll("video.orb").forEach(o => go(o, !quiet));
    panel.querySelectorAll("video.orb").forEach(o => go(o, !quiet && panel.classList.contains("open")));
  };
  const mo = new MutationObserver(sync), opt = { attributes: true, attributeFilter: ["class"] };
  mo.observe(pill, opt); mo.observe(panel, opt); mo.observe(document.body, opt);
  sync();
})();""")

open("index.new.html", "w", encoding="utf-8").write(src)
print("ok", len(src))
