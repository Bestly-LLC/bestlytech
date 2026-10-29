// Recipe scaling math, ported as-is from the approved preview (recipes/preview.html, SCALE-START..SCALE-END) and
// extended with the pure helpers the page needs (step text, durations, yield lines). No DOM, no React: everything
// here is testable in node. House rules baked in: US units, friendly fractions, amount + unit never split
// (callers render "amt" and "nw" segments with white-space: nowrap).

import type { AmountOut, CapInfo, Plan, RecipeDoc, RIngredient, RStep, ScaleState, Seg, Resolved, OmniSettings } from "./types";

const FRAC_V = [0, 1 / 8, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1];
const FRAC_C = ["", "⅛", "¼", "⅓", "½", "⅔", "¾", ""];
export const TSP: Record<string, number> = { tsp: 1, tbsp: 3, cup: 48 };
const EGG_TSP = 9.75; // 1 large egg is about 3¼ tbsp
const UF: Record<string, number> = { "⅛": 0.125, "¼": 0.25, "⅓": 1 / 3, "½": 0.5, "⅔": 2 / 3, "¾": 0.75 };

export function snapFrac(x: number): { w: number; i: number } {
  let w = Math.floor(x + 1e-9);
  const fr = Math.max(0, x - w);
  let bi = 0, bd = 9;
  for (let i = 0; i < FRAC_V.length; i++) {
    const d = Math.abs(fr - FRAC_V[i]);
    if (d < bd - 1e-12) { bd = d; bi = i; }
  }
  if (bi === 7) { w += 1; bi = 0; }
  return { w, i: bi };
}
export function snapVal(x: number): number { const s = snapFrac(x); return s.w + FRAC_V[s.i]; }
export function numStr(x: number): string {
  const s = snapFrac(x);
  if (s.w === 0 && s.i === 0) return "0";
  if (s.w === 0) return FRAC_C[s.i];
  return s.i ? "" + s.w + FRAC_C[s.i] : "" + s.w;
}
export function parseQty(input: unknown): number {
  const str = String(input == null ? "" : input).trim();
  if (!str) return NaN;
  const toks = str.replace(/([0-9])([⅛¼⅓½⅔¾])/g, "$1 $2").split(/\s+/);
  let tot = 0;
  for (const t of toks) {
    if (UF[t] != null) tot += UF[t];
    else if (/^\d+\/\d+$/.test(t)) { const p = t.split("/"); tot += +p[0] / +p[1]; }
    else if (/^\d*\.?\d+$/.test(t)) tot += parseFloat(t);
    else return NaN;
  }
  return tot;
}

/** A piece of a volume: [{n:'1⅓',u:'tsp',val:1.333}] or a raw phrase such as "a pinch". */
export interface VolPart { n?: string; u?: string; val?: number; raw?: string }

