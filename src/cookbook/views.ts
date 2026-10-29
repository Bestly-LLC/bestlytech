// Family Cookbook: the screens (sign in, home, Needs a look, Recently Deleted, check a card) and what their buttons do.
// Rendering is plain strings into #view; clicks are caught once on the document (data-act) and routed to ACT.

import { $, $$, IC, addDays, appIcon, clock, DAY, deep, esc, fd, ic, lineify, nowrapDom, nowrapify, nwx, words } from "./dom";
import { ApiError, fn as _fn, forgetPhotos, getToken, hydratePhotos, plainError, rpc, setToken, startSignIn } from "./api";
import { ACT, FORM, S, hooks, resetState, type Cap, type Photo, type Row } from "./state";
import { PEOPLE, appTitle, bookTitle, canSeeId, manifestFor, otherReviewers, type Role } from "./people";
import { acceptAll, finishedDoc, ingLine, parseAmountText, plainName, replaceWord, rt, setCtx, unsureList } from "./text";
import { closeSheet, hideToast, openSheet, toast } from "./ui";
import { isReviewer, loadAll, loadCaps, loadDeleted, loadRows, loadReview, fetchRec, startPolling, stopPolling } from "./data";
import { V_recipe, recipeMounted, recipeLeft, closeCook, renderTimers } from "./recipe";
import { closeCam, openCam, paintCam, resend } from "./camera";
import { CATS, hueOf, photoHtml, thumbHtml } from "./pics";
import { qStatus } from "./pics";

/* ===== small pieces ===== */
const av = (id: Role, sm?: boolean) => '<span class="av' + (sm ? " sm" : "") + '" aria-hidden="true">' + PEOPLE[id].ini + "</span>";
function bar(left: string, mid?: string, right?: string) {
  return '<div class="bar">' + left + '<span class="mid">' + (mid || "") + "</span>" + (right || '<span style="width:48px" aria-hidden="true"></span>') + "</div>";
}
const backBtn = (label: string) => '<button class="back" data-act="back">' + ic("left") + "<span>" + esc(label) + "</span></button>";
const daysLeft = (r: Row) => Math.max(0, Math.ceil((new Date(r.deletedAt as string).getTime() + 30 * DAY - Date.now()) / DAY));

/* ===== sign in ===== */
function V_signin() {
  return '<div class="page signin enter">' + appIcon(92)
    + '<h1 id="h1" class="book" tabindex="-1">Family Cookbook</h1>'
    + '<p class="lead">Our family\'s recipe cards, kept safe. Only family can open it.</p>'
    + '<button class="hero-btn" data-act="signin"' + (S.busy ? " disabled" : "") + ">" + ic("lock") + "<span>" + (S.busy ? "One moment" : "Sign in with Bestly Cloud") + "</span></button>"
    + '<p class="msg" id="signin-msg" role="alert"' + (S.msg ? "" : " hidden") + ">" + esc(S.msg) + "</p>"
    + '<p class="fine">Use your own Bestly Cloud account. After that, this phone stays signed in.</p>'
    + '<details class="more first"><summary><span>First time here?</span>' + ic("down", 22) + '</summary><div class="inner"><p>Jared sent you a note with your username and how to choose a password. You only do that once.</p><p>Having trouble? Ask Jared.</p></div></details></div>';
}

