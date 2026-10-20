#!/usr/bin/env python3
"""Patches the LIVE Studio app (the content-hashed file the boot loader serves) with:
  1. the TikTok posting kit: a "Post to TikTok" panel on a post's detail, and a "TikTok drafts to finish" strip in the queue
  2. the cover fix: a post's video shows its custom cover (thumb_url) before play, in every player (Studio, TikTok and Instagram tabs)

Studio has no source repo. The live file is the source of truth: fetch it, patch it, ship it as a new build.
  python3 patch_studio.py <live_app.html> <out.html>
Every replacement must match exactly once or the script stops; nothing is half-applied.
"""
import hashlib, pathlib, sys

here = pathlib.Path(__file__).parent
src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
html = src.read_text()
n_before = len(html)


def once(old, new, label):
    global html
    c = html.count(old)
    if c != 1:
        sys.exit(f"patch '{label}': expected exactly 1 match, found {c}")
    html = html.replace(old, new)


CSS = (here / "kit.css").read_text() + r"""
/* Post to TikTok panel + the queue strip */
.tkpanel .pbody{padding:12px}
.tkq{margin:8px 12px 6px;border:var(--hair) solid var(--line);border-radius:12px;background:var(--panel-2);overflow:hidden}
.tkqh{display:flex;align-items:center;gap:8px;padding:9px 12px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)}
.tkqh .n{margin-left:auto;color:var(--accent);font-variant-numeric:tabular-nums}
.tkr{display:flex;align-items:center;gap:10px;width:100%;min-height:56px;padding:8px 12px;border-top:var(--hair) solid var(--line);text-align:left;transition:background var(--fast) var(--ease)}
.tkr:hover{background:var(--accent-2)}
.tkr:active{background:var(--accent-2)}
.tkth{width:30px;aspect-ratio:9/16;border-radius:5px;overflow:hidden;background:#000;flex:none}
.tkth img{width:100%;height:100%;object-fit:cover;display:block}
.tkt{min-width:0;flex:1;font-size:13.5px;line-height:1.35;overflow-wrap:anywhere;color:var(--ink)}
.tkt .cid{margin-right:6px}
.tkd{font-size:12px;color:var(--dim);white-space:nowrap}
/* the cover a post's video shows before it plays (iOS paints the first video frame over a poster attribute) */
.vcover{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;pointer-events:none;display:block}
.pmedia .vcover{object-fit:cover}
.player.vbad .vcover{display:none}
"""

JS = (here / "kit.js").read_text() + r"""
/* ── TikTok posting kit in Studio ─────────────────────────────────────────
   Inbox-mode uploads cannot set caption, cover, location or the AI label, so each draft is finished by hand in the
   TikTok app. The kit (migration 20261020083000_studio_tiktok_kit) is the caption, hashtags, place and cover as
   tap-to-copy cards plus a checklist; "I posted it" flips the row to posted. Same module as bestly.tech/k/<code>. */
document.addEventListener("play", e => {      // a played video drops its cover; one capture listener covers every player
  const v = e.target;
  if(v && v.tagName === "VIDEO" && v.parentElement){ const c = v.parentElement.querySelector(":scope > .vcover"); if(c) c.remove(); }
}, true);
let TK_LIST = { kits: null, at: 0, busy: false };
function tkApi(it){
  return {
    load: () => rpc("studio_tiktok_kit", { p_token: TOKEN, p_item: it.id }),
    check: (post, key, on) => rpc("studio_tiktok_kit_check", { p_token: TOKEN, p_post: post, p_key: key, p_on: on }),
    posted: (post) => rpc("studio_tiktok_kit_posted", { p_token: TOKEN, p_post: post }),
  };
}
function tkMountPanel(it){
  const old = document.getElementById("tkPanel"); if(old) old.remove();
  const wc = document.querySelector(".wcall"); if(!wc || !it || it.media_type !== "video" || !window.TKKit) return;
  const panel = document.createElement("div");
  panel.className = "panel tkpanel"; panel.id = "tkPanel"; panel.hidden = true;
  panel.innerHTML = `<div class="phead">Post to TikTok<span class="pn" id="tkPn"></span></div><div class="pbody"><div id="tkBody"></div></div>`;
  wc.insertBefore(panel, wc.firstChild);
  TKKit.mount(panel.querySelector("#tkBody"), tkApi(it), {
    onKit: k => { panel.hidden = false; const pn = panel.querySelector("#tkPn"); if(pn) pn.textContent = k.status === "posted" ? "posted" : k.status === "in_drafts" ? "in your drafts" : "uploading"; },
    onEmpty: () => panel.remove(),
    onPosted: () => { TK_LIST.at = 0; tkFetchList(); syncSoon(); },
  });
}
function tkFetchList(){
  if(TK_LIST.busy || !TOKEN) return;
  TK_LIST.busy = true;
  rpc("studio_tiktok_kits", { p_token: TOKEN }).then(r => {
    TK_LIST.kits = (r && r.ok && r.kits) || []; TK_LIST.at = Date.now();
  }).catch(() => { TK_LIST.at = Date.now(); }).finally(() => { TK_LIST.busy = false; tkPaintList(true); });
}
function tkPaintList(fromFetch){
  const list = $("list"); if(!list || !BOARD) return;
  const old = list.querySelector(".tkq"); if(old) old.remove();
  if(!fromFetch && (!TK_LIST.kits || Date.now() - TK_LIST.at > 25000)) tkFetchList();
  const mine = new Set((BOARD.items || []).filter(i => i.client_slug === CLIENT).map(i => i.id));
  const kits = (TK_LIST.kits || []).filter(k => k.status === "in_drafts" && mine.has(k.item));
  if(!kits.length) return;
  const head = list.querySelector(".lhead"); if(!head) return;
  const box = document.createElement("div");
  box.className = "tkq"; box.setAttribute("role", "group"); box.setAttribute("aria-label", "TikTok drafts to finish");
  box.innerHTML = `<div class="tkqh"><span>TikTok drafts to finish</span><span class="n">${kits.length}</span></div>` +
    kits.map(k => `<button type="button" class="tkr" data-tk="${esc(k.item)}">
      <span class="tkth">${k.cover ? `<img src="${esc(k.cover)}" alt="" loading="lazy" decoding="async">` : ""}</span>
      <span class="tkt">${k.code ? `<b class="cid">${esc(k.code)}</b>` : ""}${esc(k.title || "A clip")}</span>
      <span class="tkd">${k.done}&nbsp;of&nbsp;${k.total || 5}&nbsp;done</span></button>`).join("");
  head.insertAdjacentElement("afterend", box);
  box.querySelectorAll("[data-tk]").forEach(b => b.onclick = () => {
    SEL = b.dataset.tk; paintQueue(); paintDetail(); mDetail(true);
  });
}
function vcover(u){ return u ? `<img class="vcover" src="${esc(u)}" alt="" decoding="async" draggable="false">` : ""; }
"""

