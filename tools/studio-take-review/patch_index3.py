"""Studio take decisions: the Queue's "Your call" on the newest take in Asks, plus a Production door.
Exact-once patch on the build that shipped Send back (index 72bba43e17).
Usage: python3 patch_index3.py index.live.html index.new.html
1. Asks detail, right column top: the SAME panel.decide / .dbtn markup the Queue uses for a post
   (Approve / Changes, on-state with "now", pnote underneath). Approve -> studio_take_approve (works for
   waiting, legacy, attached, already-approved). Changes -> focuses the Send back card. Undo approval while
   it is not being cut. Replaces the old per-take Approve / Send back buttons and the script sign-off panel
   once a recording is in (the script was signed off before it went out).
2. The ... menu on an ask with a take: "Approved (sign off)", "To review" (undo), "Needs changes" act on the take.
3. Production door in Asks (hidden while empty): Approved, waiting to be cut / Being cut / In Drafts.
(Spark, 2026-10-15; migration 20261015170000_studio_take_decisions.sql)"""
import sys
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:100]!r}"
    src = src.replace(old, new)

# ---- CSS --------------------------------------------------------------------------------
rep("@keyframes tkin{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}",
"""@keyframes tkin{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
/* take decisions: the Queue's own panel.decide / .dbtn, nothing restyled; only the undo and flash lines are new */
.panel.decide .pnote.tkflash2{color:var(--ok);font-weight:600}
.panel.decide .pnote .tkundo{display:block;margin-top:8px}
.panel.decide .phead .pn.tk{text-transform:none;letter-spacing:0;font-size:11.5px}
.row .prodl{font-size:12px;color:var(--faint)}""")

# ---- the Production door ------------------------------------------------------------------
rep("""  ["done",   "Done",        "Attached to a post, or closed"],
];""", """  ["done",   "Done",        "Attached to a post, or closed"],
  ["prod",   "Production",  "Approved takes: waiting to be cut, being cut, in Drafts", true],   // hideEmpty
];""")

rep("""  const groups = {
    ours:   [...(mdCards(["todo", "note"]).length""", """  /* Production: every approved take, by where it is in the cut. A take that is already in a post still
     waits to be cut until the editor files the cut (edit_done_at), so "In Drafts" means a cut exists. */
  const STALE = 3 * 3600e3, nowMs = Date.now();
  const prodAll = ASKS.flatMap(a => (a.uploads || []).filter(u => u.review_state === "approved" && (u.status === "transcoded" || u.status === "attached")).map(u => ({ a, u })));
  const claimedNow = u => u.edit_claimed_at && nowMs - new Date(u.edit_claimed_at).getTime() < STALE;
  const byApproved = (x, y) => String(x.u.reviewed_at || "").localeCompare(String(y.u.reviewed_at || ""));
  const pWait = prodAll.filter(({ u }) => !u.edit_done_at && !claimedNow(u)).sort(byApproved);
  const pCut  = prodAll.filter(({ u }) => !u.edit_done_at && claimedNow(u)).sort(byApproved);
  const pDraft = prodAll.filter(({ u }) => u.edit_done_at).sort((x, y) => String(y.u.edit_done_at).localeCompare(String(x.u.edit_done_at))).slice(0, 15);
  const prow = ({ a, u }, kind) => {
    const bits = [`Take ${u.take_no || ""}`.trim(), u.duration_s ? fmtClock(Number(u.duration_s)) : "",
      kind === "draft" ? "cut " + when(u.edit_done_at) : kind === "cut" ? "picked up " + when(u.edit_claimed_at) : "approved " + when(u.reviewed_at)].filter(Boolean);
    return `<div class="rw"><button class="row ${a.id === ASEL ? "sel" : ""}" data-ask="${a.id}">
      <h3>${esc(a.title)}</h3>
      <div class="meta"><span class="pill p-${kind === "draft" ? "attached" : "received"}">${kind === "draft" ? "in Drafts" : kind === "cut" ? "being cut" : "waiting to be cut"}</span><span class="prodl">${esc(bits.join(" · "))}</span></div>
    </button>${a.item_id ? `<button class="mv more" data-prodpost="${esc(a.item_id)}" aria-label="Open the post" title="Open the post${a.item_title ? ": " + esc(a.item_title) : ""}">&#8599;</button>` : ""}</div>`;
  };
  const groups = {
    prod:   [["Approved, waiting to be cut", pWait.map(x => prow(x, "wait"))], ["Being cut", pCut.map(x => prow(x, "cut"))], ["In Drafts", pDraft.map(x => prow(x, "draft"))]],
    ours:   [...(mdCards(["todo", "note"]).length""")

