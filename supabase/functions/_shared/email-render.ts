// email-render.ts — the Email Builder's one renderer. Pure TypeScript, no imports, no Deno or DOM APIs, so the
// admin page (Vite) and the edge functions (Deno) run the exact same code: what Jared previews is what is sent.
//
//   blocks (JSON)  +  brand kit (data)  ->  email-safe HTML (tables, inline styles, 600px, 560px card)
//
// Brand kits are DATA (public.email_brand_kits). Nothing about a brand is hard-coded here except the defaults a
// kit may leave out. The shell mirrors public/email-templates/bestly-letter.html: same classes (bg, card, bt, bm,
// bb, eb, bx, lk) so the dark-mode block works in Apple Mail / iOS, same bulletproof buttons, same feathered footer.
//
// Also here: block validation/repair for model output (normalizeDoc), a plain-text renderer, and the .eml builder
// (multipart/related with inline CID images, X-Unsent: 1) so Apple Mail's draft window keeps the pictures.

/* ───────────────────────── types ───────────────────────── */

export type ButtonStyle = "solid" | "outline";

export type Block =
  | { id: string; type: "eyebrow"; text: string }
  | { id: string; type: "headline"; text: string }
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "subheading"; text: string }
  | { id: string; type: "list"; items: string[]; ordered?: boolean }
  | { id: string; type: "button"; label: string; url: string; style?: ButtonStyle }
  | { id: string; type: "callout"; title?: string; text: string; image_url?: string; image_alt?: string; button?: { label: string; url: string; style?: ButtonStyle } }
  | { id: string; type: "image"; kind: "asset" | "ai"; asset_key?: string; prompt?: string; url?: string; alt: string; link?: string }
  | { id: string; type: "panel"; hero_label?: string; hero_value?: string; rows: { label: string; value: string }[] }
  | { id: string; type: "divider" }
  | { id: string; type: "signature" }
  | { id: string; type: "product_ads"; keys: string[]; variant?: "full" | "soft" };

export type BlockType = Block["type"];
export const BLOCK_TYPES: BlockType[] = ["eyebrow", "headline", "paragraph", "subheading", "list", "button", "callout", "image", "panel", "divider", "signature", "product_ads"];

export interface EmailDoc {
  subject: string;
  preheader?: string;
  blocks: Block[];
}

export interface KitTheme {
  page_bg?: string; card_bg?: string; card_border?: string;
  text?: string; heading?: string; muted?: string;
  accent?: string; accent_text?: string; eyebrow?: string; box_bg?: string; rule?: string;
  font_body?: string; font_heading?: string; font_css_url?: string;
  heading_size?: number; heading_weight?: number; heading_tracking?: string;
  radius?: number;
  dark?: { page_bg?: string; card_bg?: string; card_border?: string; text?: string; heading?: string; muted?: string; eyebrow?: string; box_bg?: string; link?: string; rule?: string };
}
export interface KitHeader {
  layout?: "banner" | "logo" | "text" | "none";
  image_url?: string; link_url?: string; alt?: string; bg?: string;
  name?: string; name_color?: string; logo_size?: number; logo_radius?: number;
}
export interface KitSignature {
  enabled?: boolean; style?: "photo" | "text";
  name?: string; role?: string; role_brand?: string; email?: string; phone?: string; phone_tel?: string;
  image_url?: string; divider_color?: string; sub?: string;
}
export interface KitFooterLine { text: string; link_label?: string; link_url?: string }
export interface KitFooter { rainbow?: boolean; lines?: KitFooterLine[] }
export interface KitAd {
  key: string; name: string; style?: "hero" | "row";
  headline?: string; blurb: string; url: string; cta?: string;
  image_url?: string; icon_url?: string; icon_bg?: string;
  extra_text?: string; extra_label?: string; extra_url?: string;
}
export interface KitAds { heading?: string; items?: KitAd[] }
export interface KitAdPolicy { mode?: "ensure" | "auto" | "never"; max?: number; default_keys?: string[]; soft_prefix?: string }
export interface KitSender { from_name?: string; from_email?: string; reply_to?: string; bcc?: string }
export interface KitAsset { url: string; alt: string; label?: string }

export interface Kit {
  slug: string; name: string; kind?: "house" | "client";
  theme?: KitTheme; header?: KitHeader; signature?: KitSignature; footer?: KitFooter;
  product_ads?: KitAds; ad_policy?: KitAdPolicy; default_sender?: KitSender;
  assets?: Record<string, KitAsset>;
  ai_images?: "allow" | "never";
  voice?: string; // plain-language voice note for the writer
  default_eyebrow?: string;
  site_url?: string;
}

/* ───────────────────────── defaults (Bestly look) ───────────────────────── */

const SANS = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter','Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "'Newsreader',Georgia,'Times New Roman',serif";

const T0 = {
  page_bg: "#faf9f7", card_bg: "#ffffff", card_border: "#e7e5e0",
  text: "#111827", heading: "#111827", muted: "#667085",
  accent: "#3b4a9c", accent_text: "#ffffff", eyebrow: "#3b4a9c", box_bg: "#f3f1ec", rule: "#e7e5e0",
  font_body: SANS, font_heading: SERIF, font_css_url: "https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400&display=swap",
  heading_size: 32, heading_weight: 400, heading_tracking: "-.02em", radius: 20,
  dark: { page_bg: "#0b0d14", card_bg: "#141414", card_border: "#242424", text: "#fafafa", heading: "#fafafa", muted: "#a8a8a8", eyebrow: "#7b8fe5", box_bg: "#1d1d1d", link: "#9aaaf0", rule: "#242424" },
};

