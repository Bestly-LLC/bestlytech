import { describe, expect, it } from "vitest";
import seed from "./seedRecipes.json";
import type { RecipeDoc } from "./types";
import {
  amountOf, capInfo, durRange, fStr, getSteps, haveFactor, mmss, numStr, ozNote, parseQty, partsStr, planOf, resolve,
  volParts, yieldStr, usedIds, noteSegs, nowrapSegs,
} from "./scale";

const R = seed.recipes as unknown as RecipeDoc[];
const byId = (id: string) => R.find((r) => r.id === id)!;
const ing = (r: RecipeDoc, id: string) => r.ingredients.find((i) => i.id === id)!;

describe("friendly fractions", () => {
  it("writes ⅛ ¼ ⅓ ½ ⅔ ¾ and mixed numbers", () => {
    expect(numStr(1 / 3)).toBe("⅓");
    expect(numStr(2 / 3)).toBe("⅔");
    expect(numStr(1.75)).toBe("1¾");
    expect(numStr(2)).toBe("2");
  });
  it("reads fractions people type", () => {
    expect(parseQty("1/2")).toBeCloseTo(0.5);
    expect(parseQty("1½")).toBeCloseTo(1.5);
    expect(parseQty("2")).toBe(2);
    expect(parseQty("two")).toBeNaN();
  });
  it("promotes and demotes units", () => {
    expect(partsStr(volParts(3))).toBe("1 tbsp");
    expect(partsStr(volParts(48))).toBe("1 cup");
    expect(partsStr(volParts(8))).toBe("2 tbsp + 2 tsp");
    expect(partsStr(volParts(0.05))).toBe("a pinch");
  });
});

describe("I only have… (almond flour cookies)", () => {
  const r = byId("almond-flour-cc-cookies");
  const f = haveFactor(ing(r, "almond"), 2, "cup");
  it("2 of 3 cups is two thirds", () => expect(f).toBeCloseTo(2 / 3));
  it("butter ⅓ cup", () => expect(amountOf(ing(r, "butter"), f).str).toBe("⅓ cup"));
  it("granulated sugar 2 tbsp + 2 tsp", () => expect(amountOf(ing(r, "gran"), f).str).toBe("2 tbsp + 2 tsp"));
  it("egg ⅔ with the beat-one-egg note", () => {
    const a = amountOf(ing(r, "egg"), f);
    expect(a.str).toBe("⅔ egg");
    expect(a.note).toBe("⅔ egg: beat 1 large egg, use about 2 tbsp + 1 tsp.");
  });
  it("vanilla 1⅓ tsp", () => expect(amountOf(ing(r, "vanilla"), f).str).toBe("1⅓ tsp"));
  it("chips ⅔ cup", () => expect(amountOf(ing(r, "chips"), f).str).toBe("⅔ cup"));
  it("almond flour itself is 2 cups", () => expect(amountOf(ing(r, "almond"), f).str).toBe("2 cups"));
  it("step text carries the live amounts inline", () => {
    const t = resolve(r, "Beat {butter}, {gran}, {egg} and {vanilla}.", f);
    expect(t.plain).toBe("Beat ⅓ cup, 2 tbsp + 2 tsp, ⅔ egg and 1⅓ tsp.");
    expect(t.notes).toHaveLength(1);
  });
  it("can't compare a different kind of unit", () => expect(haveFactor(ing(r, "egg"), 2, "cup")).toBeNaN());
});

describe("pineapple tepache", () => {
  const r = byId("pineapple-tepache");
  it("ranges scale both ends at 2×", () => {
    expect(amountOf(ing(r, "sugar"), 2).str).toBe("1½–2 cups");
    expect(amountOf(ing(r, "water"), 2).str).toBe("20–24 cups");
    expect(amountOf(ing(r, "clove"), 2).str).toBe("8–10");
  });
  it("countables round to sensible halves", () => expect(amountOf(ing(r, "pine"), 0.5).str).toBe("½"));
  it("a tiny amount is a pinch", () => {
    const tiny = { id: "x", name: "salt", amount: 0.1, unit: "tsp" };
    expect(amountOf(tiny, 1).str).toBe("a pinch");
  });
  it("warns that a bigger batch needs a second jar", () => expect(r.yield.max_note).toMatch(/second jar/));
});

