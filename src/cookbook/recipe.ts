// Family Cookbook: the recipe page, the scaler, "I only have...", the OmniCook switch (Jared only), timers and Start Cooking.
// Same behaviour and the same maths as the Kitchen's recipe page (src/lib/recipes/scale.ts is shared), drawn for a phone.

import { $, $$, esc, ic, nowrapDom, nowrapify, words, clock, fd } from "./dom";
import {
  TSP, altNote, durRange, fStr, getSteps, haveFactor, haveUnits, machineChips, mmss, numStr, ozNote, parseQty, partsStr, planOf,
  pluralLead, servesLine, shortName, timeBits, usedIds, volParts, yieldAlt, yieldStr, fmtDur,
} from "@/lib/recipes/scale";
import { rpc, hydratePhotos, plainError } from "./api";
import { ACT, S, hooks } from "./state";
import { PEOPLE, canEditRecipe, otherReviewers, showsOmniCook, visLine } from "./people";
import { amt2, noteHtml, rt, unsureList } from "./text";
import { photoHtml, hueOf } from "./pics";
import { rsFor } from "./data";
import { toast } from "./ui";

const recOf = () => S.recs[S.vp.id as string];
const isJared = () => showsOmniCook(S.me && S.me.id);
const planFor = (r: any, s: any) => planOf(r, { ...s, omni: !!s.omni && isJared() });
const omniShown = (r: any) => isJared() && !!r.omnicook && r.omnicook !== "none";

/* "I only have..." also understands pounds, which the card scaler leaves out */
const haveUnits2 = (ing: any) => (ing.unit === "lb" ? ["lb", "oz"] : haveUnits(ing));
function haveFactor2(ing: any, amt: number, unit: string) {
  if (ing.unit === "lb") {
    const need = ing.amount;
    if (need == null || ing.no_scale || !(amt > 0)) return NaN;
    return unit === "lb" ? amt / need : unit === "oz" ? amt / 16 / need : NaN;
  }
  return haveFactor(ing, amt, unit);
}
export function exampleHave(r: any) {
  if (r.slug === "almond-flour-cc-cookies") return { id: "almond", amt: "2", unit: "cup", label: "2 cups almond flour" };
  const ing = r.ingredients.find((i: any) => i.amount != null && !i.no_scale) || r.ingredients[0];
  const half = ing.amount / 2, u = ing.unit;
  const A = TSP[u] ? partsStr(volParts(half * TSP[u])) : numStr(half) + " " + (u === "count" ? "" : u);
  return { id: ing.id, amt: String(half), unit: TSP[u] ? u : haveUnits2(ing)[0], label: A.trim() + " " + shortName(ing.name) };
}

/* ===== the recipe page ===== */
let IO: IntersectionObserver | null = null;
let SRO: ResizeObserver | null = null;

