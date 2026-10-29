import { describe, expect, it } from "vitest";
import { pantryReport, pantryRatio, listWords, type PantryMap } from "./pantry";
import { normalizeIngredient } from "./draft";
import type { RIngredient } from "./types";

const ing = (o: Partial<RIngredient> & { id: string; name: string }): RIngredient => ({ amount: 1, unit: "cup", ...o });

describe("pantryRatio", () => {
  it("compares cups with cups and fl oz with cups", () => {
    const flour = ing({ id: "f", name: "flour", amount: 2, unit: "cup" });
    expect(pantryRatio(flour, { item_id: "1", item: "Flour", status: "have", qty: 4, unit: "cup" })).toBeCloseTo(2);
    expect(pantryRatio(flour, { item_id: "1", item: "Flour", status: "have", qty: 16, unit: "fl oz" })).toBeCloseTo(1);
  });
  it("uses pounds against ounces and counts against eggs", () => {
    expect(pantryRatio(ing({ id: "c", name: "cheese", amount: 8, unit: "oz" }), { item_id: "1", item: "Cheese", status: "have", qty: 1, unit: "lb" })).toBeCloseTo(2);
    expect(pantryRatio(ing({ id: "e", name: "egg", amount: 2, unit: "egg" }), { item_id: "1", item: "Eggs", status: "have", qty: 6, unit: "ct" })).toBeCloseTo(3);
  });
  it("gives NaN when there is no quantity or the units do not match", () => {
    expect(pantryRatio(ing({ id: "f", name: "flour" }), { item_id: "1", item: "Flour", status: "have", qty: null, unit: null })).toBeNaN();
    expect(pantryRatio(ing({ id: "f", name: "flour" }), { item_id: "1", item: "Flour", status: "have", qty: 2, unit: "bottles" })).toBeNaN();
  });
});

describe("pantryReport", () => {
  const doc = { ingredients: [
    ing({ id: "a", name: "almond flour", amount: 3, unit: "cup" }),
    ing({ id: "b", name: "chocolate chips", amount: 1, unit: "cup" }),
    ing({ id: "s", name: "salt", amount: 0.5, unit: "tsp" }),
    ing({ id: "x", name: "baking soda", amount: 0.5, unit: "tsp" }),
    ing({ id: "o", name: "sprinkles", amount: 1, unit: "tbsp", optional: true }),
  ] };
  const map: PantryMap = {
    a: { item_id: "1", item: "Almond flour", status: "have", qty: 6, unit: "cup" },
    b: { item_id: "2", item: "Chocolate chips", status: "out", qty: null, unit: null },
    s: null, x: null, o: null,
  };
  it("sorts ingredients into have, out and not tracked, and skips basics and optionals", () => {
    const r = pantryReport(doc, map);
    expect(r.have).toEqual(["almond flour"]);
    expect(r.out).toEqual(["chocolate chips"]);
    expect(r.unknown).toEqual(["baking soda"]);
    expect(r.toBuy).toEqual(["chocolate chips", "baking soda"]);
  });
  it("finds the biggest batch only from ingredients with real quantities", () => {
    const r = pantryReport(doc, map);
    expect(r.best).toBeCloseTo(2);
    expect(r.limit).toBe("almond flour");
    expect(r.counted).toBe(1);
  });
  it("has no biggest batch when nothing has a quantity", () => {
    const r = pantryReport(doc, { ...map, a: { item_id: "1", item: "Almond flour", status: "have", qty: null, unit: null } });
    expect(r.best).toBeNull();
  });
});

describe("listWords", () => {
  it("joins with commas and and", () => {
    expect(listWords(["a"])).toBe("a");
    expect(listWords(["a", "b"])).toBe("a and b");
    expect(listWords(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("normalizeIngredient", () => {
  it("turns pounds into ounces and fluid ounces into tablespoons", () => {
    expect(normalizeIngredient({ id: "a", name: "butter", amount: 0.5, unit: "lb" })).toMatchObject({ amount: 8, unit: "oz" });
    expect(normalizeIngredient({ id: "b", name: "cream", amount: 4, unit: "fl oz" })).toMatchObject({ amount: 8, unit: "tbsp" });
  });
  it("reads cloves and cans as a count of that thing", () => {
    expect(normalizeIngredient({ id: "g", name: "garlic", amount: 3, unit: "clove" })).toMatchObject({ amount: 3, unit: "count", name: "cloves garlic" });
    expect(normalizeIngredient({ id: "t", name: "garlic cloves", amount: 3, unit: "clove" })).toMatchObject({ unit: "count", name: "garlic cloves" });
  });
  it("leaves amounts without numbers alone", () => {
    expect(normalizeIngredient({ id: "s", name: "salt", amount: null, unit: "to taste" })).toMatchObject({ amount: null, unit: "to taste" });
  });
});
