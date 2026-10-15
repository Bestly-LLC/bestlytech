"""Studio take review: staff app (index.html). Exact-once patch on the live file.
Usage: python3 patch_index.py index.live.html index.new.html
Asks > "In from them": each take shows Approve / Send back, the script (collapsed) and the past rounds;
the old "Attach" is hidden until a take is approved. (Spark, 2026-10-15; docs/studio-take-review-opusplan.md)"""
import sys
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:90]!r}"
    src = src.replace(old, new)

# ---- CSS ---------------------------------------------------------------
rep(".p-changes,.p-open,.p-received{color:var(--warn);background:var(--warn-2)}",
    ".p-changes,.p-open,.p-received,.p-redo{color:var(--warn);background:var(--warn-2)}")
rep(".uprow .tkn{font-weight:600;", """/* ── take review: the buttons live on the take, next to the player ── */
.work.askw .uprow>.tkrev{grid-column:1/-1}
.tkrev{margin-top:2px;padding:8px 0 2px;display:grid;gap:10px}\n.tkrev.tkact{padding:10px 0 4px}
.tkrev .tkbtns{display:flex;gap:8px;flex-wrap:wrap}
.tkrev .tkbtns .btn{min-height:44px;padding-inline:18px}
.tkrev details{border:var(--hair) solid var(--line);border-radius:10px;background:var(--panel-2)}
.tkrev summary{cursor:pointer;padding:10px 12px;min-height:24px;font-size:12.5px;font-weight:600;color:var(--dim);list-style:none}
.tkrev summary::-webkit-details-marker{display:none}
.tkrev summary::after{content:"+";float:right;font-weight:400}
.tkrev details[open] summary::after{content:"\\2212"}
.tkrev details .beats{padding:0 12px 10px}
.tkrev .tkflash{font-size:13px;line-height:1.5;color:var(--ok);font-weight:600}
.tkrev .tkround{font-size:12.5px;line-height:1.5;color:var(--dim);white-space:pre-wrap}
.tkrev .tkround b{color:var(--ink);font-weight:600}
.tkrev .tkround.out{padding-left:10px;border-left:2px solid var(--warn)}
.tknote{width:100%;min-height:110px;box-sizing:border-box;resize:vertical}
.tkerr{color:var(--stop);font-size:12.5px;margin-top:8px;min-height:1em}
@media (prefers-reduced-motion:no-preference){ .tkrev .tkflash{animation:tkin .24s ease-out} }
@keyframes tkin{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
.uprow .tkn{font-weight:600;""")

# ---- door + status ------------------------------------------------------------
rep("""const askDoor = a => (a.status === "draft" || a.status === "received") ? "ours" : a.status === "open" ? "client" : "done";""",
    """const askDoor = a => (a.status === "draft" || a.status === "received") ? "ours" : (a.status === "open" || a.status === "redo") ? "client" : "done";
const askWaitingTakes = a => (a.uploads || []).filter(u => u.review_state === "waiting" && u.status === "transcoded").length;
const askStatWait = a => a.status === "received" && askWaitingTakes(a) ? "take to review" : null;""")
rep("""  const waiting  = ASKS.filter(a => a.status === "open");""", """  const waiting  = ASKS.filter(a => a.status === "open" || a.status === "redo");""")
rep("""const STAT = { open: "on their board", received: "recording in",""", """const STAT = { open: "on their board", redo: "sent back · waiting on a new take", received: "recording in",""")
rep("""${esc(a.status === "received" && a.kind === "comment" ? "their words in" : (STAT[a.status] || a.status))}""",
    """${esc(a.status === "received" && a.kind === "comment" ? "their words in" : (askStatWait(a) || STAT[a.status] || a.status))}""")
rep("""<div class="counts">${recorded.length ? `<span><b>${recorded.length}</b> in from ${esc(who1)}</span>` : ""}""",
    """<div class="counts">${recorded.length ? `<span><b>${recorded.length}</b> in from ${esc(who1)}</span>` : ""}${ASKS.reduce((n, a) => n + askWaitingTakes(a), 0) ? `<span style="color:var(--warn)"><b>${ASKS.reduce((n, a) => n + askWaitingTakes(a), 0)}</b> to review</span>` : ""}""")

