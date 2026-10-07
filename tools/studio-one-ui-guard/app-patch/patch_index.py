import sys, re, hashlib
SP = __import__("os").path.dirname(__import__("os").path.abspath(__file__)) + "/.."
src = open(sys.argv[1], encoding="utf-8").read()
out_path = sys.argv[2]
s = src

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, f"anchor count {n} != {count}: {old[:90]!r}"
    s = s.replace(old, new)

# 1. one tab list, driven by data
rep('function isHouse(){ return houseClient().kind === "house"; }\n', '''// What a project has is DATA, not a second layout: a board that shows the brand
// guide only has no asks, list or calendar to fill; a house brand has an engine
// content bank. Every project gets the same Queue, post, Your call and notes.
const hasBank = () => houseClient().kind === "house";
''')
i = s.index('// tabs a house brand has: no asks')
j = s.index('async function loadHouse(){')
s = s[:i] + '''function tabs(){
  const c = houseClient(), go = !!c.guide_only;
  return TABS.filter(([k]) => k === "bank" ? hasBank()
    : go ? !["asks", "todos", "tuesday", "calendar"].includes(k)
    : (k !== "tuesday" || tuesdayShown()));
}
''' + s[j:]

# loadHouse with a short cache so repaints do not re-ask the server
rep('''async function loadHouse(){
  let r = null;
  try { r = await rpc("studio_house_board", { p_token: TOKEN, p_slug: CLIENT }); } catch(e){ r = { ok:false, error:e.message }; }
  HOUSE = (r && r.ok) ? r : null;
  if(!HOUSE) HOUSE_ERR = (r && r.error) || "unreachable";
  return HOUSE;
}''', '''let HOUSE_AT = 0, HOUSE_FOR = null;
async function loadHouse(force){
  const slug = CLIENT;
  // a project with no pipeline answers "not_house"; that answer is cached too, or every 4 s repaint would ask again
  if(!force && HOUSE_FOR === slug && Date.now() - HOUSE_AT < 45000) return HOUSE;
  let r = null;
  try { r = await rpc("studio_house_board", { p_token: TOKEN, p_slug: slug }); } catch(e){ r = { ok:false, error:e.message }; }
  if(slug !== CLIENT) return HOUSE;
  HOUSE = (r && r.ok) ? r : null;
  HOUSE_AT = Date.now(); HOUSE_FOR = slug;
  HOUSE_ERR = HOUSE ? null : ((r && r.error) || "unreachable");
  return HOUSE;
}''')

# 2. replace the second Queue (house list + house detail + paintHouse) with the Pipeline card
a = s.index('function paintHouseQueue(){')
b = s.index('/* ── the Library (house brands)')
pipe = open(SP + "/app-patch/pipe.js", encoding="utf-8").read()
s = s[:a] + pipe + "\n" + s[b:]

# 3. dispatch: one Queue
rep('''  if(TAB === "queue" && isHouse()){ await paintHouse(); }
  else if(TAB === "bank" && isHouse()){ await paintBank(); }
  else if(TAB === "queue"){''', '''  if(TAB === "bank" && hasBank()){ await paintBank(); }
  else if(TAB === "queue"){''')

# 4. buttons that only make sense when there is a board to send to
rep('if(!BOARD.staff || !BOARD.staff.can_promote || isHouse()) return "";', 'if(!BOARD.staff || !BOARD.staff.can_promote || guideOnly()) return "";', 2)
rep('if(!BOARD || !BOARD.staff || !BOARD.staff.can_promote || isHouse() || !CLIENT || TAB !== "queue") return;', 'if(!BOARD || !BOARD.staff || !BOARD.staff.can_promote || !CLIENT || TAB !== "queue") return;')

# 5. nothing is sent to a board that shows the guide only
rep('''  if(it.stage !== "internal") return "It is with the client.";
  const sign = SIGN(it)''', '''  if(it.stage !== "internal") return "It is with the client.";
  const gc = CLIENTS.find(x => x.slug === it.client_slug) || {};
  if(gc.guide_only) return "Their board shows the brand guide only, so there is nothing to send them.";
  const sign = SIGN(it)''')

