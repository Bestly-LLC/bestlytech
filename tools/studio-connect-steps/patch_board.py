"""Board: a to-do with connect steps draws the SAME step list as the Settings tile (2026-10-16, Jared:
"make the instructions in settings the same as in the todos for the connections").
client_todos_board now returns t.connect = client_connect_tile(client, platform). This patch adds ONE list builder
(connListHTML / connTailHTML) that the tile AND the to-do card/sheet both call, so the words, order, conditional
YouTube step and "Having trouble?" items cannot drift. The to-do's own link button, title, due and tick are untouched.
Usage: python3 patch_board.py live.html new.html   (exact-once asserts)"""
import sys
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:90]!r}"
    src = src.replace(old, new)

# 1. tile uses the shared builders
rep('''      d = `<b class="chead">${esc(cn.headline || "")}</b>${withPrep ? (cn.text ? `<div class="d" style="margin-top:4px">${esc(cn.text)}</div>` : "") + prepListHTML(prep) : connStepsHTML(cn)}`;
      if(withPrep) tail = troubleHTML(prep, a.platform);''',
'''      d = `<b class="chead">${esc(cn.headline || "")}</b>${connListHTML(cn, prep)}`;
      tail = connTailHTML(cn, prep, a.platform);''')
rep('''else { d = w.why + (prep ? prepListHTML(prep) : ""); badge = `<span class="badge">Not started</span>`;''',
    '''else { d = w.why + connListHTML(cn, prep); badge = `<span class="badge">Not started</span>`;''')
rep('''btn = `<button class="btn send cbtn${prep ? " cbig" : ""}" data-connect="${a.platform}" style="margin-top:8px">Connect ${esc(w.name)}</button>`; if(prep) tail = troubleHTML(prep, a.platform); }''',
    '''btn = `<button class="btn send cbtn${prep ? " cbig" : ""}" data-connect="${a.platform}" style="margin-top:8px">Connect ${esc(w.name)}</button>`; tail = connTailHTML(cn, prep, a.platform); }''')

# 2. shared builders (after connStepsHTML)
rep('''function accountRowsHTML(){''', '''/* ONE place that decides what a not-yet-connected platform's steps and "Having trouble?" say. The Settings tile and
   the to-do card both call these with the same client_connect_tile jsonb, so they can never differ. (2026-10-16) */
function connListHTML(cn, prep){
  if(cn && cn.state === "waiting"){
    const her = cn.stage !== "jared", ac = cn.action;
    const withPrep = !!(prep && her && ac && ac.kind === "link");
    return withPrep ? (cn.text ? `<div class="d" style="margin-top:4px">${esc(cn.text)}</div>` : "") + prepListHTML(prep) : connStepsHTML(cn);
  }
  return prep ? prepListHTML(prep) : "";
}
function connTailHTML(cn, prep, plat){
  if(!prep) return "";
  if(cn && cn.state === "waiting"){
    const her = cn.stage !== "jared", ac = cn.action;
    return her && ac && ac.kind === "link" ? troubleHTML(prep, plat) : "";
  }
  return troubleHTML(prep, plat);
}
function connBlockHTML(t){
  const cn = t && t.connect;
  if(!cn || cn.state === "connected" || cn.state === "reconnect") return "";
  const prep = cn.prep && Array.isArray(cn.prep.steps) ? cn.prep : null;
  const head = cn.state === "waiting" ? `<b class="chead">${esc(cn.headline || "")}</b>` : "";
  const list = connListHTML(cn, prep);
  if(!list) return "";
  return `<div class="d cxb">${head}${list}${connTailHTML(cn, prep, t.connect_platform)}</div>`;
}
(() => { const st = document.createElement("style"); st.textContent = `.cxb{margin-top:6px}.cxb .chead{display:block;color:var(--ink);font-weight:600}.cxb .csteps{margin:8px 0 0 20px;padding:0;display:grid;gap:6px;font-size:14px;line-height:1.45}.cxb .phead{margin-top:12px}.cxb .pafter{margin-top:10px;font-size:14px;line-height:1.45;font-weight:600;color:var(--ink)}.cxb .psub{display:block;margin-top:3px;font-size:13px;line-height:1.45;color:var(--ink-3)}.cxb a{color:var(--accent);text-decoration:underline;text-underline-offset:2px;overflow-wrap:anywhere}.cxb .refdet.trouble{margin-top:10px}.cxb .tbody{display:grid;gap:12px;padding:12px 2px 2px;font-size:13.5px;line-height:1.5;color:var(--ink-2)}.cxb .tbody b{display:block;color:var(--ink);font-weight:600}.cxb .tbody .tshort{color:var(--ink-2)}.cxb .cbtn,.cxb .btn.ghost{display:inline-flex;width:auto;min-height:40px;padding:0 16px;font-size:15px;align-items:center}`; document.head.appendChild(st); })();
function wireConnAsk(root, t){
  root.querySelectorAll("[data-asku]").forEach(b => b.onclick = e => {
    e.stopPropagation();
    const note = (t && t.connect && t.connect.prep && t.connect.prep.ask_note) || "";
    openIdea();
    $("sheetTitle").textContent = "Ask us to do it";
    $("sheetSub").textContent = "Tell us what is stuck. We will sort it out with you.";
    const x = $("ideaBox"); if(x && note){ x.value = note; x.dispatchEvent(new Event("input", { bubbles: true })); }
  });
}
function accountRowsHTML(){''')

