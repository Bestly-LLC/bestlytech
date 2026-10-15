"""Studio send-back card + YouTube name: staff app (index.html). Exact-once patch on the live file.
Usage: python3 patch_index2.py index.live.html index.new.html
1. Asks detail: a separate "Send back to <first name>" card (right column, above the internal Notes panel,
   which is untouched). Required note, one Send back button, acts on the newest take (waiting, approved or
   legacy/attached), shows past to-client notes as a short history. The per-take Send back button now jumps to it.
2. Platform names: YouTube added to PWORDS, PL_NAME, PL_SHORT (it fell back to the raw key "youtube").
(Spark, 2026-10-15; plan docs/studio-take-review-opusplan.md, follow-up in bestly_memory studio/take-review-2026-10-15)"""
import sys
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:90]!r}"
    src = src.replace(old, new)

# ---- CSS: a card that reads as "to her", never as the internal thread -------------------
rep("@keyframes tkin{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}",
"""@keyframes tkin{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
/* ── send back to her: its own card, client blue, so it is never mistaken for the internal Notes ── */
.panel.sendback{border-color:var(--line-2);box-shadow:inset 3px 0 0 var(--client)}
.panel.sendback .phead{color:var(--client)}
.sbbody{padding:12px 14px 14px;display:grid;gap:10px}
.sbhelp{margin:0;font-size:12.5px;line-height:1.5;color:var(--dim)}
.sbbody label{font-size:12px;font-weight:600;color:var(--ink)}
.sbbody textarea{width:100%;min-height:96px;box-sizing:border-box;resize:vertical}
.sbfoot{display:flex;gap:10px 14px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.sbfoot .btn{min-height:44px;padding-inline:22px}
.sbtake{font-size:12px;line-height:1.45;color:var(--faint);flex:1 1 170px}
.sbstate{font-size:13px;line-height:1.5;color:var(--ink)}
.sbhist{border-top:var(--hair) solid var(--line);padding-top:10px;display:grid;gap:8px}
.sbh{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);font-weight:600}
.sbrow{font-size:12.5px;line-height:1.5;color:var(--dim);white-space:pre-wrap;padding-left:10px;border-left:2px solid var(--client)}
.sbrow b{color:var(--ink);font-weight:600}""")

# ---- platform names -------------------------------------------------------------------
rep("""const PWORDS = { instagram: "Instagram", facebook: "Facebook Page", tiktok: "TikTok", linkedin: "LinkedIn Page", pinterest: "Pinterest" };""",
    """const PWORDS = { instagram: "Instagram", facebook: "Facebook Page", tiktok: "TikTok", linkedin: "LinkedIn Page", pinterest: "Pinterest", youtube: "YouTube" };""")
rep("""const PL_NAME = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", pinterest: "Pinterest" };""",
    """const PL_NAME = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", linkedin: "LinkedIn", pinterest: "Pinterest", youtube: "YouTube" };""")
rep("""const PL_SHORT = { instagram: "IG", facebook: "FB", tiktok: "TT", linkedin: "LI", pinterest: "PIN" };""",
    """const PL_SHORT = { instagram: "IG", facebook: "FB", tiktok: "TT", linkedin: "LI", pinterest: "PIN", youtube: "YT" };""")

