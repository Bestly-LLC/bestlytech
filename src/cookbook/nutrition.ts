// Family Cookbook: the Nutrition card (Recipe screen + compact on Check) and "Log to Health".
// Per-serving numbers never change with the servings stepper, so this reads straight off the doc/draft, no scaler involved.

import { $, esc, ic, nwx } from "./dom";
import { ACT, S } from "./state";
import { closeSheet, openSheet, toast } from "./ui";
import type { Nutrition } from "@/lib/recipes/types";

const DV = { protein_g: 50, carbs_g: 275, fat_g: 78, fiber_g: 28, sugar_g: 50, sodium_mg: 2300 } as const;
const HEALTH_FLAG = "cb.healthShortcut";
const SHORTCUT_URL = "https://cloud.bestly.tech/apps/bestlykey/shortcut";
const HEART = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true" style="width:22px;height:22px"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.4 4.5 6.9 4.5c2 0 3.6 1.1 5.1 2.9 1.5-1.8 3.1-2.9 5.1-2.9 3.5 0 5.5 3.4 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" fill="#ff5a6e"/></svg>';

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
/** No general English pluralizer in this codebase (pluralLead only knows a fixed ingredient whitelist): good enough for serving labels like "pancake" or "slice". */
function pluralLabel(label: string, n: number): string {
  if (Math.abs(n - 1) < 1e-9) return label;
  if (/[sxz]$|[cs]h$/i.test(label)) return label + "es";
  if (/[^aeiou]y$/i.test(label)) return label.slice(0, -1) + "ies";
  return label + "s";
}
const pct = (v: number, dv: number) => Math.max(0, Math.min(100, Math.round((v / dv) * 100)));
const row = (label: string, v: number, unit: string, dv: number) =>
  '<div class="nut-row"><span class="lb">' + label + '</span><span class="val">' + nwx(Math.round(v) + " " + unit) + '</span><div class="nut-bar"><i style="width:' + pct(v, dv) + '%"></i></div></div>';

/** `compact` is the Check screen (quiet "Working out nutrition…" placeholder when missing); the Recipe screen hides the card until it exists. */
export function nutritionHtml(n: Nutrition | null | undefined, opts: { compact?: boolean; health?: boolean; recipeId?: string } = {}): string {
  if (!n) return opts.compact ? '<div class="nut-panel quiet"><p class="nut-wait">Working out nutrition…</p></div>' : "";
  const p = n.per_serving, isCard = n.source === "card";
  const tagCls = "nut-tag" + (isCard ? " card" : ""), tagTxt = isCard ? "From the card" : "Estimated";
  const per = "Per serving (1 " + esc(n.serving_label) + ")" + (isCard ? ", as printed on the card." : ". About, from the ingredients.");
  const foot = isCard ? "Numbers copied from the card. Changing how many it makes doesn't change one serving." : "Worked out from the ingredients with USDA food data. Changing how many it makes doesn't change one serving.";
  const rows = row("Protein", p.protein_g, "g", DV.protein_g) + row("Carbs", p.carbs_g, "g", DV.carbs_g) + row("Fat", p.fat_g, "g", DV.fat_g);
  const extra = row("Fiber", p.fiber_g, "g", DV.fiber_g) + row("Sugar", p.sugar_g, "g", DV.sugar_g) + row("Sodium", p.sodium_mg, "mg", DV.sodium_mg);
  const showHealth = !!opts.health && !opts.compact && isIOS();
  return '<div class="nut-panel' + (opts.compact ? " compact" : "") + '">'
    + '<div class="nut-head"><h2>Nutrition</h2><span class="' + tagCls + '">' + tagTxt + "</span></div>"
    + '<p class="nut-per">' + per + "</p>"
    + '<div class="nut-cal"><b>' + Math.round(p.kcal) + "</b><span>Calories</span></div>"
    + '<div class="nut-rows">' + rows + "</div>"
    + (opts.compact ? "" : '<button class="nut-more" type="button" data-act="nut-more" aria-expanded="false">Show more</button><div class="nut-extra" id="nut-extra">' + extra + "</div>")
    + '<p class="nut-foot">' + foot + "</p>"
    + (n.low_confidence ? '<p class="nut-foot warn">Rough estimate: some ingredients were hard to read.</p>' : "")
    + (showHealth ? '<button class="btn primary block nut-health" type="button" data-act="health" data-id="' + esc(opts.recipeId || "") + '">' + HEART + "Log to Health</button>" : "")
    + "</div>";
}

/* ===== Log to Health ===== */
let curNut: Nutrition | null = null;
let curTitle = "";
let ateN = 1;