/* ===== home ===== */
function waitingHtml() {
  const Q = S.caps;
  if (!Q.length) return "";
  const ready = Q.filter((q) => q.status === "ready").length;
  return '<div class="waiting"><div class="sech tight"><h2>Your new cards</h2><span>' + (ready ? ready + " ready to check" : "Reading") + "</span></div>"
    + Q.map((q) => capRow(q)).join("") + "</div>";
}
const capTitle = (q: Cap) => (q.status === "ready" && q.draft ? q.draft.title : "Card " + (S.capN[q.id] || ""));
function capRow(q: Cap) {
  const thumb = thumbHtml({ title: capTitle(q), photos: q.photos }, q.id, q.localUrl);
  const text = '<span class="q-t"><b>' + esc(capTitle(q)) + "</b>" + qStatus(q) + "</span>";
  if (q.status === "ready") return '<button class="qrow" data-act="qcheck" data-id="' + q.id + '">' + thumb + text + '<span class="tbtn" aria-hidden="true"><span class="lbl">Check</span>' + ic("right", 20) + "</span></button>";
  if (q.status === "failed" || (q.tmp && q.error)) {
    return '<div class="qrow">' + thumb + text + '<span class="qact"><button class="tbtn" data-act="qretry" data-id="' + q.id + '">Try again</button><button class="tbtn quiet" data-act="qdrop" data-id="' + q.id + '" aria-label="Remove this card">' + ic("x", 20) + "</button></span></div>";
  }
  return '<div class="qrow">' + thumb + text + "<span></span></div>";
}
function V_home() {
  const u = S.me!;
  const nReview = S.review.length;
  return '<div class="page home enter"><div class="home-top"><span></span>'
    + '<button class="avbtn" data-act="menu" aria-haspopup="dialog">' + av(u.id) + "<span>Menu</span></button></div>"
    + '<h1 id="h1" class="book" tabindex="-1">' + esc(bookTitle(u)) + "</h1>"
    + '<p class="sub">Our family\'s recipes, in one place.</p>'
    + '<button class="hero-btn" data-act="snap">' + ic("camera") + "<span>Take a picture of a recipe card</span></button>"
    + '<div id="needs">' + needsHtml(nReview) + "</div>"
    + '<div id="waiting">' + waitingHtml() + "</div>"
    + '<div id="loadmsg">' + loadMsgHtml() + "</div>"
    + '<div class="search">' + ic("search") + '<label class="sr" for="q">Search recipes</label><input id="q" type="search" placeholder="Search recipes" value="' + esc(S.q) + '" autocomplete="off" enterkeyhint="search">'
    + '<button class="clear" data-act="clearq" aria-label="Clear search"' + (S.q ? "" : " hidden") + ">" + ic("x", 22) + "</button></div>"
    + '<div class="sech"><h2>Recipes</h2><span id="count"></span></div><div class="grid" id="list" role="list"></div></div>';
}
const needsHtml = (n: number) => (isReviewer() && n > 0 ? '<button class="needs" data-act="review"><span>Needs a look</span><span class="count">' + n + "</span>" + ic("right", 22) + "</button>" : "");
const loadMsgHtml = () => (S.loadErr ? '<div class="banner">' + ic("eye") + "<div>" + esc(S.loadErr) + '<div class="mt"><button class="btn slim" data-act="reload">Try again</button></div></div></div>' : "");

function rcard(r: Row) {
  return '<button class="rcard" role="listitem" data-act="open" data-id="' + r.id + '" aria-label="Open ' + esc(r.title) + '">' + thumbHtml(r)
    + '<span class="rc-body"><span class="rc-title">' + esc(r.title) + '</span><span class="rc-by">' + av(r.by, true) + "<span>Added by " + esc(PEOPLE[r.by].name) + "</span></span>"
    + '<span class="rc-date">' + nwx(fd(r.added)) + "</span>"
    + (r.status === "review" ? '<span class="tag warn">' + ic("eye") + "Being checked</span>" : "") + "</span></button>";
}
export function paintList() {
  const l = $("#list");
  if (!l) return;
  const q = S.q.trim().toLowerCase();
  const list = S.rows.filter((r) => !q || r.hay.indexOf(q) >= 0);
  $("#count").textContent = list.length + " " + (list.length === 1 ? "recipe" : "recipes");
  l.innerHTML = list.length
    ? list.map(rcard).join("")
    : q
      ? '<div class="empty wide">' + ic("search") + '<h3>No recipes match "' + esc(S.q.trim()) + '"</h3><p>Try a shorter word, like "bread".</p><button class="btn" data-act="clearq">Clear search</button></div>'
      : '<div class="empty wide">' + ic("camera") + "<h3>No recipes yet</h3><p>Take a picture of your first recipe card. We type it up for you.</p></div>";
  nowrapDom($("#count").parentNode);
  nowrapDom(l);
  hydratePhotos(l);
}
/** Called after any list changed (new data from the server, a card finished). */
export function refreshHome() {
  if (S.view === "home") {
    const w = $("#waiting"), n = $("#needs"), m = $("#loadmsg");
    if (w) { w.innerHTML = waitingHtml(); nowrapDom(w); hydratePhotos(w); }
    if (n) n.innerHTML = needsHtml(S.review.length);
    if (m) m.innerHTML = loadMsgHtml();
    paintList();
  }
  if (S.cam) paintCam();
}

