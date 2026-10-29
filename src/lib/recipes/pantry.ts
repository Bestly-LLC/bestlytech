// What Basil's pantry says about a recipe. The server (recipe_pantry_map) matches each ingredient id to a pantry item;
// this file turns that into the plain sentences the page shows, and works out the biggest batch where the pantry has real quantities.

import type { RecipeDoc, RIngredient } from "./types";
import { TSP, shortName, fStr } from "./scale";

export interface PantryEntry { item_id: string; item: string; status: "have" | "low" | "out" | "arriving"; qty: number | null; unit: string | null }
export type PantryMap = Record<string, PantryEntry | null>;

export interface PantryReport {
  have: string[]; low: string[]; out: string[]; coming: string[]; unknown: string[];
  /** Names to put on the groceries list: used up, plus anything Basil does not track (basics like water and salt excluded). */
  toBuy: string[];
  /** Biggest batch the counted ingredients allow, floored to 1/24, or null when no ingredient has a usable quantity. */
  best: number | null; limit: string | null; counted: number;
  alts: string[];
}

const BASICS = /\b(water|ice|salt|pepper)\b/i;
/** Teaspoons in one pantry unit (volume). */
const P_TSP: Record<string, number> = { tsp: 1, tbsp: 3, cup: 48, "fl oz": 6, gal: 768, l: 202.88, ml: 0.2029 };
const P_OZ: Record<string, number> = { oz: 1, lb: 16 };
const P_COUNT = new Set(["ct", "each", "count", "egg", "eggs", "piece", "pieces"]);

/** How many times the recipe's amount the pantry holds (1 = exactly one batch), or NaN when the units cannot be compared. */
export function pantryRatio(ing: RIngredient, p: PantryEntry): number {
  if (ing.amount == null || ing.no_scale || p.qty == null || !(p.qty > 0)) return NaN;
  const u = (p.unit ?? "").toLowerCase();
  if (TSP[ing.unit]) {
    if (P_TSP[u]) return (p.qty * P_TSP[u]) / (ing.amount * TSP[ing.unit]);
    if (P_OZ[u] && ing.oz != null) return (p.qty * P_OZ[u]) / ing.oz;
    return NaN;
  }
  if (ing.unit === "oz") return P_OZ[u] ? (p.qty * P_OZ[u]) / ing.amount : NaN;
  if (ing.unit === "count" || ing.unit === "egg") return u === "" || P_COUNT.has(u) ? p.qty / ing.amount : NaN;
  return NaN;
}

export function pantryReport(doc: Pick<RecipeDoc, "ingredients">, map: PantryMap | null | undefined): PantryReport {
  const rep: PantryReport = { have: [], low: [], out: [], coming: [], unknown: [], toBuy: [], best: null, limit: null, counted: 0, alts: [] };
  const m = map ?? {};
  let best = Infinity;
  for (const ing of doc.ingredients) {
    if (ing.optional || ing.amount == null) continue;
    const name = shortName(ing.name);
    const p = m[ing.id] ?? null;
    if (!p) {
      if (BASICS.test(name)) continue;
      rep.unknown.push(name); rep.toBuy.push(name);
      continue;
    }
    if (p.status === "out") { rep.out.push(name); rep.toBuy.push(name); continue; }
    if (p.status === "arriving") { rep.coming.push(name); continue; }
    (p.status === "low" ? rep.low : rep.have).push(name);
    if (/ or /.test(ing.name) && p.item && !new RegExp(p.item.split(" ")[0], "i").test(shortName(ing.name))) rep.alts.push(`Using ${p.item.toLowerCase()} for ${shortName(ing.name)}.`);
    const r = pantryRatio(ing, p);
    if (!Number.isNaN(r)) { rep.counted++; if (r < best) { best = r; rep.limit = name; } }
  }
  rep.best = Number.isFinite(best) ? Math.floor(best * 24 + 1e-9) / 24 : null;
  return rep;
}

export function bestLabel(best: number): string { return best > 4 ? "4× or more" : fStr(best); }

/** "a, b and c" */
export function listWords(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1];
}