rep("""  $("list").querySelectorAll("[data-askmenu]").forEach(b => b.onclick = (e) => {""",
"""  $("list").querySelectorAll("[data-prodpost]").forEach(b => b.onclick = (e) => { e.stopPropagation(); SEL = b.dataset.prodpost; go("queue"); mDetail(true); });
  $("list").querySelectorAll("[data-askmenu]").forEach(b => b.onclick = (e) => {""")

# ---- the decision panel -------------------------------------------------------------------
rep("function askDecideHTML(a, canAct){", r"""/* The newest recording of an ask, when it can be decided (transcoded, or already in a post). */
function askCallTake(a){
  if(!a || a.kind === "comment" || a.status === "draft") return null;
  const u = (a.uploads || []).filter(x => !["pending", "failed", "removed"].includes(x.status))[0];   // newest first
  return u && (u.status === "transcoded" || u.status === "attached") ? u : null;
}
const takeClaimed = u => !!u.edit_claimed_at && Date.now() - new Date(u.edit_claimed_at).getTime() < 3 * 3600e3;
/* Your call, on a take. The Queue's panel for a post, word for word: Approve / Changes, the one you chose
   marked "now". Approve puts the take in Production; Changes is the note to her (Send back card below). */
function takeCallHTML(a, client, canAct){
  const u = askCallTake(a); if(!u) return "";
  const first = firstName(client.contact || client.name || "them");
  const n = u.take_no || (a.uploads || []).length || 1;
  const rs = u.review_state, appr = rs === "approved", back = rs === "sent_back", shut = a.status === "closed";
  const cutting = appr && !u.edit_done_at && takeClaimed(u);
  const ok = canAct && !shut;
  const state = back ? `Changes sent. Waiting on Take ${n + 1} from ${esc(first)}.`
    : appr ? (u.edit_done_at ? `Approved. The cut is ready${a.item_id ? ", in Drafts" : ""}.` : cutting ? "Approved. Being cut now." : "Approved. In Production, waiting to be cut.")
    : `Approve puts Take ${n} in Production to be cut${u.status === "attached" ? "; it is already in a post and the post stays as it is" : ""}. Changes is your note to ${esc(first)}.`;
  return `<div class="panel decide tkcall" id="tkCall"><div class="phead">Your call<span class="pn tk">Take ${esc(String(n))}</span></div>
    <div class="dsec">
      <button class="dbtn ok ${appr ? "on" : ""}" data-tkdo="approved" ${ok && !back ? "" : "disabled"} data-tip="${back ? "This take was already sent back." : "Approved. It goes to Production to be cut. The post is not touched."}">
        <i class="dot"></i><b>Approve</b>${appr ? `<span class="now">now</span>` : ""}</button>
      <button class="dbtn warn ${back ? "on" : ""}" data-tkdo="changes" ${ok ? "" : "disabled"} data-tip="Send it back to ${esc(first)} with a note. Opens the note below.">
        <i class="dot"></i><b>Changes</b>${back ? `<span class="now">now</span>` : ""}</button>
      ${TAKEFLASH[u.id] && !back && !appr ? `<div class="pnote tkflash2" role="status">${esc(TAKEFLASH[u.id])}</div>` : ""}
      <div class="pnote">${state}${appr && ok && !u.edit_done_at && !cutting ? `<button class="btn sm ghost tkundo" type="button" data-tkundo="${esc(u.id)}">Undo approval</button>` : ""}</div>
      ${!canAct ? `<div class="pnote">A producer approves or sends back a take.</div>` : ""}
    </div>
  </div>`;
}
function focusSendBack(){
  const t = $("tkBack"), c = $("sbCard"), el = t || c; if(!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" }); if(t) t.focus({ preventScroll: true });
}
function askDecideHTML(a, canAct){""")

