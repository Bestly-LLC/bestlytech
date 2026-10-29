// Family Cookbook: sheets (bottom dialogs) and the toast.

import { $, esc, lineify, nowrapDom } from "./dom";
import { S } from "./state";

let toastT: ReturnType<typeof setTimeout> | null = null;

export function openSheet(html: string, label?: string) {
  S.lastFocus = document.activeElement as HTMLElement;
  const l = $("#l-sheet");
  l.innerHTML = '<div class="scrim" data-act="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="' + esc(label || "Dialog") + '" tabindex="-1"><div class="grab" aria-hidden="true"></div>' + html + "</div></div>";
  nowrapDom(l);
  lineify(l);
  S.sheetOpen = true;
  const sh = $(".sheet", l);
  const af = $("[data-autofocus]", l) || sh;
  af.focus({ preventScroll: true });
}
export function closeSheet(quiet?: boolean) {
  const l = $("#l-sheet");
  if (!l || !S.sheetOpen) return;
  l.innerHTML = "";
  S.sheetOpen = false;
  if (!quiet && S.lastFocus && S.lastFocus.focus && document.contains(S.lastFocus)) S.lastFocus.focus({ preventScroll: true });
}

export function toast(msg: string, act?: { label: string; fn: () => void }) {
  const el = $("#toast"), b = $("#toast-act");
  $("#toast-msg").textContent = msg;
  if (act) { b.hidden = false; b.textContent = act.label; b.onclick = () => { hideToast(); act.fn(); }; }
  else { b.hidden = true; b.onclick = null; }
  nowrapDom($("#toast-msg"));
  el.classList.add("show");
  if (toastT) clearTimeout(toastT);
  toastT = setTimeout(hideToast, act ? 7000 : 3800);
}
export function hideToast() { $("#toast").classList.remove("show"); }
