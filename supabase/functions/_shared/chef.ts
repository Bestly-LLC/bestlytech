// _shared/chef.ts — Basil's chef: gourmet recipes from what is actually in the pantry, with Omni Cook steps where the
// machine genuinely helps (Jared, 2026-10-15). Free AI only (paid: "never"); a run that can't get a free model fails
// soft and says so.
//
//   import { chefCook, chefSpoken, chefMarkdown } from "../_shared/chef.ts";
//   const r = await chefCook(db, { ask: "something with salmon", count: 3, job: "basil-chef" });
//
// Recipes are saved through basil_chef_save() into pantry_recipes in the shape the Kitchen page's recipe view and
// cook mode read: ingredients {k, name, amt, omni_amt?, m?, opt?}, steps [{t, timer?}], omni_steps [{t, timer?,
// omni:{mode, f, c, min, speed, rev?}}] or null. Step text marks ingredients {k} or {k|amount}. Migration:
// 20261015190000_basil_chef.sql.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { llm } from "./free-llm.ts";

export interface ChefIngredient { k: string; name: string; amt: string; omni_amt?: string; m?: string; opt?: boolean }
export interface ChefStep { t: string; timer?: number; omni?: { mode: string; f: number; c: number; min: number; speed: string; rev?: boolean } }
export interface ChefRecipe {
  name: string; how: string; chef_note: string; serves: number; minutes: number;
  ingredients: ChefIngredient[]; steps: ChefStep[]; omni_steps: ChefStep[] | null; omni_why?: string;
}
export interface ChefResult { recipes: ChefRecipe[]; saved: string[]; model: string; provider: string }

const STAPLE = /^(water|ice|(kosher |sea |flaky )?salt|(fresh(ly)? )?(ground )?(black )?pepper|salt and pepper|ice water|boiling water)$/i;
const MODES = ["Saute", "Steam", "Cook", "Mix", "Chop", "Blend", "Knead", "Whip", "Sous vide", "Slow cook", "Rice", "Ferment"];