/* ===== Needs a look ===== */
function V_review() {
  const l = S.review;
  return '<div class="page enter">' + bar(backBtn("Cookbook"), "")
    + '<div class="pagehead"><h1 id="h1" tabindex="-1">Needs a look</h1><p class="lead">Cards someone asked another person to check.</p></div>'
    + (l.length
      ? '<div class="list">' + l.map((r) => {
        const n = unsureList(r.doc).length, p = PEOPLE[(r.flaggedBy || r.by) as Role];
        return '<button class="rrow" data-act="open-review" data-id="' + r.id + '">' + thumbHtml(r) + '<span class="body"><b class="rc-title">' + esc(r.title) + "</b>"
          + '<span class="rc-by">' + av(p.id, true) + "<span>Flagged by " + esc(p.name) + (r.flaggedAt ? ", " + nwx(fd(r.flaggedAt)) : "") + "</span></span>"
          + '<span class="tag warn">' + ic("eye") + words(n) + " to check</span>"
          + (r.closer ? '<span class="hint">A closer look was needed to read this one.</span>' : "") + "</span></button>";
      }).join("") + "</div>"
      : '<div class="empty">' + ic("check") + '<h3>Nothing to check</h3><p>When someone taps "Someone else check this", the card shows up here.</p><button class="btn primary" data-act="back">Back to the cookbook</button></div>')
    + "</div>";
}

/* ===== Recently Deleted ===== */
function V_deleted() {
  const l = S.deleted;
  return '<div class="page enter">' + bar(backBtn("Cookbook"), "")
    + '<div class="pagehead"><h1 id="h1" tabindex="-1">Recently Deleted</h1><p class="lead">Deleted recipes stay here for 30 days, card photo included. Anyone who could see one can bring it back.</p></div>'
    + (l.length
      ? '<div class="list">' + l.map((r) => {
        const p = PEOPLE[(r.deletedBy || r.by) as Role], dl = daysLeft(r);
        return '<div class="dl">' + thumbHtml(r) + '<div class="body"><b class="rc-title">' + esc(r.title) + "</b>"
          + '<span class="rc-by">' + av(p.id, true) + "<span>Deleted by " + esc(p.name) + " on " + nwx(fd(r.deletedAt)) + "</span></span>"
          + '<span class="tag warn">' + ic("clock") + dl + " " + (dl === 1 ? "day" : "days") + " left</span>"
          + '<span class="hint">Deleted for good on ' + nwx(fd(addDays(new Date(r.deletedAt as string), 30))) + "</span></div>"
          + '<div class="actions"><button class="btn primary block" data-act="restore" data-id="' + r.id + '">' + ic("restore", 22) + "Restore</button></div></div>";
      }).join("") + "</div>"
      : '<div class="empty">' + ic("trash") + "<h3>Nothing here</h3><p>Deleted recipes show up here for 30 days.</p></div>")
    + "</div>";
}