# ---- the take row ---------------------------------------------------------------
rep("""const takeN = u => a.uploads.length > 1 ? `<b class="tkn">Take ${takeOrder.indexOf(u.id) + 1}</b> · ` : "";""",
    """const takeN = u => a.uploads.length > 1 || u.review_state ? `<b class="tkn">Take ${u.take_no || takeOrder.indexOf(u.id) + 1}</b> · ` : "";
  const RSV = { waiting: "waiting for review", sent_back: "sent back" };
  const takeState = u => u.status === "transcoded" && u.review_state === "waiting" ? "waiting for review"
    : u.status === "transcoded" && u.review_state === "approved" ? (u.edit_done_at ? "approved · cut is ready" : "approved · being cut")
    : u.review_state === "sent_back" ? "sent back · waiting on Take " + ((u.take_no || 0) + 1) : null;
  const unreviewed = u => u.review_state === "waiting" || u.review_state === "sent_back";
  const rounds = u => (a.reviews || []).filter(r => r.upload_id === u.id);
  const takeAct = u => {
    if(u.review_state !== "waiting" || u.status !== "transcoded") return "";
    return `<div class="tkrev tkact">${canAct ? `<div class="tkbtns"><button class="btn primary" data-tkok="${u.id}">Approve</button><button class="btn" data-tksend="${u.id}">Send back</button></div>`
      : `<div class="tkround">A producer approves or sends back a take.</div>`}${TAKEFLASH[u.id] ? "" : ""}</div>`;
  };
  const takeReviewHTML = u => {
    if(!u.review_state || u.review_state === "legacy") return "";
    const fl = TAKEFLASH[u.id] ? `<div class="tkflash" role="status">${esc(TAKEFLASH[u.id])}</div>` : "";
    const thread = (a.reviews || []).filter(r => r.upload_id === u.id).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))
      .map(r => r.decision === "rerecord"
        ? `<div class="tkround out"><b>${esc(r.who || "Someone")} sent Take ${esc(String(u.take_no || ""))} back</b> · ${when(r.created_at)}<br>${esc(r.note || "")}</div>`
        : `<div class="tkround"><b>${esc(r.who || "Someone")} approved Take ${esc(String(u.take_no || ""))}</b> · ${when(r.created_at)}</div>`).join("");
    const scr = u.review_state === "waiting" && (a.script || []).length
      ? `<details><summary>The script she was given</summary><div class="beats">${beatsHTML(a.script)}</div></details>` : "";
    return `<div class="tkrev">${fl}${scr}${thread}</div>`;
  };""")
rep("""const st = { ready:"uploaded · transcoding", transcoded:"ready to attach", attached:"attached to a post", failed:"transcode failed", stored:"stored" }[u.status] || u.status;""",
    """const st = takeState(u) || { ready:"uploaded · transcoding", transcoded:"ready to attach", attached:"attached to a post", failed:"transcode failed", stored:"stored" }[u.status] || u.status;""")
rep("""${u.status === "transcoded" && canAct ? `<button class="btn sm primary" data-attach""", """${u.status === "transcoded" && canAct && !unreviewed(u) ? `<button class="btn sm primary" data-attach""")
rep("""<div class="u2">${when(u.created_at)}${u.error ? " · " + esc(u.error) : ""}</div><div id="pl-${u.id}"></div></div>""",
    """<div class="u2">${when(u.created_at)}${u.error ? " · " + esc(u.error) : ""}</div>${takeAct(u)}<div id="pl-${u.id}"></div></div>""")
rep("""      </div></div>`;
  };
  d.innerHTML = `<h1>${esc(a.title)}</h1>""", """      </div>${takeReviewHTML(u)}</div>`;
  };
  d.innerHTML = `<h1>${esc(a.title)}</h1>""")
