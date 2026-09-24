// layout.ts — the Cookie Yeti / InventoryProof card system, as satori trees.
// Type only: an <img> can only ever be the mascot or a brand mark, by name.
export const W = 1080, H = 1350, PAD = 64;
export type Card = { kind: string; eyebrow?: string; head?: string; body?: string; big?: string; pose?: string; ground?: string; accent?: string; i: number; n: number };
let ASSETS = "";
export function setAssets(base: string) { ASSETS = base; }

// ── design tokens ───────────────────────────────────────────────────────────
export const GROUNDS: Record<string, Record<string, [string, string]>> = {
  cy: { plum: ["#250F37", "#3A1F5C"], wine: ["#300D19", "#4A1A2C"], forest: ["#07211B", "#12382D"], indigo: ["#0D142C", "#182450"], ink: ["#151221", "#221C33"], teal: ["#061F26", "#0F3A46"] },
  ip: { navy: ["#0D1424", "#16213E"], green: ["#061F16", "#10382A"], purple: ["#1F0E2D", "#33204E"], wine: ["#300B10", "#4A1A1E"], slate: ["#161E2E", "#202B40"], ocean: ["#121D49", "#1C2E6E"] },
};
export const ACCENT: Record<string, Record<string, string>> = {
  cy: { teal: "#4FE0C4", pink: "#F0628C", gold: "#E9B44C", grey: "#B9B4C8", dim: "#8C86A0" },
  ip: { orange: "#F2A33A", blue: "#6F9BFF", green: "#4FDC94", lilac: "#CDA6FF", gold: "#F2A33A", grey: "#AEB6C8", dim: "#7F8798" },
};
export const KINDS: Record<string, string[]> = { cy: ["cover", "body", "serif", "word", "closing"], ip: ["quote", "lead", "word", "bar", "closing"] };
const grad = (b: string, g: string) => { const [a, c] = GROUNDS[b][g] || Object.values(GROUNDS[b])[0]; return `linear-gradient(180deg, ${a} 0%, ${c} 100%)`; };

// ── element tree (what satori consumes) ─────────────────────────────────────
type El = { type: string; props: Record<string, unknown> };
// deno-lint-ignore no-explicit-any
// satori treats ANY array of children as "more than one child", so a childless
// or single-child node must not carry an array at all.
const h = (type: string, props: Record<string, any> | null, ...children: any[]): El => {
  const kids = children.filter((c) => c != null && c !== false);
  const p: Record<string, any> = { ...(props || {}) };
  if (kids.length === 1) p.children = kids[0]; else if (kids.length > 1) p.children = kids;
  return { type, props: p };
};

function accented(text: string) { const m = /^(.*?)\*([^*]+)\*(.*)$/s.exec(text || ""); return m ? [m[1], m[2], m[3]] : null; }
// A headline is a wrapping row of word boxes: satori lays out flex, not inline
// runs, and this is what lets one phrase carry a colour and still break lines.
function Head(o: { text?: string; color: string; size: number; weight: number; family: string; align?: string; line?: number; extra?: Record<string, unknown>; underline?: boolean }) {
  const { text, color, size, weight, family, align = "left", line = 1.05, extra = {}, underline = false } = o;
  const parts = accented(text || "") || ["", "", text || ""];
  const words: [string, boolean][] = [];
  const push = (chunk: string, on: boolean) => chunk.split(/\s+/).filter(Boolean).forEach((w) => words.push([w, on]));
  push(parts[0], false); push(parts[1], true); push(parts[2], false);
  const on = underline ? { textDecoration: "underline", textDecorationColor: color } : { color };
  return h("div", { style: { display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", columnGap: Math.round(size * 0.26),
    fontFamily: family, fontSize: size, fontWeight: weight, lineHeight: line, color: "#FFFFFF", letterSpacing: "-0.02em", ...extra } },
    ...words.map(([w, acc]) => h("div", { style: acc ? on : {} }, w)));
}
const Dots = (i: number, n: number, color: string, dim: string) => h("div", { style: { display: "flex", gap: 10 } },
  ...Array.from({ length: n }, (_, k) => h("div", { style: { width: 12, height: 12, borderRadius: 6, background: k + 1 === i ? color : dim, opacity: k + 1 === i ? 1 : 0.55 } })));