# ---- the card ---------------------------------------------------------------------------
rep("const TAKEFLASH = {};", r"""const TAKEFLASH = {};
/* The note meant for HER. Separate from the internal Notes panel on purpose: this one is on her board. */
function sendBackHTML(a, client, canAct){
  const takes = (a.uploads || []).filter(u => (u.take_no || u.review_state) && !["pending", "failed", "removed"].includes(u.status));
  if(!takes.length || a.kind === "comment") return "";
  const u = takes[0];                                   // studio_asks lists newest first
  const first = firstName(client.contact || client.name || "them");
  const sent = (a.reviews || []).filter(r => r.to_client && r.decision === "rerecord")
    .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
  const n = u.take_no || takes.length;
  const inPost = u.status === "attached";
  let body;
  if(a.status === "closed" || a.status === "draft") body = `<div class="sbstate">This ask is ${esc(a.status)}.</div>`;
  else if(u.review_state === "sent_back") body = `<div class="sbstate">${TAKEFLASH[u.id] ? `<b>${esc(TAKEFLASH[u.id])}</b>` : `Take ${esc(String(n))} is already sent back. Waiting on Take ${esc(String(n + 1))} from ${esc(first)}.`}</div>`;
  else if(!canAct) body = `<div class="sbstate">A producer sends takes back.</div>`;
  else body = `<label for="tkBack">Note for ${esc(first)}</label>
      <textarea class="f" id="tkBack" maxlength="2000" rows="4" placeholder="What should ${esc(first)} change or record again? Plain and specific."></textarea>
      <div class="sbfoot"><span class="sbtake">Goes with Take ${esc(String(n))}${inPost ? ". It is already in a post, and the post stays as it is." : "."}</span><button class="btn primary" id="tkBackGo" data-up="${esc(u.id)}">Send back</button></div>
      <div class="tkerr" id="tkBackErr" role="alert"></div>`;
  const hist = sent.length ? `<div class="sbhist"><div class="sbh">What ${esc(first)} was told</div>${sent.slice(0, 5).map(r =>
      `<div class="sbrow"><b>${esc(r.who || "Someone")}</b> · Take ${esc(String((takes.find(t => t.id === r.upload_id) || {}).take_no || ""))} · ${when(r.created_at)}<br>${esc(r.note || "")}</div>`).join("")}${sent.length > 5 ? `<div class="sbrow">${sent.length - 5} older not shown.</div>` : ""}</div>` : "";
  return `<div class="panel sendback" id="sbCard"><div class="phead">Send back to ${esc(first)}</div><div class="sbbody"><p class="sbhelp">${esc(first)} sees this on their board.</p>${body}${hist}</div></div>`;
}
function wireSendBack(a){
  const go = $("tkBackGo"); if(!go) return;
  go.onclick = async () => {
    const t = ($("tkBack").value || "").trim(), er = $("tkBackErr");
    if(t.length < 3){ er.textContent = "Write what she should change first."; $("tkBack").focus(); return; }
    if(BUSY) return; BUSY = true; go.disabled = true; go.textContent = "Sending…"; er.textContent = "";
    try{
      const id = go.dataset.up;
      const r = await rpc("studio_take_send_back", { p_token: TOKEN, p_upload: id, p_note: t });
      if(r && r.ok){ TAKEFLASH[id] = "Sent back. It is at the top of their board and in tomorrow's email."; BUSY = false; await takeRefresh(); return; }
      er.textContent = human(r, "Didn't send"); go.disabled = false; go.textContent = "Send back";
    }catch(e){ er.textContent = "Didn't send: " + e.message; go.disabled = false; go.textContent = "Send back"; }
    finally{ BUSY = false; }
  };
}""")

rep("""<aside class="wright"><div class="wcall">${askDecideHTML(a, canAct)}</div>${notesHTML(askNotes(a))}</aside>""",
    """<aside class="wright"><div class="wcall">${askDecideHTML(a, canAct)}</div>${sendBackHTML(a, client, canAct)}${notesHTML(askNotes(a))}</aside>""")
rep("""  wireAskNotes(a);
  const cfs = (send)""", """  wireAskNotes(a);
  wireSendBack(a);
  const cfs = (send)""")
# the per-take Send back now leads to the card
rep("""d.querySelectorAll("[data-tksend]").forEach(b => b.onclick = () => takeSendBack(a, b.dataset.tksend));""",
    """d.querySelectorAll("[data-tksend]").forEach(b => b.onclick = () => { const t = $("tkBack"); if(t){ t.scrollIntoView({ block: "center", behavior: "smooth" }); t.focus({ preventScroll: true }); } });""")
# past to-her notes live in the card, not under the take
rep("""const thread = (a.reviews || []).filter(r => r.upload_id === u.id).sort(""",
    """const thread = (a.reviews || []).filter(r => r.upload_id === u.id && r.decision !== "rerecord").sort(""")

open(sys.argv[2], "w", encoding="utf-8").write(src)
print("index patched", len(src))