rep("""<aside class="wright"><div class="wcall">${askDecideHTML(a, canAct)}</div>""",
    """<aside class="wright"><div class="wcall">${takeCallHTML(a, client, canAct) || askDecideHTML(a, canAct)}</div>""")

rep("""  d.querySelectorAll("[data-tkok]").forEach(b => b.onclick = () => takeApprove(a, b.dataset.tkok, b));""",
"""  d.querySelectorAll("[data-tkok]").forEach(b => b.onclick = () => takeApprove(a, b.dataset.tkok, b));
  d.querySelectorAll("[data-tkdo]").forEach(b => b.onclick = () => { const u = askCallTake(a); if(!u) return; if(b.dataset.tkdo === "approved") takeApprove(a, u.id, b); else focusSendBack(); });
  d.querySelectorAll("[data-tkundo]").forEach(b => b.onclick = () => takeUnapprove(a, b.dataset.tkundo, b));""")

# the old per-take buttons go: the decision lives in Your call now
old_act = """  const takeAct = u => {
    if(u.review_state !== "waiting" || u.status !== "transcoded") return "";
    return `<div class="tkrev tkact">${canAct ? `<div class="tkbtns"><button class="btn primary" data-tkok="${u.id}">Approve</button><button class="btn" data-tksend="${u.id}">Send back</button></div>`
      : `<div class="tkround">A producer approves or sends back a take.</div>`}${TAKEFLASH[u.id] ? "" : ""}</div>`;
  };"""
rep(old_act, """  const takeAct = u => "";   // Approve / Changes live in Your call (takeCallHTML)""")

rep("""  const takeState = u => u.status === "transcoded" && u.review_state === "waiting" ? "waiting for review"
    : u.status === "transcoded" && u.review_state === "approved" ? (u.edit_done_at ? "approved · cut is ready" : "approved · being cut")""",
"""  const takeState = u => u.status === "transcoded" && u.review_state === "waiting" ? "waiting for review"
    : (u.status === "transcoded" || u.status === "attached") && u.review_state === "approved" ? (u.edit_done_at ? "approved · cut is ready" : takeClaimed(u) ? "approved · being cut" : "approved · waiting to be cut")""")

# thread: the approved line shows only while the take IS approved (latest one), the flash moved into Your call
rep("""    const fl = TAKEFLASH[u.id] ? `<div class="tkflash" role="status">${esc(TAKEFLASH[u.id])}</div>` : "";
    const thread = (a.reviews || []).filter(r => r.upload_id === u.id && r.decision !== "rerecord").sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))""",
"""    const fl = "";
    const lastAppr = (a.reviews || []).filter(r => r.upload_id === u.id && r.decision === "approved").map(r => r.created_at).sort().pop();
    const thread = (a.reviews || []).filter(r => r.upload_id === u.id && r.decision !== "rerecord" && (r.decision !== "approved" || (u.review_state === "approved" && r.created_at === lastAppr))).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))""")

# ---- approve / undo -------------------------------------------------------------------------
rep("""    if(r && r.ok){ TAKEFLASH[id] = r.already ? "Already approved." : "Approved. Spark is cutting it; it will show up in Drafts."; await takeRefresh(); }""",
    """    if(r && r.ok){ TAKEFLASH[id] = r.already ? "Already approved." : "Approved. It is in Production, waiting to be cut."; await takeRefresh(); }""")
