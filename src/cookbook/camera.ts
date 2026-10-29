// Family Cookbook: "Take a picture of a recipe card".
// A live camera view (back camera) with a frame to line the card up in, or "Choose a photo" when the camera is
// off-limits. Each shot is shrunk to about half a megabyte, sent in the background, and shows up in the tray while
// the card is read. Several cards can be taken in a row; the back of a card is a second shot on the same card.

import { $, $$, esc, ic, nowrapDom } from "./dom";
import { ApiError, plainError, setLocalPic, uploadPhoto, hydratePhotos } from "./api";
import { ACT, S, hooks, type Cap } from "./state";
import { loadCaps } from "./data";
import { shrink, type Source } from "./shrink";
import { thumbHtml, qStatus } from "./pics";
import { toast } from "./ui";

let stream: MediaStream | null = null;

function skeleton(): string {
  return '<div class="cam" role="dialog" aria-modal="true" aria-label="Take a picture of a recipe card">'
    + '<div class="cam-top"><button class="btn" data-act="snap-close">Done</button><span class="n" id="cam-n"></span></div>'
    + '<div class="cam-view"><video id="camvideo" playsinline muted autoplay></video>'
    + '<div class="guide" aria-hidden="true"><i></i><i></i><i></i><i></i></div>'
    + '<div class="cam-msg" id="cam-msg" role="status" hidden></div>'
    + '<div class="cam-label" id="cam-label"></div><div class="flash" id="cam-flash"></div></div>'
    + '<div class="cam-tips"><span>' + ic("flat") + "Lay it flat</span><span>" + ic("sun") + "Good light</span><span>" + ic("spark") + "No glare</span></div>"
    + '<div class="cam-ctl" id="cam-ctl"></div>'
    + '<div class="cam-tray" id="cam-tray" aria-label="Cards you have taken"></div>'
    + '<input id="cam-file" type="file" accept="image/*" hidden></div>';
}

const camCap = (id: string | null) => (id ? S.caps.find((c) => c.id === id) || null : null);

export function paintCam() {
  const c = S.cam;
  if (!c) return;
  const root = $("#l-cam .cam");
  if (!root) return;
  const back = camCap(c.backFor);
  const last = camCap(c.last);
  $("#cam-n").textContent = c.n + " " + (c.n === 1 ? "card" : "cards") + " so far";
  $("#cam-label").textContent = back ? "Now the back of the card" : "Line up the card inside the frame";
  const msg = $("#cam-msg");
  msg.hidden = !c.err; msg.textContent = c.err || "";
  const flash = $("#cam-flash");
  flash.classList.toggle("go", !!c.flash);
  let ctl: string;
  const pick = '<button class="btn light" data-act="cam-pick">' + ic("image", 22) + "Choose a photo</button>";
  if (c.after === "front") ctl = '<div class="cam-after"><p>Card ' + (last ? S.capN[last.id] || "" : "") + ' added</p><div class="row"><button class="btn light" data-act="add-back">Add the back</button><button class="btn primary" data-act="keep-going" data-autofocus>Keep going</button></div></div>';
  else if (c.after === "back") ctl = '<div class="cam-after"><p>Back added</p><div class="row"><button class="btn primary" data-act="keep-going" data-autofocus>Keep going</button></div></div>';
  else ctl = '<span class="cam-side"></span><button class="shutter" data-act="shutter" aria-label="' + (back ? "Take a picture of the back" : "Take a picture") + '"' + (c.ready ? "" : " disabled") + " data-autofocus></button>" + '<span class="cam-side">' + pick + "</span>";
  $("#cam-ctl").innerHTML = ctl;
  const tray = $("#cam-tray");
  const keep = tray.scrollLeft;
  tray.innerHTML = S.caps.length ? S.caps.map(tile).join("") : '<span class="none">Your cards show up here as you take them.</span>';
  tray.scrollLeft = keep;
  nowrapDom(root);
  hydratePhotos(tray);
  if (c.focus) { const f = $("[data-autofocus]", $("#cam-ctl")); if (f && !f.disabled) f.focus({ preventScroll: true }); c.focus = false; }
}
function tile(q: Cap): string {
  const title = q.status === "ready" && q.draft ? q.draft.title : "Card " + (S.capN[q.id] || "");
  const inner = thumbHtml({ title, photos: q.photos }, q.id, q.localUrl) + '<span class="tx"><b>' + esc(title) + "</b>" + qStatus(q) + (q.hasBack ? '<span class="qst">Front and back</span>' : "") + "</span>";
  return q.status === "ready"
    ? '<button class="tile" data-act="qcheck" data-id="' + q.id + '" aria-label="Check ' + esc(title) + '">' + inner + "</button>"
    : '<div class="tile">' + inner + "</div>";
}