/** Merge a kit over its parent. Objects merge by key; arrays and scalars replace. Used by resolveKit. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (over === null || over === undefined) return base;
  if (typeof base !== "object" || base === null || Array.isArray(base) || typeof over !== "object" || Array.isArray(over)) return over as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = k in out ? deepMerge(out[k], v) : v;
  return out as T;
}

/** Resolve `extends` chains. `rows` is every kit row keyed by slug; a row's `extends` names its parent slug. */
export function resolveKit(row: Kit & { extends?: string | null }, rows: Record<string, Kit & { extends?: string | null }>, depth = 0): Kit {
  if (!row.extends || depth > 4 || !rows[row.extends]) return row;
  const parent = resolveKit(rows[row.extends], rows, depth + 1);
  const { extends: _e, ...mine } = row;
  const merged = deepMerge(parent as unknown, mine) as Kit;
  // the child's own identity always wins
  merged.slug = row.slug; merged.name = row.name; merged.kind = row.kind ?? parent.kind;
  return merged;
}

/* ───────────────────────── text helpers ───────────────────────── */

export function esc(t: string): string {
  return String(t ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const UNITS = "AM|PM|am|pm|a\\.m\\.|p\\.m\\.|mph|mi|ft|lb|lbs|oz|MB|GB|KB|TB|min|mins|hr|hrs|%";
/** A number never wraps away from its unit: "9 MB", "3:05 PM", "65 mph" get a non-breaking space. */
export function bindUnits(t: string): string {
  return String(t ?? "")
    .replace(new RegExp(`(\\d)[ \\t]+(${UNITS})(?![A-Za-z])`, "g"), "$1 $2")
    .replace(/(\d)[ \t]+(°[FC])/g, "$1 $2")
    .replace(/(\$\d[\d,.]*)[ \t]+(million|billion|k)\b/gi, "$1 $2");
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2460}-\u{24FF}\u{25A0}-\u{25FF}]/gu;
export const stripEmoji = (t: string) => String(t ?? "").replace(EMOJI, "").replace(/[ \t]{2,}/g, " ");

const SAFE_URL = /^(https:\/\/|mailto:|tel:)/i;
export function safeUrl(u: unknown): string {
  const s = String(u ?? "").trim();
  return SAFE_URL.test(s) && !/[\s"<>]/.test(s) ? s : "";
}

/** Inline text: escape, then **bold** and [label](url). Newlines become <br>. Numbers stay with their units. */
export function inline(raw: string, linkStyle: string, bold = "600"): string {
  let s = esc(bindUnits(stripEmoji(raw)));
  s = s.replace(/\[([^\]\n]{1,120})\]\((https:\/\/[^\s)"<>]+|mailto:[^\s)"<>]+|tel:[^\s)"<>]+)\)/g, (_m, label, url) => `<a class="lk" href="${url}" style="${linkStyle}">${label}</a>`);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, `<b style="font-weight:${bold}">$1</b>`);
  return s.replace(/ /g, "&nbsp;").replace(/\n/g, "<br>");
}

/** Plain text of the same inline markup (links become "label (url)"). */
export function inlineText(raw: string): string {
  return stripEmoji(String(raw ?? "")).replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "$1 ($2)").replace(/\*\*([^*\n]+)\*\*/g, "$1");
}

/* ───────────────────────── ids ───────────────────────── */

let _n = 0;
export function blockId(): string {
  _n = (_n + 1) % 1e6;
  return "b" + Date.now().toString(36).slice(-4) + _n.toString(36) + Math.random().toString(36).slice(2, 5);
}

/* ───────────────────────── rendering ───────────────────────── */

type TH = typeof T0 & KitTheme;
function themeOf(kit: Kit): TH {
  const t = { ...T0, ...(kit.theme ?? {}), dark: { ...T0.dark, ...(kit.theme?.dark ?? {}) } } as TH;
  return t;
}

function fontStyle(weight: number, size: number, line: number, family: string) {
  return `font:${weight} ${size}px/${line}px ${family}`;
}

function btnHtml(th: TH, label: string, url: string, style: ButtonStyle = "solid", fam: string, margin = "6px 0 18px", attrs = ""): string {
  const href = safeUrl(url);
  if (!href) return "";
  const r = 12;
  if (style === "outline") {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${margin}"><tr><td class="lk" style="border:1.5px solid ${th.accent};border-radius:${r}px"><a href="${esc(href)}" target="_blank" class="lk"${attrs} style="display:inline-block;padding:12.5px 24px;${fontStyle(600, 16, 20, fam)};color:${th.accent};text-decoration:none;border-radius:${r}px">${esc(bindUnits(stripEmoji(label))).replace(/ /g, "&nbsp;")}</a></td></tr></table>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${margin}"><tr><td style="background:${th.accent};border-radius:${r}px"><a href="${esc(href)}" target="_blank"${attrs} style="display:inline-block;padding:14px 26px;${fontStyle(600, 16, 20, fam)};color:${th.accent_text};text-decoration:none;border-radius:${r}px">${esc(bindUnits(stripEmoji(label))).replace(/ /g, "&nbsp;")}</a></td></tr></table>`;
}

function sigHtml(kit: Kit, th: TH): string {
  const s = kit.signature ?? {};
  if (s.enabled === false) return "";
  const fam = th.font_body as string;
  const name = esc(s.name ?? "");
  const link = `color:${th.accent};text-decoration:none`;
  if (s.style === "text") {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:32px"><tr><td class="bb" style="border-top:1px solid ${th.rule};padding-top:24px">`
      + `<p class="bh" style="margin:4px 0 0;font:700 16px/24px ${fam};color:${th.heading}">${name}</p>`
      + (s.role ? `<p class="bm" style="margin:0;font:400 14px/21px ${fam};color:${th.muted}">${esc(s.role)}</p>` : "")
      + `</td></tr></table>`;
  }
  const div = s.divider_color ?? "#7a8be0";
  const brand = s.role_brand ? ` <span class="bt" style="font:400 15px/18px ${th.font_heading};color:${th.heading}">${esc(s.role_brand)}</span>` : "";
  const phone = s.phone ? `<span class="bm" style="color:${th.muted}">&nbsp;&nbsp;·&nbsp;&nbsp;</span><a class="lk" href="tel:${esc(s.phone_tel ?? "")}" style="${link};white-space:nowrap">${esc(s.phone).replace(/ /g, "&nbsp;").replace(/-/g, "&#8209;")}</a>` : "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
    + (s.image_url ? `<td style="vertical-align:top;padding:0;width:56px"><img src="${esc(s.image_url)}" width="56" height="56" alt="${name}" style="display:block;width:56px;height:56px;border:0;border-radius:28px"></td><td style="width:16px;min-width:16px;font-size:0;line-height:0">&nbsp;</td>` : "")
    + `<td class="bb" style="vertical-align:top;padding:0 0 0 14px;border-left:2px solid ${div}">`
    + `<div class="bh" style="font:600 15px/20px ${fam};color:${th.heading}">${name}</div>`
    + (s.role ? `<div class="bm" style="padding-top:2px;font:400 13px/18px ${fam};color:${th.muted}">${esc(s.role)}${brand}</div>` : "")
    + `<div style="padding-top:8px;font:400 13px/20px ${fam}">${s.email ? `<a class="lk" href="mailto:${esc(s.email)}" style="${link}">${esc(s.email)}</a>` : ""}${phone}</div>`
    + `</td></tr></table>`;
}

function adRowHtml(a: KitAd, th: TH, last: boolean): string {
  const fam = th.font_body as string;
  const bdr = last ? "" : `border-bottom:1px solid ${th.rule};`;
  return `<tr><td class="bb" style="padding:18px 0;${bdr}"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`
    + (a.icon_url ? `<td style="width:56px;vertical-align:top"><a href="${esc(a.url)}" style="text-decoration:none"><img src="${esc(a.icon_url)}" width="56" height="56" alt="${esc(a.name)}" style="display:block;width:56px;height:56px;border:0;border-radius:14px;background:${a.icon_bg ?? th.box_bg}"></a></td><td style="width:16px;font-size:0;line-height:0">&nbsp;</td>` : "")
    + `<td style="vertical-align:top"><div class="bh" style="font:600 15px/20px ${fam};color:${th.heading}">${esc(a.name)}</div>`
    + `<div class="bm" style="padding-top:4px;font:400 14px/21px ${fam};color:${th.muted}">${inline(a.blurb, `color:${th.accent};text-decoration:none`)}</div>`
    + `<div style="padding-top:8px;font:600 14px/20px ${fam}"><a class="lk" href="${esc(a.url)}" style="color:${th.accent};text-decoration:none;white-space:nowrap">${esc(a.cta ?? "Learn more")}&nbsp;&rarr;</a></div></td></tr></table></td></tr>`;
}

function adsFullHtml(kit: Kit, th: TH, keys: string[]): string {
  const items = (kit.product_ads?.items ?? []).filter((a) => keys.includes(a.key));
  if (!items.length) return "";
  const fam = th.font_body as string;
  const hero = items.find((a) => a.style === "hero");
  const rows = items.filter((a) => a !== hero);
  const link = `color:${th.accent};text-decoration:none`;
  let h = `<tr><td style="padding:32px 4px 12px"><p class="bm" style="margin:0;font:600 12px/16px ${fam};letter-spacing:.16em;text-transform:uppercase;color:${th.muted}">${esc(kit.product_ads?.heading ?? "More from Bestly")}</p></td></tr>`;
  h += `<tr><td class="card" style="background:${th.card_bg};border:1px solid ${th.card_border};border-radius:${th.radius}px;padding:0;overflow:hidden">`;
  if (hero) {
    h += (hero.image_url ? `<a href="${esc(hero.url)}" style="display:block;text-decoration:none;line-height:0"><img src="${esc(hero.image_url)}" width="560" alt="${esc(hero.name)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:${th.radius}px ${th.radius}px 0 0;background:#0b0d14"></a>` : "")
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pad" style="padding:22px 28px 6px">`
      + (hero.headline ? `<div class="bh" style="font:400 22px/28px ${th.font_heading};letter-spacing:-.01em;color:${th.heading}">${esc(hero.headline)}</div>` : "")
      + `<div class="bm" style="padding-top:8px;font:400 15px/23px ${fam};color:${th.muted}">${inline(hero.blurb, link)}</div>`
      + `<div style="padding-top:12px;font:600 15px/22px ${fam}"><a class="lk" href="${esc(hero.url)}" style="${link};white-space:nowrap">${esc(hero.cta ?? "Learn more")}&nbsp;&rarr;</a>`
      + (hero.extra_text ? `<span class="bm" style="color:${th.muted};font-weight:400">&nbsp;&nbsp;${esc(hero.extra_text)}&nbsp;</span><a class="lk" href="${esc(hero.extra_url ?? "")}" style="${link};white-space:nowrap">${esc(hero.extra_label ?? "").replace(/ /g, "&nbsp;").replace(/-/g, "&#8209;")}</a>` : "")
      + `</div></td></tr>`;
    if (rows.length) h += `<tr><td class="pad" style="padding:6px 28px 6px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.map((a, i) => adRowHtml(a, th, i === rows.length - 1)).join("")}</table></td></tr>`;
    h += `</table>`;
  } else {
    h += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="pad" style="padding:6px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows.map((a, i) => adRowHtml(a, th, i === rows.length - 1)).join("")}</table></td></tr></table>`;
  }
  return h + `</td></tr>`;
}

/** One quiet line inside the card: "From Bestly: Bestly Studio makes your social posts. See how it works". */
function adsSoftHtml(kit: Kit, th: TH, keys: string[]): string {
  const a = (kit.product_ads?.items ?? []).find((x) => keys.includes(x.key));
  if (!a) return "";
  const fam = th.font_body as string;
  const prefix = kit.ad_policy?.soft_prefix ?? "From Bestly:";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px"><tr><td class="bb" style="border-top:1px solid ${th.rule};padding-top:18px">`
    + `<p class="bm" style="margin:0;font:400 14px/21px ${fam};color:${th.muted}"><b class="bh" style="font-weight:600;color:${th.heading}">${esc(prefix)}</b> ${inline(a.blurb, `color:${th.accent};text-decoration:none`)} <a class="lk" href="${esc(a.url)}" style="color:${th.accent};text-decoration:none;font-weight:600;white-space:nowrap">${esc(a.cta ?? "Learn more")}&nbsp;&rarr;</a></p>`
    + `</td></tr></table>`;
}

/** Preview-only hooks: the builder's preview page makes these elements tap-to-edit. Never present in sent/exported HTML. */
const ea = (on: boolean, id: string, field: string, raw: string) =>
  on ? ` data-bid="${esc(id)}" data-field="${field}" data-raw="${esc(raw).replace(/\n/g, "&#10;")}"` : "";

function renderBlock(b: Block, kit: Kit, th: TH, ed = false): string {
  const fam = th.font_body as string;
  const link = `color:${th.accent};text-decoration:none`;
  switch (b.type) {
    case "eyebrow":
      return `<p class="eb"${ea(ed, b.id, "text", b.text)} style="margin:0 0 10px;font:600 12px/16px ${fam};letter-spacing:.16em;text-transform:uppercase;color:${th.eyebrow}">${esc(bindUnits(stripEmoji(b.text)))}</p>`;
    case "headline":
      return `<h1 class="bh h1"${ea(ed, b.id, "text", b.text)} style="margin:0 0 20px;font:${th.heading_weight} ${th.heading_size}px/${Math.round((th.heading_size as number) * 1.125)}px ${th.font_heading};letter-spacing:${th.heading_tracking};color:${th.heading}">${inline(b.text, link, "inherit")}</h1>`;
    case "paragraph":
      return `<p class="bt"${ea(ed, b.id, "text", b.text)} style="margin:0 0 14px;font:400 16px/25px ${fam};color:${th.text}">${inline(b.text, link)}</p>`;
    case "subheading":
      return `<p class="bh"${ea(ed, b.id, "text", b.text)} style="margin:22px 0 6px;font:600 17px/24px ${fam};color:${th.heading}">${inline(b.text, link, "inherit")}</p>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag} class="bt" style="margin:0 0 14px;padding:0 0 0 22px;font:400 16px/25px ${fam};color:${th.text}">${(b.items ?? []).map((i, n) => `<li${ea(ed, b.id, "item:" + n, i)} style="margin:0 0 6px">${inline(i, link)}</li>`).join("")}</${tag}>`;
    }
    case "button":
      return btnHtml(th, b.label, b.url, b.style, fam, "6px 0 18px", ed ? ` data-bid="${esc(b.id)}" data-kind="button"` : "");
    case "callout": {
      const centered = !!(b.image_url || b.button);
      const inner = (b.image_url ? `<a href="${esc(safeUrl(b.button?.url) || b.image_url)}" style="text-decoration:none"><img src="${esc(b.image_url)}" height="32" alt="${esc(b.image_alt ?? "")}" style="display:block;height:32px;width:auto;border:0;margin:0 auto 18px"></a>` : "")
        + (b.title ? `<p class="bh" style="margin:0 0 6px;font:600 15px/22px ${fam};color:${th.heading}">${inline(b.title, link, "inherit")}</p>` : "")
        + `<p class="bh"${ea(ed, b.id, "text", b.text)} style="margin:0 ${centered ? "0 22px" : ""};font:${centered ? 700 : 400} ${centered ? 19 : 15}px/${centered ? 28 : 23}px ${fam};color:${th.heading}">${inline(b.text, link)}</p>`
        + (b.button ? btnHtml(th, b.button.label, b.button.url, b.button.style ?? "outline", fam, "0 auto") : "");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 28px"><tr><td class="bx" align="${centered ? "center" : "left"}" style="padding:${centered ? "28px 28px 26px" : "16px 18px"};border-radius:${centered ? 18 : 14}px;background:${th.box_bg};text-align:${centered ? "center" : "left"}">${inner}</td></tr></table>`;
    }
    case "image": {
      const url = safeUrl(b.url);
      if (!url) return "";
      const img = `<img src="${esc(url)}" width="488" alt="${esc(b.alt ?? "")}" style="display:block;width:100%;max-width:488px;height:auto;border:0;border-radius:14px">`;
      const l = safeUrl(b.link);
      return `<div style="margin:6px 0 18px;line-height:0;font-size:0">${l ? `<a href="${esc(l)}" target="_blank" style="text-decoration:none">${img}</a>` : img}</div>`;
    }
    case "panel": {
      const rows = (b.rows ?? []).map((r) => `<tr><td class="bb bm" style="border-top:1px solid ${th.rule};padding:14px 0;font:400 14px/20px ${fam};color:${th.muted}">${esc(r.label)}</td><td class="bb bh" align="right" style="border-top:1px solid ${th.rule};padding:14px 0;font:600 14px/20px ${fam};color:${th.heading}">${esc(bindUnits(r.value)).replace(/ /g, "&nbsp;")}</td></tr>`).join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 24px"><tr><td class="bx" style="background:${th.box_bg};border-radius:16px;padding:8px 24px 6px">`
        + (b.hero_value ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:20px 0 16px">${b.hero_label ? `<div class="bm" style="font:600 13px/18px ${fam};letter-spacing:.02em;text-transform:uppercase;color:${th.muted}">${esc(b.hero_label)}</div>` : ""}<div class="bh" style="padding-top:6px;font:800 48px/52px ${fam};letter-spacing:-.03em;color:${th.heading};white-space:nowrap">${esc(b.hero_value)}</div></td></tr></table>` : "")
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr></table>`;
    }
    case "divider":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0"><tr><td class="bb" style="border-top:1px solid ${th.rule};font-size:0;line-height:0">&nbsp;</td></tr></table>`;
    case "signature":
      return sigHtml(kit, th);
    case "product_ads":
      return b.variant === "soft" ? adsSoftHtml(kit, th, b.keys ?? []) : "";
  }
  return "";
}

function footerHtml(kit: Kit, th: TH): string {
  const f = kit.footer ?? {};
  const fam = th.font_body as string;
  const lines = (f.lines ?? []).map((l, i) =>
    `<p class="bm" style="margin:${i ? "4px" : "0"} 0 0;font:400 12px/18px ${fam};color:${th.muted}">${esc(l.text)}${l.link_label && safeUrl(l.link_url) ? ` <a class="lk" href="${esc(l.link_url!)}" style="color:${th.accent};text-decoration:none;font-weight:600;white-space:nowrap">${esc(l.link_label)}</a>` : ""}</p>`).join("");
  return `<tr><td style="padding:26px 8px 0;text-align:center" align="center">`
    + (f.rainbow !== false ? `<div style="height:2px;max-width:220px;margin:0 auto 14px;border-radius:2px;background:linear-gradient(90deg,rgba(228,3,3,0),#e40303 14%,#ff8c00 30%,#ffed00 46%,#008026 62%,#24408e 78%,rgba(115,41,130,0))"></div>` : "")
    + lines + `</td></tr>`;
}

function headerHtml(kit: Kit, th: TH): { top: string; cardRadius: string; cardBorderTop: string } {
  const h = kit.header ?? {};
  const fam = th.font_body as string;
  const r = th.radius as number;
  if (h.layout === "banner" && h.image_url) {
    const bg = h.bg ?? "#0a0a0a";
    const img = `<img src="${esc(h.image_url)}" width="560" alt="${esc(h.alt ?? kit.name)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:${r}px ${r}px 0 0;background:${bg};color:#fafafa;font:600 15px/20px ${fam}">`;
    const l = safeUrl(h.link_url);
    return {
      top: `<tr><td style="border-radius:${r}px ${r}px 0 0;background:${bg};line-height:0;font-size:0">${l ? `<a href="${esc(l)}" target="_blank" title="${esc(l.replace(/^https?:\/\//, ""))}" style="display:block;text-decoration:none;line-height:0">${img}</a>` : img}</td></tr>`,
      cardRadius: `0 0 ${r}px ${r}px`, cardBorderTop: "border-top:0;",
    };
  }
  if (h.layout === "logo" || h.layout === "text") {
    const size = h.logo_size ?? 56;
    const img = h.layout === "logo" && h.image_url ? `<img src="${esc(h.image_url)}" ${h.logo_size ? `height="${size}"` : `width="${size}" height="${size}"`} alt="${esc(h.alt ?? kit.name)}" style="display:block;${h.logo_size ? `height:${size}px;width:auto` : `width:${size}px;height:${size}px`};border:0;border-radius:${h.logo_radius ?? 14}px;margin:0 auto">` : "";
    const l = safeUrl(h.link_url);
    const nm = h.name ? `<div class="bh" style="padding-top:${img ? 12 : 0}px;font:700 ${img ? 17 : 22}px/24px ${th.font_heading};letter-spacing:-.01em;color:${h.name_color ?? th.accent}">${esc(h.name)}</div>` : "";
    const inner = img + nm;
    return {
      top: inner ? `<tr><td align="center" style="padding:0 0 24px">${l ? `<a href="${esc(l)}" style="text-decoration:none">${inner}</a>` : inner}</td></tr>` : "",
      cardRadius: `${r}px`, cardBorderTop: "",
    };
  }
  return { top: "", cardRadius: `${r}px`, cardBorderTop: "" };
}

export function cssBlock(th: TH): string {
  const d = th.dark!;
  return `@media (prefers-color-scheme: dark) {
  .bg { background:${d.page_bg} !important; } .card { background:${d.card_bg} !important; border-color:${d.card_border} !important; }
  .bt { color:${d.text} !important; } .bh { color:${d.heading} !important; } .bm { color:${d.muted} !important; } .bb { border-color:${d.rule} !important; } .eb { color:${d.eyebrow} !important; } .bx { background:${d.box_bg} !important; } .lk { color:${d.link} !important; }
}
@media (max-width:520px) { .pad { padding:28px 22px !important; } .h1 { font-size:${Math.max(24, (th.heading_size as number) - 4)}px !important; line-height:${Math.max(28, (th.heading_size as number) - 4 + 4)}px !important; } }`;
}

/** The whole email as one HTML document. */
export function renderEmail(kit: Kit, doc: EmailDoc, opts: { editable?: boolean } = {}): string {
  const ed = !!opts.editable;
  const th = themeOf(kit);
  const fam = th.font_body as string;
  const blocks = (doc.blocks ?? []).filter(Boolean);
  const hdr = headerHtml(kit, th);
  const inCard = blocks.filter((b) => !(b.type === "product_ads" && b.variant !== "soft"));
  const after = blocks.filter((b) => b.type === "product_ads" && b.variant !== "soft") as Extract<Block, { type: "product_ads" }>[];
  const body = inCard.map((b, i) => {
    const h = renderBlock(b, kit, th, ed);
    // a sign-off line ("See you tomorrow,") sits a little further from the signature, as in the shipped templates
    return b.type === "paragraph" && inCard[i + 1]?.type === "signature" ? h.replace("margin:0 0 14px", "margin:0 0 28px") : h;
  }).join("\n    ");
  const adsAfter = after.map((b) => adsFullHtml(kit, th, b.keys ?? [])).join("");
  const pre = doc.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(bindUnits(doc.preheader))}</div>` : "";
  const fontLink = th.font_css_url ? `<link href="${esc(th.font_css_url)}" rel="stylesheet">` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(doc.subject || kit.name)}</title>
${fontLink}
<style>
${cssBlock(th)}
</style></head>
<body style="margin:0;padding:0" class="bg">
${pre}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="bg" style="background:${th.page_bg}">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  ${hdr.top}
  <tr><td class="card pad" style="background:${th.card_bg};border:1px solid ${th.card_border};${hdr.cardBorderTop}border-radius:${hdr.cardRadius};padding:36px 36px 32px;font-family:${fam}">
    ${body}
  </td></tr>
  ${adsAfter}
  ${footerHtml(kit, th)}

</table></td></tr></table></body></html>`;
}

/* ───────────────────────── plain text ───────────────────────── */

export function renderText(kit: Kit, doc: EmailDoc): string {
  const out: string[] = [];
  for (const b of doc.blocks ?? []) {
    switch (b.type) {
      case "eyebrow": out.push(inlineText(b.text).toUpperCase()); break;
      case "headline": out.push(inlineText(b.text)); break;
      case "paragraph": case "subheading": out.push(inlineText(b.text)); break;
      case "list": out.push((b.items ?? []).map((i, n) => `${b.ordered ? n + 1 + "." : "-"} ${inlineText(i)}`).join("\n")); break;
      case "button": if (safeUrl(b.url)) out.push(`${b.label}: ${b.url}`); break;
      case "callout": out.push([b.title, b.text, b.button ? `${b.button.label}: ${b.button.url}` : ""].filter(Boolean).map((x) => inlineText(String(x))).join("\n")); break;
      case "panel": out.push([b.hero_label && b.hero_value ? `${b.hero_label}: ${b.hero_value}` : "", ...(b.rows ?? []).map((r) => `${r.label}: ${r.value}`)].filter(Boolean).join("\n")); break;
      case "signature": { const s = kit.signature ?? {}; if (s.enabled !== false) out.push(["--", s.name, [s.role, s.role_brand].filter(Boolean).join(" "), [s.email, s.phone].filter(Boolean).join(" · ")].filter(Boolean).join("\n")); break; }
      case "product_ads": for (const a of (kit.product_ads?.items ?? []).filter((x) => (b.keys ?? []).includes(x.key))) out.push(`${a.name}: ${inlineText(a.blurb)} ${a.url}`); break;
      case "image": if (b.alt) out.push(`[${b.alt}]`); break;
      default: break;
    }
  }
  const f = (kit.footer?.lines ?? []).map((l) => `${l.text}${l.link_label ? ` ${l.link_label}: ${l.link_url}` : ""}`);
  return out.filter(Boolean).join("\n\n") + (f.length ? "\n\n" + f.join("\n") : "") + "\n";
}

/* ───────────────────────── validate / repair model output ───────────────────────── */

const clip = (s: unknown, n: number) => stripEmoji(String(s ?? "")).replace(/\r/g, "").trim().slice(0, n);

export interface NormalizeOpts {
  kit: Kit;
  /** URLs the person typed or pasted (and kit URLs) that a button may point at. Model-invented links are dropped. */
  allowedUrls?: string[];
  allowAnyUrl?: boolean;
}

const urlKey = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();

export function kitUrls(kit: Kit): string[] {
  const u: string[] = [];
  const push = (x?: string) => { if (x) u.push(x); };
  push(kit.site_url); push(kit.header?.link_url);
  for (const a of kit.product_ads?.items ?? []) { push(a.url); push(a.extra_url); }
  for (const l of kit.footer?.lines ?? []) push(l.link_url);
  return u.filter(Boolean);
}
export function urlsIn(text: string): string[] {
  return (String(text ?? "").match(/https?:\/\/[^\s)<>"']+/g) ?? []).map((x) => x.replace(/[.,;:!?]+$/, ""));
}

/** Turn whatever the model returned into valid blocks. Never throws; says what it fixed in `warnings`. */
export function normalizeDoc(raw: unknown, o: NormalizeOpts): { doc: EmailDoc; warnings: string[]; problems: string[] } {
  const warnings: string[] = [];
  const problems: string[] = []; // things so wrong the caller should retry
  const kit = o.kit;
  const allowed = new Set((o.allowedUrls ?? []).concat(kitUrls(kit)).map(urlKey));
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const list = Array.isArray(r.blocks) ? r.blocks : [];
  if (!list.length) problems.push("no blocks");
  const blocks: Block[] = [];
  let headlines = 0, eyebrows = 0;
  const urlOk = (u: string) => {
    const s = safeUrl(u);
    if (!s) return "";
    if (o.allowAnyUrl || /^(mailto:|tel:)/i.test(s) || allowed.has(urlKey(s))) return s;
    // same host as an allowed URL counts (a deep link on a site the person named)
    try { const h = new URL(s).host; for (const a of allowed) { try { if (new URL(a).host === h) return s; } catch { /* skip */ } } } catch { /* skip */ }
    return "";
  };
  for (const item of list.slice(0, 40)) {
    const b = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const type = String(b.type ?? "") as BlockType;
    if (!BLOCK_TYPES.includes(type)) { warnings.push(`Dropped an unknown block "${String(b.type)}".`); continue; }
    const id = typeof b.id === "string" && /^[\w-]{3,40}$/.test(b.id) ? b.id : blockId();
    switch (type) {
      case "eyebrow": { if (eyebrows++) break; const t = clip(b.text, 60); if (t) blocks.push({ id, type, text: t }); break; }
      case "headline": { if (headlines++) break; const t = clip(b.text, 120); if (t) blocks.push({ id, type, text: t }); break; }
      case "paragraph": case "subheading": { const t = clip(b.text, type === "paragraph" ? 1500 : 160); if (t) blocks.push({ id, type, text: t } as Block); break; }
      case "list": { const items = (Array.isArray(b.items) ? b.items : []).map((x) => clip(x, 300)).filter(Boolean).slice(0, 12); if (items.length) blocks.push({ id, type, items, ordered: !!b.ordered }); break; }
      case "button": {
        const url = urlOk(String(b.url ?? "")); const label = clip(b.label, 40);
        if (!label) break;
        if (!url) { warnings.push(`Removed the button "${label}": its link was not one you gave me. Add it back with the real link.`); break; }
        blocks.push({ id, type, label, url, style: b.style === "outline" ? "outline" : "solid" }); break;
      }
      case "callout": {
        const text = clip(b.text, 500); if (!text) break;
        const bt = b.button as Record<string, unknown> | undefined;
        const bu = bt ? urlOk(String(bt.url ?? "")) : "";
        blocks.push({ id, type, title: clip(b.title, 80) || undefined, text, ...(bt && bu && clip(bt.label, 40) ? { button: { label: clip(bt.label, 40), url: bu, style: bt.style === "solid" ? "solid" : "outline" } } : {}) }); break;
      }
      case "image": {
        const kind = b.kind === "ai" ? "ai" : "asset";
        const alt = clip(b.alt, 140) || "Picture";
        if (kind === "ai") {
          if (kit.ai_images === "never") { warnings.push(`This brand does not use AI pictures, so I left one out.`); break; }
          const prompt = clip(b.prompt, 400); if (!prompt) break;
          blocks.push({ id, type, kind, prompt, alt, url: typeof b.url === "string" && /\/storage\/v1\/object\/public\/email-assets\//.test(b.url) ? safeUrl(b.url) : undefined, link: typeof b.link === "string" ? urlOk(b.link) || undefined : undefined });
        } else {
          const key = String(b.asset_key ?? "");
          const asset = kit.assets?.[key];
          if (!asset) { warnings.push(`Dropped a picture: "${key}" is not one of this brand's pictures.`); break; }
          blocks.push({ id, type, kind, asset_key: key, url: asset.url, alt: alt === "Picture" ? asset.alt : alt, link: typeof b.link === "string" ? urlOk(b.link) || undefined : undefined });
        }
        break;
      }
      case "panel": {
        const rows = (Array.isArray(b.rows) ? b.rows : []).map((x: any) => ({ label: clip(x?.label, 60), value: clip(x?.value, 80) })).filter((x) => x.label && x.value).slice(0, 10);
        if (rows.length) blocks.push({ id, type, hero_label: clip(b.hero_label, 60) || undefined, hero_value: clip(b.hero_value, 30) || undefined, rows }); break;
      }
      case "divider": blocks.push({ id, type }); break;
      case "signature": blocks.push({ id, type }); break;
      case "product_ads": {
        const have = new Set((kit.product_ads?.items ?? []).map((a) => a.key));
        const keys = (Array.isArray(b.keys) ? b.keys : []).map(String).filter((k) => have.has(k)).slice(0, kit.ad_policy?.max ?? 2);
        if (keys.length) blocks.push({ id, type, keys, variant: b.variant === "soft" ? "soft" : "full" });
        else warnings.push("Dropped a product ad that named a product this brand does not have.");
        break;
      }
    }
  }
  // house structure: headline first (after an optional eyebrow), one signature last, one ad block max
  if (!blocks.some((b) => b.type === "headline")) problems.push("no headline");
  const sigs = blocks.filter((b) => b.type === "signature");
  const withoutSig = blocks.filter((b) => b.type !== "signature");
  const adBlocks = withoutSig.filter((b) => b.type === "product_ads");
  const final: Block[] = withoutSig.filter((b) => b.type !== "product_ads");
  if (adBlocks.length > 1) warnings.push("Kept only the first product ad.");
  const policy = kit.ad_policy?.mode ?? "auto";
  let ad = adBlocks[0] as Extract<Block, { type: "product_ads" }> | undefined;
  if (policy === "never") { ad = undefined; }
  else if (policy === "ensure" && !ad) {
    const keys = (kit.ad_policy?.default_keys ?? []).filter((k) => (kit.product_ads?.items ?? []).some((a) => a.key === k)).slice(0, 1);
    if (keys.length) { ad = { id: blockId(), type: "product_ads", keys, variant: "soft" }; warnings.push("Added a soft Bestly product line (this brand always includes one)."); }
  }
  if (sigs.length || kit.signature?.enabled !== false) final.push({ id: sigs[0]?.id ?? blockId(), type: "signature" });
  if (ad) final.push(ad);
  const doc: EmailDoc = {
    subject: clip(r.subject, 140) || "",
    preheader: clip(r.preheader, 160) || undefined,
    blocks: final,
  };
  if (!doc.subject) problems.push("no subject");
  return { doc, warnings, problems };
}

/** Style problems worth telling the person about (not blocking). */
export function lintDoc(doc: EmailDoc): string[] {
  const text = [doc.subject, doc.preheader ?? "", ...(doc.blocks ?? []).map((b) => JSON.stringify(b))].join(" ");
  const out: string[] = [];
  if (/\b(2[0-3]|1[3-9]):[0-5]\d\b(?!\s?[AaPp]\.?[Mm])/.test(text)) out.push("There is a 24-hour time. Use 3:05 PM style.");
  if (/\b\d+(\.\d+)?\s?(km|kg|cm|mm|meters?|metres?|kilometers?|°C|celsius)\b/i.test(text)) out.push("There is a metric unit. Use miles, feet, pounds and °F.");
  if (EMOJI.test(text)) out.push("There is an emoji.");
  EMOJI.lastIndex = 0;
  return out;
}

/* ───────────────────────── .eml (inline CID images, Apple Mail draft) ───────────────────────── */

export function imageUrlsIn(html: string): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*?\bsrc="(https?:\/\/[^"]+)"/gi)) set.add(m[1].replace(/&amp;/g, "&"));
  return [...set];
}

/** Swap each remote image URL for cid:xxx. `map` is url -> cid. */
export function rewriteImagesToCid(html: string, map: Record<string, string>): string {
  let out = html;
  for (const [url, cid] of Object.entries(map)) {
    const esc1 = url.replace(/&/g, "&amp;");
    out = out.split(`src="${esc1}"`).join(`src="cid:${cid}"`).split(`src="${url}"`).join(`src="cid:${cid}"`);
  }
  return out;
}

const enc = new TextEncoder();
function b64(bytes: Uint8Array): string {
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const wrap76 = (s: string) => s.replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");

/** RFC 2045 quoted-printable of a UTF-8 string. */
export function qp(text: string): string {
  const bytes = enc.encode(text.replace(/\r?\n/g, "\r\n"));
  let line = "", out = "";
  const push = (tok: string) => { if (line.length + tok.length > 75) { out += line + "=\r\n"; line = ""; } line += tok; };
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c === 13 && bytes[i + 1] === 10) { out += line + "\r\n"; line = ""; i++; continue; }
    const next = bytes[i + 1];
    const eol = next === undefined || next === 13;
    if ((c >= 33 && c <= 126 && c !== 61) || ((c === 32 || c === 9) && !eol)) push(String.fromCharCode(c));
    else push("=" + c.toString(16).toUpperCase().padStart(2, "0"));
  }
  return out + line;
}

/** RFC 2047 encoded-word for a header value that is not plain ASCII. */
export function encHeader(v: string): string {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(enc.encode(v))}?=`;
}

export interface EmlImage { cid: string; contentType: string; data: Uint8Array; filename?: string }
export interface EmlInput { from: string; to?: string; subject: string; html: string; text: string; images?: EmlImage[]; date?: Date; domain?: string }

export function buildEml(i: EmlInput): string {
  const alt = "=_alt_" + Math.random().toString(36).slice(2, 12);
  const rel = "=_rel_" + Math.random().toString(36).slice(2, 12);
  const images = i.images ?? [];
  const map: Record<string, string> = {};
  const h: string[] = [
    "X-Unsent: 1",
    `From: ${i.from}`,
    `To: ${i.to ?? ""}`,
    `Subject: ${encHeader(i.subject)}`,
    `Date: ${(i.date ?? new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${Math.random().toString(36).slice(2)}.${Date.now()}@${i.domain ?? "bestly.tech"}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${alt}"`,
  ];
  void map;
  const parts: string[] = [];
  parts.push(`--${alt}\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(i.text)}\r\n`);
  const htmlPart = `Content-Type: text/html; charset="utf-8"\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n${qp(i.html)}\r\n`;
  if (images.length) {
    const imgs = images.map((im) => `--${rel}\r\nContent-Type: ${im.contentType}; name="${im.filename ?? im.cid}"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <${im.cid}>\r\nContent-Disposition: inline; filename="${im.filename ?? im.cid}"\r\n\r\n${wrap76(b64(im.data))}\r\n`).join("");
    parts.push(`--${alt}\r\nContent-Type: multipart/related; type="text/html"; boundary="${rel}"\r\n\r\n--${rel}\r\n${htmlPart}${imgs}--${rel}--\r\n`);
  } else {
    parts.push(`--${alt}\r\n${htmlPart}`);
  }
  return h.join("\r\n") + "\r\n\r\n" + parts.join("") + `--${alt}--\r\n`;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
