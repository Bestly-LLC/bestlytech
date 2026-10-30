// Log to Health: the shortcut URL, the "seen the setup once" flag, and a small plural for serving labels.
import type { Nutrition } from "@/lib/recipes/types";

const HEALTH_FLAG = "cb.healthShortcut";
export const HEALTH_SHORTCUT_URL = "https://cloud.bestly.tech/apps/bestlykey/shortcut";

/** No general English pluralizer in this codebase: good enough for serving labels like "pancake" or "slice". */
export function pluralizeLabel(label: string, n: number): string {
  if (Math.abs(n - 1) < 1e-9) return label;
  if (/[sxz]$|[cs]h$/i.test(label)) return `${label}es`;
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`;
  return `${label}s`;
}
export function buildHealthShortcutUrl(n: Nutrition, amount: number, title: string): string {
  const p = n.per_serving, r = (v: number) => Math.round(v * amount);
  const payload = { kcal: r(p.kcal), protein_g: r(p.protein_g), carbs_g: r(p.carbs_g), fat_g: r(p.fat_g), fiber_g: r(p.fiber_g), sugar_g: r(p.sugar_g), sodium_mg: r(p.sodium_mg), title };
  return `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent("Log to Health")}&input=text&text=${encodeURIComponent(JSON.stringify(payload))}&x-success=${encodeURIComponent(window.location.href)}`;
}
export function hasHealthShortcut(): boolean {
  try { return !!localStorage.getItem(HEALTH_FLAG); } catch { return false; }
}
export function markHealthShortcutDone() {
  try { localStorage.setItem(HEALTH_FLAG, "1"); } catch { /* private window: this device asks again next time */ }
}