rep("""${a.uploads.length > 1 ? ` <span class="tkof">${a.uploads.length} takes · up to 3</span>` : ""}""",
    """${a.uploads.length > 1 ? ` <span class="tkof">${a.uploads.length} takes · up to 6</span>` : ""}""")

# ---- buttons that also apply to a sent-back ask ------------------------------------
rep("""${(a.status === "open" || a.status === "received") && canAct ? `<button class="btn" id="askPull" """,
    """${(a.status === "open" || a.status === "received" || a.status === "redo") && canAct ? `<button class="btn" id="askPull" """)
rep("""${(a.status === "open" || a.status === "received") && canAct ? `<button class="btn stop" id="askClose">""",
    """${(a.status === "open" || a.status === "received" || a.status === "redo") && canAct ? `<button class="btn stop" id="askClose">""")

# ---- wiring -------------------------------------------------------------------------
rep("""  d.querySelectorAll("[data-attach-to]").forEach(sel => sel.onchange = () => { if(sel.value) attach(sel.dataset.attachTo, sel.value); });""",
    """  d.querySelectorAll("[data-attach-to]").forEach(sel => sel.onchange = () => { if(sel.value) attach(sel.dataset.attachTo, sel.value); });
  d.querySelectorAll("[data-tkok]").forEach(b => b.onclick = () => takeApprove(a, b.dataset.tkok, b));
  d.querySelectorAll("[data-tksend]").forEach(b => b.onclick = () => takeSendBack(a, b.dataset.tksend));""")

rep("""async function attach(uploadId, itemId){""", """/* ── take review: approve it for the editor, or send it back with a note ────────── */
const TAKEFLASH = {};
async function takeRefresh(){
  await Promise.all([loadAsks(), reloadClients()]);
  paintNav(); paintAskQueue(); paintAskDetail();
}
async function takeApprove(a, id, btn){
  if(BUSY) return; BUSY = true; if(btn){ btn.disabled = true; btn.textContent = "…"; }
  try{
    const r = await rpc("studio_take_approve", { p_token: TOKEN, p_upload: id });
    if(r && r.ok){ TAKEFLASH[id] = r.already ? "Already approved." : "Approved. Spark is cutting it; it will show up in Drafts."; await takeRefresh(); }
    else { msg(human(r, "Didn't approve")); if(btn){ btn.disabled = false; btn.textContent = "Approve"; } }
  }catch(e){ msg("Didn't approve: " + e.message); if(btn){ btn.disabled = false; btn.textContent = "Approve"; } }
  finally{ BUSY = false; }
}
function takeSendBack(a, id){
  const u = (a.uploads || []).find(x => x.id === id); if(!u) return;
  const n = u.take_no || "";
  sheet({ title: `Send Take ${n} back`, sub: esc(a.title) + " — she sees this note at the top of her board and in tomorrow's email.",
    html: `<label class="field"><span>What should she change?</span><textarea class="f tknote" id="tkNote" maxlength="2000" placeholder="Plain and specific. She reads this before she films again."></textarea></label><div class="tkerr" id="tkErr" role="alert"></div>`,
    focus: "#tkNote",
    actions: [{ label: "Cancel" }, { label: "Send to her", kind: "primary", grow: true, run: async (box) => {
      const t = (box.querySelector("#tkNote").value || "").trim(), er = box.querySelector("#tkErr");
      if(t.length < 3){ er.textContent = "Write what she should change first."; return "keep"; }
      const r = await rpc("studio_take_send_back", { p_token: TOKEN, p_upload: id, p_note: t });
      if(!(r && r.ok)){ er.textContent = human(r, "Didn't send"); return "keep"; }
      TAKEFLASH[id] = r.already ? "Already sent back." : "Sent back. She'll see it at the top of her board and in tomorrow's email.";
      await takeRefresh();
    } }] });
}
async function attach(uploadId, itemId){""")

# ---- the review thread does not double as staff notes ---------------------------------
rep("""reviews: (a.reviews || []).map(r => ({""", """reviews: (a.reviews || []).filter(r => !r.upload_id).map(r => ({""")

open(sys.argv[2], "w", encoding="utf-8").write(src)
print("index patched", len(src))