const SYSTEM = `You are Basil's chef: a gourmet chef cooking at home for Jared (one or two people, weeknights).
Cook restaurant-quality food from ONLY the pantry list you are given, plus water, salt and black pepper.
Think like a chef: build flavor (browning, aromatics, toasting spices, deglazing), balance fat, acid, salt, sweet and heat,
finish bright (acid or fresh garnish at the end), and give texture contrast. Weeknight-doable: 15 to 60 minutes.
Every dish has a point of view: a sauce, glaze or dressing built from the pantry's condiments (for example soy, honey,
lemon and garlic into a glaze; sriracha and mayonnaise into a spicy aioli; parmesan and pasta water into a silky sauce),
a technique done right (a hard sear, a toasted spice, an emulsion, a reduction), and a finish (acid, crunch, toasted
seeds or nuts, cracked pepper). No plain "cook X, serve over Y".
Prefer items marked use_soon. Frozen proteins must be thawed or cooked from frozen safely; say how.
Freezer items normally sold cooked (rice, chili, breaded or rotisserie chicken, Brazi Bites) are already cooked: reheat
or crisp them, never cook them from raw. Dry rice in the pantry is raw.
Food safety: chicken 165°F, pork and sausage 160°F, fish 145°F, shrimp pink and opaque, reheated chili to a boil.
US units only (cups, tbsp, tsp, oz, lb, °F). Plain words, no emoji.

The Omni Cook: Jared owns a TOKIT Omni Cook, a heated 2.2 L bowl with a blade. It heats from 95°F to 356°F, runs
speeds 1 to 10, and has reverse (the blade turns backwards to stir gently without chopping). A steaming basket sits
inside the bowl and a steaming tray sits on top, so rice or a sauce can cook below while fish or vegetables steam above.
Modes: ${MODES.join(", ")}.
Use it only where it genuinely helps: sauces and emulsions, risotto, soups, curries, steaming fish over rice,
chopping aromatics, doughs, whipping, sous vide, slow cooking. It cannot sear, crisp, roast, grill or fry.
Look at every dish for an Omni Cook method, and make at least one of the dishes one where it shines.
When it helps, give omni_steps: a complete alternate method on the Omni Cook (any final searing or crisping can stay
on the stove in the same list), and one sentence in omni_why saying why it is worth it. When it does not help,
omni_steps is null and omni_why is "".

Return JSON only: {"recipes":[ ... ]}. One complete example of the quality and shape wanted (its ingredients are
only an example; yours come from the pantry list, and never copy this dish):
{"name":"Honey Soy Glazed Salmon with Garlic Rice","how":"Glossy honey-soy salmon over garlicky jasmine rice.",
 "chef_note":"Reduce the glaze until it coats a spoon before it touches the fish, so it lacquers instead of steaming.",
 "serves":2,"minutes":30,
 "ingredients":[{"k":"salmon","name":"salmon fillets, thawed","amt":"2 (about 12 oz)","pantry":"Salmon"},
  {"k":"rice","name":"jasmine rice, rinsed","amt":"1 cup","pantry":"Kirkland jasmine rice"},
  {"k":"water","name":"water","amt":"1 1/4 cups","omni_amt":"4 cups"},
  {"k":"garlic","name":"minced garlic","amt":"2 tsp","pantry":"Minced garlic"},
  {"k":"soy","name":"soy sauce","amt":"2 tbsp","pantry":"Soy sauce"},
  {"k":"honey","name":"honey","amt":"1 tbsp","pantry":"Honey"},
  {"k":"oil","name":"olive oil","amt":"1 tbsp","pantry":"Kirkland olive oil"},
  {"k":"salt","name":"salt","amt":"1/2 tsp"}],
 "steps":[{"t":"Simmer the {rice} with {water}, {garlic|1 tsp} and {salt|1/4 tsp}, covered, on low.","timer":15},
  {"t":"Stir {soy}, {honey} and {garlic|1 tsp} in a small pan and simmer until it coats a spoon.","timer":3},
  {"t":"Pat the {salmon} dry and season with {salt|1/4 tsp}. Sear skin side up in hot {oil} until browned.","timer":4},
  {"t":"Flip, brush on the glaze and cook until it flakes and reads 145°F. Serve over the rice.","timer":4}],
 "omni_steps":[{"t":"Add {water}, {garlic|1 tsp} and {salt|1/4 tsp} to the bowl. Put the {rice} in the steaming basket and set it in.","timer":10,"omni":{"mode":"Steam","f":212,"c":100,"min":10,"speed":"1"}},
  {"t":"Season the {salmon} with {salt|1/4 tsp}, lay it on the steaming tray and set the tray on top. Keep steaming until it reads 145°F.","timer":12,"omni":{"mode":"Steam","f":212,"c":100,"min":12,"speed":"1"}},
  {"t":"Lift off the tray and basket and pour out the water. Add {soy}, {honey} and {garlic|1 tsp} and reduce to a glaze.","timer":4,"omni":{"mode":"Saute","f":248,"c":120,"min":4,"speed":"1","rev":true}},
  {"t":"For color, sear the salmon in hot {oil} for 1 minute a side. Spoon the glaze over and serve on the rice."}],
 "omni_why":"Rice and salmon steam together in one go, then the bowl reduces the glaze with no pan to watch."}

Rules:
- "pantry" is the EXACT name of the pantry item used, copied from the list. Omit "pantry" only for water, salt and pepper.
- At most one ingredient may be missing from the pantry, only as a garnish, with "opt": true and no "pantry".
- "k" is a short lowercase key, unique within the recipe. Every ingredient, salt and pepper included, appears in the
  steps as {k} (the whole amount) or {k|part} (part of it, like {butter|1 tbsp}), and again in omni_steps when there are
  any. Only use keys you listed. Water you list gets a key too.
- "steps" is the stovetop method and never mentions the Omni Cook. "omni_steps", when given, is a complete method of
  3 or more steps that stands on its own.
- "omni_amt" only when the Omni Cook needs a different amount (often water for steaming).
- "timer" is whole minutes, only on steps with a wait. In omni steps, "min" equals the timer, "f" and "c" match.
- "speed" is a string "1" to "10". Use "rev": true for gentle stirring of chunky food.
- Never repeat a dish from the "recent" list. Make the dishes different from each other (protein, cuisine, method).`;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Check and tidy one recipe against the real pantry; null when it can't be used. */
function tidy(raw: any, pantry: Map<string, string>): ChefRecipe | null {
  if (!raw || typeof raw.name !== "string" || !Array.isArray(raw.ingredients) || !Array.isArray(raw.steps)) return null;
  if (raw.ingredients.length < 3 || raw.steps.length < 2) return null;
  const keys = new Set<string>();
  let missing = 0, fromPantry = 0;
  const ingredients: ChefIngredient[] = [];
  for (const i of raw.ingredients) {
    const k = String(i?.k ?? "").trim().toLowerCase();
    const name = String(i?.name ?? "").trim();
    if (!k || !name || keys.has(k)) return null;
    keys.add(k);
    const out: ChefIngredient = { k, name, amt: String(i?.amt ?? "").trim() };
    if (i?.omni_amt) out.omni_amt = String(i.omni_amt).trim();
    const want = String(i?.pantry ?? "").trim().toLowerCase();
    let hit = want ? pantry.get(want) : undefined;
    // A near miss ("Salmon fillets" for "Salmon"): take the one pantry name it contains or is contained by.
    if (want && !hit) {
      const near = [...pantry.entries()].filter(([low]) => want.includes(low) || low.includes(want));
      if (near.length === 1) hit = near[0][1];
    }
    if (hit) { out.m = `^${esc(hit.toLowerCase())}$`; fromPantry++; }
    else if (!STAPLE.test(name.replace(/,.*$/, "").trim()) && !STAPLE.test(k)) {
      if (!i?.opt) return null;
      missing++;
    }
    if (i?.opt) out.opt = true;
    ingredients.push(out);
  }
  if (missing > 1 || fromPantry < 2) return null;
  const refs = (t: string) => [...t.matchAll(/\{([a-z0-9_ -]+)(?:\|[^}]*)?\}/gi)].map((m) => m[1].toLowerCase());
  const step = (s: any, omni: boolean): ChefStep | null => {
    const t = String(s?.t ?? "").trim();
    if (!t || refs(t).some((r) => !keys.has(r))) return null;
    const out: ChefStep = { t };
    const timer = Math.round(Number(s?.timer));
    if (timer > 0 && timer < 600) out.timer = timer;
    if (omni && s?.omni) {
      const o = s.omni;
      const mode = MODES.find((m) => m.toLowerCase() === String(o.mode ?? "").toLowerCase());
      const f = Math.round(Number(o.f));
      if (!mode || !(f >= 95 && f <= 356)) return null;
      const min = Math.round(Number(o.min)) || out.timer || 0;
      if (min <= 0) return null;
      out.omni = { mode, f, c: Math.round((f - 32) * 5 / 9), min, speed: String(o.speed ?? "1").replace(/[^0-9]/g, "") || "1" };
      if (o.rev === true) out.omni.rev = true;
      if (!out.timer) out.timer = min;
    }
    return out;
  };
  const steps = raw.steps.map((s: any) => step(s, false));
  if (steps.some((s: ChefStep | null) => !s)) return null;
  // Every pantry ingredient has to be used somewhere, or the bolded list promises something the steps never do.
  const used = new Set((steps as ChefStep[]).flatMap((x) => refs(x.t)));
  if (ingredients.some((i) => i.m && !used.has(i.k))) return null;
  let omni: ChefStep[] | null = null;
  if (Array.isArray(raw.omni_steps) && raw.omni_steps.length >= 3) {
    const o = raw.omni_steps.map((s: any) => step(s, true));
    if (!o.some((s: ChefStep | null) => !s) && o.some((s: ChefStep) => s.omni)) omni = o;
  }
  const serves = Math.min(8, Math.max(1, Math.round(Number(raw.serves)) || 2));
  const minutes = Math.min(240, Math.max(5, Math.round(Number(raw.minutes)) || 30));
  return {
    name: raw.name.trim().slice(0, 80), how: String(raw.how ?? "").trim().slice(0, 240),
    chef_note: String(raw.chef_note ?? "").trim().slice(0, 400), serves, minutes,
    ingredients, steps: steps as ChefStep[], omni_steps: omni,
    omni_why: omni ? String(raw.omni_why ?? "").trim().slice(0, 240) : "",
  };
}