/* ===== check a card ===== */
export function curCheck(): any {
  const v = S.vp;
  if (v.kind === "queue") {
    const cap = S.caps.find((c) => c.id === v.id);
    if (!cap || cap.status !== "ready" || !cap.draft) return null;
    const d = S.drafts[cap.id] || (S.drafts[cap.id] = { doc: deep(cap.draft), note: "" });
    return { r: d.doc, d, mode: "new", cap, by: S.me!.id, photos: cap.photos, capId: cap.id, flaggedBy: null, flaggedAt: null };
  }
  const row = S.review.find((x) => x.id === v.id);
  if (!row) return null;
  const k = "r" + row.id;
  const d = S.drafts[k] || (S.drafts[k] = { doc: deep(row.doc), note: row.note || "" });
  return { r: d.doc, d, mode: "review", row, by: row.by, photos: row.photos, capId: undefined, flaggedBy: row.flaggedBy, flaggedAt: row.flaggedAt };
}
function typedCheck(r: any) {
  const ul = unsureList(r);
  let h = '<h2 class="hdr-r">' + esc(r.title) + "</h2>";
  h += ul.length
    ? '<div class="uchips" id="uchips"><p><b>' + words(ul.length) + ' to check.</b> Yellow words might be wrong. Tap one to fix it.</p><div class="row">'
      + ul.map((u) => '<button class="chip u2" data-act="fix" data-uid="' + u.uid + '"><span>' + esc(u.label) + "</span></button>").join("") + "</div></div>"
    : '<div class="uchips clear-ok">' + ic("check") + "<span>Every word looks right.</span></div>";
  h += '<div><h3 class="sec-h">What you need</h3><ul class="ing">' + r.ingredients.map((i: any) => "<li>" + ingLine(r, i, 1, "check") + "</li>").join("") + "</ul></div>";
  h += '<div><h3 class="sec-h">How to make it</h3><ol class="steps">' + r.steps.map((s: any, i: number) => {
    const o = rt(r, s.text, 1, "check");
    return '<li class="step"><span class="snum" aria-hidden="true">' + (i + 1) + "</span><div><h4>" + esc(s.title) + "</h4><p>" + o.html + "</p>" + o.notes.map((n) => '<p class="stnote">' + n + "</p>").join("") + "</div></li>";
  }).join("") + "</ol></div>";
  return h;
}
function V_check() {
  const c = curCheck();
  if (!c) return V_home();
  const r = c.r, review = c.mode === "review";
  const others = otherReviewers(c.by as Role).filter((id) => id !== S.me!.id || review);
  return '<div class="page enter">' + bar(backBtn(review ? "Needs a look" : "Cookbook"), "")
    + '<div class="pagehead tight"><h1 id="h1" tabindex="-1">Check this card</h1><p class="lead">'
    + (review ? "Flagged by " + esc(PEOPLE[(c.flaggedBy || c.by) as Role].name) + (c.flaggedAt ? ", " + nwx(fd(c.flaggedAt)) : "") + "." : "We typed this up from your photo. Look it over.") + "</p></div>"
    + '<div class="check">' + (c.photos && c.photos.length ? '<section class="panel-card" aria-label="Card photo">' + photoHtml(c.photos, c.capId, r.title) + "</section>" : "")
    + '<section class="panel-typed"><div class="card-surface" id="typed">' + typedCheck(r) + "</div>"
    + '<div class="field"><label for="note">A short note (optional)</label><input id="note" type="text" maxlength="80" placeholder="Grandma\'s Thanksgiving stuffing" value="' + esc(c.d.note) + '" autocomplete="off"></div>'
    + '<div class="acts">'
    + (review ? '<button class="btn primary big block" data-act="approve">' + ic("check") + "Approve</button>" : '<button class="btn primary big block" data-act="looks">' + ic("check") + "Looks right</button>")
    + '<button class="btn big block" data-act="fix-next">' + ic("pencil") + "Fix a word</button>"
    + (review ? '<button class="btn ghost block" data-act="back">Leave it for later</button>'
      : (others.length ? '<button class="btn big block" data-act="flag">' + ic("people") + "Someone else check this</button>" : "")
        + '<button class="btn ghost block" data-act="qdrop-here">Throw this card away</button>')
    + "</div></section></div></div>";
}

const VIEWS: Record<string, () => string> = { signin: V_signin, home: V_home, review: V_review, deleted: V_deleted, check: V_check, recipe: V_recipe };

/* ===== render and navigate ===== */
export function render(enter?: boolean) {
  const v = $("#view");
  if (S.view !== "signin" && !S.me) S.view = "signin";
  if (S.view === "recipe" && !S.recs[S.vp.id as string]) { S.view = "home"; S.vp = {}; }
  if (S.view === "check" && !curCheck()) { S.view = "home"; S.vp = {}; }
  if (S.view !== "recipe") recipeLeft();
  v.innerHTML = VIEWS[S.view]();
  if (!enter) $$(".enter", v).forEach((x: Element) => x.classList.remove("enter"));
  nowrapDom(v);
  lineify(v);
  hydratePhotos(v);
  if (S.view === "home") paintList();
  if (S.view === "recipe") recipeMounted();
  syncChrome();
}
export function go(view: typeof S.view, vp?: typeof S.vp) {
  closeSheet(true);
  if (S.cook) closeCook();
  S.view = view; S.vp = vp || {};
  if (view === "recipe") { S.tab = "recipe"; S.side = "front"; S.zoom = false; S.ingOpen = false; S.viewBatch = 1; }
  if (view === "check") { S.side = "front"; S.zoom = false; }
  render(true);
  window.scrollTo(0, 0);
  const h = $("#h1");
  if (h) h.focus({ preventScroll: true });
}
function paintTyped() { const c = curCheck(); if (!c) return; const t = $("#typed"); t.innerHTML = typedCheck(c.r); nowrapDom(t); }
export function paintPhoto() {
  let photos: Photo[] | undefined, capId: string | undefined, title = "";
  if (S.view === "check") { const c = curCheck(); if (!c) return; photos = c.photos; capId = c.capId; title = c.r.title; }
  else { const r = S.recs[S.vp.id as string]; if (!r) return; photos = r.photos; title = r.title; }
  const pc = $(".panel-card");
  if (!pc || !photos) return;
  pc.innerHTML = photoHtml(photos, capId, title);
  nowrapDom(pc);
  hydratePhotos(pc);
  const zb = $("#zoombox");
  if (zb && S.zoom) { zb.scrollLeft = zb.scrollWidth * 0.03; zb.scrollTop = zb.scrollHeight * 0.07; }
}