# 6. forget the open pipeline post with the client
rep('SEL = null; ASEL = null; BRAND = null; ASKS = []; IDEAS = []; HSEL = null; HOUSE = null;', 'SEL = null; ASEL = null; BRAND = null; ASKS = []; IDEAS = []; HSEL = null; HOUSE = null; HOUSE_AT = 0; HOUSE_FOR = null; if(typeof PSEL !== "undefined") PSEL = null;')

# 7. the bank tab keeps its own name so two tabs are never both called Library
rep('["bank","Library"],["asks","Asks"]', '["bank","Bank"],["asks","Asks"]')

rep('  bank: "Everything made for this client — files, posts, the library.",', '  bank: "What the content engines have written, waiting to be approved, and what they have already queued.",')

rep("ICON.bank = ICON.library;", 'ICON.bank = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8l2-4h14l2 4"/><path d="M3 8h18v11a1 1 0 01-1 1H4a1 1 0 01-1-1z"/><path d="M9 12h6"/></svg>`;')

rep('<div class="lhead"><h2>Library</h2></div><div class="empty" style="margin:16px">Could not load the library for ${esc(c.name)}.</div>', '<div class="lhead"><h2>Bank</h2></div><div class="empty" style="margin:16px">Could not load the content bank for ${esc(c.name)}.</div>')
rep('<h2>Library<span class="hh">${hoku ? "HOKU engine" : "cards engine"}</span>', '<h2>Bank<span class="hh">${hoku ? "HOKU engine" : "cards engine"}</span>')

rep('${team !== "approved" ? `<div class="pnote">${sign', '${(CLIENTS.find(x => x.slug === it.client_slug) || {}).guide_only ? `<div class="pnote">Their board shows the brand guide only, so there is nothing to send them.</div>` : team !== "approved" ? `<div class="pnote">${sign')

# 8. css for the schedule sheet
css = '''
/* ── the Pipeline card and schedule (one Queue for every project) ─────── */
.pp-open.warn svg{color:var(--warn)}
.pp-row{min-height:44px}
.pp-row:focus-visible,.pp-open:focus-visible,.hgrid .t:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.pp-row,.pp-open{transition:none}.pp-row:active{transform:none}}
.pp-stat{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin:2px 0 6px;font-size:13px;color:var(--dim)}
.pp-counts{display:flex;flex-wrap:wrap;gap:4px 18px;margin:0 0 12px;font-size:13px;color:var(--dim);font-variant-numeric:tabular-nums}
.pp-counts b{font-size:20px;font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.pp-row{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;padding:10px 12px;margin:0 0 6px;border-radius:12px;
  background:var(--panel-2);border:var(--hair) solid var(--line);color:var(--ink);
  transition:background var(--fast) var(--ease),transform var(--fast) var(--ease)}
.pp-row:hover{background:var(--fill)}
.pp-row:active{transform:scale(.995)}
.pp-th{flex:0 0 48px;width:48px;aspect-ratio:3/4;border-radius:6px;overflow:hidden;background:var(--panel)}
.pp-th img{width:100%;height:100%;object-fit:cover;display:block}
.pp-tx{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}
.pp-tx b{font-size:14.5px;font-weight:600;line-height:1.35;letter-spacing:-.005em;overflow-wrap:anywhere;text-wrap:pretty}
.pp-m{display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;font-size:12.5px;color:var(--dim);font-variant-numeric:tabular-nums}
.pp-m span{white-space:nowrap}
.pp-media{max-width:360px;margin:0 0 6px}
.sheet.vx .hgrid{max-width:240px;margin-top:4px}
.sheet.vx .hgrid .t{border:0;cursor:pointer}
.sheet.vx .hslides{display:flex;gap:8px;overflow-x:auto;margin:0 0 6px}
.sheet.vx .hslide img{height:220px;width:auto;border-radius:8px;display:block}
.sheet.vx .box{margin:0 0 6px;white-space:pre-wrap;overflow-wrap:anywhere}
'''
rep('.bph{width:176px;aspect-ratio:4/5', css + '\n.bph{width:176px;aspect-ratio:4/5')

open(out_path, "w", encoding="utf-8").write(s)
h = hashlib.sha256(s.encode("utf-8")).hexdigest()[:10]
print("wrote", out_path, len(s.encode()), h)