/** Ask the chef. Throws when no free model produced a usable recipe. */
export async function chefCook(db: SupabaseClient, opts: { ask?: string; count?: number; deadlineMs?: number; job: string; fn?: string }): Promise<ChefResult> {
  const count = Math.min(4, Math.max(1, opts.count ?? 3));
  const { data, error } = await db.rpc("basil_chef_pantry");
  if (error) throw new Error(`pantry: ${error.message}`);
  const items = ((data as any)?.items ?? []) as { name: string; where: string; category: string | null; low: boolean; use_soon: boolean }[];
  const recent = ((data as any)?.recent ?? []) as string[];
  if (items.length < 3) throw new Error("the pantry is nearly empty");
  const pantry = new Map(items.map((i) => [i.name.toLowerCase(), i.name]));
  const ask = (opts.ask ?? "").trim().slice(0, 200);

  const user = [
    `Make ${count} ${count === 1 ? "recipe" : "different recipes"}.`,
    ask ? `Jared asked for: "${ask}". Follow it if the pantry allows; if it doesn't, cook the closest thing and say so in chef_note.` : "",
    // Grouped by place, one line each: about a third of the tokens of one line per item (Groq's cap is 7,000 in + out).
    "Pantry list, by where it is (use_soon = use it first):",
    ...[...new Set(items.map((i) => i.where))].map((w) =>
      `${w}: ${items.filter((i) => i.where === w).map((i) => `${i.name}${i.low ? " (low)" : ""}${i.use_soon ? " (use_soon)" : ""}`).join("; ")}`),
    recent.length ? `Recent (don't repeat): ${recent.join("; ")}` : "",
  ].filter(Boolean).join("\n");

  let kept: ChefRecipe[] = [];
  const r = await llm({
    // "extract", not "write": structured JSON, and the write route leaves out Groq (the one free rung that's rarely cooled down).
    task: "extract", system: SYSTEM, user, json: true, maxTokens: 1300 * count,
    job: opts.job, fn: opts.fn ?? opts.job, paid: "never", deadlineMs: opts.deadlineMs ?? 60_000,
    validate: (j) => {
      const list = Array.isArray(j?.recipes) ? j.recipes : [];
      kept = list.map((x: unknown) => tidy(x, pantry)).filter(Boolean) as ChefRecipe[];
      return kept.length ? null : "no recipe used only pantry items with valid steps; follow the rules exactly";
    },
  });
  kept = kept.slice(0, count);
  const { data: saved, error: se } = await db.rpc("basil_chef_save", { p_recipes: kept, p_ask: ask || null });
  if (se) throw new Error(`save: ${se.message}`);
  const names = (saved ?? []) as string[];
  kept.forEach((k, i) => { if (names[i]) k.name = names[i]; });
  return { recipes: kept, saved: names, model: r.model, provider: r.provider };
}