# ── 1. the kit ────────────────────────────────────────────────────────────
once("</head>", f'<style id="tkkit-css">\n{CSS}\n</style>\n</head>', "css")
once("function paintQueue(){\n", JS + "\nfunction paintQueue(){\n", "js")
once("  wireAud(it);\n  wireWork(it, canAct);\n",
     "  wireAud(it);\n  wireWork(it, canAct);\n  try { tkMountPanel(it); } catch(e){}\n", "panel hook")
once("  wireStages(D, () => { const it = BOARD.items.find(i => i.id === SEL); return it ? stageOf(it) : null; });\n  restoreScroll();\n}",
     "  wireStages(D, () => { const it = BOARD.items.find(i => i.id === SEL); return it ? stageOf(it) : null; });\n  try { tkPaintList(); } catch(e){}\n  restoreScroll();\n}",
     "list hook")

# ── 2. the cover before play ──────────────────────────────────────────────
once('<video src="${esc(url)}#t=0.1" ${poster ? `poster="${esc(poster)}"` : ""} playsinline muted preload="metadata" tabindex="-1"></video>',
     '<video src="${esc(url)}${poster ? "" : "#t=0.1"}" ${poster ? `poster="${esc(poster)}"` : ""} playsinline muted preload="metadata" tabindex="-1"></video>${vcover(poster)}',
     "tap player")
once('<video src="${esc(url)}" ${poster ? `poster="${esc(poster)}"` : ""} playsinline preload="metadata"></video>\n  </div>${vbarHTML()}</div>`;',
     '<video src="${esc(url)}" ${poster ? `poster="${esc(poster)}"` : ""} playsinline preload="metadata"></video>${vcover(poster)}\n  </div>${vbarHTML()}</div>`;',
     "inline player")
once('return `<video class="pvid" src="${esc(it.media_url)}" ${it.thumb_url ? `poster="${esc(it.thumb_url)}"` : ""} playsinline preload="metadata"></video>\n',
     'return `<video class="pvid" src="${esc(it.media_url)}" ${it.thumb_url ? `poster="${esc(it.thumb_url)}"` : ""} playsinline preload="metadata"></video>${vcover(it.thumb_url)}\n',
     "phone preview")

# the full-screen theatre opens from a player: keep that player's cover until its first frame plays
once('<div class="vstage"><video src="${esc(url)}" autoplay playsinline webkit-playsinline preload="auto"></video>${vbarHTML()}</div>',
     '<div class="vstage"><video src="${esc(url)}" ${src && src.poster ? `poster="${esc(src.poster)}"` : ""} autoplay playsinline webkit-playsinline preload="auto"></video>${vbarHTML()}</div>',
     "theatre poster")

dst.write_text(html)
print(f"patched: {n_before} -> {len(html)} bytes, sha256 {hashlib.sha256(html.encode()).hexdigest()[:10]}")