export function V_recipe(): string {
  const r = recOf();
  const s = rsFor(r.id), n = unsureList(r).length;
  const hasHave = r.ingredients.some((i: any) => i.amount != null && !i.no_scale), ex = hasHave ? exampleHave(r) : null;
  const front = (r.photos || []).find((p: any) => p.side === "front") || (r.photos || [])[0];
  const hasCard = !!front;
  return '<div class="page rp enter">'
    + '<section class="hero" id="hero" style="--h:' + hueOf(r.category) + '">' + (front ? '<div class="hero-img" aria-hidden="true"><img data-photo="' + front.id + '" alt=""></div>' : "")
    + '<div class="hbar"><button class="frostbtn circle" data-act="back" aria-label="Close recipe">' + ic("x") + "</button>"
    + '<div class="hright">' + (r.canEdit ? '<button class="frostbtn" data-act="edit">' + ic("pencil", 22) + "Edit</button>" : "") + '<span class="clock" id="clock">' + clock() + "</span></div></div>"
    + '<div class="foot"><div><h1 class="ht" id="h1" tabindex="-1">' + esc(r.title) + '</h1><p class="src" id="r-src"></p></div>'
    + '<div class="pills"><button class="frostbtn" data-act="to-ing">' + ic("note", 22) + 'Ingredients</button><button class="frostbtn strong" data-act="cook">' + ic("play", 22) + "Start Cooking</button></div></div></section>"
    + '<p class="vis" id="vis">' + ic(r.by === "mom" ? "people" : "lock", 20) + "<span>" + esc(visLine(r.by, S.me && S.me.id)) + "</span></p>"
    + (r.note ? '<p class="note-q">' + esc(r.note) + "</p>" : "")
    + (r.status === "review"
      ? '<div class="banner">' + ic("eye") + "<div>Being checked. " + esc(r.by === "mom" ? "Jared or Mariah" : otherReviewers(r.by).map((id) => PEOPLE[id].name).join(" or ") || "Someone") + " will look at the " + words(n) + " in yellow."
        + (S.me!.reviewer ? '<div class="mt"><button class="btn slim" data-act="open-review" data-id="' + r.id + '">Check it now</button></div>' : "") + "</div></div>" : "")
    + (hasCard ? '<div class="seg tabs" role="group" aria-label="What to show"><button data-act="tab" data-tab="recipe" aria-pressed="' + (S.tab === "recipe") + '">Recipe</button><button data-act="tab" data-tab="card" aria-pressed="' + (S.tab === "card") + '">Original card</button></div>' : "")
    + '<div class="rv' + (hasCard ? "" : " nocard") + '" id="rv" data-tab="' + S.tab + '">' + (hasCard ? '<section class="panel-card" aria-label="Original card photo">' + photoHtml(r.photos, undefined, r.title) + "</section>" : "")
    + '<section class="panel-typed" id="typedpanel">'
    + '<div class="rp-panel" id="r-scale"><h2>How much do you need? <small id="r-sc-tag"></small></h2><div id="r-scale-dyn" class="scale-dyn"></div>'
    + (hasHave && ex
      ? '<div class="have" id="have"><h3>I only have…</h3><div class="frow"><select class="fld" id="haveIng" aria-label="Ingredient you have"></select><input class="fld" id="haveAmt" inputmode="decimal" placeholder="Amount" aria-label="Amount you have" autocomplete="off"><select class="fld" id="haveUnit" aria-label="Unit"></select></div><div class="hout" id="haveOut" role="status"></div>'
        + '<button class="chip" data-act="haveex">Try: have ' + esc(ex.label) + "</button></div>" : "")
    + '<div id="r-omni"></div></div>'
    + '<div id="r-banners" class="rp-col"></div>'
    + '<div class="rp-panel" id="r-ing-panel"><h2>Ingredients <small id="r-ing-cap"></small></h2><ul class="rp-ing" id="r-ing"></ul></div>'
    + '<div class="rp-panel" id="r-steps-panel"><h2>Steps <small id="r-steps-cap"></small></h2><div id="r-batch"></div><ol class="rp-steps" id="r-steps"></ol></div>'
    + (r.tips && r.tips.length ? '<div class="rp-panel"><h2>Tips</h2><ul class="tips">' + r.tips.map((t: string) => "<li>" + nowrapify(t) + "</li>").join("") + "</ul></div>" : "")
    + (r.storage ? '<div class="rp-panel"><h2>Storage</h2><p>' + nowrapify(r.storage) + "</p></div>" : "")
    + (r.equipment && r.equipment.length ? '<div class="rp-panel"><h2>You will need</h2><div class="tags">' + r.equipment.map((e: string) => '<span class="tag">' + esc(e) + "</span>").join("") + "</div></div>" : "")
    + '<div class="rp-panel"><h2>Notes</h2><label class="sr" for="notes">Your notes for this recipe</label><textarea class="fld" id="notes" placeholder="Your own tweaks, like less sugar or a longer bake" autocomplete="off">' + esc(s.notes) + "</textarea>"
    + '<h3>Cook log</h3><div class="log" id="r-log"></div>'
    + '<div class="logadd"><label class="sr" for="logNote">How did it turn out?</label><input class="fld" id="logNote" placeholder="How did it turn out?" autocomplete="off"><button class="btn soft slim" data-act="logadd">Log this cook</button></div></div>'
    + (r.flags && r.flags.length ? '<details class="more"><summary><span class="row">' + ic("eye", 22) + 'Check this <span class="tag count">' + r.flags.length + "</span></span>" + ic("down", 22) + '</summary><div class="inner"><ul class="tips">' + r.flags.map((t: string) => "<li>" + nowrapify(t) + "</li>").join("") + "</ul></div></details>" : "")
    + (r.canEdit ? '<div class="manage"><button class="btn danger-ghost block" data-act="del">' + ic("trash", 22) + "Delete this recipe</button></div>" : "")
    + "</section></div></div>";
}

export function recipeMounted() {
  const r = recOf();
  if (!r) return;
  if (IO) { IO.disconnect(); IO = null; }
  if ($("#haveIng")) fillHave(r);
  const nt = $("#notes");
  if (nt) {
    nt.addEventListener("input", (e: Event) => { rsFor(r.id).notes = (e.target as HTMLTextAreaElement).value; scheduleNotes(r.id); });
    nt.addEventListener("blur", () => flushNotes());
  }
  refreshRecipe();
  if ("IntersectionObserver" in window) {
    IO = new IntersectionObserver((es) => { $("#actionbar").classList.toggle("show", !es[0].isIntersecting && S.view === "recipe" && !S.cook && !S.sheetOpen); }, { threshold: 0 });
    IO.observe($("#hero"));
  }
  const src = $("#r-src");
  if (src && "ResizeObserver" in window) { SRO = new ResizeObserver(() => fixSeps()); SRO.observe(src); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fixSeps());
  wakeOn();
}
export function recipeLeft() {
  if (IO) { IO.disconnect(); IO = null; }
  if (SRO) { SRO.disconnect(); SRO = null; }
  const ab = $("#actionbar");
  if (ab) ab.classList.remove("show");
  flushNotes();
  if (!S.cook) wakeOff();
}

/* the line under the title: facts separated by dots. A dot lives inside the fact before it (never alone at the start of a
   line), and is hidden whenever the next fact has wrapped to a new line (never dangling at the end of one). */
function srcLine(r: any, f: number) {
  const bits = ["Added by " + PEOPLE[r.by as keyof typeof PEOPLE].name + " on " + fd(r.added)].concat(timeBits(r));
  if (r.yield) bits.push(servesLine(r, f));
  return bits.map((b, i) => '<span class="it">' + nowrapify(b) + (i < bits.length - 1 ? '<span class="dot" aria-hidden="true"> ·</span>' : "") + "</span>").join(" ");
}
export function fixSeps() {
  const src = $("#r-src");
  if (!src) return;
  const items = $$(".it", src) as HTMLElement[];
  items.forEach((it, i) => {
    const dot = it.querySelector(".dot") as HTMLElement | null, next = items[i + 1];
    if (!dot || !next) return;
    dot.style.visibility = "visible";
    const nr = next.getClientRects()[0], dr = dot.getBoundingClientRect();
    if (nr && nr.top > dr.top + 3) dot.style.visibility = "hidden";
  });
}