/** Name on the home screen, tab title and the manifest follow the person. */
export function syncChrome() {
  const t = appTitle(S.me);
  document.title = t;
  const m = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (m) m.setAttribute("content", t);
  const l = document.querySelector('link[rel="manifest"]');
  const href = manifestFor(S.me);
  if (l && l.getAttribute("href") !== href) l.setAttribute("href", href);
}

/* ===== sheets ===== */
function tipSheet() {
  const t = appTitle(S.me);
  return '<div class="center"><p class="eyebrow">One time only</p><h2>Keep your cookbook on your phone</h2>'
    + '<div class="tip-phone" aria-hidden="true">' + appIcon(76) + '<span class="lbl">' + esc(t) + "</span></div>"
    + '<p class="muted">This is how it will look on your Home Screen. It opens in one tap.</p>'
    + '<ol class="tip-steps"><li><span class="ico">' + ic("share", 26) + "</span><span>Tap the Share button.</span></li><li><span class=\"ico\">" + ic("addsq", 26) + '</span><span>Tap "Add to Home Screen".</span></li><li><span class="ico">' + ic("check", 26) + '</span><span>Tap "Add".</span></li></ol>'
    + '<button class="btn primary big" data-act="tip-ok" data-autofocus>Got it</button></div>';
}
function maybeTip() {
  const id = S.me!.id;
  const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || (navigator as any).standalone === true;
  if (standalone) return;
  try { if (localStorage.getItem("fc_tip_" + id)) return; localStorage.setItem("fc_tip_" + id, "1"); } catch { return; }
  openSheet(tipSheet(), "Add to Home Screen");
}

/* ===== fix a word ===== */
function openFix(uid: string) {
  const c = curCheck();
  if (!c) return;
  const r = c.r;
  const u = unsureList(r).find((x) => x.uid === uid);
  if (!u) return;
  let h: string;
  if (u.kind === "ing") {
    const noun = plainName(u.ing.name).split(",")[0];
    h = "<h2>How much " + esc(noun) + '?</h2><p class="muted">Look at the card photo. Which one matches?</p><div class="choices">'
      + u.ing.unsure.alts.map((a: any, i: number) => '<button class="choice" data-act="fix-pick" data-uid="' + uid + '" data-i="' + i + '"' + (i === 0 ? " data-autofocus" : "") + "><span>" + esc(a.label) + " " + esc(noun) + "</span>" + (i === 0 ? "<small>Our guess</small>" : "") + "</button>").join("") + "</div>";
  } else {
    setCtx(uid);
    let ctx = "";
    for (const s of r.steps) { if (s.text.indexOf("[[" + uid + "|") >= 0) { ctx = rt(r, s.text, 1, "ctx").html; break; } }
    if (!ctx) for (const i of r.ingredients) { if (i.name.indexOf("[[" + uid + "|") >= 0) { ctx = rt(r, i.name, 1, "ctx").html; break; } }
    setCtx(null);
    h = '<h2>Which word is right?</h2><div class="ctx">' + ctx + '</div><div class="choices">'
      + u.alts!.map((a, i) => '<button class="choice" data-act="fix-pick" data-uid="' + uid + '" data-i="' + i + '"' + (i === 0 ? " data-autofocus" : "") + "><span>" + nowrapify(a) + "</span>" + (i === 0 ? "<small>Our guess</small>" : "") + "</button>").join("") + "</div>";
  }
  h += '<form class="typeit" data-form="fixtype" data-uid="' + uid + '"><label class="sr" for="fixin">Type it yourself</label><input id="fixin" type="text" autocomplete="off" placeholder="Type it yourself"><button class="btn primary" type="submit">Use this</button></form>'
    + '<p id="fixerr" class="hint err" role="alert" hidden></p><button class="btn ghost block" data-act="close-sheet">Cancel</button>';
  openSheet(h, "Fix a word");
}
function applyFix(uid: string, val: any) {
  const c = curCheck();
  if (!c) return;
  const r = c.r;
  if (uid.indexOf("ing:") === 0) {
    const ing = r.ingredients.find((x: any) => x.id === uid.slice(4));
    ing.amount = val.amount; ing.unit = val.unit; delete ing.amount_max; ing.unsure.done = true;
  } else replaceWord(r, uid, val);
  closeSheet(); paintTyped(); toast("Fixed.");
}

