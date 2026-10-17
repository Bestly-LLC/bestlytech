"""Board: draw client_connect_tile's TikTok sandbox `pre` steps (+ one link button) and `trouble` Q/A (2026-10-17).
Tile jsonb shape (only while studio_flags.tt_production_approved is false):
  pre {steps[], link{url,label}, link_at}  -> steps go in front of the normal steps in ONE numbered list; the link button sits on step link_at
  trouble [{q,a}], trouble_title           -> the folded "Having trouble?" list for a platform that has no connect_platform_help prep
The tile and the to-do card both call connListHTML/connTailHTML/connStepsHTML, so they cannot differ.
Usage: python3 patch_board.py live.html new.html   (exact-once asserts)"""
import sys
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:90]!r}"
    src = src.replace(old, new)

rep('''function connStepsHTML(cn){
  const st = (cn.steps || []).map(s => `<li>${esc(s)}</li>`).join("");''',
'''function connPreLis(cn){
  const pre = cn && cn.pre;
  if(!pre || !Array.isArray(pre.steps)) return "";
  const lk = pre.link && /^https:\\/\\//i.test(pre.link.url || "") ? pre.link : null;
  return pre.steps.map((s, i) => {
    if(lk && i === pre.link_at) return `<li><a class="btn ghost cbtn" href="${esc(lk.url)}" target="_blank" rel="noopener" style="text-decoration:none;margin:0 0 6px">${esc(lk.label || "Open")}</a><span class="psub">${esc(s)}</span></li>`;
    return `<li>${esc(s)}</li>`;
  }).join("");
}
function connStepsHTML(cn){
  const st = connPreLis(cn) + (cn.steps || []).map(s => `<li>${esc(s)}</li>`).join("");''')
rep('''  return prep ? prepListHTML(prep) : "";
}
function connTailHTML(cn, prep, plat){
  if(!prep) return "";''',
'''  if(prep) return prepListHTML(prep);
  const pl = connPreLis(cn);
  return pl ? `<ol class="csteps">${pl}</ol>` : "";
}
function connTailHTML(cn, prep, plat){
  if(!prep){
    const tr = cn && Array.isArray(cn.trouble) ? cn.trouble : [];
    if(!tr.length) return "";
    if(cn.state === "waiting" && !(cn.stage !== "jared" && cn.action && cn.action.kind === "link")) return "";
    return troubleHTML({ trouble: tr, trouble_title: cn.trouble_title }, plat);
  }''')
open(sys.argv[2], "w", encoding="utf-8").write(src)