function fillHave(r: any) {
  const items = r.ingredients.filter((i: any) => i.amount != null && !i.no_scale);
  $("#haveIng").innerHTML = items.map((i: any) => '<option value="' + esc(i.id) + '">' + esc(shortName(plainOf(i.name))) + "</option>").join("");
  syncUnits(r);
}
const plainOf = (n: string) => String(n).replace(/\[\[\w+\|([^|\]]*)[^\]]*\]\]/g, "$1");
function syncUnits(r: any, unit?: string) {
  const ing = r.ingredients.find((i: any) => i.id === $("#haveIng").value);
  const us = haveUnits2(ing);
  $("#haveUnit").innerHTML = us.map((u) => '<option value="' + u + '">' + (u === "count" ? "whole" : u) + "</option>").join("");
  $("#haveUnit").value = unit && us.indexOf(unit) >= 0 ? unit : us[0];
}
function applyHave() {
  const r = recOf(), s = rsFor(r.id), out = $("#haveOut");
  if (!out) return;
  const ing = r.ingredients.find((i: any) => i.id === $("#haveIng").value), amt = parseQty($("#haveAmt").value), unit = $("#haveUnit").value;
  if (!$("#haveAmt").value.trim()) { out.className = "hout"; out.textContent = ""; return; }
  const f = haveFactor2(ing, amt, unit);
  if (isNaN(f) || f <= 0) { out.className = "hout err"; out.textContent = "Type an amount like 2, 1/2 or 1½."; return; }
  s.factor = f; s.split = false;
  const hv = TSP[unit] ? partsStr(volParts(amt * TSP[unit])) : (numStr(amt) + " " + (unit === "count" ? "" : unit)).trim();
  s.have = { desc: hv + " " + shortName(plainOf(ing.name)), ing: ing.id };
  refreshRecipe(true);
  out.className = "hout"; out.textContent = "Everything now scaled to " + fStr(f) + ", makes " + yieldStr(r, f) + ".";
  nowrapDom(out);
}
function setFactor(v: number) { const s = rsFor(S.vp.id as string); s.factor = v; s.have = null; s.split = false; refreshRecipe(); }

