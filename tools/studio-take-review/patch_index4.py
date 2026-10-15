"""Studio: a post whose take was sent back is off the Queue (Jared, 2026-10-15).
Exact-once patch on the build that shipped take decisions (index 1b58a21a3b).
Usage: python3 patch_index4.py index.live.html index.new.html
The server (migration 20261015190000_studio_park_sent_back_posts.sql) already drops the post from studio_board /
studio_board_slim / studio_board_stamp / studio_seen_counts, so the Queue and its counts follow. This patch:
1. re-syncs the board and the counts after a send back / put back (takeRefresh), so the post leaves the Queue at once
2. Asks > Send back card: a quiet line "Post CY28 is off the Queue until the new take is approved." + "Put it back" (the undo)
3. hides the two links that would open the parked post (Asks header link, Production arrow)
(Spark, 2026-10-15)"""
import sys
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:100]!r}"
    src = src.replace(old, new)

rep(".sbstate{font-size:13px;line-height:1.5;color:var(--ink)}",
""".sbstate{font-size:13px;line-height:1.5;color:var(--ink)}
.sbpark{font-size:12.5px;line-height:1.5;color:var(--dim);display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center}
.sbpark .btn{min-height:32px}""")

rep("""  const hist = sent.length ? `<div class="sbhist">""",
"""  if(a.item_id && a.item_parked_at && a.status !== "closed" && a.status !== "draft") body += `<div class="sbpark" id="parkNote"><span>${esc(a.item_code ? "Post " + a.item_code : "The post")} is off the Queue until the new take is approved.</span>${canAct ? `<button class="btn sm ghost" type="button" data-putback="${esc(a.item_id)}">Put it back</button>` : ""}</div>`;
  const hist = sent.length ? `<div class="sbhist">""")

rep("""${inPost ? ". It is already in a post, and the post stays as it is." : "."}""",
    """${inPost ? ". It is already in a post. The post comes off the Queue until the new take is approved." : "."}""")

rep("""${a.item_id ? `<a href="#queue" data-goitem="${a.item_id}">""", """${a.item_id && !a.item_parked_at ? `<a href="#queue" data-goitem="${a.item_id}">""")
rep("""${a.item_id ? `<button class="mv more" data-prodpost=""", """${a.item_id && !a.item_parked_at ? `<button class="mv more" data-prodpost=""")

rep("""  await Promise.all([loadAsks(), reloadClients()]);
  paintNav(); paintAskQueue(); paintAskDetail();""",
"""  await Promise.all([loadAsks(), reloadClients(), syncBoard().catch(() => {}), newCountsLoad()]);
  paintNav(); paintAskQueue(); paintAskDetail();""")

rep("""function wireSendBack(a){
  const go = $("tkBackGo"); if(!go) return;""",
"""function wireSendBack(a){
  document.querySelectorAll("[data-putback]").forEach(b => b.onclick = async () => {
    if(BUSY) return; BUSY = true; b.disabled = true; b.textContent = "Putting back…";
    try{
      const r = await rpc("studio_post_put_back", { p_token: TOKEN, p_item: b.dataset.putback });
      if(r && r.ok){ BUSY = false; toast("Back on the Queue.", { ms: 3500 }); await takeRefresh(); return; }
      msg(human(r, "Didn't put it back")); b.disabled = false; b.textContent = "Put it back";
    }catch(e){ msg("Didn't put it back: " + e.message); b.disabled = false; b.textContent = "Put it back"; }
    finally{ BUSY = false; }
  });
  const go = $("tkBackGo"); if(!go) return;""")
open(sys.argv[2], "w", encoding="utf-8").write(src)
print("ok", len(src))
