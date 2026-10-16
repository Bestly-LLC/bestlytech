"""Reconnect pop-up on her board (board.html). Exact-once patch on the live file.
Usage: python3 patch_board.py board.live.html board.new.html
When a connected account needs her to reconnect, a modal that cannot be dismissed (no X, no backdrop tap, no Esc)
holds the screen until she reconnects (fresh link via client_social_connect_link, watched like the tile's Connect)
or ticks "We're no longer posting here" and confirms (client_social_stop_platform). One platform at a time.
The trigger is the rule client_posting_state already uses (accounts[].connected && needs_attention, or connect.state
'reconnect'); nothing new is decided on the client. Paused accounts, staff view-as (PEEK / viewer) and members are skipped.
(Claude, 2026-10-16)"""
import sys
src = open(sys.argv[1], encoding="utf-8").read()
def rep(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"expected {count} got {n} for: {old[:90]!r}"
    src = src.replace(old, new)

# 1. staff view-as must not run the stop RPC
rep('"client_social_connect_link", "client_social_disconnect"];', '"client_social_connect_link", "client_social_disconnect", "client_social_stop_platform"];')

# 2. repaint hooks: every place that refreshes ACCTS re-checks the pop-up
rep("""  const box = $("acctRows"); if(box){ box.innerHTML = accountRowsHTML(); wireAccounts(); }
}
let CONNECT_T = null;""", """  const box = $("acctRows"); if(box){ box.innerHTML = accountRowsHTML(); wireAccounts(); }
  rcCheck();
}
let CONNECT_T = null;""")
rep("""        const bx = $("acctRows"); if(bx){ bx.innerHTML = accountRowsHTML(); wireAccounts(); }
        toast(`${(ACCT_WORDS[p] || {}).name || p} connected""", """        const bx = $("acctRows"); if(bx){ bx.innerHTML = accountRowsHTML(); wireAccounts(); }
        rcCheck();
        toast(`${(ACCT_WORDS[p] || {}).name || p} connected""")
rep("""      ACCTS = r;
      const bx = $("acctRows"); if(bx){ bx.innerHTML = accountRowsHTML(); wireAccounts(); }
      (r.accounts || []).forEach(""", """      ACCTS = r;
      const bx = $("acctRows"); if(bx){ bx.innerHTML = accountRowsHTML(); wireAccounts(); }
      rcCheck();
      (r.accounts || []).forEach(""")
rep("a.connected, a.active])); }", "a.connected, a.active, a.needs_attention])); }")

# 3. the pop-up itself
CSS = r'''
.rcx{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;background:var(--scrim);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);overflow-y:auto;overscroll-behavior:contain;opacity:0;transition:opacity 240ms var(--ease)}
.rcx.on{opacity:1}
.rcn-card{width:100%;max-width:420px;margin:auto;box-sizing:border-box;background:var(--raise);color:var(--ink);border-radius:var(--r-card);box-shadow:var(--lift-lg);padding:26px 22px calc(22px + env(safe-area-inset-bottom));outline:0;transform:translateY(10px) scale(.97);transition:transform 340ms var(--ease)}
.rcx.on .rcn-card{transform:none}
.rcn-card.rcn-bump{animation:rcnudge 320ms var(--ease)}
@keyframes rcnudge{0%{transform:scale(1)}40%{transform:scale(1.018)}100%{transform:scale(1)}}
.rcn-card h2{margin:0 0 10px;font:600 24px/1.2 var(--ui, -apple-system,BlinkMacSystemFont,"SF Pro Display","Inter",sans-serif);letter-spacing:-.022em}
.rcn-card p{text-wrap:balance;margin:0 0 18px;font-size:16px;line-height:1.5;color:var(--ink-2)}
.rcn-s{display:inline-block}
.rcn-card .rcn-go{display:flex;width:100%;min-height:52px;justify-content:center;align-items:center;font-size:17px}
.rcn-card .rcn-link{display:block;margin:6px auto 0;min-height:44px;padding:0 14px;background:none;border:0;color:var(--accent);font-family:inherit;font-size:15px;font-weight:500;line-height:1;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.rcn-msg{min-height:20px;margin:6px 0 0;text-align:center;font-size:14px;line-height:1.4;color:var(--ink-2)}
.rcn-off{margin-top:14px;padding-top:12px;border-top:1px solid var(--rule)}
.rcn-chk{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 2px;cursor:pointer;font-size:15px;line-height:1.35;color:var(--ink)}
.rcn-chk input{flex:0 0 24px;width:24px;height:24px;margin:0;accent-color:var(--accent)}
.rcn-card .rcn-stop{display:flex;width:100%;min-height:48px;justify-content:center;align-items:center;margin-top:8px;font-size:16px}
.rcn-card .rcn-stop:disabled{opacity:.4;cursor:default}
body.rcn-open{overflow:hidden}
body.rcn-open .scrim{z-index:110}
body.rcn-open .sheet{z-index:111}
body.rcn-open #toast{z-index:130}
@media (prefers-reduced-motion:reduce){.rcx,.rcn-card{transition:none}.rcn-card{transform:none}.rcn-card.rcn-bump{animation:none}}
'''
JS = r'''/* ── Reconnect pop-up ───────────────────────────────────────────────────
   Same rule as the tile: an account that is connected but needs_attention (token expired or inside its
   warning window, or switched off), or whose connect state is "reconnect". It cannot be dismissed. She
   reconnects (modal closes by itself when the account is healthy again) or says "We're no longer posting
   here" and confirms, which turns that platform off for her. One platform at a time. (2026-10-16) */
(() => { const st = document.createElement("style"); st.textContent = `__CSS__`; document.head.appendChild(st); })();
let RC_PLAT = null, RC_T = null;
const RC_CADENCE = { linkedin: "LinkedIn signs you out every 2 months.", pinterest: "Pinterest signs you out every 2 months.", tiktok: "TikTok signs you out once a year." };
function rcNeeds(){
  if(!ACCTS || !ACCTS.ok || ACCTS.viewer || PEEK || !TOKEN || isMember()) return null;
  const list = ACCTS.accounts || [];
  for(const p of ["instagram", "facebook", "tiktok", "linkedin", "pinterest", "youtube"]){
    const a = list.find(x => x.platform === p);
    if(!a || a.paused) continue;
    if((a.connected && a.needs_attention) || (a.connect && a.connect.state === "reconnect")) return a;
  }
  return null;
}
function rcClose(){
  clearTimeout(RC_T);
  const m = $("rcModal"); if(m) m.remove();
  RC_PLAT = null; document.body.classList.remove("rcn-open");
}
function rcCheck(){
  if(!ACCTS || !ACCTS.ok) return;   // a failed fetch must not close or open anything
  const a = rcNeeds();
  if(!a){ if(RC_PLAT) rcClose(); return; }
  if(RC_PLAT === a.platform && $("rcModal")) return;
  rcClose(); rcOpen(a);
}
function rcOpen(a){
  const p = a.platform, name = PLATNAME[p] || (ACCT_WORDS[p] || {}).name || p;
  RC_PLAT = p;
  const m = document.createElement("div");
  m.id = "rcModal"; m.className = "rcx"; m.setAttribute("role", "alertdialog"); m.setAttribute("aria-modal", "true");
  m.setAttribute("aria-labelledby", "rcTitle"); m.setAttribute("aria-describedby", "rcBody");
  m.innerHTML = `<div class="rcn-card" tabindex="-1">
      <h2 id="rcTitle">Reconnect ${esc(name)}</h2>
      <p id="rcBody">${RC_CADENCE[p] ? `<span class="rcn-s">${esc(RC_CADENCE[p])}</span> ` : ""}<span class="rcn-s">Tap Reconnect to keep your approved posts going out.</span></p>
      <button type="button" class="btn send rcn-go" id="rcGo">Reconnect</button>
      <button type="button" class="rcn-link" id="rcAsk">Ask us to do it</button>
      <div class="rcn-msg" id="rcMsg" role="status" aria-live="polite"></div>
      <div class="rcn-off">
        <label class="rcn-chk"><input type="checkbox" id="rcChk"><span>We're no longer posting here</span></label>
        <button type="button" class="btn hold rcn-stop" id="rcStop" disabled>Turn off ${esc(name)}</button>
      </div>
    </div>`;
  document.body.appendChild(m); document.body.classList.add("rcn-open");
  requestAnimationFrame(() => requestAnimationFrame(() => m.classList.add("on")));
  const msg = t => { const e = $("rcMsg"); if(e) e.textContent = t || ""; };
  m.addEventListener("click", e => { if(e.target === m){ const c = m.querySelector(".rcn-card"); c.classList.remove("rcn-bump"); void c.offsetWidth; c.classList.add("rcn-bump"); } });
  $("rcChk").onchange = () => { $("rcStop").disabled = !$("rcChk").checked; };
  $("rcAsk").onclick = () => {
    openIdea();
    $("sheetTitle").textContent = "Ask us to do it";
    $("sheetSub").textContent = "Tell us what is stuck. We will sort it out with you.";
    const t = $("ideaBox"); if(t){ t.value = `Please help me reconnect ${name}.`; t.dispatchEvent(new Event("input", { bubbles: true })); }
  };
  $("rcGo").onclick = async () => {
    const b = $("rcGo"), was = b.textContent; b.disabled = true; b.textContent = "One moment…"; msg("");
    try{
      const r = await rpc("client_social_connect_link", { p_token: TOKEN, p_platform: p });
      if(r && r.peek){ msg("Viewing only. She reconnects this herself."); b.disabled = false; b.textContent = was; return; }
      if(!r || !r.ok || !r.url){ msg(r && r.error === "platform_not_ready" ? "Not ready yet. Tap Ask us to do it." : "Couldn't start that. Try again."); b.disabled = false; b.textContent = was; return; }
      const w = window.open(r.url, "_blank");
      if(!w){ window.location.href = r.url; return; }
      try{ w.opener = null; }catch{}
      b.textContent = "Finish in the other tab…"; msg("This closes by itself when you're connected.");
      watchConnect(p);
      RC_T = setTimeout(() => { const g = $("rcGo"); if(g){ g.disabled = false; g.textContent = "Open it again"; } }, 8000);
    }catch{ msg("Couldn't start that. Try again."); b.disabled = false; b.textContent = was; }
  };
  $("rcStop").onclick = async () => {
    const b = $("rcStop"); b.disabled = true; b.textContent = "One moment…"; msg("");
    try{
      const r = await rpc("client_social_stop_platform", { p_token: TOKEN, p_platform: p });
      if(r && (r.peek || r.error === "view_only")){ msg("Viewing only. Nothing changed."); b.disabled = false; b.textContent = `Turn off ${name}`; return; }
      if(r && r.ok){
        ACCTS = r; const bx = $("acctRows"); if(bx){ bx.innerHTML = accountRowsHTML(); wireAccounts(); }
        rcClose(); rcCheck();
        toast(`${name} is turned off. Nothing else goes out there.`, { ok: true });
        return;
      }
      msg("Couldn't turn that off. Try again."); b.disabled = false; b.textContent = `Turn off ${name}`;
    }catch{ msg("Couldn't turn that off. Try again."); b.disabled = false; b.textContent = `Turn off ${name}`; }
  };
  setTimeout(() => { const c = m.querySelector(".rcn-card"); if(c && !m.contains(document.activeElement)) $("rcGo").focus({ preventScroll: true }); }, 60);
}
/* No Esc, and Tab stays inside the card. While the idea sheet is open on top of it, Esc closes that sheet as usual. */
document.addEventListener("keydown", e => {
  if(!RC_PLAT || !$("rcModal")) return;
  if($("sheet").classList.contains("up")) return;
  if(e.key === "Escape"){ e.preventDefault(); e.stopImmediatePropagation(); return; }
  if(e.key === "Tab"){
    const f = [...$("rcModal").querySelectorAll("button:not([disabled]), input")].filter(x => x.offsetParent !== null);
    if(!f.length) return;
    const first = f[0], last = f[f.length - 1], cur = document.activeElement;
    if(!$("rcModal").contains(cur)){ e.preventDefault(); first.focus(); }
    else if(e.shiftKey && cur === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && cur === last){ e.preventDefault(); first.focus(); }
  }
}, true);

'''.replace("__CSS__", CSS.replace("\\", "\\\\").replace("`", "\\`"))
rep("/* Keep the Connect tiles and the to-do list in step with what really happened", JS + "/* Keep the Connect tiles and the to-do list in step with what really happened")
open(sys.argv[2], "w", encoding="utf-8").write(src)
print("board patched", len(src))