const ingList = (r: ChefRecipe) => r.ingredients.filter((i) => i.m).map((i) => i.name.replace(/,.*$/, "")).slice(0, 4);
const andList = (a: string[]) => a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;

/** What Hey Scout says. Short: the first dish in full, the others by name. */
export function chefSpoken(r: ChefResult): string {
  const [a, ...rest] = r.recipes;
  if (!a) return "The chef came up empty. Try again in a minute.";
  let s = `Chef's pick: ${a.name}, about ${a.minutes} minutes. It uses your ${andList(ingList(a))}.`;
  if (a.omni_steps) s += ` Use the Omni Cook for this one. ${a.omni_why || ""}`.trimEnd();
  if (a.chef_note) s += ` Chef's tip: ${a.chef_note}`;
  if (rest.length) s += ` Also: ${andList(rest.map((x) => x.name))}.`;
  return `${s} The full recipes are on the Kitchen page.`;
}

/** What Scout chat shows. */
export function chefMarkdown(r: ChefResult): string {
  return r.recipes.map((x) => {
    const lines = [`**${x.name}** · ${x.minutes} min · serves ${x.serves}${x.omni_steps ? " · Omni Cook" : ""}`, x.how];
    if (x.omni_steps && x.omni_why) lines.push(`Omni Cook: ${x.omni_why}`);
    if (x.chef_note) lines.push(`Chef's tip: ${x.chef_note}`);
    return lines.filter(Boolean).join("\n");
  }).join("\n\n") + "\n\nFull recipes, with cook mode: Kitchen page (Home Hub, Kitchen).";
}
