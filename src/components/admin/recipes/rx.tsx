import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import type { RecipeDoc, Seg, ScaleState } from "@/lib/recipes/types";
import type { PantryMap } from "@/lib/recipes/pantry";
import "./recipes.css";

/* ---------- data shapes (recipes_overview) ---------- */

export interface CookEntry { id: string; cooked_at: string; factor: number | null; summary: string | null; note: string | null; omni: boolean }
export interface RecipeRow {
  id: number; slug: string; name: string; doc: RecipeDoc; photo_path: string | null; source: string | null; source_url: string | null;
  created_at: string; favorite: boolean; pantry: PantryMap; notes: string; cooks: CookEntry[];
}
export interface FermentRow {
  id: string; recipe_id: number; started_at: string; state: "fermenting" | "bottled" | "done"; tasted_on: string | null;
  bottled_at: string | null; burped_on: string | null; finished_at: string | null;
}
export interface GroceryRow { id: string; name: string; recipe_id: number | null; recipe_title: string | null; status: string; added_at: string }
export interface TimerRow { id: string; recipe_id: number | null; label: string; total_sec: number; ends_at: string; status: "running" | "done" | "stopped" }
export interface HaSettings { speaker: boolean; timer_push: boolean; kitchen_auto: boolean; voice: boolean; lights: boolean }
export interface LegacyIdea { name: string; how: string; minutes: number | null; serves: number | null; source: string | null; omni: boolean }
export interface Overview {
  recipes: RecipeRow[]; legacy: LegacyIdea[]; ferments: FermentRow[]; groceries: GroceryRow[]; settings: HaSettings; timers: TimerRow[]; now: string;
}
export interface HandoffRow { id: string; kind: "cook" | "link"; recipe_id: number | null; title: string | null; url: string | null; source: string | null; status: string; created_at: string }
export interface RecipeCommand { id: number; action: "next" | "back" | "repeat" | "start_timer" | "stop_timer"; said: string | null; status: string; created_at: string }
export interface ParseJob { id: string; kind: "photo" | "link"; source: string; status: "queued" | "running" | "done" | "failed"; attempts: number; error: string | null; result: { draft: RecipeDoc; review: string[] } | null }

/** Per-recipe state while you work on it: the scale, the ingredient ticks and the "I only have" note. */
export interface WorkState extends ScaleState { checked: Record<string, boolean>; have: { desc: string; ing: string } | null }
export const newWork = (): WorkState => ({ factor: 1, omni: false, split: false, checked: {}, have: null });

/* ---------- plumbing ---------- */

export const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;
export async function call<T = unknown>(fn: string, args?: object): Promise<T> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** A thin, typed handle on the recipe tables (the generated types do not know them yet). */
export interface Q extends PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> {
  select: (c: string) => Q; eq: (k: string, v: string) => Q; gte: (k: string, v: string) => Q;
  order: (c: string, o: { ascending: boolean }) => Q; limit: (n: number) => Q;
}
export const table = (t: string) => (supabase as unknown as { from: (t: string) => Q }).from(t);

/* ---------- time + text ---------- */

export const clock12 = (d: Date) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${d.getHours() < 12 ? "AM" : "PM"}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (d: Date) => `${MON[d.getMonth()]} ${d.getDate()}`;
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const dayDiff = (a: Date, b: Date) => Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 864e5);
export const startLabel = (iso: string) => {
  const d = new Date(iso);
  return `${fmtDate(d)}, ${clock12(d)}`;
};
/** The Pacific calendar day an ISO time falls on, as a local Date at midnight (the ferment clock is Pacific). */
export function pacificDay(iso: string | Date): Date {
  const s = new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export const todayPacific = () => pacificDay(new Date());

/** Renders text pieces from the scaler: amounts bold, number+unit never breaking apart. */
export function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => s.k === "amt" ? <span key={i} className="amt">{s.s}</span> : s.k === "nw" ? <span key={i} className="nw">{s.s}</span> : <span key={i}>{s.s}</span>)}
    </>
  );
}

/** Wraps a layer in .rx and puts it on <body>, above the admin chrome. */
export function RxPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(<div className="rx">{children}</div>, document.body);
}

/* ---------- categories (gradient hue + glyph per category) ---------- */

export const CATS: Record<string, { icon: string; h: number }> = {
  "Sauces & Pasta": { icon: "bowl", h: 34 }, "Ferments & Drinks": { icon: "jar", h: 78 }, Bread: { icon: "loaf", h: 26 },
  "Sauces & Dressings": { icon: "bowl", h: 140 }, Drinks: { icon: "glass", h: 262 }, Baking: { icon: "cookie", h: 14 },
  Mains: { icon: "bowl", h: 8 }, Sides: { icon: "leaf", h: 110 }, Breakfast: { icon: "cookie", h: 44 }, Snacks: { icon: "leaf", h: 96 },
  Soups: { icon: "bowl", h: 20 }, Desserts: { icon: "cookie", h: 330 },
};
export const catOf = (c?: string | null) => (c && CATS[c]) || { icon: "leaf", h: 150 };
export const CATEGORY_NAMES = Object.keys(CATS);

/* ---------- small hooks ---------- */

export const supportsSpeech = () => typeof window !== "undefined" && !!((window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition);