export function refreshRecipe(fromHave?: boolean) {
  const r = recOf();
  if (!r || S.view !== "recipe" || !$("#r-src")) return;
  const s = rsFor(r.id), pl = planFor(r, s), f = pl.eff;
  if (!fromHave && $("#haveOut") && !s.have) $("#haveOut").textContent = "";
  $("#r-src").innerHTML = srcLine(r, pl.capped ? pl.eff : s.factor);
  const std = [0.5, 1, 2, 3], yv = yieldStr(r, s.factor).replace(/^about /, "").split(" ");
  const stepSize = Math.max(1, Math.round(r.yield.amount / 8));
  $("#r-sc-tag").textContent = Math.abs(s.factor - 1) > 1e-9 ? "Scaled to " + fStr(s.factor) : "";
  $("#r-scale-dyn").innerHTML =
    '<div class="stepper"><button class="iconbtn" data-act="dec" aria-label="Fewer">' + ic("minus") + "</button>"
    + '<div class="sval"><b>' + esc(yv[0]) + "</b> " + esc(yv.slice(1).join(" ")) + "</div>"
    + '<button class="iconbtn" data-act="inc" aria-label="More">' + ic("plus") + "</button></div>"
    + '<div class="rp-seg" role="group" aria-label="Batch size">' + [["½×", 0.5], ["1×", 1], ["2×", 2], ["3×", 3]].map((c) => '<button class="chip" data-act="scale" data-f="' + c[1] + '" aria-pressed="' + (Math.abs(s.factor - (c[1] as number)) < 1e-9) + '">' + c[0] + "</button>").join("") + "</div>"
    + (Math.abs(s.factor - 1) > 1e-9 && std.indexOf(s.factor) < 0 ? '<button class="chip" data-act="reset-scale">Reset to 1×</button>' : "");
  S._step = stepSize;
  const alt = yieldAlt(r, s.factor);
  if (alt) $("#r-scale-dyn").insertAdjacentHTML("beforeend", '<div class="inote">' + esc(alt) + "</div>");
  if (r.yield && r.yield.max_note && s.factor > 1 + 1e-9) $("#r-scale-dyn").insertAdjacentHTML("beforeend", '<div class="rp-note warn">' + ic("eye") + "<div>" + esc(r.yield.max_note) + "</div></div>");
  /* OmniCook switch: Jared only */
  const om = $("#r-omni");
  if (omniShown(r)) {
    om.innerHTML = '<div class="omni"><div><b>Tokit OmniCook 2.2 L</b><div class="inote">' + (s.omni ? "Showing machine steps" : "Switch on for machine steps") + '</div></div><button class="hit" role="switch" aria-checked="' + !!s.omni + '" aria-label="Tokit OmniCook 2.2 L" data-act="omni"><span class="switch"></span></button></div>'
      + (s.omni && r.omnicook === "converted" ? '<div class="rp-note">' + ic("eye") + "<div>Converted for the OmniCook. Check it the first time.</div></div>" : "");
  } else om.innerHTML = "";
  /* bowl fill, capacity guard, split */
  let ban = "";
  if (pl.omni && pl.cap) {
    const dough = pl.cap.base * pl.eff, pct = Math.min(100, (dough / pl.cap.max) * 100);
    ban += '<div class="rp-note"><div class="grow"><div><b>Bowl fill</b> <span class="nw">' + Math.round(dough) + ' oz</span> of about <span class="nw">' + pl.cap.max + ' oz</span> of dough (2.2 L bowl)</div><div class="meter ' + (dough > pl.cap.max * 1.02 ? "over" : "") + '"><i style="width:' + pct + '%"></i></div></div></div>';
    if (pl.capped) {
      const n = Math.ceil(s.factor / pl.cap.maxF - 1e-9);
      ban += '<div class="rp-note warn">' + ic("eye") + '<div class="grow"><div>One OmniCook batch tops out at <span class="nw">' + fStr(pl.cap.maxF) + '</span>. You asked for <span class="nw">' + fStr(s.factor) + '</span>, so this shows a single <span class="nw">' + fStr(pl.cap.maxF) + '</span> batch.</div><button class="btn primary slim" data-act="split">Split into ' + n + " batches</button></div></div>";
    }
    if (pl.n > 1) ban += '<div class="rp-note">' + ic("eye") + '<div class="grow"><div>Making <span class="nw">' + fStr(s.factor) + "</span> as " + pl.n + ' batches of <span class="nw">' + fStr(pl.eff) + "</span>. Steps are labeled Batch 1 of " + pl.n + ', and so on.</div><button class="btn slim" data-act="unsplit">Back to one batch</button></div></div>';
  }
  $("#r-banners").innerHTML = ban;
  /* ingredients */
  $("#r-ing-cap").textContent = pl.n > 1 ? "per batch, " + pl.n + " batches" : "";
  $("#r-ing").innerHTML = r.ingredients.map((ing: any) => {
    const a = amt2(ing, f), oz = ozNote(ing, f), alt = altNote(ing, f), on = !!s.checked[ing.id], uns = ing.unsure && !ing.unsure.done;
    let nm = ing.name;
    if (ing.unit === "count" || ing.unit === "egg") nm = pluralLead(nm, a.n);
    const nameHtml = rt({ ingredients: [] }, nm, f, "read").html;
    const lead = a.none ? "" : uns ? '<mark class="u soft amt">' + esc(a.listLead) + "</mark>" : '<span class="amt">' + esc(a.listLead) + "</span>";
    const none = a.none ? '<span class="inote big">' + esc(ing.unit) + "</span>" : "";
    return '<li><button class="irow" data-act="icheck" data-id="' + esc(ing.id) + '" aria-pressed="' + on + '"><span class="ibox">' + ic("check") + '</span><span class="itext"><span class="iline">' + lead + '<span class="iname">' + nameHtml + "</span>" + none
      + (oz ? '<span class="oz">(' + esc(oz) + ")</span>" : "") + (alt && !oz ? '<span class="oz">(' + esc(alt) + ")</span>" : "") + (ing.optional ? '<span class="opt">optional</span>' : "") + "</span>"
      + (a.note ? '<span class="inote">' + noteHtml(a.note) + "</span>" : "") + (ing.no_scale ? '<span class="inote">Same at any size.</span>' : "") + (ing.note ? '<span class="inote warn">' + esc(ing.note) + "</span>" : "") + "</span></button></li>";
  }).join("");
  /* steps */
  const batch = pl.n > 1 ? Math.min(S.viewBatch, pl.n) : null;
  $("#r-batch").innerHTML = pl.n > 1 ? '<div class="rp-seg" role="group" aria-label="Batch">' + Array.from({ length: pl.n }, (_, i) => '<button class="chip" data-act="batch" data-v="' + (i + 1) + '" aria-pressed="' + (batch === i + 1) + '">Batch ' + (i + 1) + " of " + pl.n + "</button>").join("") + "</div>" : "";
  $("#r-steps-cap").textContent = pl.omni ? "OmniCook" : "";
  const steps = getSteps(r, pl, batch || 1);
  $("#r-steps").innerHTML = steps.map((st: any, i: number) => {
    const t = rt(r, st.text, f, "read"), mc = pl.omni ? machineChips(st.omni) : [];
    return '<li class="rp-step"><span class="rp-snum" aria-hidden="true">' + (i + 1) + '</span><div class="sbody"><div class="stitle">' + esc(st.title) + (st.batchLabel ? '<span class="btag">' + esc(st.batchLabel) + "</span>" : "") + "</div>"
      + '<p class="stext">' + t.html + "</p>" + (mc.length ? '<div class="mchips">' + mc.map((c) => '<span class="mchip ' + (c.k ? "k" : "") + '">' + esc(c.t) + "</span>").join("") + "</div>" : "")
      + t.notes.map((n) => '<p class="snote">' + n + "</p>").join("")
      + (st.timer_sec ? '<div class="sact"><button class="stbtn" data-act="timer" data-i="' + i + '">' + ic("timer", 22) + "Start " + esc(durRange(st.timer_sec, st.timer_max_sec)) + " timer</button></div>" : "") + "</div></li>";
  }).join("");
  /* log */
  const lg = s.log;
  $("#r-log").innerHTML = lg.length
    ? lg.slice().reverse().map((l) => '<div class="logrow"><b>Made it ' + esc(l.date) + "</b> · " + esc(l.desc) + (l.note ? " · " + esc(l.note) : "") + (l.by && S.me && l.by !== S.me.id && PEOPLE[l.by as keyof typeof PEOPLE] ? " · " + esc(PEOPLE[l.by as keyof typeof PEOPLE].name) : "") + "</div>").join("")
    : '<p class="muted">No cooks logged yet.</p>';
  nowrapDom($("#hero")); nowrapDom($("#typedpanel"));
  hydratePhotos($("#view"));
  fixSeps();
}