/* ===== doing things ===== */
/** Run a server call from a button: the button is off until it answers, and a problem is said in plain words. */
async function working<T>(t: HTMLElement | null, job: () => Promise<T>): Promise<T | undefined> {
  if (S.busy) return undefined;
  S.busy = true;
  if (t) (t as HTMLButtonElement).disabled = true;
  try { return await job(); }
  catch (e: any) {
    if (e instanceof ApiError && e.code === "not_signed_in") { signOutLocal("You were signed out. Sign in again."); return undefined; }
    toast(plainError(e));
    return undefined;
  } finally { S.busy = false; if (t && document.contains(t)) (t as HTMLButtonElement).disabled = false; }
}

export function signOutLocal(msg = "") {
  stopPolling(); hideToast(); closeSheet(true); closeCam(); if (S.cook) closeCook(); S.timers = []; renderTimers();
  setToken(""); forgetPhotos(); resetState(); S.msg = msg;
  go("signin");
}

async function reloadLists() { await Promise.all([loadRows(), loadReview(), loadCaps()]); }

async function finishNew(t: HTMLElement, kind: "approved" | "review") {
  const c = curCheck();
  if (!c) return;
  const r = c.r;
  const doc = kind === "approved" ? finishedDoc(r) : deep(r);
  const note = c.d.note.trim();
  await working(t, async () => {
    const row = await rpc("family_capture_save", { p_id: c.cap.id, p_doc: doc, p_note: note, p_flag: kind === "review" });
    S.caps = S.caps.filter((x) => x.id !== c.cap.id);
    delete S.drafts[c.cap.id];
    await Promise.all([loadRows(), loadReview()]).catch(() => {});
    await fetchRec(String(row.id)).catch(() => {});
    if (S.recs[String(row.id)]) go("recipe", { id: String(row.id), from: "home" }); else go("home");
    const who = otherReviewers(S.me!.id).map((id) => PEOPLE[id].name).join(" and ");
    toast(kind === "approved" ? "Saved to " + bookTitle(S.me) + "." : "Sent. " + (who || "Someone") + " will take a look.");
  });
}

