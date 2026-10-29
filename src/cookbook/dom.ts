// Family Cookbook: tiny DOM helpers, icons and "number + unit never wraps" safety net.
// The cookbook is a small hand-rendered app (strings in, innerHTML out), so everything that goes into a template
// string passes through esc() first.

export const $ = (s: string, r?: ParentNode | null): any => (r || document).querySelector(s);
export const $$ = (s: string, r?: ParentNode | null): any[] => Array.from((r || document).querySelectorAll(s));

export function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}
export const nwx = (s: unknown) => '<span class="nw">' + esc(s) + "</span>";
export const deep = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DAY = 864e5;
export const toDate = (d: string | Date | null | undefined): Date => (d instanceof Date ? d : d ? new Date(d) : new Date());
/** "Oct 29" */
export const fd = (d: string | Date | null | undefined) => { const x = toDate(d); return MON[x.getMonth()] + " " + x.getDate(); };
/** 12-hour clock, "3:05 PM" */
export function clock(d: Date = new Date()): string {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + m + " " + ap;
}
export const addDays = (d: Date, n: number) => { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; };
export function words(n: number) { return n + " " + (n === 1 ? "word" : "words"); }

export const IC: Record<string, string> = {
  camera: '<path d="M4 8.5A2 2 0 0 1 6 6.5h1.4l1.2-1.8a1 1 0 0 1 .8-.4h5.2a1 1 0 0 1 .8.4l1.2 1.8H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="12.6" r="3.6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>', down: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  trash: '<path d="M4 7h16M10 7V4.5h4V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6"/>',
  pencil: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  zin: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M11 8v6M8 11h6"/>', zout: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2M8 11h6"/>',
  share: '<path d="M12 15V4M8.5 7.5 12 4l3.5 3.5M6 11h-.5A1.5 1.5 0 0 0 4 12.5v6A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H18"/>',
  addsq: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.3a3 3 0 0 1 0 5.8M18 19a5.5 5.5 0 0 0-2.4-4.5"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.8l2.2 1.4M9.5 3.5h5"/>',
  sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"/>',
  flat: '<rect x="3.5" y="8" width="17" height="8.5" rx="1.5"/><path d="M6 19.5h12"/>',
  spark: '<path d="M11 3.5l1.6 4.4 4.4 1.6-4.4 1.6L11 15.5l-1.6-4.4L5 9.5l4.4-1.6zM18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  out: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h10"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  note: '<path d="M6 4h9l4 4v12H6z"/><path d="M14.5 4v4.5H19"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10.5" r="1.8"/><path d="m4 17 5-4.5 3.5 3L15 13l5 4.5"/>',
};
export const ic = (n: string, s?: number) =>
  '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"' + (s ? ' style="width:' + s + "px;height:" + s + 'px"' : "") + ">" + IC[n] + "</svg>";

/** Wrap every number+unit in plain text so it can never break across lines. */
const NOWRAP_RE = /([0-9½¼¾⅓⅔⅛][0-9.½¼¾⅓⅔⅛]*(?:[–-][0-9½¼¾⅓⅔⅛][0-9.½¼¾⅓⅔⅛]*)?(?:\s|-)?(?:°F|cups?|tbsp|tsp|oz|lb|minutes?|min|seconds?|sec|inches|inch|hours?|hr)(?![A-Za-z]))/g;
export function nowrapify(text: string): string {
  return String(text).split(NOWRAP_RE).map((p, i) => (i % 2 ? '<span class="nw">' + esc(p) + "</span>" : esc(p))).join("");
}

const UNITRE = /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?!\d)|\d{1,2}:\d{2} (?:AM|PM)|[0-9½¼¾⅓⅔⅛][0-9.½¼¾⅓⅔⅛]*(?:[–-][0-9½¼¾⅓⅔⅛.]+)? ?(?:×|°F|cups?|tbsp|tsp|oz|lb|minutes?|min|seconds?|sec|hours?|hr|days?|words?|cards?|servings?|slices?|bars?|recipes?|bagels?|cookies|inches|inch|gallons?|drinks?)(?![A-Za-z]))/g;
/** Safety net run on every screen after it is drawn: any "2 cups", "Oct 29", "3:05 PM" left in plain text gets no-wrap. */
export function nowrapDom(root: Element | null | undefined) {
  if (!root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n: Node) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const p = (n as Text).parentElement;
      if (!p || p.closest("script,style,textarea,input,svg,.nw,.amt,option")) return NodeFilter.FILTER_REJECT;
      UNITRE.lastIndex = 0;
      return UNITRE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  const nodes: Node[] = [];
  while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach((n) => {
    const frag = document.createDocumentFragment();
    const pd = getComputedStyle(n.parentNode as Element).display;
    let host: Node = frag;
    if (/flex|grid/.test(pd)) { host = document.createElement("span"); frag.appendChild(host); }
    (n.nodeValue as string).split(UNITRE).forEach((p, i) => {
      if (i % 2) { const s = document.createElement("span"); s.className = "nw"; s.textContent = p; host.appendChild(s); }
      else if (p) host.appendChild(document.createTextNode(p));
    });
    (n.parentNode as Node).replaceChild(frag, n);
  });
}

/** The app icon (also rasterised for the home screen). */
export function appIcon(size: number, cls?: string) {
  return '<svg class="' + (cls || "") + '" width="' + size + '" height="' + size + '" viewBox="0 0 88 88" role="img" aria-label="Cookbook app icon"><defs><linearGradient id="gic" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3F7AB4"/><stop offset="1" stop-color="#1D4670"/></linearGradient></defs>'
    + '<rect width="88" height="88" rx="20" fill="url(#gic)"/><g transform="rotate(-5 44 44)"><rect x="15" y="22" width="58" height="44" rx="4" fill="#FFFDF4"/><path d="M15 32H73" stroke="#D9544A" stroke-width="1.8"/><path d="M19 42H69M19 50H69M19 58H55" stroke="#8FB4DA" stroke-width="1.6" stroke-linecap="round"/></g></svg>';
}

/**
 * House copy rule: a sentence that fits on one line never splits across two. Every sentence in a paragraph becomes an
 * inline-block, so one that will not fit where it starts moves to the next line whole. Only text that ends a sentence is
 * wrapped, so a sentence that carries on into a number or date (a nowrap span) is left alone.
 */
export function lineify(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("p").forEach((p) => {
    if (p.dataset.ln) return;
    p.dataset.ln = "1";
    Array.from(p.childNodes).forEach((n) => {
      if (n.nodeType !== 3) return;
      const full = n.textContent || "";
      const tail = /^[)\]”"']*[.!?]*[)\]”"']*(?=\s|$)/.exec(full)?.[0] ?? "";
      const lead = /^\s*/.exec(full.slice(tail.length))![0];
      const rest = full.slice(tail.length + lead.length);
      const parts = rest.replace(/([.!?]["”')\]]*)\s+(?=[A-Z0-9"“(])/g, "$1\u0001").split("\u0001");
      if (parts.length < 2) return;
      const frag = document.createDocumentFragment();
      if (tail) frag.append(tail);
      if (lead) frag.append(" ");
      parts.forEach((s, i) => {
        if (i) frag.append(" ");
        if (/[.!?]["”')\]]*\s*$/.test(s)) { const sp = document.createElement("span"); sp.className = "ln"; sp.textContent = s.trim(); frag.append(sp); }
        else frag.append(s);
      });
      n.replaceWith(frag);
    });
  });
}