function smallParts(Tin: number): VolPart[] {
  let T = Tin;
  if (T < 3 - 1e-9) {
    const v = snapVal(T);
    if (v < 3 - 1e-9) return [{ n: numStr(T), u: "tsp", val: v }];
    T = 3;
  }
  let w = Math.floor(T / 3 + 1e-9), rs = snapVal(T - 3 * w);
  if (rs >= 3 - 1e-9) { w += 1; rs = 0; }
  if (w >= 4) return cupParts(w * 3 + rs);
  if (rs < 0.3) rs = 0;
  if (rs === 0) return [{ n: "" + w, u: "tbsp", val: w }];
  if (Math.abs(rs - 0.75) < 1e-6) return [{ n: w + "¼", u: "tbsp", val: w + 0.25 }];
  if (Math.abs(rs - 1.5) < 1e-6) return [{ n: w + "½", u: "tbsp", val: w + 0.5 }];
  if (Math.abs(rs - 2.25) < 1e-6) return [{ n: w + "¾", u: "tbsp", val: w + 0.75 }];
  return [{ n: "" + w, u: "tbsp", val: w }, { n: numStr(rs), u: "tsp", val: rs }];
}
function cupParts(T: number): VolPart[] {
  const tol = Math.min(1.5, Math.max(1, 0.03 * T));
  let w = Math.floor(T / 48 + 1e-9), rem = T - 48 * w, fc = "", small: VolPart[] = [];
  if (rem >= 48 - tol) { w += 1; rem = 0; }
  const cands: [number, string][] = [[12, "¼"], [16, "⅓"], [24, "½"], [32, "⅔"], [36, "¾"]];
  if (rem <= tol && w >= 1) { rem = 0; }
  else {
    let bd = 1e9, bc: [number, string] | null = null;
    for (const c of cands) { const d = Math.abs(rem - c[0]); if (d < bd) { bd = d; bc = c; } }
    if (bc && bd <= tol) { fc = bc[1]; rem = 0; }
    if (!fc && rem >= 12 - 1e-9) {
      for (let k = cands.length - 1; k >= 0; k--) {
        if (cands[k][0] <= rem + 1e-9) { fc = cands[k][1]; rem -= cands[k][0]; break; }
      }
    }
    if (rem > 0) { const rr = Math.round(rem * 2) / 2; if (rr >= 0.5) small = smallParts(rr); }
  }
  const parts: VolPart[] = [];
  const cupVal = w + (fc ? FRAC_V[FRAC_C.indexOf(fc)] : 0);
  if (cupVal > 0) parts.push({ n: w ? (fc ? "" + w + fc : "" + w) : fc, u: "cup", val: cupVal });
  return parts.concat(small);
}
/** Teaspoons in, friendly parts out ("⅓ cup", "2 tbsp + 2 tsp", "a pinch"). */
export function volParts(T: number): VolPart[] {
  if (T < 0.125 - 1e-9) return [{ raw: "a pinch" }];
  if (T < 12 - 1e-9) return smallParts(T);
  return cupParts(T);
}
function unitWord(p: VolPart): string { return p.u === "cup" && (p.val ?? 0) > 1 + 1e-9 ? "cups" : (p.u ?? ""); }
export function partsStr(ps: VolPart[]): string { return ps.map((p) => (p.raw ? p.raw : p.n + " " + unitWord(p))).join(" + "); }
function rangeStr(pa: VolPart[], pb: VolPart[]): string {
  const sa = partsStr(pa), sb = partsStr(pb);
  if (sa === sb) return sa;
  if (pa.length === 1 && pb.length === 1 && pa[0].u && pa[0].u === pb[0].u) return pa[0].n + "–" + pb[0].n + " " + unitWord(pb[0]);
  if (pa.length > 1 || pb.length > 1) return sa + " to " + sb;
  return sa + "–" + sb;
}
function roundCount(v: number): number { let r = v < 4 ? Math.round(v * 2) / 2 : Math.round(v); if (r < 0.5) r = 0.5; return r; }
function ozFmt(v: number): string { const s = v < 1 ? v.toFixed(2) : v.toFixed(1); return s.replace(/\.?0+$/, ""); }