# 3. to-do card
rep('''    let fwd = "";
    if(t.status === "open"){
      if(t.next) fwd += `<div class="fwd"><b>Next</b> · ${esc(t.next)}</div>`;''', '''    let fwd = "";
    const blk = t.status === "open" ? connBlockHTML(t) : "";
    if(t.status === "open"){
      if(t.next && !blk) fwd += `<div class="fwd"><b>Next</b> · ${esc(t.next)}</div>`;''')
rep('''        ${t.detail ? `<div class="d">${esc(t.detail)}</div>` : ""}
        ${fwd}
        ${links}''', '''        ${blk || (t.detail ? `<div class="d">${esc(t.detail)}</div>` : "")}
        ${fwd}
        ${links}''')
rep('''  $("todoBody").querySelectorAll(".tlink").forEach(a => a.addEventListener("click", e => e.stopPropagation()));''',
'''  $("todoBody").querySelectorAll(".tlink").forEach(a => a.addEventListener("click", e => e.stopPropagation()));
  $("todoBody").querySelectorAll("[data-tdet]").forEach(g => wireConnAsk(g, (TODOS || []).find(x => x.id === g.dataset.tdet)));''')
rep('''if(e.target.closest && e.target.closest("a")) return; open(); };''', '''if(e.target.closest && e.target.closest("a, .cxb")) return; open(); };''')

# 4. to-do sheet
rep('''  $("sheetSub").textContent = done ? "Done — nothing left on this one."
    : (t.next || (t.from && t.from.label) || "From one of your calls.");
  $("sheetBody").innerHTML =
    (t.detail ? `<p class="sheetnote">${esc(t.detail)}</p>` : "") +''', '''  const blk = done ? "" : connBlockHTML(t);
  $("sheetSub").textContent = done ? "Done — nothing left on this one."
    : blk ? "Follow the steps below."
    : (t.next || (t.from && t.from.label) || "From one of your calls.");
  $("sheetBody").innerHTML =
    (blk || (t.detail ? `<p class="sheetnote">${esc(t.detail)}</p>` : "")) +''')
rep('''  $("sheetCancel").addEventListener("click", closeSheet);
  showSheet();

  if(!done){
    const inp = $("todoDue")''', '''  $("sheetCancel").addEventListener("click", closeSheet);
  showSheet();
  wireConnAsk($("sheetBody"), t);

  if(!done){
    const inp = $("todoDue")''')
# 5. a seeded to-do has no stored link yet: give it a way to the tile's Connect button
rep('''    const links = t.status === "done" ? "" : linksHTML(t);''', '''    const links = t.status === "done" ? "" : (linksHTML(t) || (blk ? SETLINK : ""));''')
rep('''    (done ? "" : linksHTML(t)) +''', '''    (done ? "" : (linksHTML(t) || (blk ? SETLINK : ""))) +''')
rep('''function wireConnAsk(root, t){''', '''const SETLINK = `<div class="tlinks"><a class="tlink" href="#settings">Open Settings<span class="ar">→</span></a></div>`;
function wireConnAsk(root, t){
  root.querySelectorAll('a[href="#settings"]').forEach(a => a.addEventListener("click", () => { if(root.id === "sheetBody") closeSheet(); }));''')
open(sys.argv[2], "w", encoding="utf-8").write(src)
print("board patched", len(src))
