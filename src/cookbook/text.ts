// Family Cookbook: recipe text with live amounts, and the "unsure word" markup from the card reader.
//
// Markup, as written by the reader (recipe-parse, family mode):
//   steps carry {ingredient_id} tokens and [[w3|best|alt|alt]] words (the reader was not sure, best guess first)
//   an ingredient may carry unsure:{alts:[{label,amount,unit}]} when its amount was doubtful
// Modes: read (soft yellow mark), check (tappable), plain (no mark), clean (amounts only), ctx (one word highlighted).

import { PLURALS, amountOf, numStr, pluralLead, ozNote, TSP, parseQty } from "@/lib/recipes/scale";
import { esc, nowrapify } from "./dom";

// Everyday plurals for scanned cards (the Kitchen's own list is shorter). Runs once, in the cookbook bundle only.
PLURALS.push(
  [/^(\s*(?:ripe )?banana)s?(?![A-Za-z])/, "s"], [/^(\s*(?:medium )?onion)s?(?![A-Za-z])/, "s"], [/^(\s*carrot)s?(?![A-Za-z])/, "s"],
  [/^(\s*potato)(?:es)?(?![A-Za-z])/, "es"], [/^(\s*celery stalk)s?(?![A-Za-z])/, "s"], [/^(\s*apple)s?(?![A-Za-z])/, "s"], [/^(\s*packet)s?(?![A-Za-z])/, "s"],
);

export type Mode = "read" | "check" | "plain" | "clean" | "ctx";

export function segToks(seg: string, f: number): { t: "amt" | "txt"; s: string }[] {
  const out: { t: "amt" | "txt"; s: string }[] = [];
  const RE = /(\b\d+(?:–\d+)? pieces\b|\bor \d+ of\b)/;
  seg.split(RE).forEach((p, i) => {
    if (!p) return;
    if (i % 2 && Math.abs(f - 1) > 1e-9) out.push({ t: "amt", s: p.replace(/\d+/g, (m) => String(Math.max(1, Math.round(+m * f)))) });
    else out.push({ t: "txt", s: p });
  });
  return out;
}
export function noteHtml(n: string): string {
  return esc(n)
    .replace(/(\d[\d½¼¾⅓⅔⅛]*(?:–[\d½¼¾⅓⅔⅛]+)?|[½¼¾⅓⅔⅛])(?: (?:egg|eggs|cups?|tbsp|tsp))(?: \+ \d[\d½¼¾⅓⅔⅛]* (?:cups?|tbsp|tsp))*/g, (m) => '<span class="nw">' + m + "</span>")
    .replace(/(a pinch)/g, '<span class="nw">$1</span>');
}

/** The Kitchen's amount maths plus pounds (scanned cards use "lb"). */
export function amt2(ing: any, f: number) {
  if (ing.unit === "lb" && ing.amount != null) {
    const m = ing.no_scale ? 1 : f, lo = ing.amount * m, hi = ing.amount_max != null ? ing.amount_max * m : null;
    const s = hi == null ? numStr(lo) + " lb" : numStr(lo) + "–" + numStr(hi) + " lb";
    return { none: false, str: s, listLead: s, n: lo, note: null as string | null };
  }
  return amountOf(ing, f) as { none?: boolean; str: string; listLead: string; n: number; note: string | null };
}
export const plainName = (n: string) => String(n).replace(/\[\[\w+\|([^|\]]*)[^\]]*\]\]/g, "$1");

let CTX_UID: string | null = null;
export const setCtx = (u: string | null) => { CTX_UID = u; };

export function resolveTok(r: any, text: string, f: number, mode: Mode) {
  const parts = text.split(/(\{\w+\})/);
  let html = "", plain = "";
  const notes: string[] = [];
  let prev: number | null = null;
  parts.forEach((p) => {
    const m = p.match(/^\{(\w+)\}$/);
    if (m) {
      const ing = r.ingredients.find((x: any) => x.id === m[1]);
      if (!ing) { html += esc(p); plain += p; prev = null; return; }
      const a = amt2(ing, f), s = a.none ? ing.unit || "" : a.str;
      let span = '<span class="amt">' + esc(s) + "</span>";
      if (ing.unsure && !ing.unsure.done && mode !== "plain" && mode !== "clean") {
        span = mode === "check"
          ? '<button type="button" class="u amt" data-act="fix" data-uid="ing:' + ing.id + '" aria-label="Check this amount: ' + esc(s) + '">' + esc(s) + "</button>"
          : '<mark class="u soft amt">' + esc(s) + "</mark>";
      }
      html += span; plain += s;
      if (a.note) notes.push(noteHtml(a.note));
      prev = ing.unit === "count" ? a.n : null;
    } else {
      let seg = p;
      if (prev != null) { seg = pluralLead(seg, prev).replace(/^ /, " "); prev = null; }
      segToks(seg, f).forEach((tk) => {
        if (tk.t === "amt") html += '<span class="amt">' + esc(tk.s) + "</span>"; else html += nowrapify(tk.s);
        plain += tk.s;
      });
    }
  });
  return { html, plain, notes };
}