export function amountOf(ing: RIngredient, f: number): AmountOut {
  if (ing.amount == null) return { none: true, str: "", listLead: "", n: 0, note: null };
  const mult = ing.no_scale ? 1 : f;
  const lo = ing.amount * mult, hi = ing.amount_max != null ? ing.amount_max * mult : null;
  const u = ing.unit;
  let out: AmountOut;
  if (TSP[u]) {
    const A = volParts(lo * TSP[u]);
    const str = hi == null ? partsStr(A) : rangeStr(A, volParts(hi * TSP[u]));
    out = { str, listLead: str, n: ((hi == null ? lo : hi) * TSP[u]) / 48, note: null };
  } else if (u === "oz") {
    const a = numStr(lo), str = hi == null ? a + " oz" : a + "–" + numStr(hi) + " oz";
    out = { str, listLead: str, n: hi == null ? lo : hi, note: null };
  } else if (u === "count") {
    const rl = ing.no_scale ? lo : roundCount(lo), rh = hi == null ? null : ing.no_scale ? hi : roundCount(hi);
    const str = rh == null ? numStr(rl) : numStr(rl) === numStr(rh) ? numStr(rl) : numStr(rl) + "–" + numStr(rh);
    let note: string | null = null;
    if (!ing.no_scale && Math.abs(f - 1) > 1e-9) {
      const dev = Math.max(Math.abs(rl - lo) / lo, rh == null || hi == null ? 0 : Math.abs(rh - hi) / hi);
      if (dev > 0.2) note = "Exact would be about " + Math.round((hi == null ? lo : hi) * 100) / 100 + ", rounded to " + str + ".";
    }
    out = { str, listLead: str, n: rh == null ? rl : rh, note };
  } else if (u === "egg") {
    const v = snapVal(lo), whole = Math.abs(v - Math.round(v)) < 1e-6;
    const str = numStr(lo) + (v > 1 + 1e-9 ? " eggs" : " egg");
    let note: string | null = null;
    if (!whole) {
      const k = Math.ceil(v - 1e-9), tsp = Math.round(v * EGG_TSP + 1e-9);
      note = str + ": beat " + k + " large egg" + (k > 1 ? "s" : "") + ", use about " + partsStr(volParts(tsp)) + ".";
    }
    out = { str, listLead: numStr(lo), n: v, note };
  } else {
    out = { str: ing.unit || "", listLead: "", n: 0, note: null };
  }
  return out;
}
export function ozNote(ing: RIngredient, f: number): string | null {
  const base = ing.oz != null ? ing.oz : ing.approx_oz != null ? ing.approx_oz : null;
  if (base == null) return null;
  return (ing.oz == null ? "about " : "") + ozFmt(base * (ing.no_scale ? 1 : f)) + " oz";
}
export function altNote(ing: RIngredient, f: number): string | null {
  if (!ing.alt) return null;
  const m = String(ing.alt).match(/^(\S+)\s+(\w+)s?$/);
  if (!m) return ing.alt;
  const q = parseQty(m[1]);
  if (isNaN(q)) return ing.alt;
  const v = q * (ing.no_scale ? 1 : f);
  return numStr(v) + " " + m[2] + (snapVal(v) > 1 + 1e-9 ? "s" : "");
}
export const PLURALS: [RegExp, string][] = [
  [/^(\s*(?:small )?garlic clove)s?(?![A-Za-z])/, "s"], [/^(\s*whole clove)s?(?![A-Za-z])/, "s"], [/^(\s*cinnamon stick)s?(?![A-Za-z])/, "s"],
  [/^(\s*(?:ripe )?pineapple)s?(?![A-Za-z])/, "s"], [/^(\s*espresso)s?(?![A-Za-z])/, "s"], [/^(\s*(?:large )?egg)s?(?![A-Za-z])/, "s"],
];
export function pluralLead(seg: string, n: number): string {
  const pl = n > 1 + 1e-9;
  for (const p of PLURALS) {
    const m = seg.match(p[0]);
    if (m) return m[1] + (pl ? p[1] : "") + seg.slice(m[0].length);
  }
  const m = seg.match(/^(\s*(?:dried )?chile)s?( de árbol)/);
  if (m) return m[1] + (pl ? "s" : "") + m[2] + seg.slice(m[0].length);
  return seg;
}
export function haveUnits(ing: RIngredient): string[] {
  if (TSP[ing.unit]) return ["cup", "tbsp", "tsp"].concat(ing.oz != null ? ["oz"] : []);
  if (ing.unit === "oz") return ["oz"];
  if (ing.unit === "egg") return ["egg"];
  return ["count"];
}
/** "I only have…": the factor that makes `amt` `unit` of this ingredient the whole batch. NaN when it can't be compared. */
export function haveFactor(ing: RIngredient, amt: number, unit: string): number {
  const need = ing.amount;
  if (need == null || ing.no_scale || !(amt > 0)) return NaN;
  if (TSP[unit] && TSP[ing.unit]) return (amt * TSP[unit]) / (need * TSP[ing.unit]);
  if (unit === "oz" && ing.oz != null) return amt / ing.oz;
  if (unit === ing.unit || (unit === "count" && ing.unit === "count") || (unit === "egg" && ing.unit === "egg")) return amt / need;
  return NaN;
}
export function fStr(f: number): string {
  const s = snapVal(f);
  return (Math.abs(s - f) < 0.01 ? numStr(f) : Math.round(f * 100) / 100 + "") + "×";
}
export function capInfo(r: Pick<RecipeDoc, "omnicook_capacity" | "ingredients">): CapInfo | null {
  const c = r.omnicook_capacity;
  if (!c) return null;
  let base = c.base_dough_oz;
  if (base == null) {
    base = 0;
    r.ingredients.forEach((i) => { if (i.oz != null && !/\(boil\)/.test(i.name)) base! += i.oz; });
  }
  if (!(base > 0)) return null;
  const maxF = Math.max(0.125, Math.floor(((c.max_dough_oz * 1.02) / base) * 8) / 8);
  return { base, max: c.max_dough_oz, maxF };
}
export function planOf(r: Pick<RecipeDoc, "omnicook" | "omnicook_capacity" | "ingredients">, s: ScaleState): Plan {
  const omni = !!(s.omni && r.omnicook && r.omnicook !== "none");
  const cap = omni ? capInfo(r) : null;
  let eff = s.factor, n = 1, capped = false;
  if (cap && s.factor > cap.maxF + 1e-9) {
    if (s.split) { n = Math.ceil(s.factor / cap.maxF - 1e-9); eff = s.factor / n; }
    else { eff = cap.maxF; capped = true; }
  }
  return { f: s.factor, eff, n, capped, cap, omni };
}

/* ---------- text, durations, yield (pure helpers used by the page) ---------- */

