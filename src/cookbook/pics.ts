// Family Cookbook: pictures of recipe cards (thumbnails, the original card with zoom).

import { esc, ic } from "./dom";
import { S, type Cap, type Photo } from "./state";

/* ===== pictures ===== */
export const CATS: Record<string, number> = { Baking: 14, Dinner: 24, Holidays: 8, Breakfast: 40, "Sauces & Pasta": 34, "Ferments & Drinks": 78, Bread: 26, "Sauces & Dressings": 140, Drinks: 262, Family: 210 };
export const hueOf = (c?: string) => (c && CATS[c] != null ? CATS[c] : 150);

const frontOf = (photos?: Photo[]) => (photos || []).find((p) => p.side === "front") || (photos || [])[0];
/** Small picture of a card: the photo if there is one, otherwise a soft colour with the first letter. */
export function thumbHtml(r: { title: string; category?: string; photos?: Photo[] }, capId?: string, localUrl?: string): string {
  const ph = frontOf(r.photos);
  const inner = localUrl
    ? '<img src="' + esc(localUrl) + '" alt="" class="px">'
    : ph ? '<img data-photo="' + ph.id + '"' + (capId ? ' data-local="' + capId + '"' : "") + ' alt="" decoding="async" class="px">' : "";
  const letter = esc((String(r.title || "?").replace(/^[^A-Za-z0-9]+/, "")[0] || "?").toUpperCase());
  return '<span class="thumb" style="--h:' + hueOf(r.category) + '"><span class="thumb-ph" aria-hidden="true">' + letter + "</span>" + inner + "</span>";
}

/** The original card, front and back, with zoom. */
export function photoHtml(photos: Photo[], capId?: string, title?: string): string {
  const front = photos.find((p) => p.side === "front"), back = photos.find((p) => p.side === "back");
  const hasBack = !!(front && back);
  const side = hasBack ? S.side : "front";
  const cur = (side === "back" ? back : front) || photos[0];
  if (!cur) return '<p class="muted">There is no photo of this card.</p>';
  return '<div class="photo-bar">'
    + (hasBack
      ? '<div class="seg" role="group" aria-label="Which side of the card"><button data-act="side" data-side="front" aria-pressed="' + (side === "front") + '">Front</button><button data-act="side" data-side="back" aria-pressed="' + (side === "back") + '">Back</button></div>'
      : '<span class="muted">Original card</span>')
    + '<button class="chip" data-act="zoom" aria-pressed="' + S.zoom + '">' + ic(S.zoom ? "zout" : "zin", 22) + (S.zoom ? "Zoom out" : "Zoom in") + "</button></div>"
    + '<div class="zoombox' + (S.zoom ? " z" : "") + '" id="zoombox" data-act="zoom" tabindex="0" role="group" aria-label="Card photo. ' + (S.zoom ? "Zoomed in. Scroll to look around." : "Tap to zoom in.") + '">'
    + '<img data-photo="' + cur.id + '"' + (capId ? ' data-local="' + capId + '"' : "") + ' alt="Photo of the ' + side + " of the recipe card" + (title ? " for " + esc(title) : "") + '"></div>'
    + '<p class="hint">' + (S.zoom ? "Drag to look around. Tap to zoom out." : "Tap the photo to zoom in.") + "</p>";
}


/** One line saying where a scanned card is. */
export function qStatus(q: Cap): string {
  if (q.status === "ready") return '<span class="qst ready">' + ic("check", 20) + "Ready to check</span>";
  if (q.status === "failed") return '<span class="qst bad">Could not read this one</span>';
  if (q.tmp && q.error) return '<span class="qst bad">' + esc(q.error) + "</span>";
  const word = q.status === "uploading" ? "Sending…" : q.status === "closer" ? "Taking a closer look…" : "Reading…";
  return '<span class="qst"><span class="ring" aria-hidden="true"></span>' + word + "</span>";
}
