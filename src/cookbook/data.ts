// Family Cookbook: loading and keeping the lists fresh.

import { rpc } from "./api";
import { deep, fd } from "./dom";
import { S, hooks, type Cap, type Rec, type Row, type RState } from "./state";

export const isReviewer = () => !!S.me && S.me.reviewer;

export async function loadRows() {
  const j = await rpc<{ recipes: Row[] }>("family_recipes");
  S.rows = j.recipes || [];
}
export async function loadReview() {
  if (!isReviewer()) { S.review = []; return; }
  const j = await rpc<{ recipes: Row[] }>("family_review_list");
  S.review = j.recipes || [];
}
export async function loadDeleted() {
  const j = await rpc<{ recipes: Row[] }>("family_deleted_list");
  S.deleted = j.recipes || [];
}

/** Server cards replace the list; cards still on their way up (no id from the server yet) stay at the end. */
export async function loadCaps() {
  const j = await rpc<{ captures: any[] }>("family_captures");
  const keep = S.caps.filter((c) => c.tmp);
  const fresh: Cap[] = (j.captures || []).map((c) => ({
    id: c.id, status: c.status, draft: c.draft || undefined, closer: !!c.closer, lowconf: !!c.lowconf, hasBack: !!c.hasBack,
    error: c.error, photos: c.photos || [], created: c.created,
  }));
  fresh.forEach((c) => { if (!S.capN[c.id]) S.capN[c.id] = ++S.capSeq; });
  S.caps = fresh.concat(keep);
}

export async function loadAll() {
  S.loadErr = "";
  try {
    await Promise.all([loadRows(), loadCaps(), loadReview()]);
    S.loaded = true;
  } catch (e: any) {
    if (e && e.code === "not_signed_in") throw e;
    S.loadErr = "Could not load your recipes. Check your connection and try again.";
  }
}

const RECIPE_DEFAULTS = { omnicook: "none" as const };
/** A whole recipe from the server's reply (row facts + doc). */
export function recFrom(full: any): Rec {
  const doc = deep(full.doc || {});
  const rec: any = { ...RECIPE_DEFAULTS, ...doc };
  rec.slug = doc.id;
  rec.id = String(full.id);
  rec.by = full.by; rec.added = full.added; rec.status = full.status; rec.flaggedBy = full.flaggedBy; rec.flaggedAt = full.flaggedAt;
  rec.note = full.note || ""; rec.closer = !!full.closer; rec.photos = full.photos || []; rec.canEdit = !!full.canEdit;
  rec.title = doc.title || full.title; rec.category = doc.category || full.category || "";
  if (!rec.yield || typeof rec.yield.amount !== "number") rec.yield = { amount: 1, unit: "serving" };
  rec.ingredients = Array.isArray(rec.ingredients) ? rec.ingredients : [];
  rec.steps = Array.isArray(rec.steps) ? rec.steps : [];
  return rec as Rec;
}

export function rsFor(id: string): RState {
  return S.rs[id] || (S.rs[id] = { factor: 1, omni: false, split: false, notes: "", log: [], have: null, checked: {} });
}

/** Fetch one recipe, keep it, and set up this person's notes and the cook log. */
export async function fetchRec(id: string): Promise<Rec> {
  const full = await rpc("family_recipe", { p_id: Number(id) });
  const rec = recFrom(full);
  S.recs[rec.id] = rec;
  const s = rsFor(rec.id);
  s.notes = full.notes || "";
  s.log = (full.cooks || []).slice().reverse().map((c: any) => ({ date: fd(c.at), desc: c.desc || "", note: c.note || "", by: c.by || null }));
  return rec;
}

/* ===== keep the screen up to date ===== */
let pollT: ReturnType<typeof setInterval> | null = null;
let slowAt = 0;
export function startPolling() {
  stopPolling();
  slowAt = Date.now();
  pollT = setInterval(tick, 3500);
  document.addEventListener("visibilitychange", onVisible);
}
export function stopPolling() {
  if (pollT) clearInterval(pollT);
  pollT = null;
  document.removeEventListener("visibilitychange", onVisible);
}
function onVisible() { if (document.visibilityState === "visible" && S.me) { slowAt = 0; tick(); } }

let ticking = false;
async function tick() {
  if (ticking || !S.me || document.visibilityState !== "visible") return;
  const waiting = S.caps.some((c) => !c.tmp && (c.status === "reading" || c.status === "closer"));
  const slow = Date.now() - slowAt > 45_000;
  if (!waiting && !slow) return;
  ticking = true;
  try {
    if (slow) { slowAt = Date.now(); await Promise.all([loadRows(), loadCaps(), loadReview()]); }
    else await loadCaps();
    hooks.refreshHome();
  } catch (e: any) {
    if (e && e.code === "not_signed_in") hooks.signOut();
  } finally { ticking = false; }
}