function ateSumHtml(n: Nutrition, f: number) {
  const p = n.per_serving, r = (v: number) => Math.round(v * f);
  return [["Calories", r(p.kcal), ""], ["Protein", r(p.protein_g), "g"], ["Carbs", r(p.carbs_g), "g"], ["Fat", r(p.fat_g), "g"]]
    .map(([l, v, u]) => "<span>" + l + " " + nwx(v + (u ? " " + u : "")) + "</span>").join("");
}
function renderAteSum() {
  if (!curNut) return;
  const lbl = $("#ate-lbl"), val = $("#ate-val"), sum = $("#ate-sum");
  if (lbl) lbl.innerHTML = nwx(ateN + " " + pluralLabel(curNut.serving_label, ateN));
  if (val) val.textContent = String(ateN);
  if (sum) sum.innerHTML = ateSumHtml(curNut, ateN);
}
function logSheetHtml(n: Nutrition) {
  return "<h2>Log to Health</h2><p>How much did you eat?</p>"
    + '<div class="ate-row"><b class="nw" id="ate-lbl">1 ' + esc(n.serving_label) + '</b>'
    + '<div class="stepper"><button class="iconbtn" data-act="ate-dec" aria-label="Less">' + ic("minus") + '</button><div class="sval" id="ate-val">1</div><button class="iconbtn" data-act="ate-inc" aria-label="More">' + ic("plus") + "</button></div></div>"
    + '<div class="nut-sum" id="ate-sum"></div>'
    + '<button class="btn primary big block" type="button" data-act="log-it" data-autofocus>Log it</button>'
    + '<button class="btn ghost block" type="button" data-act="close-sheet">Not now</button>';
}
function setupSheetHtml() {
  return "<h2>Connect Apple Health</h2><p>One-time setup, about a minute. After this, logging is one tap.</p>"
    + '<ol class="nut-setup"><li><span class="n">1</span><span>Tap <b>Get the shortcut</b> below.</span></li>'
    + '<li><span class="n">2</span><span>Tap <b>Add Shortcut</b> on the screen that opens.</span></li>'
    + '<li><span class="n">3</span><span>The first time it runs, tap <b>Allow</b> so it can save to Health.</span></li></ol>'
    + '<button class="btn primary big block" type="button" data-act="get-shortcut" data-autofocus>Get the shortcut</button>'
    + '<button class="btn ghost block" type="button" data-act="close-sheet">Not now</button>';
}
function openLog() {
  if (!curNut) return;
  ateN = 1;
  openSheet(logSheetHtml(curNut), "Log to Health");
  renderAteSum();
}

Object.assign(ACT, {
  health(t: HTMLElement) {
    const id = t.dataset.id as string, r = S.recs[id];
    if (!r || !r.nutrition) return;
    curNut = r.nutrition; curTitle = r.title;
    let done = false;
    try { done = !!localStorage.getItem(HEALTH_FLAG); } catch { /* private window: ask every time */ }
    if (done) openLog(); else openSheet(setupSheetHtml(), "Connect Apple Health");
  },
  "get-shortcut"() {
    try { localStorage.setItem(HEALTH_FLAG, "1"); } catch { /* private window: this device asks again next time */ }
    window.open(SHORTCUT_URL, "_blank");
    closeSheet(true);
    openLog();
  },
  "ate-dec"() { if (ateN > 1) { ateN--; renderAteSum(); } },
  "ate-inc"() { if (ateN < 12) { ateN++; renderAteSum(); } },
  "log-it"() {
    if (!curNut) return;
    const p = curNut.per_serving, f = ateN;
    const payload = {
      kcal: Math.round(p.kcal * f), protein_g: Math.round(p.protein_g * f), carbs_g: Math.round(p.carbs_g * f),
      fat_g: Math.round(p.fat_g * f), fiber_g: Math.round(p.fiber_g * f), sugar_g: Math.round(p.sugar_g * f), sodium_mg: Math.round(p.sodium_mg * f),
      title: curTitle,
    };
    const url = "shortcuts://x-callback-url/run-shortcut?name=" + encodeURIComponent("Log to Health") + "&input=text&text=" + encodeURIComponent(JSON.stringify(payload)) + "&x-success=" + encodeURIComponent(location.href);
    const n = ateN, label = pluralLabel(curNut.serving_label, n);
    closeSheet(true);
    document.dispatchEvent(new CustomEvent("cb:health-log", { detail: { url, payload } }));
    window.location.href = url;
    toast("Logged " + n + " " + label + " to Health");
  },
  "nut-more"(t: HTMLElement) {
    const extra = $("#nut-extra");
    if (!extra) return;
    const on = extra.classList.toggle("on");
    t.textContent = on ? "Show less" : "Show more";
    t.setAttribute("aria-expanded", String(on));
  },
});