/* ===== notes and the cook log are kept on the server ===== */
let noteT: ReturnType<typeof setTimeout> | null = null, noteFor = "";
function scheduleNotes(id: string) { noteFor = id; if (noteT) clearTimeout(noteT); noteT = setTimeout(flushNotes, 900); }
export function flushNotes() {
  if (!noteT) return;
  clearTimeout(noteT); noteT = null;
  const id = noteFor;
  rpc("family_set_notes", { p_id: Number(id), p_body: rsFor(id).notes }).catch((e) => toast("Your note did not save. " + plainError(e)));
}
async function logCook(rid: string, note: string) {
  const s = rsFor(rid);
  const desc = s.have ? s.have.desc : Math.abs(s.factor - 1) < 1e-9 ? "1× batch" : fStr(s.factor) + " batch";
  try {
    await rpc("family_log_cook", { p_id: Number(rid), p_summary: desc, p_note: note, p_factor: s.factor, p_omni: !!s.omni && isJared() });
  } catch (e) { toast("That did not save. " + plainError(e)); return; }
  s.log.push({ date: fd(new Date()), desc, note, by: S.me!.id });
  if (S.view === "recipe" && S.vp.id === rid) refreshRecipe(true);
  toast("Logged. Made it " + fd(new Date()) + ", " + desc + ".");
}

/* ===== wake lock, audio ===== */
let wl: any = null, AC: AudioContext | null = null;
async function wakeOn() { try { if ("wakeLock" in navigator && !wl) { wl = await (navigator as any).wakeLock.request("screen"); wl.addEventListener("release", () => { wl = null; }); } } catch { wl = null; } }
function wakeOff() { try { wl && wl.release(); } catch { /* already released */ } wl = null; }
function unlockAudio() { try { AC = AC || new (window.AudioContext || (window as any).webkitAudioContext)(); if (AC.state === "suspended") AC.resume(); } catch { /* no sound */ } }
function chime() {
  if (!AC) return;
  const t = AC.currentTime;
  [[880, 0], [1174.66, 0.2], [1567.98, 0.4]].forEach((a) => {
    const o = AC!.createOscillator(), g = AC!.createGain();
    o.type = "sine"; o.frequency.value = a[0]; o.connect(g); g.connect(AC!.destination);
    g.gain.setValueAtTime(0.0001, t + a[1]); g.gain.exponentialRampToValueAtTime(0.25, t + a[1] + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + a[1] + 1);
    o.start(t + a[1]); o.stop(t + a[1] + 1.1);
  });
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* no buzz */ }
}

/* ===== timers: several at once, +1 min, chime. They count down to a clock time, so a sleeping phone does not lose them. ===== */
function startTimer(key: string, label: string, sec: number, maxSec?: number | null) {
  const ex = S.timers.find((t) => t.key === key && !t.done);
  if (ex) { toast("The " + label + " timer is already running."); return; }
  S.timers.push({ id: ++S.tid, key, label, total: sec, remain: sec, endAt: Date.now() + sec * 1000, done: false, max: maxSec || null });
  renderTimers();
  toast(label + " timer started: " + durRange(sec, maxSec) + (maxSec ? ". It starts at the low end. Add time if you need it." : "."));
}
export function renderTimers() {
  const el = $("#timers");
  if (!el) return;
  el.innerHTML = S.timers.map((t) => '<div class="pill ' + (t.done ? "done" : "") + '" data-tid="' + t.id + '"><span class="pl">' + esc(t.label) + '</span><span class="pt">' + (t.done ? "Done" : mmss(t.remain)) + "</span>"
    + '<button class="pb" data-act="tplus" data-id="' + t.id + '" aria-label="Add one minute to the ' + esc(t.label) + ' timer">+1 min</button><button class="pb" data-act="tstop" data-id="' + t.id + '" aria-label="' + (t.done ? "Dismiss" : "Stop") + " the " + esc(t.label) + ' timer">' + (t.done ? "Dismiss" : ic("x", 22)) + "</button></div>").join("");
  nowrapDom(el);
  document.body.classList.toggle("has-timers", S.timers.length > 0);
}
export function tickTimers() {
  if (!S.timers.length) return;
  const now = Date.now();
  let ch = false;
  S.timers.forEach((t) => {
    if (t.done) return;
    t.remain = Math.max(0, (t.endAt - now) / 1000);
    if (t.remain <= 0) { t.done = true; ch = true; chime(); toast(t.label + " timer is done."); }
  });
  if (ch) renderTimers();
  else S.timers.forEach((t) => { const e = document.querySelector('.pill[data-tid="' + t.id + '"] .pt'); if (e) e.textContent = t.done ? "Done" : mmss(t.remain); });
}