const Arrow = (color: string) => h("svg", { width: 44, height: 16, viewBox: "0 0 44 16" }, h("path", { d: "M0 8h40M33 1l7 7-7 7", fill: "none", stroke: color, strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round" }));
// deno-lint-ignore no-explicit-any
const col = (extra: Record<string, unknown>, ...kids: any[]) => h("div", { style: { display: "flex", flexDirection: "column", ...extra } }, ...kids.filter((k) => k != null));
const txt = (style: Record<string, unknown>, s: string) => h("div", { style }, s);

export function cy(p: Card) {
  const A = ACCENT.cy;
  const bodyT = (size: number, align: string, extra: Record<string, unknown>) => p.body ? txt({ fontFamily: "InterTight", fontWeight: 500, fontSize: size, lineHeight: 1.4, color: A.grey, textAlign: align, ...extra }, p.body) : null;
  const brand = col({ position: "absolute", left: PAD, top: 56 },
    txt({ fontFamily: "InterTight", fontWeight: 600, fontSize: 30, color: "#FFFFFF" }, "Cookie Yeti"),
    txt({ fontFamily: "InterTight", fontWeight: 500, fontSize: 15, letterSpacing: "0.22em", color: A.dim, marginTop: 6 }, "PRIVACY · AUTOMATIC"));
  const last = p.n > 1 && p.i === p.n;
  const footer = h("div", { style: { position: "absolute", left: PAD, right: PAD, bottom: 60, display: "flex", alignItems: "center", justifyContent: "space-between" } },
    h("div", { style: { display: "flex", alignItems: "center", gap: 12, fontFamily: "InterTight", fontWeight: 500, fontSize: 24, color: A.teal, opacity: p.n > 1 && !last ? 1 : 0 } }, h("div", {}, "Swipe"), Arrow(A.teal)),
    p.n > 1 ? Dots(p.i, p.n, A.teal, A.dim) : h("div", {}));
  let main: El;
  if (p.kind === "cover") {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 290 },
      p.eyebrow ? txt({ fontFamily: "InterTight", fontWeight: 600, fontSize: 19, letterSpacing: "0.24em", color: A.teal, marginBottom: 34 }, p.eyebrow.toUpperCase()) : null,
      Head({ text: p.head, color: A.teal, size: 92, weight: 800, family: "InterTight" }),
      h("div", { style: { width: 88, height: 5, background: A.teal, borderRadius: 3, marginTop: 42, marginBottom: 34 } }),
      bodyT(27, "left", { maxWidth: 900 }));
  } else if (p.kind === "body") {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 360 },
      Head({ text: p.head, color: A.teal, size: 58, weight: 700, family: "InterTight", line: 1.12 }),
      bodyT(33, "left", { marginTop: 40, maxWidth: 900 }));
  } else if (p.kind === "serif") {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 0, height: H, justifyContent: "center", alignItems: "center" },
      Head({ text: p.head, color: A.pink, size: 104, weight: 800, family: "Playfair", align: "center", line: 1.12, underline: true, extra: { letterSpacing: "-0.01em" } }),
      bodyT(27, "center", { marginTop: 36, maxWidth: 880 }));
  } else if (p.kind === "word") {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 0, height: H, justifyContent: "center", alignItems: "center" },
      txt({ fontFamily: "Playfair", fontWeight: 800, fontSize: (p.big || "").length > 9 ? 150 : 200, lineHeight: 1, color: A.gold, letterSpacing: "-0.02em", textAlign: "center" }, `${p.big}.`),
      Head({ text: p.head, color: A.teal, size: 62, weight: 700, family: "InterTight", align: "center", line: 1.12, extra: { marginTop: 40 } }),
      bodyT(26, "center", { marginTop: 28, maxWidth: 820 }));
  } else {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 0, height: H, justifyContent: "center", alignItems: "center" },
      h("img", { src: `${ASSETS}/brand/cookieyeti-icon.png`, width: 250, height: 250, style: { borderRadius: 56 } }),
      Head({ text: p.head, color: A.teal, size: 44, weight: 700, family: "InterTight", align: "center", line: 1.2, extra: { marginTop: 56, maxWidth: 820 } }),
      txt({ fontFamily: "InterTight", fontWeight: 600, fontSize: 30, color: A.teal, marginTop: 34 }, "@cookie_yeti_privacy"),
      txt({ fontFamily: "InterTight", fontWeight: 500, fontSize: 27, color: A.grey, marginTop: 26 }, "On the App Store"));
  }
  return h("div", { style: { width: W, height: H, display: "flex", position: "relative", background: grad("cy", p.ground || "plum") } }, brand, main, footer);
}

