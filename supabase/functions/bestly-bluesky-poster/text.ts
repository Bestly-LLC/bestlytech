// Bluesky post text + rich-text facets: pure functions, no network. Used by bestly-bluesky-poster and unit-tested on their own.
//
// Rules (Jared, 2026-10-19):
//  - Post text max 300 graphemes (the record also caps at 3000 UTF-8 bytes; both are checked).
//  - Never cut with "..." : shorten by DROPPING lines (tags first, extra paragraphs, a long source line becomes a short one,
//    then the source goes); only when even the first paragraph does not fit is it cut, at a sentence end, never with dots.
//  - Keep "More: minutenewsdaily.com"; "minutenewsdaily.com" and any https:// address become real links (facets, UTF-8 byte offsets).
//  - Hashtags: at most 2, real tag facets.
//  - Bluesky has no AI-content field, so when the clip has an AI voice (or provenance is missing) the LAST LINE says "AI voice".

export const AI_LINE = "AI voice";
export const MORE_LINE = "More: minutenewsdaily.com";
export const MAX_GRAPHEMES = 300;
export const MAX_BYTES = 3000;
export const MAX_TAGS = 2;

const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
export const glen = (s: string): number => { let n = 0; for (const _ of seg.segment(s)) n++; return n; };
const enc = new TextEncoder();
export const blen = (s: string): number => enc.encode(s).length;
const fits = (s: string, max: number) => glen(s) <= max && blen(s) <= MAX_BYTES;

const HASHTAG_LINE = /^(\s*#[\p{L}\p{N}_]+\s*)+$/u;
const MORE_RE = /^\s*more:\s*(https?:\/\/)?(www\.)?minutenewsdaily\.com\/?\s*$/i;
const AI_RE = /^\s*ai voice\s*\.?\s*$/i;
const URL_RE = /https?:\/\/[^\s]+/g;

export type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: Array<{ $type: "app.bsky.richtext.facet#link"; uri: string } | { $type: "app.bsky.richtext.facet#tag"; tag: string }>;
};

function cleanTag(t: string): string | null {
  const x = t.replace(/^#/, "").replace(/[^\p{L}\p{N}_]/gu, "").slice(0, 60);
  return x && !/^\d+$/.test(x) ? x : null;           // Bluesky ignores all-number tags
}

// cut a paragraph to a grapheme budget at a sentence end (else a word end); never adds dots
function cutPara(p: string, budget: number): string {
  if (fits(p, budget)) return p;
  const chars = [...seg.segment(p)].map((s) => s.segment);
  let acc = "";
  for (const ch of chars) { if (glen(acc + ch) > budget || blen(acc + ch) > MAX_BYTES) break; acc += ch; }
  const sent = Math.max(acc.lastIndexOf(". "), acc.lastIndexOf("! "), acc.lastIndexOf("? "), acc.lastIndexOf(".\n"));
  if (sent > acc.length * 0.4) return acc.slice(0, sent + 1).trim();
  const sp = acc.lastIndexOf(" ");
  return (sp > acc.length * 0.4 ? acc.slice(0, sp) : acc).trim().replace(/[,;:\-–—]+$/, "").trim();
}

// "Source: CBS Miami, "Long title" on YouTube. Full video: https://youtu.be/x"  ->  "Source: CBS Miami https://youtu.be/x"
function compactSource(line: string): string | null {
  const m = line.match(/^\s*Source:\s*([^,"\n]+?)\s*(?:,|"|$)/i);
  const u = line.match(URL_RE)?.[0]?.replace(/[.,;:!?)\]]+$/, "");
  if (!m) return u ? "Full video: " + u : null;
  return "Source: " + m[1].trim() + (u ? " " + u : "");
}

