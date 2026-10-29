import { describe, expect, it } from "vitest";
import { PEOPLE, appTitle, bookTitle, canEditRecipe, canSeeId, manifestFor, otherReviewers, showsOmniCook, visLine, type Role } from "./people";
import { haveFactor } from "../lib/recipes/scale";
import { MAX_EDGE, fitSize, tries } from "./shrink";

const ROLES: Role[] = ["mom", "jared", "mariah"];

describe("who can see a recipe (mirror of _family_can_see)", () => {
  it("Mom's recipes are visible to all three", () => {
    for (const v of ROLES) expect(canSeeId("mom", v)).toBe(true);
  });
  it("Jared's and Mariah's recipes are never visible to Mom", () => {
    expect(canSeeId("jared", "mom")).toBe(false);
    expect(canSeeId("mariah", "mom")).toBe(false);
  });
  it("Jared and Mariah see each other's", () => {
    expect(canSeeId("jared", "mariah")).toBe(true);
    expect(canSeeId("mariah", "jared")).toBe(true);
    expect(canSeeId("jared", "jared")).toBe(true);
  });
  it("nobody signed in sees nothing", () => {
    for (const o of ROLES) { expect(canSeeId(o, null)).toBe(false); expect(canSeeId(o, undefined)).toBe(false); expect(canSeeId(o, "")).toBe(false); }
  });
});

describe("who can change a recipe", () => {
  it("the owner and Jared only", () => {
    expect(canEditRecipe("mom", "mom")).toBe(true);
    expect(canEditRecipe("mom", "jared")).toBe(true);
    expect(canEditRecipe("mom", "mariah")).toBe(false);
    expect(canEditRecipe("mariah", "mariah")).toBe(true);
    expect(canEditRecipe("mariah", "jared")).toBe(true);
    expect(canEditRecipe("jared", "mariah")).toBe(false);
    expect(canEditRecipe("jared", "mom")).toBe(false);
    expect(canEditRecipe("mom", null)).toBe(false);
  });
});

describe("someone else check this", () => {
  it("offers only reviewers who can see the card, never the owner", () => {
    expect(otherReviewers("mom")).toEqual(["jared", "mariah"]);
    expect(otherReviewers("jared")).toEqual(["mariah"]);
    expect(otherReviewers("mariah")).toEqual(["jared"]);
  });
  it("never offers Mom", () => {
    for (const o of ROLES) expect(otherReviewers(o)).not.toContain("mom");
  });
});

describe("names that follow the person", () => {
  it("Mom gets Harris, Jared and Mariah get Best, nobody gets the generic name", () => {
    expect(appTitle(PEOPLE.mom)).toBe("Harris Cookbook");
    expect(appTitle(PEOPLE.jared)).toBe("Best Cookbook");
    expect(appTitle(PEOPLE.mariah)).toBe("Best Cookbook");
    expect(appTitle(null)).toBe("Family Cookbook");
    expect(bookTitle(PEOPLE.mom)).toBe("The Harris Cookbook");
    expect(bookTitle(undefined)).toBe("Family Cookbook");
  });
  it("picks the matching install manifest", () => {
    expect(manifestFor(null)).toBe("/cookbook.webmanifest");
    expect(manifestFor(PEOPLE.mom)).toBe("/cookbook-harris.webmanifest");
    expect(manifestFor(PEOPLE.mariah)).toBe("/cookbook-best.webmanifest");
  });
  it("says who can see a card without naming Mom to herself wrongly", () => {
    expect(visLine("mom", "mom")).toBe("Shared with Jared and Mariah");
    expect(visLine("jared", "jared")).toBe("Only you and Mariah can see this");
    expect(visLine("mariah", "jared")).toBe("Only you and Mariah can see this");
  });
});

describe("OmniCook switch", () => {
  it("is Jared's alone", () => {
    expect(showsOmniCook("jared")).toBe(true);
    expect(showsOmniCook("mariah")).toBe(false);
    expect(showsOmniCook("mom")).toBe(false);
    expect(showsOmniCook(null)).toBe(false);
  });
});

describe("I only have 2 cups almond flour", () => {
  const almond = { id: "almond", name: "almond flour", amount: 3, unit: "cup" } as any;
  it("makes two thirds of the batch", () => {
    expect(haveFactor(almond, 2, "cup")).toBeCloseTo(2 / 3, 6);
  });
  it("cannot compare cups to a count", () => {
    expect(haveFactor(almond, 2, "count")).toBeNaN();
  });
});

describe("photo shrinking plan", () => {
  it("never enlarges and keeps the aspect ratio", () => {
    expect(fitSize(1200, 800, 2000)).toEqual({ w: 1200, h: 800 });
    expect(fitSize(4000, 3000, 2000)).toEqual({ w: 2000, h: 1500 });
    expect(fitSize(3000, 4000, 2000)).toEqual({ w: 1500, h: 2000 });
  });
  it("tries big first and ends small", () => {
    const t = tries();
    expect(t[0]).toEqual({ edge: MAX_EDGE, q: 0.82 });
    expect(t[t.length - 1].edge).toBeLessThan(MAX_EDGE / 1.5);
    expect(t.length).toBeGreaterThan(6);
  });
});