rep("""function takeSendBack(a, id){""", """async function takeUnapprove(a, id, btn){
  if(BUSY) return; BUSY = true; if(btn){ btn.disabled = true; btn.textContent = "…"; }
  try{
    const r = await rpc("studio_take_unapprove", { p_token: TOKEN, p_upload: id });
    if(r && r.ok){ TAKEFLASH[id] = "Approval undone. It is out of Production."; await takeRefresh(); }
    else { msg(human(r, "Didn't undo")); if(btn){ btn.disabled = false; btn.textContent = "Undo approval"; } }
  }catch(e){ msg("Didn't undo: " + e.message); if(btn){ btn.disabled = false; btn.textContent = "Undo approval"; } }
  finally{ BUSY = false; }
}
function takeSendBack(a, id){""")

# ---- the ... menu ---------------------------------------------------------------------------
rep("""  const now = isDraft ? (g ? (myCallOn(g) || "pending") : team) : "sent";""",
"""  const tk = askCallTake(a), tkRs = tk && tk.review_state;       // a recording is in: this menu is about that take
  const tkOk = !!tk && canAct && st !== "closed";
  const tkUndo = tkOk && tkRs === "approved" && !tk.edit_done_at && !takeClaimed(tk);
  const now = tk ? (tkRs === "approved" ? "approved" : tkRs === "sent_back" ? "changes" : "pending")
    : isDraft ? (g ? (myCallOn(g) || "pending") : team) : "sent";""")
rep("""    <div class="lbl">Drafts</div>
    ${opt("pending",  "To review",     canAct && movable, mvWhy, "askmove")}
    ${opt("approved", isDraft ? "Approved" : "Approved (sign off)", canAct && movable, mvWhy, "askmove")}
    <div class="lbl">Set aside</div>
    ${opt("changes",  "Needs changes", canAct && movable, mvWhy, "askmove")}
    ${opt("killed",   "Killed",        canAct && movable, mvWhy, "askmove")}
    ${!isDraft && movable ?""",
"""    <div class="lbl">${tk ? "Take " + esc(String(tk.take_no || "")) : "Drafts"}</div>
    ${tk ? opt("pending",  "To review", tkUndo, tkRs === "approved" ? "The editor already has it" : "Not approved yet", "tkmove")
         : opt("pending",  "To review",     canAct && movable, mvWhy, "askmove")}
    ${tk ? opt("approved", "Approved (sign off)", tkOk && tkRs !== "sent_back", tkRs === "sent_back" ? "Already sent back" : "", "tkmove")
         : opt("approved", isDraft ? "Approved" : "Approved (sign off)", canAct && movable, mvWhy, "askmove")}
    <div class="lbl">Set aside</div>
    ${tk ? opt("changes",  "Needs changes", tkOk, "", "tkmove")
         : opt("changes",  "Needs changes", canAct && movable, mvWhy, "askmove")}
    ${tk ? opt("killed",   "Killed",        false, "Close the ask instead", "tkmove")
         : opt("killed",   "Killed",        canAct && movable, mvWhy, "askmove")}
    ${tk ? `<div class="why">Approve sends this take to Production. Needs changes opens the note to them.</div>` : ""}
    ${!tk && !isDraft && movable ?""")
rep("""  el.querySelectorAll("[data-askmove]").forEach(b => b.onclick = () => { const what = b.dataset.askmove; closeMove(); askDecide(a, what); });""",
"""  el.querySelectorAll("[data-askmove]").forEach(b => b.onclick = () => { const what = b.dataset.askmove; closeMove(); askDecide(a, what); });
  el.querySelectorAll("[data-tkmove]").forEach(b => b.onclick = () => {
    const what = b.dataset.tkmove; closeMove();
    if(what === "approved") return takeApprove(a, tk.id, null);
    if(what === "pending") return takeUnapprove(a, tk.id, null);
    if(ASEL !== a.id){ ASEL = a.id; paintAskQueue(); paintAskDetail(); mDetail(true); }
    setTimeout(focusSendBack, 60);
  });""")

open(sys.argv[2], "w", encoding="utf-8").write(src)
print("ok", len(src))
