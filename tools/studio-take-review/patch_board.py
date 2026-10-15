"""Studio take review: her board (board.html). Exact-once patch on the live file.
Usage: python3 patch_board.py board.live.html board.new.html
A sent-back ask (status 'redo') moves to the top under "Needs a re-record": our note, her last take,
the script again, one "Record again" button. (Spark, 2026-10-15; plan docs/studio-take-review-opusplan.md)"""
import sys
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:90]!r}"
    src = src.replace(old, new)

# ---- CSS ---------------------------------------------------------------
rep(".s2sec{margin:18px 0 8px;", """/* ── a take we sent back: the note leads, then her last take, the script, one button ── */
.redo{margin:0 0 18px;padding:18px 18px 16px;border-radius:18px;background:var(--raise);border:var(--hair) solid var(--rule);
  box-shadow:inset 3px 0 0 var(--accent)}
.redo .rt{margin:0 0 4px;font-size:17px;font-weight:600;line-height:1.3;color:var(--ink);letter-spacing:-.01em}
.redo .rl{margin:14px 0 6px;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;color:var(--faint);font-weight:600}
.redo .rnote{margin:0;font-size:19px;line-height:1.45;color:var(--ink);font-weight:500;white-space:pre-wrap;text-wrap:pretty;letter-spacing:-.005em}
.redo .rvid{background:#000;border-radius:16px;overflow:hidden;aspect-ratio:9/16;max-height:46dvh;margin:0 auto;max-width:260px}
.redo .rvid video{width:100%;height:100%;display:block;object-fit:contain;background:#000}
.redo .rscr{margin-top:6px}
.redo .rscr .tgt:first-child{margin-top:0}
.redo .btn.rec{width:100%;min-height:48px;margin-top:16px}
.rdmini{font-size:13px;color:var(--ink-3);margin:0 0 8px}
.s2sec{margin:18px 0 8px;""")

# ---- helpers -----------------------------------------------------------
rep("const MAX_TAKES = 6;", """const MAX_TAKES = 6;
const isRedo = a => a && a.status === "redo";
/* what the card shows, in the order she should read it */
function redoHTML(a, withScript){
  const r = a.redo || {}, t = r.last_take || {};
  const script = withScript ? scriptHTML(a).replace(/^\\s*<h2[^>]*>[\\s\\S]*?<\\/h2>/, "") : "";
  return `<section class="redo" data-redo="${esc(a.id)}">
      <h3 class="rt">${esc(a.title)}</h3>
      <div class="rl">Notes from the team</div>
      <p class="rnote">${esc(r.note || "Please record this one again.")}</p>
      ${t.url ? `<div class="rl">Your last take</div><div class="rvid"><video controls playsinline preload="none" poster="${esc(t.poster || "")}" src="${esc(t.url)}"></video></div>` : ""}
      ${script ? `<div class="rl">The script</div><div class="rscr">${script}</div>` : ""}
      <button class="btn rec" data-redorec="${esc(a.id)}">${ICON.cam} ${FILMS() ? "Record again" : "Upload again"}</button>
    </section>`;
}
function wireRedo(root){
  root.querySelectorAll("[data-redorec]").forEach(b => b.addEventListener("click", () => {
    const a = (ASKS || []).find(x => x.id === b.dataset.redorec); if(!a) return;
    openAsk(a);
    const f = $("askFile"); if(f) f.click();      // same tap: straight to her camera or file picker
  }));
}""")

# ---- home door + chips ---------------------------------------------------
rep("""  const open = (ASKS || []).filter(a => a.status === "open").length;
  const waiting = (BOARD.items || []).filter(i => i.status === "pending" && !withUs(i)).length;
  $("pickRev").classList.toggle("due", waiting > 0);
  $("pickRec").classList.toggle("due", open > 0);""",
"""  const open = (ASKS || []).filter(a => a.status === "open").length;
  const reN = (ASKS || []).filter(isRedo).length;
  const waiting = (BOARD.items || []).filter(i => i.status === "pending" && !withUs(i)).length;
  $("pickRev").classList.toggle("due", waiting > 0);
  $("pickRec").classList.toggle("due", open + reN > 0);""")
rep("""  const bits = [oFilm ? (oFilm === 1 ? "one to film" : oFilm + " to film") : "",""",
"""  const bits = [reN ? (reN === 1 ? "one to record again" : reN + " to record again") : "",
                oFilm ? (oFilm === 1 ? "one to film" : oFilm + " to film") : "",""")
rep("""  $("pickRecSub").textContent = !open ? ((ASKS || []).length ? "All sent" : "Nothing yet")""",
    """  $("pickRecSub").textContent = !(open + reN) ? ((ASKS || []).length ? "All sent" : "Nothing yet")""")
rep("""  $("hHead").textContent = (open || waiting || todos) ? "Here is what is waiting." : "You are all caught up.";""",
    """  $("hHead").textContent = (open || reN || waiting || todos) ? "Here is what is waiting." : "You are all caught up.";""")

