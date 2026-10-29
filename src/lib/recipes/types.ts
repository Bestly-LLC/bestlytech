// Shapes for Basil's structured recipes (pantry_recipes.doc). Matches recipes/recipes.json from the approved preview.

export interface RIngredient {
  id: string;
  name: string;
  amount: number | null;
  amount_max?: number | null;
  /** cup | tbsp | tsp | oz | count | egg | free text such as "to taste" or "optional" when amount is null */
  unit: string;
  oz?: number;
  approx_oz?: number;
  alt?: string;
  optional?: boolean;
  no_scale?: boolean;
  note?: string;
  /** Set by the server when the ingredient matches an item in Basil's pantry. */
  pantry?: { item_id: string; item: string; status: "have" | "low" | "out" | "arriving"; qty: number | null; unit: string | null } | null;
}

export interface OmniSettings {
  mode?: string;
  speed?: number | null;
  time_sec?: number;
  temp_f?: number | null;
}

export interface RStep {
  title: string;
  text: string;
  timer_sec?: number;
  timer_max_sec?: number;
  omni?: OmniSettings | null;
  ferment_start?: boolean;
  added?: boolean;
}

export interface OmniCapacity { bowl_l?: number; max_dough_oz: number; base_dough_oz?: number; note?: string }

export interface RecipeDoc {
  id: string;
  title: string;
  category: string;
  blurb?: string;
  yield: { amount: number; amount_max?: number; unit: string; alt?: string; max_note?: string; estimated?: boolean };
  time?: { total_min?: number; prep_min?: number; ferment_days?: [number, number]; rise_min?: number | [number, number]; bake_min?: number | [number, number] };
  tags?: string[];
  omnicook: "none" | "native" | "converted";
  omnicook_capacity?: OmniCapacity;
  ingredients: RIngredient[];
  steps: RStep[];
  omnicook_steps?: RStep[];
  tips?: string[];
  flags?: string[];
  storage?: string;
  equipment?: string[];
  vessel?: string;
  oven_f?: number;
  ferment?: { temp_f: [number, number]; check_from_day: number; ready_days: [number, number]; after_bottling: { burp: string; drink_within_days: [number, number] } };
}

/** What the scaler remembers per recipe while you work on it. */
export interface ScaleState { factor: number; omni: boolean; split: boolean }

export interface Plan { f: number; eff: number; n: number; capped: boolean; cap: CapInfo | null; omni: boolean }
export interface CapInfo { base: number; max: number; maxF: number }
export interface AmountOut { none?: boolean; str: string; listLead: string; n: number; note: string | null }
/** One piece of display text. "nw" and "amt" never wrap apart (white-space: nowrap); "amt" is also styled as an amount. */
export interface Seg { k: "txt" | "nw" | "amt"; s: string }
export interface Resolved { segs: Seg[]; plain: string; notes: Seg[][] }
