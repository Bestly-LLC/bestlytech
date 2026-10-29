import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: () => Promise.resolve({ data: null, error: null }) } }));
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import seed from "@/lib/recipes/seedRecipes.json";
import { Library } from "./Library";
import { RecipePage } from "./RecipePage";
import { newWork, type Overview, type RecipeRow } from "./rx";
import type { RecipeDoc } from "@/lib/recipes/types";

const rows: RecipeRow[] = (seed as unknown as { recipes: RecipeDoc[] }).recipes.map((doc, i) => ({
  id: i + 1, slug: doc.id, name: doc.title, doc, photo_path: null, source: "printed card", source_url: null,
  created_at: "2026-10-29T00:00:00Z", favorite: false, pantry: {}, notes: "", cooks: [],
}));
const ov: Overview = {
  recipes: rows, legacy: [], ferments: [], groceries: [], timers: [], now: "2026-10-29T12:00:00Z",
  settings: { speaker: true, timer_push: true, kitchen_auto: false, voice: true },
};
const noop = () => undefined;
const asyncNoop = async () => undefined;

describe("recipes UI renders", () => {
  it("library lists every seeded recipe and disables what Home Assistant cannot do", () => {
    const html = renderToString(h(Library, { ov, photos: {}, onOpen: noop, onAdd: noop, onFerment: asyncNoop, onSetting: asyncNoop }));
    for (const r of rows) expect(html).toContain(r.doc.title.replace(/&/g, "&amp;"));
    expect(html).toContain("Not available yet");
    expect(html).not.toContain("Nextcloud");
    expect(html).not.toMatch(/\.\.\.|…/);
  });
  it.each(rows.map((r) => [r.doc.title, r] as const))("recipe page renders: %s", (_t, r) => {
    const html = renderToString(h(RecipePage, {
      r, work: newWork(), setWork: noop, phone: false, onlyOnList: false, fermenting: false, onBack: noop, onCook: noop, onPhoto: noop,
      onNotes: noop, onLog: asyncNoop, onFermentStart: asyncNoop, onAddToGroceries: asyncNoop, onSendToIpad: asyncNoop, startTimer: noop, timers: [],
    }));
    expect(html).toContain("Start Cooking");
    expect(html).toContain("Ingredients");
    expect(html).not.toMatch(/\.\.\.|…/);
  });
});
