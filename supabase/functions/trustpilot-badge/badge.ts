// Pure drawing code for the Trustpilot signature badge (no Deno APIs, so it
// can also be rendered locally with node). Drawn in "pt"; the PNG is 3x.
//
// Official Trustpilot logo + star images are passed in untouched as data URIs.
// Bestly never draws Trustpilot stars. Every div with >1 child sets
// display:flex explicitly — satori throws otherwise.

export const PT = 3; // render scale (Retina 3x)
export const W_PT = 264; // display width in pt, identical for both states
export const H_PT = 36; // display height in pt

export type Img = { uri: string; aspect: number }; // aspect = viewBox w / h
export type Assets = { logo: Img; stars: Img | null };
export type Stats = { avg: number | null; count: number } | null;

const NAVY = "rgb(15,33,51)";
const NAVY_SOFT = "rgba(15,33,51,0.62)";
const ACCENT = "rgb(76,95,201)";

// deno-lint-ignore no-explicit-any
const h = (type: string, props: Record<string, any> | null, ...children: any[]) => {
  const kids = children.filter((c) => c != null && c !== false);
  // deno-lint-ignore no-explicit-any
  const p: Record<string, any> = { ...(props || {}) };
  if (kids.length === 1) p.children = kids[0];
  else if (kids.length > 1) p.children = kids;
  return { type, props: p };
};

const px = (pt: number) => Math.round(pt * PT);

function img(i: Img, heightPt: number) {
  const hh = px(heightPt);
  return h("img", { src: i.uri, width: Math.round(hh * i.aspect), height: hh, style: { width: Math.round(hh * i.aspect), height: hh } });
}

const CHEVRON = "data:image/svg+xml;base64," + btoa(
  `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="20" viewBox="0 0 12 20"><path d="M2.5 2.5 L9.5 10 L2.5 17.5" fill="none" stroke="rgb(76,95,201)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
);

export function ratingLabel(stats: Stats) {
  const avg = stats?.avg;
  const a = typeof avg === "number" ? avg : Number(avg);
  return Number.isFinite(a) ? a.toFixed(1) : "0.0";
}

// Stars image file: average rounded DOWN to the nearest 0.5.
export function starsKey(avg: number | null | undefined): string {
  const a = Number(avg);
  const f = Number.isFinite(a) ? Math.max(0, Math.min(5, Math.floor(a * 2) / 2)) : 0;
  return Number.isInteger(f) ? String(f) : f.toFixed(1);
}

export function Badge(stats: Stats, a: Assets) {
  const hasReviews = !!stats && stats.count > 0 && !!a.stars;
  const margin = px(3);
  const textBase = { fontFamily: "InterTight", letterSpacing: "0.01em", color: NAVY, lineHeight: 1, whiteSpace: "nowrap" };

  const content = hasReviews
    ? [
        img(a.logo, 13.5),
        img(a.stars!, 13),
        h("div", { style: { display: "flex", alignItems: "center", gap: px(4) } },
          h("span", { style: { ...textBase, fontSize: px(12.5), fontWeight: 700 } }, ratingLabel(stats)),
          h("span", { style: { ...textBase, fontSize: px(12.5), fontWeight: 600, color: NAVY_SOFT } }, "·"),
          h("span", { style: { ...textBase, fontSize: px(12.5), fontWeight: 600, color: NAVY_SOFT } },
            `${stats!.count} review${stats!.count === 1 ? "" : "s"}`)),
      ]
    : [
        h("span", { style: { ...textBase, fontSize: px(13.5), fontWeight: 600 } }, "Review us on"),
        img(a.logo, 15),
        h("img", { src: CHEVRON, width: px(5), height: px(8.5), style: { width: px(5), height: px(8.5), marginLeft: px(-1) } }),
      ];

  return h("div", { style: { width: px(W_PT), height: px(H_PT), display: "flex", alignItems: "center", justifyContent: "center", padding: margin } },
    h("div", { style: {
      display: "flex", alignItems: "center", justifyContent: "center", gap: px(hasReviews ? 8 : 6),
      width: "100%", height: "100%", borderRadius: 999, background: "#FFFFFF",
      border: `${PT}px solid rgba(15,33,51,0.12)`,
      boxShadow: `0 ${px(0.67)}px ${px(2.5)}px rgba(15,33,51,0.09)`,
    } }, ...content));
}