/* ===== Start Cooking ===== */
function cookSteps() { const C = S.cook, r = S.recs[C.rid], s = rsFor(r.id), pl = planFor(r, s); return { r, s, pl, steps: getSteps(r, pl, null) }; }
function openCook() {
  unlockAudio();
  const r = recOf(), s = rsFor(r.id);
  s.checked = {};
  S.cook = { rid: r.id, i: 0, done: false, mic: false, heard: "" };
  S.lastFocus = document.activeElement as HTMLElement;
  document.body.classList.add("cooking");
  wakeOn();
  $("#actionbar").classList.remove("show");
  renderCook("next", true);
}
function ringHtml(done: number, total: number) {
  const c = 2 * Math.PI * 26, p = total ? done / total : 0;
  return '<div class="pring" role="img" aria-label="' + done + " of " + total + ' ingredients in"><svg viewBox="0 0 64 64" aria-hidden="true"><circle class="tr" cx="32" cy="32" r="26"/><circle class="fg" cx="32" cy="32" r="26" stroke-dasharray="' + c.toFixed(2) + '" stroke-dashoffset="' + (c * (1 - p)).toFixed(2) + '"/></svg><span aria-hidden="true">' + done + "/" + total + "<small>in</small></span></div>";
}
const SRC = () => (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
function cookLine() {
  const C = S.cook;
  if (!SRC()) return "Voice is not available in this browser. Tap Next and Back, or swipe.";
  if (C.mic) return (C.heard ? "Heard “" + esc(C.heard) + "”. " : "Listening. ") + "Say next, back, repeat, start timer or stop timer.";
  return "Tap the mic to use your voice: next, back, repeat, start timer, stop timer.";
}
function renderCook(dir?: string, first?: boolean) {
  const C = S.cook, K = cookSteps(), r = K.r, f = K.pl.eff, n = K.steps.length;
  const L = $("#l-cook");
  let el = $("#cookroot", L);
  const act = document.activeElement as HTMLElement | null;
  const keep = !first && act && act.closest && act.closest("#cookroot") && act.dataset ? { a: act.dataset.act, id: act.dataset.id } : null;
  if (!el) { L.innerHTML = '<div class="cook" id="cookroot" role="dialog" aria-modal="true" aria-label="Cooking ' + esc(r.title) + '"></div>'; el = $("#cookroot", L); }
  const used = usedIds(r, K.steps), done = used.filter((id: string) => K.s.checked[id]).length;
  const top = '<div class="ctop"><button class="iconbtn" data-act="cook-close" aria-label="Close cook mode">' + ic("x") + '</button><div class="cmeta"><div class="cr">' + esc(r.title) + '</div><div class="cs">' + (C.done ? "Finished" : "Step " + (C.i + 1) + " of " + n + (K.steps[C.i] && K.steps[C.i].batchLabel ? " · " + K.steps[C.i].batchLabel : "")) + "</div></div>" + ringHtml(done, used.length)
    + '<button class="iconbtn micb" data-act="mic" aria-pressed="' + C.mic + '" aria-label="Voice commands">' + ic("mic") + "</button></div>"
    + '<div class="cprog" aria-hidden="true">' + K.steps.map((_: any, i: number) => '<i class="' + (C.done || i < C.i ? "d" : i === C.i ? "n" : "") + '"></i>').join("") + "</div>";
  let main = "";
  if (C.done) {
    main = '<div class="cmain one"><div class="cstep cdone"><div class="ctitle">Done. Nice work.</div><p class="ctext">Log this cook so the family can see what you made and how much.</p>'
      + '<div class="sact"><button class="btn primary big" data-act="cook-log" data-autofocus>Log this cook</button><button class="btn big" data-act="cook-close">Close</button></div></div></div>';
  } else {
    const st = K.steps[C.i], t = rt(r, st.text, f, "clean"), ids = usedIds(r, [st]), mc = K.pl.omni ? machineChips(st.omni) : [];
    const chips = ids.map((id: string) => {
      const ing = r.ingredients.find((x: any) => x.id === id), a = amt2(ing, f);
      let nm = shortName(plainOf(ing.name));
      if (ing.unit === "count" || ing.unit === "egg") nm = pluralLead(nm, a.n);
      const lead = a.none ? "" : ing.unit === "count" || ing.unit === "egg" ? a.listLead : a.str;
      return '<button class="ichip ' + (K.s.checked[id] ? "on" : "") + '" data-act="cchip" data-id="' + esc(id) + '" aria-pressed="' + !!K.s.checked[id] + '"><span class="box">' + ic("check") + '</span><span class="tx"><span class="ca nw">' + esc(lead || "") + '</span><span class="cn">' + esc(nm) + "</span></span></button>";
    }).join("");
    main = '<div class="cmain" id="cmain"><div class="cstep ' + (dir === "back" ? "in-back" : dir === "next" && !keep ? "in-next" : "") + '"><h2 class="ctitle">' + esc(st.title) + '</h2><p class="ctext">' + t.html + "</p>"
      + t.notes.map((x) => '<p class="cnote">' + x + "</p>").join("")
      + (mc.length ? '<div class="mchips big">' + mc.map((c) => '<span class="mchip ' + (c.k ? "k" : "") + '">' + esc(c.t) + "</span>").join("") + "</div>" : "")
      + '<div class="sact">' + (st.timer_sec ? '<button class="btn primary big" data-act="ctimer">' + ic("timer", 24) + "Start " + esc(durRange(st.timer_sec, st.timer_max_sec)) + " timer</button>" : "") + "</div></div>"
      + '<aside class="cside" aria-label="Ingredients"><h3>' + (ids.length ? "In this step" : "Ingredients") + "</h3>" + (chips || '<p class="cnote">Nothing to add in this step.</p>') + "</aside></div>";
  }
  const last = !C.done && C.i === n - 1;
  el.innerHTML = top + main + '<div class="cline" id="cline" aria-live="polite">' + cookLine() + "</div>"
    + (C.done ? "" : '<div class="cnav"><button class="btn" data-act="cook-back"' + (C.i === 0 ? " disabled" : "") + ">" + ic("left") + 'Back</button><button class="btn primary" data-act="cook-next" data-autofocus>' + (last ? "Finish" : "Next") + ic(last ? "check" : "right") + "</button></div>")
    + '<div class="cfoot"><button data-act="cook-repeat">' + ic("restore", 20) + "Read it aloud</button></div>";
  nowrapDom(el); bindSwipe(el);
  if (keep && keep.a) { const q = el.querySelector('[data-act="' + keep.a + '"]' + (keep.id ? '[data-id="' + keep.id + '"]' : "")); if (q && !q.disabled) { q.focus({ preventScroll: true }); return; } }
  const af = el.querySelector("[data-autofocus]");
  if (af && (first || dir)) af.focus({ preventScroll: true });
}
function bindSwipe(el: HTMLElement) {
  const m = $("#cmain", el);
  if (!m) return;
  let x0: number | null = null, y0 = 0, dx = 0;
  m.addEventListener("pointerdown", (e: PointerEvent) => { if ((e.target as Element).closest("button")) return; x0 = e.clientX; y0 = e.clientY; dx = 0; });
  m.addEventListener("pointermove", (e: PointerEvent) => {
    if (x0 == null) return;
    dx = e.clientX - x0;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(e.clientY - y0)) { const o = (dx * 0.45) / (1 + Math.abs(dx) / 260); m.firstElementChild.style.transform = "translateX(" + o + "px)"; }
  });
  const end = (e: PointerEvent) => {
    if (x0 == null) return;
    const ddx = dx, ddy = (e.clientY || 0) - y0;
    x0 = null;
    m.firstElementChild.style.transition = "transform .25s cubic-bezier(.2,.9,.3,1)"; m.firstElementChild.style.transform = "";
    if (Math.abs(ddx) > 70 && Math.abs(ddx) > Math.abs(ddy) * 1.5) { if (ddx < 0) cookGo(1); else cookGo(-1); }
  };
  m.addEventListener("pointerup", end);
  m.addEventListener("pointercancel", () => { x0 = null; m.firstElementChild.style.transform = ""; });
}
function cookGo(d: number) {
  const C = S.cook;
  if (!C || C.done) return;
  const n = cookSteps().steps.length;
  if (d > 0) { if (C.i >= n - 1) { C.done = true; renderCook("next"); return; } C.i++; renderCook("next"); }
  else if (C.i > 0) { C.i--; renderCook("back"); }
}
function cookTimer() {
  const K = cookSteps(), st = K.steps[S.cook.i];
  if (!st || !st.timer_sec) return false;
  startTimer(K.r.id + "|" + S.cook.i, st.title, st.timer_sec, st.timer_max_sec);
  return true;
}
export function closeCook() {
  if (!S.cook) return;
  document.body.classList.remove("cooking");
  $("#l-cook").innerHTML = "";
  stopMic(); S.cook = null;
  if (S.view === "recipe") {
    refreshRecipe(true);
    const h = $("#h1");
    if (S.lastFocus && document.contains(S.lastFocus)) S.lastFocus.focus({ preventScroll: true }); else if (h) h.focus({ preventScroll: true });
  } else wakeOff();
}
/* voice */
let rec: any = null;
function stopMic() { if (S.cook) S.cook.mic = false; try { rec && rec.stop(); } catch { /* already stopped */ } rec = null; }
function toggleMic() {
  const SR = SRC();
  if (!SR) { const l = $("#cline"); if (l) l.textContent = "Voice is not available in this browser. Tap Next and Back, or swipe."; toast("Voice commands need Safari or Chrome. Use Back and Next for now."); return; }
  if (S.cook.mic) { stopMic(); renderCook(); return; }
  try {
    rec = new SR(); rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
    rec.onresult = (e: any) => { const tx = e.results[e.results.length - 1][0].transcript.trim().toLowerCase(); if (S.cook) { S.cook.heard = tx; voiceCmd(tx); } };
    rec.onerror = (e: any) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { if (S.cook) S.cook.mic = false; rec = null; toast("I cannot hear you yet. Allow the microphone for this page, or use Next and Back."); if (S.cook) renderCook(); } };
    rec.onend = () => { if (S.cook && S.cook.mic) { try { rec.start(); } catch { /* busy */ } } };
    rec.start(); S.cook.mic = true; renderCook();
  } catch { if (S.cook) S.cook.mic = false; rec = null; toast("Voice could not start. Use Back and Next for now."); renderCook(); }
}
function voiceCmd(t: string) {
  if (/start (the )?timer/.test(t)) { if (!cookTimer()) toast("There is no timer on this step."); }
  else if (/stop (the )?timer|cancel (the )?timer/.test(t)) {
    const K = cookSteps(), k = K.r.id + "|" + S.cook.i;
    const tm = S.timers.slice().reverse().find((x) => x.key === k) || S.timers[S.timers.length - 1];
    if (tm) { S.timers = S.timers.filter((x) => x !== tm); renderTimers(); }
  }
  else if (/\b(next|continue|forward)\b/.test(t)) cookGo(1);
  else if (/\b(back|previous|go back)\b/.test(t)) cookGo(-1);
  else if (/\b(repeat|again|say that)\b/.test(t)) readAloud();
  const l = $("#cline");
  if (l && S.cook) l.innerHTML = cookLine();
}
function readAloud() {
  const K = cookSteps(), st = K.steps[S.cook.i];
  if (!st) return;
  const txt = st.title + ". " + rt(K.r, st.text, K.pl.eff, "plain").plain;
  try { if ("speechSynthesis" in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(txt)); } else toast("Reading aloud is not available here."); } catch { /* no voice */ }
}