const NOWRAP_RE = /([0-9½¼¾⅓⅔⅛][0-9.½¼¾⅓⅔⅛]*(?:[–-][0-9½¼¾⅓⅔⅛][0-9.½¼¾⅓⅔⅛]*)?(?:\s|-)?(?:°F|cups?|tbsp|tsp|oz|minutes?|min|seconds?|sec|inches|inch|hours?|hr)(?![A-Za-z]))/g;
/** Wraps every number+unit in plain text so it can never break across lines. */
export function nowrapSegs(text: string): Seg[] {
  const out: Seg[] = [];
  text.split(NOWRAP_RE).forEach((p, i) => { if (p === "") return; out.push({ k: i % 2 ? "nw" : "txt", s: p }); });
  return out;
}
const NOTE_RE = /((?:\d[\d½¼¾⅓⅔⅛]*(?:–[\d½¼¾⅓⅔⅛]+)?|[½¼¾⅓⅔⅛])(?: (?:egg|eggs|cups?|tbsp|tsp))(?: \+ \d[\d½¼¾⅓⅔⅛]* (?:cups?|tbsp|tsp))*|a pinch)/;
/** A scaling note ("⅔ egg: beat 1 large egg, use about 2 tbsp + 1 tsp.") with every amount kept together. */
export function noteSegs(n: string): Seg[] {
  const out: Seg[] = [];
  n.split(NOTE_RE).forEach((p, i) => { if (p === "") return; out.push({ k: i % 2 ? "nw" : "txt", s: p }); });
  return out;
}
function segToks(seg: string, f: number): Seg[] {
  const out: Seg[] = [];
  const RE = /(\b\d+(?:–\d+)? pieces\b|\bor \d+ of\b)/;
  seg.split(RE).forEach((p, i) => {
    if (!p) return;
    if (i % 2 && Math.abs(f - 1) > 1e-9) out.push({ k: "amt", s: p.replace(/\d+/g, (m) => String(Math.max(1, Math.round(+m * f)))) });
    else out.push({ k: "txt", s: p });
  });
  return out;
}
/** Step text with every {ingredient_id} token replaced by its live scaled amount. */
export function resolve(r: Pick<RecipeDoc, "ingredients">, text: string, f: number): Resolved {
  const parts = text.split(/(\{\w+\})/);
  const segs: Seg[] = [];
  let plain = "";
  const notes: Seg[][] = [];
  let prev: number | null = null;
  parts.forEach((p) => {
    const m = p.match(/^\{(\w+)\}$/);
    if (m) {
      const ing = r.ingredients.find((x) => x.id === m[1]);
      if (!ing) { segs.push({ k: "txt", s: p }); plain += p; prev = null; return; }
      const a = amountOf(ing, f), s = a.none ? ing.unit || "" : a.str;
      segs.push({ k: "amt", s }); plain += s;
      if (a.note) notes.push(noteSegs(a.note));
      prev = ing.unit === "count" ? a.n : null;
    } else {
      let seg = p;
      if (prev != null) { seg = pluralLead(seg, prev); prev = null; }
      segToks(seg, f).forEach((tk) => {
        if (tk.k === "amt") segs.push(tk); else nowrapSegs(tk.s).forEach((x) => segs.push(x));
        plain += tk.s;
      });
    }
  });
  return { segs, plain, notes };
}
export function fmtDur(sec: number): string {
  if (sec < 60) return sec + " sec";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h && !m && !s) return h + " hr";
  if (h) return h + " hr" + (m ? " " + m + " min" : "");
  return m + " min" + (s ? " " + s + " sec" : "");
}
export function durRange(lo: number, hi?: number | null): string {
  if (!hi || hi === lo) return fmtDur(lo);
  if (lo % 60 === 0 && hi % 60 === 0) return lo / 60 + "–" + hi / 60 + " min";
  return fmtDur(lo) + "–" + fmtDur(hi);
}
export function mmss(secIn: number): string {
  const sec = Math.max(0, Math.ceil(secIn));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0") : m + ":" + String(s).padStart(2, "0");
}
export function machineChips(o?: OmniSettings | null): { t: string; k?: boolean }[] {
  if (!o) return [];
  const c: { t: string; k?: boolean }[] = [];
  if (o.mode) c.push({ t: o.mode, k: true }); else if (o.speed != null) c.push({ t: "Speed " + o.speed });
  if (o.time_sec) c.push({ t: fmtDur(o.time_sec) });
  if (o.temp_f) c.push({ t: o.temp_f + "°F" });
  return c;
}
const rng = (a: number | [number, number]) => (Array.isArray(a) ? a[0] + "–" + a[1] : "" + a);
export function timeBits(r: Pick<RecipeDoc, "time">): string[] {
  const t = r.time || {}, b: string[] = [];
  if (t.total_min) b.push(t.total_min + " min total");
  if (t.prep_min) b.push(t.prep_min + " min prep");
  if (t.ferment_days) b.push(rng(t.ferment_days) + " days ferment");
  if (t.rise_min) b.push("Rise " + rng(t.rise_min) + " min");
  if (t.bake_min) b.push("Bake " + rng(t.bake_min) + " min");
  return b;
}
const UNITW: Record<string, [string, string]> = {
  servings: ["serving", "servings"], cookies: ["cookie", "cookies"], bagels: ["bagel", "bagels"],
  "large bagels": ["large bagel", "large bagels"], gallon: ["gallon", "gallons"], drink: ["drink", "drinks"],
};
export function yieldStr(r: Pick<RecipeDoc, "yield">, f: number): string {
  const y = r.yield;
  if (!y) return "";
  const q = (v: number) => { const x = v * f; return x >= 3 ? "" + Math.round(x) : numStr(x); };
  let n = q(y.amount);
  if (y.amount_max != null) { const m = q(y.amount_max); if (m !== n) n = n + "–" + m; }
  const top = y.amount_max != null ? y.amount_max * f : y.amount * f, w = UNITW[y.unit] || [y.unit, y.unit];
  return (y.estimated ? "about " : "") + n + " " + (top > 1 + 1e-9 ? w[1] : w[0]);
}
export function yieldAlt(r: Pick<RecipeDoc, "yield">, f: number): string | null {
  const a = r.yield && r.yield.alt;
  if (!a) return null;
  const m = a.match(/^(or )?([\d.½¼¾⅓⅔⅛ ]+?)\s+(cups?|\w+)$/);
  if (!m) return a;
  const q = parseQty(m[2]);
  if (isNaN(q)) return a;
  if (/^cups?$/.test(m[3])) return (m[1] || "") + partsStr(volParts(q * f * 48));
  return (m[1] || "") + Math.max(1, Math.round(q * f)) + " " + m[3];
}
export function servesLine(r: Pick<RecipeDoc, "yield">, f: number): string {
  const y = r.yield;
  if (!y) return "";
  return (y.unit === "servings" ? "Serves " : "Makes ") + yieldStr(r, f);
}
export const shortName = (n: string) => String(n).split(/[,(]/)[0].trim();

export interface PlannedStep extends RStep { b: number; bi: number; batchLabel: string | null }
/** The steps to show: the machine steps in OmniCook mode, repeated per batch when a big batch is split. */
export function getSteps(r: Pick<RecipeDoc, "steps" | "omnicook_steps">, pl: Plan, batch: number | null): PlannedStep[] {
  const base = pl.omni && r.omnicook_steps ? r.omnicook_steps : r.steps;
  const out: PlannedStep[] = [];
  const bs = batch ? [batch] : Array.from({ length: pl.n }, (_, i) => i + 1);
  bs.forEach((b) => base.forEach((st, i) => out.push({ ...st, b, bi: i, batchLabel: pl.n > 1 ? "Batch " + b + " of " + pl.n : null })));
  return out;
}
/** Ingredient ids that appear as {tokens} in these steps, in first-use order. */
export function usedIds(r: Pick<RecipeDoc, "ingredients">, steps: { text: string }[]): string[] {
  const ids: string[] = [];
  steps.forEach((st) => {
    const toks: string[] = st.text.match(/\{(\w+)\}/g) ?? [];
    toks.forEach((t) => {
      const id = t.slice(1, -1);
      if (!ids.includes(id) && r.ingredients.some((i) => i.id === id)) ids.push(id);
    });
  });
  return ids;
}
/** The "Try: have …" example the preview offered, built from the recipe itself. */
export function exampleHave(r: Pick<RecipeDoc, "id" | "ingredients">): { id: string; amt: string; unit: string; label: string } {
  if (r.id === "almond-flour-cc-cookies") return { id: "almond", amt: "2", unit: "cup", label: "2 cups almond flour" };
  const ing = r.ingredients.find((i) => i.amount != null && !i.no_scale) || r.ingredients[0];
  const half = (ing.amount ?? 1) / 2, u = ing.unit;
  const A = TSP[u] ? partsStr(volParts(half * TSP[u])) : u === "count" ? numStr(half) : numStr(half) + " " + u;
  return { id: ing.id, amt: String(half), unit: TSP[u] ? u : haveUnits(ing)[0], label: A + " " + shortName(ing.name) };
}