export function rt(r: any, text: string, f: number, mode: Mode) {
  const parts = String(text).split(/(\[\[\w+\|[^\]]*\]\])/);
  let html = "", plain = "";
  const notes: string[] = [];
  parts.forEach((p) => {
    const m = p.match(/^\[\[(\w+)\|([^\]]*)\]\]$/);
    if (m) {
      const g = m[2].split("|")[0];
      plain += g;
      const inner = nowrapify(g);
      if (mode === "plain" || mode === "clean") html += inner;
      else if (mode === "check") html += '<button type="button" class="u" data-act="fix" data-uid="' + m[1] + '" aria-label="Check this word: ' + esc(g) + '">' + inner + "</button>";
      else if (mode === "ctx") html += m[1] === CTX_UID ? '<mark class="u soft">' + inner + "</mark>" : inner;
      else html += '<mark class="u soft">' + inner + "</mark>";
    } else if (p) {
      const o = resolveTok(r, p, f, mode === "ctx" ? "clean" : mode);
      html += o.html; plain += o.plain; notes.push(...o.notes);
    }
  });
  return { html, plain, notes };
}
export const plain = (r: any, t: string) => rt(r, t, 1, "plain").plain;

export function ingLine(r: any, ing: any, f: number, mode: Mode) {
  const a = amt2(ing, f);
  const nm = pluralLead(" " + ing.name, a.n).replace(/^ /, "");
  const nameHtml = rt({ ingredients: [] }, nm, f, mode === "check" ? "check" : mode === "plain" ? "plain" : "read").html;
  let lead = "";
  if (!a.none) {
    lead = '<span class="amt">' + esc(a.listLead) + "</span>";
    if (ing.unsure && !ing.unsure.done && mode !== "plain") {
      lead = mode === "check"
        ? '<button type="button" class="u amt" data-act="fix" data-uid="ing:' + ing.id + '" aria-label="Check this amount: ' + esc(a.listLead) + '">' + esc(a.listLead) + "</button>"
        : '<mark class="u soft amt">' + esc(a.listLead) + "</mark>";
    }
  }
  const oz = ozNote(ing, f);
  const tail = a.none ? ' <span class="oz">' + esc(ing.unit) + "</span>" : oz && TSP[ing.unit] ? ' <span class="oz nw">(' + esc(oz) + ")</span>" : "";
  return lead + " <span>" + nameHtml + "</span>" + tail + (ing.optional ? ' <span class="opt">optional</span>' : "");
}

/* ===== unsure words ===== */
export interface Unsure { uid: string; kind: "word" | "ing"; alts?: string[]; ing?: any; label: string }
export function unsureList(r: any): Unsure[] {
  const out: Unsure[] = [], seen: Record<string, number> = {};
  const scan = (t: string) => {
    String(t).replace(/\[\[(\w+)\|([^\]]*)\]\]/g, (all, id, rest) => {
      if (!seen[id]) { seen[id] = 1; out.push({ uid: id, kind: "word", alts: rest.split("|"), label: rest.split("|")[0] }); }
      return all;
    });
  };
  (r.ingredients || []).forEach((i: any) => {
    if (i.unsure && !i.unsure.done) out.push({ uid: "ing:" + i.id, kind: "ing", ing: i, label: amt2(i, 1).str + " " + plainName(i.name) });
    scan(i.name);
  });
  (r.steps || []).forEach((s: any) => scan(s.text));
  return out;
}
export function replaceWord(r: any, uid: string, val: string) {
  const re = new RegExp("\\[\\[" + uid + "\\|[^\\]]*\\]\\]", "g");
  r.ingredients.forEach((i: any) => { i.name = i.name.replace(re, val); });
  r.steps.forEach((s: any) => { s.text = s.text.replace(re, val); });
}
export function acceptAll(r: any) {
  unsureList(r).forEach((u) => { if (u.kind === "word") replaceWord(r, u.uid, u.alts![0]); else u.ing.unsure.done = true; });
}
/** A copy that is safe to store as a finished recipe: no markup left, no "unsure" flags. */
export function finishedDoc(r: any): any {
  const d = JSON.parse(JSON.stringify(r));
  acceptAll(d);
  (d.ingredients || []).forEach((i: any) => { delete i.unsure; });
  return d;
}
export function parseAmountText(txt: string, ing: any) {
  const m = String(txt).trim().match(/^([\d\s½¼¾⅓⅔⅛\/.]+?)\s*(cups?|c\.?|tbsp|tablespoons?|tsp|teaspoons?|oz|ounces?|lbs?|pounds?)?\s*$/i);
  if (!m) return null;
  const q = parseQty(m[1]);
  if (isNaN(q) || q <= 0) return null;
  let u = ing.unit;
  if (m[2]) { const w = m[2].toLowerCase(); u = /^(cup|c)/.test(w) ? "cup" : /^tb/.test(w) ? "tbsp" : /^(ts|tea)/.test(w) ? "tsp" : /^(oz|oun)/.test(w) ? "oz" : "lb"; }
  return { amount: q, unit: u };
}
