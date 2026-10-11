/**
 * Faces and logos for the demos. Photos (fictional, AI-made) live in /agent-demo/people/<slug>.webp and logos
 * (original marks for made-up businesses) in /agent-demo/logos/<slug>.svg. A name with no photo or logo falls
 * back to its initials, so a missing file never leaves a hole.
 */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const PEOPLE = new Set([
  "dan-ortiz", "kelly-moran", "mark-ellis", "alex-kim", "dana-reyes", "priya-shah", "luis", "dee", "amir", "marcus",
  "maria-alvarez", "tom-nguyen", "jules-park", "sam-whitfield", "priya-desai", "marcus-bell", "hannah-ruiz", "tom-aldridge",
]);

const LOGOS = new Set([
  "ledgerly", "brightside-dental", "ridgeline-plumbing", "harbor-and-pine", "osteria-lume",
  "greenline-dental", "northwind-cafe", "ortiz-landscaping",
]);

export const personSrc = (name: string): string | null => {
  const s = slugify(name);
  return PEOPLE.has(s) ? `/agent-demo/people/${s}.webp` : null;
};

/** Round badge logo for a business contact ("Greenline Dental"), if we drew one. */
export const badgeSrc = (name: string): string | null => {
  const s = slugify(name);
  return LOGOS.has(s) ? `/agent-demo/logos/${s}.svg` : null;
};

export const logoSrc = (slug: string) => `/agent-demo/logos/${slug}.svg`;

/** Each demo business: its logo, and the short name for the app's sidebar. */
export const BRANDS: Record<string, { logo: string; short: string }> = {
  "saas-support": { logo: "ledgerly", short: "Ledgerly" },
  dental: { logo: "brightside-dental", short: "Brightside" },
  plumbing: { logo: "ridgeline-plumbing", short: "Ridgeline" },
  "real-estate": { logo: "harbor-and-pine", short: "Harbor & Pine" },
  restaurant: { logo: "osteria-lume", short: "Lume" },
};

/** Start loading a caller's photo early so it is already there when the call picks up. */
export function preloadPerson(name: string) {
  const src = personSrc(name);
  if (!src || typeof Image === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  img.src = src;
}