describe("espresso martini", () => {
  const r = byId("espresso-martini");
  it("garnish beans (no_scale) stay at 3 at any size", () => {
    expect(amountOf(ing(r, "beans"), 4).str).toBe("3");
    expect(amountOf(ing(r, "beans"), 0.5).str).toBe("3");
  });
  it("oz scales and keeps a clean fraction", () => expect(amountOf(ing(r, "vodka"), 2).str).toBe("4 oz"));
});

describe("timers and temperatures never scale", () => {
  const r = byId("almond-flour-cc-cookies");
  it("the bake step keeps 375°F and its timer at 3×", () => {
    const step = r.steps.find((s) => /Heat the oven/.test(s.title))!;
    expect(resolve(r, step.text, 3).plain).toBe(step.text);
    const bake = r.steps.find((s) => s.title === "Bake")!;
    expect(bake.timer_sec).toBe(600);
  });
});

describe("OmniCook capacity (cottage cheese bagels)", () => {
  const r = byId("cottage-cheese-bagels-omnicook");
  it("this recipe is the max batch", () => expect(capInfo(r)!.maxF).toBe(1));
  it("OmniCook caps a 2× ask at 1× and says so", () => {
    const p = planOf(r, { factor: 2, omni: true, split: false });
    expect(p.capped).toBe(true);
    expect(p.eff).toBe(1);
    expect(p.n).toBe(1);
  });
  it("splitting makes two batches of 1× with Batch 1 of 2 labels", () => {
    const p = planOf(r, { factor: 2, omni: true, split: true });
    expect(p.n).toBe(2);
    expect(p.eff).toBe(1);
    const steps = getSteps(r, p, null);
    expect(steps[0].batchLabel).toBe("Batch 1 of 2");
    expect(steps.some((s) => s.batchLabel === "Batch 2 of 2")).toBe(true);
    expect(steps).toHaveLength(r.omnicook_steps!.length * 2);
  });
  it("stovetop mode isn't capped", () => {
    const p = planOf(r, { factor: 2, omni: false, split: false });
    expect(p.capped).toBe(false);
    expect(p.eff).toBe(2);
  });
  it("ounces scale alongside cups", () => {
    expect(ozNote(ing(r, "flour"), 1)).toBe("21.2 oz");
    expect(ozNote(ing(r, "flour"), 0.5)).toBe("10.6 oz");
  });
  it("a smaller batch fits without a warning", () => {
    const p = planOf(r, { factor: 0.5, omni: true, split: false });
    expect(p.capped).toBe(false);
    expect(p.n).toBe(1);
  });
});

describe("OmniCook toggle on recipes without one", () => {
  it("'none' ignores the toggle", () => {
    const r = byId("creamy-caesar-dressing");
    expect(planOf(r, { factor: 2, omni: true, split: false }).omni).toBe(false);
  });
});

describe("display helpers", () => {
  it("yield lines", () => {
    expect(yieldStr(byId("cottage-cheese-alfredo"), 2)).toBe("4 servings");
    expect(yieldStr(byId("almond-flour-cc-cookies"), 1)).toBe("about 24 cookies");
  });
  it("durations are friendly", () => {
    expect(durRange(300, 600)).toBe("5–10 min");
    expect(durRange(30)).toBe("30 sec");
    expect(durRange(3600, 4500)).toBe("60–75 min");
    expect(mmss(75)).toBe("1:15");
  });
  it("fStr", () => {
    expect(fStr(2 / 3)).toBe("⅔×");
    expect(fStr(2)).toBe("2×");
  });
  it("numbers stay glued to their unit", () => {
    expect(nowrapSegs("Bake at 425°F for 20–22 minutes.").filter((s) => s.k === "nw").map((s) => s.s)).toEqual(["425°F", "20–22 minutes"]);
    expect(noteSegs("⅔ egg: beat 1 large egg, use about 2 tbsp + 1 tsp.").filter((s) => s.k === "nw").map((s) => s.s)).toContain("2 tbsp + 1 tsp");
  });
  it("every {token} in every step points at a real ingredient", () => {
    for (const r of R) {
      for (const st of [...r.steps, ...(r.omnicook_steps ?? [])]) {
        for (const t of st.text.match(/\{(\w+)\}/g) ?? []) {
          expect(r.ingredients.some((i) => i.id === t.slice(1, -1)), `${r.id}: ${t}`).toBe(true);
        }
      }
      expect(usedIds(r, r.steps).length).toBeGreaterThan(0);
    }
  });
});