Object.assign(ACT, {
  async signin(t: HTMLElement) {
    if (S.busy) return;
    S.busy = true; S.msg = ""; render(false);
    try { location.assign(await startSignIn()); return; }
    catch (e: any) { S.msg = (e instanceof ApiError && e.message && /\s/.test(e.message)) ? e.message : "Sign-in is not available right now. Please try again in a few minutes."; }
    S.busy = false; render(false);
    const b = $("#signin-msg"); if (b) b.focus?.();
  },
  "close-sheet"() { closeSheet(); },
  scrim(t: HTMLElement, e: Event) { if (e.target === t) closeSheet(); },
  "tip-ok"() { closeSheet(); const h = $("#h1"); if (h) h.focus({ preventScroll: true }); },
  async menu() {
    await Promise.race([loadDeleted().catch(() => {}), new Promise((r) => setTimeout(r, 700))]);
    openSheet('<h2>' + esc(bookTitle(S.me)) + '</h2><p class="muted">Signed in as ' + esc(S.me!.name) + '.</p><div class="menu-list"><button class="btn" data-act="deleted" data-autofocus><span class="row">' + ic("trash", 22) + 'Recently Deleted</span><span class="cnt">' + S.deleted.length + '</span></button>'
      + '<button class="btn" data-act="signout"><span class="row">' + ic("out", 22) + "Sign out</span></button></div><button class=\"btn ghost block\" data-act=\"close-sheet\">Close</button>", "Menu");
  },
  async deleted() { closeSheet(true); await loadDeleted().catch(() => {}); go("deleted"); },
  async signout() {
    try { await rpc("family_logout"); } catch { /* the token is dropped here either way */ }
    signOutLocal();
  },
  async open(t: HTMLElement) {
    const id = t.dataset.id as string;
    await working(t, async () => { await fetchRec(id); go("recipe", { id, from: S.view, fromVp: S.vp }); });
  },
  back() { go((S.vp.from as any) || "home", S.vp.fromVp); },
  clearq() { S.q = ""; const i = $("#q"); if (i) { i.value = ""; i.focus(); } paintList(); const c = $(".search .clear"); if (c) c.hidden = true; },
  async review() { await loadReview().catch(() => {}); go("review"); },
  "open-review"(t: HTMLElement) { go("check", { kind: "recipe", id: t.dataset.id, from: S.view, fromVp: S.vp }); },
  snap() { openCam(); },
  qcheck(t: HTMLElement) { const id = t.dataset.id as string; closeCam(); go("check", { kind: "queue", id, from: "home" }); },
  async qretry(t: HTMLElement) {
    const c = S.caps.find((x) => x.id === t.dataset.id);
    if (!c) return;
    if (c.tmp) { resend(c); return; }
    await working(t, async () => { await rpc("family_capture_retry", { p_id: c.id }); c.status = "reading"; c.error = null; refreshHome(); });
  },
  async qdrop(t: HTMLElement) {
    const c = S.caps.find((x) => x.id === t.dataset.id);
    if (!c) return;
    if (c.tmp) { S.caps = S.caps.filter((x) => x !== c); refreshHome(); return; }
    await working(t, async () => { await rpc("family_capture_discard", { p_id: c.id }); S.caps = S.caps.filter((x) => x !== c); refreshHome(); });
  },
  "qdrop-here"(t: HTMLElement) {
    const c = curCheck();
    if (!c || !c.cap) return;
    openSheet('<h2>Throw this card away?</h2><p>The photo and the typed recipe are removed. You can take the picture again any time.</p><button class="btn danger big block" data-act="qdrop-yes" data-id="' + c.cap.id + '">' + ic("trash", 22) + 'Throw it away</button><button class="btn big block" data-act="close-sheet" data-autofocus>Keep it</button>', "Throw this card away");
  },
  async "qdrop-yes"(t: HTMLElement) {
    const id = t.dataset.id as string;
    await working(t, async () => { await rpc("family_capture_discard", { p_id: id }); S.caps = S.caps.filter((x) => x.id !== id); delete S.drafts[id]; closeSheet(true); go("home"); toast("Thrown away."); });
  },
  reload: async () => { await loadAll().catch(() => {}); refreshHome(); },
  tab(t: HTMLElement) { S.tab = t.dataset.tab as any; $("#rv").dataset.tab = S.tab; $$(".tabs button").forEach((b: HTMLElement) => b.setAttribute("aria-pressed", String(b.dataset.tab === S.tab))); },
  side(t: HTMLElement) { S.side = t.dataset.side as any; paintPhoto(); },
  zoom() { S.zoom = !S.zoom; paintPhoto(); },
  fix(t: HTMLElement) { openFix(t.dataset.uid as string); },
  "fix-next"() {
    const c = curCheck();
    if (!c) return;
    const l = unsureList(c.r);
    if (l.length) openFix(l[0].uid); else toast("Nothing is yellow. Tap any other word you want to change.");
  },
  "fix-pick"(t: HTMLElement) {
    const c = curCheck();
    const u = unsureList(c.r).find((x) => x.uid === t.dataset.uid);
    const i = +(t.dataset.i as string);
    if (u) applyFix(u.uid, u.kind === "ing" ? u.ing.unsure.alts[i] : u.alts![i]);
  },
  looks(t: HTMLElement) { finishNew(t, "approved"); },
  flag(t: HTMLElement) { finishNew(t, "review"); },
  async approve(t: HTMLElement) {
    const c = curCheck();
    if (!c || c.mode !== "review") return;
    const doc = finishedDoc(c.r), note = c.d.note.trim();
    await working(t, async () => {
      await rpc("family_approve", { p_id: Number(c.row.id), p_doc: doc, p_note: note });
      delete S.drafts["r" + c.row.id]; delete S.recs[c.row.id];
      await Promise.all([loadRows(), loadReview()]).catch(() => {});
      toast("Approved. It is out of the queue.");
      go("review");
    });
  },
  edit() {
    const r = S.recs[S.vp.id as string];
    openSheet('<h2>Edit recipe</h2><form class="field gap" data-form="edit"><div class="field"><label for="ed-title">Name</label><input id="ed-title" type="text" maxlength="120" value="' + esc(r.title) + '" data-autofocus></div>'
      + '<div class="field"><label for="ed-note">A short note (optional)</label><input id="ed-note" type="text" maxlength="80" value="' + esc(r.note || "") + '"></div>'
      + '<button class="btn primary big block" type="submit">Save</button><button class="btn ghost block" type="button" data-act="close-sheet">Cancel</button></form>', "Edit recipe");
  },
  del() {
    const r = S.recs[S.vp.id as string];
    openSheet("<h2>Delete \"" + esc(r.title) + "\"?</h2><p>It moves to Recently Deleted and stays there for " + nwx("30 days") + ". The card photo goes with it. You can bring it back until " + nwx(fd(addDays(new Date(), 30))) + ".</p>"
      + '<button class="btn danger big block" data-act="del-yes">' + ic("trash", 22) + 'Move to Recently Deleted</button><button class="btn big block" data-act="close-sheet" data-autofocus>Keep it</button>', "Delete recipe");
  },
  async "del-yes"(t: HTMLElement) {
    const id = S.vp.id as string;
    await working(t, async () => {
      await rpc("family_delete", { p_id: Number(id) });
      closeSheet(true);
      delete S.recs[id];
      await Promise.all([loadRows(), loadReview()]).catch(() => {});
      go("home");
      toast("Moved to Recently Deleted.", {
        label: "Undo", fn: async () => {
          try { await rpc("family_restore", { p_id: Number(id) }); await Promise.all([loadRows(), loadReview()]); if (S.view === "home") render(false); toast("Put back."); }
          catch (e) { toast(plainError(e)); }
        },
      });
    });
  },
  async restore(t: HTMLElement) {
    const id = t.dataset.id as string;
    await working(t, async () => {
      const r = S.deleted.find((x) => x.id === id);
      await rpc("family_restore", { p_id: Number(id) });
      await Promise.all([loadRows(), loadReview(), loadDeleted()]).catch(() => {});
      render(false);
      toast(r ? 'Restored. "' + r.title + '" is back in the cookbook.' : "Restored.");
    });
  },
});

