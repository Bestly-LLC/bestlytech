/* ── the Pipeline: one Queue for every project ───────────────────────────
   Jared, 6 Oct 2026: HOKU "keeps reverting to the older UI. Make it the same
   one Elizabeth uses, for everything in the studio."
   It used to have two Queues. A brand that publishes straight out of the
   social pipeline (HOKU, Cookie Yeti, InventoryProof) got a separate screen
   built from social_posts; every other repaint (the 4-second live check, a
   sync, a note arriving) painted the standard Queue over it, so the page
   flipped between the two and the brand's own posts under review vanished
   from the one it kept landing on. There is now ONE Queue for every project.
   What only a pipeline brand has — posts that go out on a schedule without a
   review cycle — is a card at the top of that Queue (same shape as Recut)
   which opens the schedule: what goes out next, how many days it lasts, what
   already landed, and anything that is wrong, with Hold / Release / Post now.
   It is read straight from social_posts, never copied, so it cannot disagree
   with what actually publishes. A project with no such posts shows no card. */
const curClient = () => CLIENTS.find(x => x.slug === CLIENT) || {};
const guideOnly = () => !!curClient().guide_only;
let PSEL = null;
const ppFirst = p => String(p.caption || p.hook || "").split("\n")[0].trim() || "No caption";
// the schedule matters where posts go out WITHOUT passing through the Queue as items
function pipeShown(){
  return !!(HOUSE && HOUSE.ok && HOUSE.client && HOUSE.client.slug === CLIENT && (HOUSE.posts || []).some(p => !p.item));
}
function pipeAttn(){
  const posts = (HOUSE && HOUSE.posts) || [], now = Date.now();
  return posts.filter(p => p.status === "failed" || p.status === "held" || (p.status === "queued" && hAt(p) < now - 1800000)).length;
}
function pipeLabel(){
  const b = document.getElementById("pipeOpen"); if(!b) return;
  const n = (HOUSE && HOUSE.counts) || {}, bad = pipeAttn();
  const rw = hRunway();
  const parts = [`${n.queued || 0} scheduled`];
  if(n.next_at) parts.push(`next ${hDay(n.next_at)} ${hTime(n.next_at)}`);
  if(!n.queued) parts.push("queue is empty");
  else { const d = Number(n.runway_days || 0); parts.push(`${d}\u00a0day${d === 1 ? "" : "s"} of posts`); }
  if(bad) parts.unshift(`${bad} need${bad === 1 ? "s" : ""} attention`);
  b.classList.toggle("warn", !!bad || rw.bad);
  b.querySelector(".t span").textContent = parts.join(" · ");
}
function pipeMount(){
  if(!BOARD || !CLIENT || TAB !== "queue") return;
  const head = document.querySelector("#list .lhead"); if(!head) return;
  const draw = () => {
    if(!pipeShown()) return;
    if(!document.getElementById("pipeOpen")){
      const h = document.querySelector("#list .lhead"); if(!h) return;
      const bar = document.createElement("div"); bar.className = "rc-bar pp-bar";
      bar.innerHTML = `<button class="rc-open pp-open" id="pipeOpen" type="button" aria-haspopup="dialog">${VICO.cal || VICO.cut}<span class="t"><b>Pipeline</b><span></span></span><span class="go">${VICO.next}</span></button>`;
      h.insertAdjacentElement("afterend", bar);
      bar.firstChild.onclick = pipeOpen;
    }
    pipeLabel();
  };
  draw();
  const slug = CLIENT;
  loadHouse().then(() => { if(slug === CLIENT && TAB === "queue") draw(); });
}
{ const _pq2 = paintQueue; paintQueue = function(){ const r = _pq2.apply(this, arguments); try { pipeMount(); } catch(e){ console.warn("pipeline", e); } return r; }; }