export function ip(p: Card) {
  const A = ACCENT.ip, ac = A[p.accent || ""] || A.blue;
  const eyebrow = (align = "left") => p.eyebrow ? txt({ fontFamily: "Manrope", fontWeight: 700, fontSize: 17, letterSpacing: "0.26em", color: ac, textAlign: align, marginBottom: 30 }, p.eyebrow.toUpperCase()) : null;
  const body = (size: number, align = "left", extra: Record<string, unknown> = {}) => p.body ? txt({ fontFamily: "Manrope", fontWeight: 500, fontSize: size, lineHeight: 1.45, color: A.grey, textAlign: align, ...extra }, p.body) : null;
  const brand = h("div", { style: { display: "flex", position: "absolute", left: PAD, top: 60, fontFamily: "Manrope", fontWeight: 700, fontSize: 28, color: "#FFFFFF", letterSpacing: "-0.01em" } },
    h("div", {}, "Inventory"), h("div", { style: { color: A.orange } }, "Proof"), h("div", { style: { color: A.orange, fontSize: 14, marginLeft: 4, marginTop: -6 } }, "°"));
  const last = p.n > 1 && p.i === p.n;
  const footer = h("div", { style: { position: "absolute", left: PAD, right: PAD, bottom: 60, display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "Manrope", fontWeight: 500, fontSize: 21, color: A.dim } },
    h("div", { style: { display: "flex", alignItems: "center", gap: 10, opacity: p.n > 1 && !last ? 1 : 0 } }, h("div", {}, "swipe"), Arrow(A.dim)),
    p.n > 1 ? Dots(p.i, p.n, A.blue, A.dim) : h("div", {}),
    h("div", { style: { opacity: last ? 0 : 1 } }, "iOS · App Store"));
  const mascot = (size: number) => p.pose ? h("img", { src: `${ASSETS}/proofy/proofy-${p.pose}.png`, height: size, style: { position: "absolute", right: PAD - 8, bottom: 118, objectFit: "contain" } }) : null;
  let main: El, extra: El | null = null;
  if (p.kind === "quote") {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 250, alignItems: "center" },
      txt({ alignSelf: "flex-start", fontFamily: "Manrope", fontWeight: 800, fontSize: 96, lineHeight: 0.6, color: ac, marginBottom: 40 }, "“"),
      eyebrow("center"),
      Head({ text: p.head, color: ac, size: 70, weight: 700, family: "Manrope", align: "center", line: 1.14, extra: { maxWidth: 900 } }),
      body(24, "center", { marginTop: 40, maxWidth: 760 }));
    extra = mascot(200);
  } else if (p.kind === "lead") {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 300 },
      eyebrow(),
      Head({ text: p.head, color: ac, size: 60, weight: 700, family: "Manrope", line: 1.12 }),
      h("div", { style: { width: 88, height: 4, background: ac, borderRadius: 2, marginTop: 36, marginBottom: 34 } }),
      body(29, "left", { maxWidth: 900 }));
    extra = mascot(220);
  } else if (p.kind === "word") {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 290 },
      eyebrow(),
      txt({ fontFamily: "Manrope", fontWeight: 800, fontSize: (p.big || "").length > 10 ? 104 : 128, lineHeight: 1.0, color: ac, letterSpacing: "-0.03em", textTransform: "uppercase", maxWidth: 940 }, p.big || ""),
      Head({ text: p.head, color: ac, size: 34, weight: 700, family: "Manrope", line: 1.25, extra: { marginTop: 36, maxWidth: 820 } }),
      body(22, "left", { marginTop: 22, maxWidth: 560 }));
    extra = mascot(250);
  } else if (p.kind === "bar") {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 300 },
      eyebrow(),
      h("div", { style: { display: "flex", borderLeft: `8px solid ${A.gold}`, paddingLeft: 34 } },
        Head({ text: p.head, color: A.gold, size: 60, weight: 700, family: "Manrope", line: 1.12, extra: { maxWidth: 860 } })),
      body(24, "left", { marginTop: 40, maxWidth: 560 }));
    extra = mascot(250);
  } else {
    main = col({ position: "absolute", left: PAD, right: PAD, top: 0, height: H, justifyContent: "center", alignItems: "center" },
      h("img", { src: `${ASSETS}/proofy/proofy-${p.pose || "cheering-arms-up"}.png`, height: 270, style: { objectFit: "contain" } }),
      Head({ text: p.head, color: ac, size: 44, weight: 700, family: "Manrope", align: "center", line: 1.2, extra: { marginTop: 50, maxWidth: 840 } }),
      txt({ fontFamily: "Manrope", fontWeight: 600, fontSize: 28, color: A.blue, marginTop: 30 }, "@inventoryproof"),
      txt({ fontFamily: "Manrope", fontWeight: 500, fontSize: 26, color: A.grey, marginTop: 24 }, "On the App Store"));
  }
  return h("div", { style: { width: W, height: H, display: "flex", position: "relative", background: grad("ip", p.ground || "navy") } }, brand, main, ...(extra ? [extra] : []), footer);
}