# ---- the Record screen: "Needs a re-record" sits on top -------------------
rep("""function paintRecord(){
  const open = (ASKS || []).filter(a => a.status === "open");
  const rest = (ASKS || []).filter(a => a.status !== "open");""",
"""function paintRecord(){
  const redo = (ASKS || []).filter(isRedo);
  const open = (ASKS || []).filter(a => a.status === "open");
  const rest = (ASKS || []).filter(a => a.status !== "open" && !isRedo(a));""")
rep("""    `${open.length ? `<div class="s2sec">Waiting on you</div>${open.map(row).join("")}` : ""}
     ${!open.length ? `<div class="s2empty">""",
"""    `${redo.length ? `<div class="s2sec">Needs a re-record</div>${redo.map(a => redoHTML(a, true)).join("")}` : ""}
     ${open.length ? `<div class="s2sec">Waiting on you</div>${open.map(row).join("")}` : ""}
     ${!open.length && !redo.length ? `<div class="s2empty">""")
rep("""  $("recBody").querySelectorAll("[data-ask]").forEach(b => b.onclick = () => {
    const a = (ASKS || []).find(x => x.id === b.dataset.ask); if(a) openAsk(a);
  });
}""", """  $("recBody").querySelectorAll("[data-ask]").forEach(b => b.onclick = () => {
    const a = (ASKS || []).find(x => x.id === b.dataset.ask); if(a) openAsk(a);
  });
  wireRedo($("recBody"));
}""")

# ---- Record button on the header + whats-new strip -------------------------
rep("""  const open = ASKS.filter(a => a.status === "open").length;
  const b = $("askBtn");""", """  const open = ASKS.filter(a => a.status === "open" || isRedo(a)).length;
  const b = $("askBtn");""")
rep("""  const open = ASKS.filter(a => a.status === "open"), back = ASKS.filter(a => a.status === "attached" && a.item_id);
  const gLeft""", """  const open = ASKS.filter(a => a.status === "open"), back = ASKS.filter(a => a.status === "attached" && a.item_id);
  const redoL = ASKS.filter(isRedo);
  const gLeft""")
rep("""  if(back.length) parts.push(`<button class="quiet" id="wnBack">""", """  if(redoL.length) parts.push(`<button id="wnRedo">${ICON.cam} ${redoL.length === 1 ? "One take to record again" : redoL.length + " takes to record again"}</button>`);
  if(back.length) parts.push(`<button class="quiet" id="wnBack">""")
rep("""  const bk = $("wnBack"); if(bk)""", """  const rd = $("wnRedo"); if(rd) rd.onclick = () => (redoL.length === 1 ? openAsk(redoL[0]) : openAsks());
  const bk = $("wnBack"); if(bk)""")

# ---- Recordings list ----------------------------------------------------------
rep("""const WHAT = { open:["New","new"], received:["Sent","ok"], attached:["In a post","ok"] };""",
    """const WHAT = { open:["New","new"], redo:["Record again","new"], received:["Sent","ok"], attached:["In a post","ok"] };""")
rep("""  const open = ASKS.filter(a => a.status === "open"), rest = ASKS.filter(a => a.status !== "open");
  let html = "";
  if(open.length) html += `<div class="psec">To record</div>` + open.map(row).join("");""",
"""  const redoA = ASKS.filter(isRedo), open = ASKS.filter(a => a.status === "open"), rest = ASKS.filter(a => a.status !== "open" && !isRedo(a));
  let html = "";
  if(redoA.length) html += `<div class="psec">Needs a re-record</div>` + redoA.map(row).join("");
  if(open.length) html += `<div class="psec">To record</div>` + open.map(row).join("");""")
rep("""    open.length ? `${open.length} to record. Tap one to see the script.` : "Nothing waiting on you.", html);""",
    """    (open.length + redoA.length) ? `${open.length + redoA.length} to record. Tap one to see the script.` : "Nothing waiting on you.", html);""")

# ---- the ask sheet itself ------------------------------------------------------
rep("""    a.status !== "open" ? `<span class="tag date">Sent ${esc(ago(a.received_at || a.created_at))}</span>` : "",""",
    """    a.status !== "open" && !isRedo(a) ? `<span class="tag date">Sent ${esc(ago(a.received_at || a.created_at))}</span>` : "",""")
rep("""    body.innerHTML = stepsHTML("read")
      + (a.status === "attached" ?""", """    body.innerHTML = stepsHTML("read")
      + (isRedo(a) ? redoHTML(a, false).replace(/<button class="btn rec"[\\s\\S]*?<\\/button>/, "") : "")
      + (a.status === "attached" ?""")
rep("""            ? (a.status === "open" && !sent ? "Record" : "Record another take")
            : (a.status === "open" && !sent ? "Upload your video" : "Upload another take")}</button>`""",
    """            ? (isRedo(a) ? "Record again" : a.status === "open" && !sent ? "Record" : "Record another take")
            : (isRedo(a) ? "Upload again" : a.status === "open" && !sent ? "Upload your video" : "Upload another take")}</button>`""")
rep("""    a.status = a.status === "open" ? "received" : a.status; a.received_at""",
    """    a.status = (a.status === "open" || isRedo(a)) ? "received" : a.status; a.redo = null; a.received_at""")

open(sys.argv[2], "w", encoding="utf-8").write(src)
print("board patched", len(src))