/* ===== actions for the page ===== */
Object.assign(ACT, {
  cook() { openCook(); },
  "cook-close"() { closeCook(); },
  "cook-next"() { cookGo(1); },
  "cook-back"() { cookGo(-1); },
  "cook-repeat"() { readAloud(); },
  "cook-log"() { const rid = S.cook.rid; closeCook(); logCook(rid, ""); },
  cchip(t: HTMLElement) {
    const s = rsFor(S.cook.rid), id = t.dataset.id as string;
    s.checked[id] = !s.checked[id];
    const m = $("#cmain"), y = m ? m.scrollTop : 0;
    renderCook();
    const m2 = $("#cmain");
    if (m2) m2.scrollTop = y;
  },
  ctimer() { cookTimer(); },
  mic() { toggleMic(); },
  scale(t: HTMLElement) { setFactor(parseFloat(t.dataset.f as string)); },
  "reset-scale"() { setFactor(1); },
  inc() { const r = recOf(), s = rsFor(r.id); const nv = r.yield.amount * s.factor + (S._step || 1); setFactor(nv / r.yield.amount); },
  dec() { const r = recOf(), s = rsFor(r.id); const nv = r.yield.amount * s.factor - (S._step || 1); if (nv <= 0) return; setFactor(nv / r.yield.amount); },
  haveex() { const r = recOf(), ex = exampleHave(r); $("#haveIng").value = ex.id; syncUnits(r, ex.unit); $("#haveAmt").value = ex.amt; applyHave(); },
  omni() { const s = rsFor(S.vp.id as string); s.omni = !s.omni; s.split = false; refreshRecipe(true); },
  split() { rsFor(S.vp.id as string).split = true; S.viewBatch = 1; refreshRecipe(true); },
  unsplit() { rsFor(S.vp.id as string).split = false; refreshRecipe(true); },
  batch(t: HTMLElement) { S.viewBatch = +(t.dataset.v as string); refreshRecipe(true); },
  icheck(t: HTMLElement) { const s = rsFor(S.vp.id as string), id = t.dataset.id as string; s.checked[id] = !s.checked[id]; refreshRecipe(true); },
  timer(t: HTMLElement) {
    const r = recOf(), pl = planFor(r, rsFor(r.id));
    const st = getSteps(r, pl, pl.n > 1 ? S.viewBatch : 1)[+(t.dataset.i as string)];
    startTimer(r.id + "|" + t.dataset.i + "|" + S.viewBatch, st.title, st.timer_sec as number, st.timer_max_sec);
  },
  tplus(t: HTMLElement) {
    const tm = S.timers.find((x) => String(x.id) === t.dataset.id);
    if (tm) { if (tm.done) { tm.done = false; tm.endAt = Date.now() + 60000; tm.remain = 60; } else { tm.endAt += 60000; tm.remain += 60; } tm.total += 60; renderTimers(); }
  },
  tstop(t: HTMLElement) { S.timers = S.timers.filter((x) => String(x.id) !== t.dataset.id); renderTimers(); },
  logadd() { const i = $("#logNote"); logCook(S.vp.id as string, i.value.trim()); i.value = ""; },
  "to-ing"() {
    if (S.tab !== "recipe") { S.tab = "recipe"; const rv = $("#rv"); if (rv) rv.dataset.tab = "recipe"; $$(".tabs button").forEach((b: HTMLElement) => b.setAttribute("aria-pressed", String(b.dataset.tab === "recipe"))); }
    const el = $("#r-ing-panel");
    if (el) setTimeout(() => { el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "start" }); }, 30);
  },
});

document.addEventListener("change", (e) => {
  const id = (e.target as HTMLElement).id;
  if (id === "haveIng") { syncUnits(recOf()); applyHave(); }
  if (id === "haveUnit") applyHave();
});
document.addEventListener("input", (e) => { if ((e.target as HTMLElement).id === "haveAmt") applyHave(); });
document.addEventListener("keydown", (e) => {
  const tg = e.target as HTMLElement;
  if (S.cook && !S.sheetOpen && !(tg.matches && tg.matches("input,textarea,select"))) { if (e.key === "ArrowRight") cookGo(1); if (e.key === "ArrowLeft") cookGo(-1); }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && (S.view === "recipe" || S.cook)) { wakeOn(); tickTimers(); } });
document.addEventListener("pointerdown", unlockAudio, { passive: true });

setInterval(tickTimers, 250);
setInterval(() => { const c = $("#clock"); if (c) c.textContent = clock(); }, 15000);
void hooks; void canEditRecipe; void fmtDur;