async function startStream() {
  const c = S.cam;
  if (!c) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { c.err = "The camera is not available here. You can still choose a photo."; paintCam(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false });
    if (!S.cam) { stopStream(); return; }
    const v = $("#camvideo") as HTMLVideoElement;
    v.srcObject = stream;
    await v.play().catch(() => {});
    c.ready = true; c.err = "";
  } catch (e: any) {
    c.err = e && e.name === "NotAllowedError" ? "The camera is turned off for this page. You can still choose a photo." : "The camera did not open. You can still choose a photo.";
  }
  paintCam();
}
function stopStream() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
}

export function openCam() {
  S.cam = { after: null, backFor: null, last: null, flash: false, focus: true, ready: false, err: "", n: 0 };
  S.lastFocus = document.activeElement as HTMLElement;
  $("#l-cam").innerHTML = skeleton();
  paintCam();
  startStream();
}
export function closeCam() {
  stopStream();
  S.cam = null;
  const l = $("#l-cam");
  if (l) l.innerHTML = "";
  hooks.refreshHome();
}

/* ===== a shot ===== */
async function take(src: Source) {
  const c = S.cam;
  if (!c || c.busy) return;
  c.busy = true;
  c.flash = true; paintCam();
  setTimeout(() => { if (S.cam) { S.cam.flash = false; $("#cam-flash")?.classList.remove("go"); } }, 600);
  let blob: Blob;
  try { blob = await shrink(src); }
  catch { c.busy = false; toast("That photo could not be read. Try again."); return; }
  const backOf = camCap(c.backFor);
  if (backOf) {
    c.n += 0; c.backFor = null; c.after = "back"; backOf.hasBack = true; c.focus = true;
    sendBack(backOf, blob);
  } else {
    const tmp: Cap = { id: "tmp" + Date.now(), tmp: true, status: "uploading", hasBack: false, photos: [], blob, localUrl: URL.createObjectURL(blob) };
    S.capN[tmp.id] = ++S.capSeq;
    S.caps.push(tmp);
    c.last = tmp.id; c.after = "front"; c.n += 1; c.focus = true;
    sendFront(tmp);
  }
  c.busy = false;
  paintCam(); hooks.refreshHome();
}

function sendFront(tmp: Cap) {
  tmp.error = undefined; tmp.status = "uploading";
  const p = uploadPhoto(tmp.blob as Blob, "front").then((r) => {
    setLocalPic(r.capture_id, tmp.localUrl as string);
    S.capN[r.capture_id] = S.capN[tmp.id];
    return r.capture_id;
  });
  tmp.p = p;
  p.then(async (id) => {
    await loadCaps().catch(() => {});
    S.caps = S.caps.filter((x) => x !== tmp);
    if (S.cam && S.cam.last === tmp.id) S.cam.last = id;
    if (S.cam && S.cam.backFor === tmp.id) S.cam.backFor = id;
    hooks.refreshHome();
  }).catch((e) => {
    if (e instanceof ApiError && e.code === "not_signed_in") { hooks.signOut(); return; }
    tmp.error = e instanceof ApiError && e.message && /\s/.test(e.message) ? e.message : plainError(e);
    hooks.refreshHome();
  });
}
export function resend(c: Cap) { if (c.tmp && c.blob) { sendFront(c); hooks.refreshHome(); } }

async function sendBack(cap: Cap, blob: Blob) {
  try {
    const id = cap.tmp ? await cap.p : cap.id;
    if (!id) throw new ApiError("error", 0, "The front did not send, so the back cannot go either.");
    await uploadPhoto(blob, "back", id);
    cap.hasBack = true;
    await loadCaps().catch(() => {});
  } catch (e: any) {
    if (e instanceof ApiError && e.code === "not_signed_in") { hooks.signOut(); return; }
    cap.hasBack = false;
    toast("The back did not send. " + (e instanceof ApiError && e.message && /\s/.test(e.message) ? e.message : "Add the back again."));
  }
  hooks.refreshHome();
}

Object.assign(ACT, {
  "snap-close"() { closeCam(); },
  shutter() { const v = $("#camvideo") as HTMLVideoElement; if (S.cam && S.cam.ready && v) take(v); },
  "add-back"() { const c = S.cam; c.backFor = c.last; c.after = null; c.focus = true; paintCam(); },
  "keep-going"() { const c = S.cam; c.after = null; c.backFor = null; c.focus = true; paintCam(); },
  "cam-pick"() { ($("#cam-file") as HTMLInputElement).click(); },
});
document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "cam-file" && el.files && el.files[0]) { const f = el.files[0]; el.value = ""; take(f); }
});
void $$;