export function linkFacets(text: string): Facet[] {
  const out: Facet[] = [];
  const taken: Array<[number, number]> = [];
  const add = (start: number, end: number, feature: Facet["features"][number]) => {
    if (taken.some(([a, b]) => start < b && end > a)) return;
    taken.push([start, end]);
    out.push({ index: { byteStart: blen(text.slice(0, start)), byteEnd: blen(text.slice(0, end)) }, features: [feature] });
  };
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(/[.,;:!?)\]]+$/, "");
    add(m.index!, m.index! + raw.length, { $type: "app.bsky.richtext.facet#link", uri: raw });
  }
  for (const m of text.matchAll(/(^|[^\w/.@-])(minutenewsdaily\.com)(?![\w-])/gi)) {
    const start = m.index! + m[1].length;
    add(start, start + m[2].length, { $type: "app.bsky.richtext.facet#link", uri: "https://minutenewsdaily.com" });
  }
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const tag = cleanTag(m[2]);
    if (!tag) continue;
    const start = m.index! + m[1].length;
    add(start, start + 1 + m[2].length, { $type: "app.bsky.richtext.facet#tag", tag });
  }
  return out.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

export function blueskyText(caption: string, aiLabel: boolean, opts: { ensureMore?: boolean; max?: number } = {}):
  { text: string; facets: Facet[]; tags: string[]; trimmed: boolean; graphemes: number; bytes: number } {
  const max = opts.max ?? MAX_GRAPHEMES;
  const lines = String(caption ?? "").replace(/\r\n?/g, "\n").split("\n");
  const tags: string[] = [];
  let hasMore = !!opts.ensureMore;
  const keep: string[] = [];
  for (const raw of lines) {
    if (raw.trim() && HASHTAG_LINE.test(raw)) {
      for (const t of raw.trim().split(/\s+/)) { const c = cleanTag(t); if (c && !tags.some((x) => x.toLowerCase() === c.toLowerCase())) tags.push(c); }
      continue;
    }
    if (MORE_RE.test(raw)) { hasMore = true; continue; }
    if (AI_RE.test(raw)) continue;                      // re-added last, below
    keep.push(raw.replace(/\s+$/, ""));
  }
  const paras = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim().split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const srcIdx = paras.findIndex((p) => /^source:/i.test(p));
  const source = srcIdx >= 0 ? paras[srcIdx] : null;
  const body = paras.filter((_, i) => i !== srcIdx);
  const useTags = tags.slice(0, MAX_TAGS);

  const build = (b: string[], src: string | null, withTags: boolean) => {
    const head = [...b, ...(src ? [src] : [])].join("\n\n");
    const tail = [hasMore ? MORE_LINE : null, withTags && useTags.length ? useTags.map((t) => "#" + t).join(" ") : null, aiLabel ? AI_LINE : null]
      .filter(Boolean).join("\n");
    return [head, tail].filter(Boolean).join("\n\n").trim();
  };

  const short = source ? compactSource(source) : null;
  // degrade in order; the first that fits wins
  const attempts: Array<[string[], string | null, boolean]> = [
    [body, source, true], [body.slice(0, 1), source, true],
    [body, short, true], [body.slice(0, 1), short, true],
    [body.slice(0, 1), source, false], [body.slice(0, 1), short, false],
    [body.slice(0, 1), null, false],
  ];
  let text = "";
  let trimmed = false;
  for (let i = 0; i < attempts.length; i++) {
    const t = build(...attempts[i]);
    if (fits(t, max)) { text = t; trimmed = i > 0; break; }
  }
  if (!text) {
    // even the first paragraph is too long: cut it (sentence end), keep the short source when it still fits
    for (const src of [short, null]) {
      const fixed = build([], src, false);
      const budget = max - glen(fixed) - (fixed ? 2 : 0);
      const first = body[0] ? cutPara(body[0], Math.max(budget, 0)) : "";
      const t = build(first ? [first] : [], src, false);
      if (first && fits(t, max)) { text = t; break; }
    }
    trimmed = true;
    if (!text) text = build([], null, false);
  }
  return { text, facets: linkFacets(text), tags: useTags.filter((t) => text.includes("#" + t)), trimmed, graphemes: glen(text), bytes: blen(text) };
}