function ppRow(p){
  return `<button class="pp-row" type="button" data-pp="${esc(p.id)}">
    <span class="pp-th">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ""}</span>
    <span class="pp-tx"><b>${esc(ppFirst(p))}</b>
      <span class="pp-m">${hPill(p)}<span>${hDay(p.scheduled_at)} · ${hTime(p.scheduled_at)}</span><span>${hKind(p)}</span>${p.error ? `<span class="hp-stop">${esc(p.error.split(":")[0])}</span>` : ""}</span></span>
  </button>`;
}
function pipeListView(){
  const H = HOUSE, c = curClient(), a = H.account || {}, n = H.counts || {}, posts = H.posts || [];
  const now = Date.now(), week = now + 7 * 86400000, can = H.staff.can_promote;
  const queued = posts.filter(p => p.status === "queued" || p.status === "posting").sort((x, y) => hAt(x) - hAt(y));
  const upNext = queued.filter(p => hAt(p) <= week), runway = queued.filter(p => hAt(p) > week);
  const attention = posts.filter(p => p.status === "failed" || p.status === "held" || (p.status === "queued" && hAt(p) < now - 1800000));
  const posted = posts.filter(p => p.status === "posted").sort((x, y) => new Date(y.posted_at || y.scheduled_at) - new Date(x.posted_at || x.scheduled_at));
  const dr = hDrain(), rw = hRunway();
  const sec = (label, items, hint) => items.length
    ? `<div class="rc-h">${label} <span class="hn">${items.length}</span></div>${items.map(ppRow).join("")}`
    : (hint ? `<div class="rc-h">${label}</div><div class="rc-note">${hint}</div>` : "");
  const gridPosts = posts.filter(p => p.status !== "failed").sort((x, y) => hAt(y) - hAt(x)).slice(0, 9);
  const grid = gridPosts.length ? `<div class="hgrid" aria-label="Profile grid preview">${gridPosts.map(p =>
      `<button class="t ${p.status === "posted" ? "p" : "q"}" type="button" data-pp="${esc(p.id)}" aria-label="${esc(ppFirst(p))}">${p.cover ? `<img src="${esc(p.cover)}" alt="" loading="lazy">` : ""}<span class="d">${hDay(p.scheduled_at)}</span></button>`).join("")}</div>
    <div class="rc-note" style="margin-top:8px">The grid as a follower sees it, newest first. Faded tiles have not gone out yet.</div>` : "";
  return {
    title: `${c.name} pipeline`, cls: "vx wide",
    sub: `Posts the pipeline publishes on a schedule, straight from the social queue. Nothing here waits for a review.`,
    html: `<div class="vx-scroll">
      <div class="pp-stat"><span class="pill hp-${dr.k}">${dr.text}</span><span class="${rw.bad ? "hp-stop" : ""}">${esc(rw.text).replace(/(\d+) (days?)/, "$1\u00a0$2")}</span>${a.handle ? `<span class="mono">${esc(a.handle)}</span>` : ""}</div>
      <div class="pp-counts"><span><b>${n.queued || 0}</b> scheduled</span><span><b>${n.posted || 0}</b> posted</span>${n.held ? `<span><b>${n.held}</b> held</span>` : ""}${n.failed ? `<span><b>${n.failed}</b> failed</span>` : ""}</div>
      ${grid}
      ${sec("Attention", attention)}
      ${sec("Up next", upNext, "Nothing in the next seven days.")}
      ${sec("Runway", runway)}
      ${sec("Published", posted)}
      ${posts.length ? "" : `<div class="empty">Nothing has been queued for this project yet.</div>`}
    </div>`,
    actions: [
      ...(can ? [{ label: a.publishing_paused ? "Resume publishing" : "Pause publishing", kind: a.publishing_paused ? "primary" : "", grow: true, run: async (box, draw) => {
        const on = !a.publishing_paused;
        if(on && !confirm(`Pause everything for ${c.name}? Nothing publishes until you resume. Posts keep their times.`)) return "keep";
        const r = await rpc("studio_social_pause", { p_token: TOKEN, p_slug: CLIENT, p_on: on });
        if(!(r && r.ok)) { draw({ ...pipeListView(), sub: esc(human(r, "Didn't change it")) }); return "keep"; }
        await loadHouse(true); draw(pipeListView()); pipeLabel(); return "keep";
      } }] : []),
      { label: "Close" }],
    wire: (box, draw) => {
      box.querySelectorAll("[data-pp]").forEach(b => b.onclick = () => { PSEL = b.dataset.pp; draw(pipePostView()); const sc = box.querySelector(".vx-scroll"); if(sc) sc.scrollTop = 0; });
    }
  };
}
function pipePostView(){
  const H = HOUSE, p = (H.posts || []).find(x => x.id === PSEL);
  if(!p){ PSEL = null; return pipeListView(); }
  const c = curClient(), can = H.staff.can_promote;
  const urls = Array.isArray(p.media_urls) ? p.media_urls.filter(Boolean) : [];
  const late = p.status === "held" && hAt(p) <= new Date();
  const item = p.item && BOARD && BOARD.items.find(i => i.id === p.item);
  const back = { label: "Back", grow: true, run: async (box, draw) => { PSEL = null; draw(pipeListView()); return "keep"; } };
  const act = (label, kind, fn) => ({ label, kind, disabled: !can, run: async (box, draw) => {
    const r = await fn();
    if(r === null) return "keep";
    if(!(r && r.ok)){ draw({ ...pipePostView(), sub: esc(human(r, "Didn't do that")) }); return "keep"; }
    await loadHouse(true); pipeLabel(); draw({ ...pipePostView(), sub: "Done." }); return "keep";
  } });
  return {
    title: ppFirst(p), cls: "vx wide",
    sub: `${hPill(p)} <span>${esc(c.name)} · ${hKind(p)} · ${hDay(p.scheduled_at)} ${hTime(p.scheduled_at)}</span>${p.attempts ? ` <span class="mono">${p.attempts} attempt${p.attempts === 1 ? "" : "s"}</span>` : ""}`,
    html: `<div class="vx-scroll">
      ${p.type === "video"
        ? `<div class="pp-media">${playerHTML(urls[0] || "", "Reel", p.cover || "")}</div>`
        : urls.length ? `<div class="slides hslides">${urls.map((u, i) => `<a class="hslide" href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Slide ${i + 1}" loading="lazy">${urls.length > 1 ? `<span>${i + 1}/${urls.length}</span>` : ""}</a>`).join("")}</div>` : ""}
      ${p.error ? `<div class="rc-h">What went wrong</div><div class="box herr">${esc(p.error)}</div>` : ""}
      <div class="rc-h">Caption</div><div class="box cap">${esc(p.caption || "")}</div>
      <div class="rc-h">Where this came from</div>
      <div class="rc-note">${item ? `This is the approved post ${esc(item.code || "")} from the Queue, scheduled to go out.` : `Made by the ${esc(c.name)} pipeline and published by bestly-ig-poster from the social queue.`} ${p.status === "posted" ? "It is live." : "Nothing is sent until its time; Hold keeps it back."}</div>
      ${p.permalink ? `<p><a class="btn" href="${esc(p.permalink)}" target="_blank" rel="noopener">Open on Instagram ↗</a></p>` : ""}
      ${can ? "" : `<div class="rc-note">You can read this schedule but not move it.</div>`}
    </div>`,
    actions: [back,
      ...(item ? [{ label: "Open in the Queue", run: async () => { SEL = item.id; paintQueue(); paintDetail(); mDetail(true); } }] : []),
      ...(p.status === "queued" || p.status === "failed" ? [act("Hold", "", () => rpc("studio_social_hold", { p_token: TOKEN, p_post: p.id, p_on: true }))] : []),
      ...(p.status === "held" ? [act(late ? "Release · goes out on the next tick" : "Release", "primary", async () => {
        if(late && !confirm("Its time has passed, so releasing it publishes on the next drain tick (within five minutes). Go ahead?")) return null;
        return rpc("studio_social_hold", { p_token: TOKEN, p_post: p.id, p_on: false }); })] : []),
      ...(p.status === "queued" ? [act("Post now", "primary", async () => {
        if(!confirm(`Post "${ppFirst(p)}" to ${c.name}'s Instagram right now?`)) return null;
        return rpc("studio_social_post_now", { p_token: TOKEN, p_post: p.id }); })] : [])
    ],
    wire: () => {}
  };
}
async function pipeOpen(){
  await loadHouse(true);
  if(!HOUSE){ return sheet({ title: "The pipeline did not load", cls: "vx", sub: `Could not read this project's schedule${HOUSE_ERR ? ` (${esc(HOUSE_ERR)})` : ""}. Try again in a moment.`, html: "", actions: [{ label: "Close" }] }); }
  PSEL = null;
  sheet(pipeListView());
}
