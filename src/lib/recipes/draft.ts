// Drafts from Basil's photo / link reader come back in US units but may use units the scaler does not know (lb, fl oz, clove, can...).
// Before the review screen, fold those into the units the page can scale: cup, tbsp, tsp, oz, count, egg. Nothing else is changed.

import type { RecipeDoc, RIngredient } from "./types";

export const SCALABLE_UNITS = ["cup", "tbsp", "tsp", "oz", "count", "egg"] as const;

export function normalizeIngredient(i: RIngredient): RIngredient {
  const out: RIngredient = { ...i };
  const u = String(out.unit ?? "").trim().toLowerCase();
  out.unit = u;
  if (out.amount == null) return out;
  const conv = (mult: number, unit: string) => {
    out.amount = out.amount! * mult;
    if (out.amount_max != null) out.amount_max = out.amount_max * mult;
    out.unit = unit;
  };
  if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") conv(16, "oz");
  else if (u === "fl oz" || u === "fluid ounce" || u === "fluid ounces") conv(2, "tbsp");
  else if (u === "cups") out.unit = "cup";
  else if (u === "tablespoon" || u === "tablespoons" || u === "tbsps") out.unit = "tbsp";
  else if (u === "teaspoon" || u === "teaspoons" || u === "tsps") out.unit = "tsp";
  else if (u === "ounce" || u === "ounces") out.unit = "oz";
  else if (u === "eggs") out.unit = "egg";
  else if (u === "pinch" || u === "dash") { conv(1 / 16, "tsp"); }
  else if (!(SCALABLE_UNITS as readonly string[]).includes(u)) {
    // clove, can, stick, piece, slice... all read as a count of the thing named
    out.unit = "count";
    if (u && u !== "count" && !new RegExp("\\b" + u.replace(/[^a-z]/g, "") + "s?\\b", "i").test(out.name)) out.name = `${u}${/s$/.test(u) ? "" : "s"} ${out.name}`.replace(/\s+/g, " ");
  }
  return out;
}

export function normalizeDraft(d: RecipeDoc): RecipeDoc {
  return { ...d, ingredients: d.ingredients.map(normalizeIngredient) };
}