Object.assign(FORM, {
  fixtype(f: HTMLElement) {
    const c = curCheck();
    const uid = f.dataset.uid as string, v = ($("#fixin").value as string).trim(), err = $("#fixerr");
    if (!c) return;
    if (!v) { err.textContent = "Type something first, or pick one above."; err.hidden = false; return; }
    if (uid.indexOf("ing:") === 0) {
      const ing = c.r.ingredients.find((x: any) => x.id === uid.slice(4));
      const a = parseAmountText(v, ing);
      if (!a) { err.textContent = "Try something like 2 cups or 1 1/2 tsp."; err.hidden = false; return; }
      applyFix(uid, a);
    } else applyFix(uid, v.replace(/[\[\]|{}]/g, ""));
  },
  async edit() {
    const r = S.recs[S.vp.id as string];
    const title = ($("#ed-title").value as string).trim(), note = ($("#ed-note").value as string).trim();
    if (!title) { toast("Give it a name first."); return; }
    await working(null, async () => {
      await rpc("family_edit", { p_id: Number(r.id), p_title: title, p_note: note });
      closeSheet(true);
      await Promise.all([loadRows(), loadReview()]).catch(() => {});
      await fetchRec(r.id);
      render(false);
      toast("Saved.");
    });
  },
});

/* ===== events ===== */
document.addEventListener("click", (e) => {
  const t = (e.target as Element).closest("[data-act]") as HTMLElement | null;
  if (!t) return;
  const a = ACT[t.dataset.act as string];
  if (a) a(t, e);
});
document.addEventListener("submit", (e) => {
  const f = (e.target as Element).closest("[data-form]") as HTMLElement | null;
  if (f) { e.preventDefault(); FORM[f.dataset.form as string](f); }
});
document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "q") { S.q = el.value; paintList(); const c = $(".search .clear"); if (c) c.hidden = !S.q; }
  if (el.id === "note") { const c = curCheck(); if (c) c.d.note = el.value; }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { if (S.sheetOpen) closeSheet(); else if (S.cook) closeCook(); else if (S.cam) closeCam(); }
  if ((e.key === "Enter" || e.key === " ") && (e.target as HTMLElement).id === "zoombox") { e.preventDefault(); ACT.zoom(e.target as HTMLElement, e); }
});

hooks.render = render;
hooks.go = go as any;
hooks.refreshHome = refreshHome;
hooks.closeCam = closeCam;
hooks.signOut = () => signOutLocal("You were signed out. Sign in again.");

/* ===== start ===== */
export async function enter(me: any) {
  S.me = { id: me.id, name: me.name, last: me.last, reviewer: !!me.reviewer, activeRoles: me.activeRoles };
  S.view = "home"; S.vp = {};
  await loadAll().catch((e: any) => { if (e && e.code === "not_signed_in") throw e; });
  startPolling();
  go("home");
  maybeTip();
}
export { loadCaps };
