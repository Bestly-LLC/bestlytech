import { supabase } from "@/integrations/supabase/client";

/**
 * The deck of cards shown under the binoculars while an admin page loads
 * (docs/loader-cards-opusplan.md). Facts come from the admin_loader_cards RPC and live in memory only:
 * money and mail never touch disk. Quotes may be cached in localStorage so loaders that run before
 * sign-in still have something to read.
 */

export type LoaderCardKind = "fact" | "tip" | "quote" | "mantra";
export type LoaderCardData = { kind: LoaderCardKind; text: string; sub?: string; author?: string };
/** "full": facts, tips and quotes (admin, signed in). "quotes": tips and quotes only (no data before sign-in). */
export type LoaderCardsMode = "full" | "quotes";

type RawQuote = { id?: string; text: string; author?: string | null; kind?: string };
type RawFact = { kind?: string; text: string; sub?: string | null; author?: string | null };

const QUOTE_CACHE_KEY = "scout-quotes-v1";
const CURSOR_KEY = "loader-cursor";
const MAX_QUOTE_CHARS = 140;
const REFRESH_MS = 10 * 60 * 1000;

/** First-ever load with nothing cached: a few short ones from the wall's deck. */
const FALLBACK_QUOTES: LoaderCardData[] = [
  { kind: "quote", text: "Stay hungry. Stay foolish.", author: "Steve Jobs" },
  { kind: "mantra", text: "Ship it, then polish it." },
  { kind: "quote", text: "Imagination is more important than knowledge.", author: "Albert Einstein" },
  { kind: "mantra", text: "Done beats perfect." },
  { kind: "quote", text: "Mars is there, waiting to be reached.", author: "Buzz Aldrin" },
  { kind: "mantra", text: "Make it obvious." },
  { kind: "quote", text: "Drop by drop is the water pot filled.", author: "The Buddha, Dhammapada" },
  { kind: "mantra", text: "Breathe. Then decide." },
];

let facts: LoaderCardData[] = [];
let quotes: LoaderCardData[] | null = null;

const isPartnerPath = () => typeof window !== "undefined" && window.location.pathname.startsWith("/partner");

type RpcCall = (fn: string) => Promise<{ data: unknown; error: unknown }>;
const rpc = (fn: string) => (supabase.rpc as unknown as RpcCall)(fn);

function toQuote(q: RawQuote): LoaderCardData | null {
  const text = (q.text ?? "").trim();
  if (!text || text.length > MAX_QUOTE_CHARS) return null;
  const author = (q.author ?? "").trim();
  if (q.kind === "mantra" || !author) return { kind: "mantra", text };
  return { kind: "quote", text, author };
}

function readQuoteCache(): LoaderCardData[] | null {
  try {
    const raw = localStorage.getItem(QUOTE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { quotes?: RawQuote[] };
    const list = (parsed.quotes ?? []).map(toQuote).filter((q): q is LoaderCardData => !!q);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

function setQuotes(raw: RawQuote[]) {
  const list = raw.map(toQuote).filter((q): q is LoaderCardData => !!q);
  if (!list.length) return;
  quotes = list;
  try {
    localStorage.setItem(
      QUOTE_CACHE_KEY,
      JSON.stringify({ at: Date.now(), quotes: raw.map((q) => ({ text: q.text, author: q.author ?? null, kind: q.kind })) }),
    );
  } catch {
    /* private mode or full: the in-memory deck still works */
  }
}

function currentQuotes(): LoaderCardData[] {
  if (!quotes) quotes = readQuoteCache() ?? FALLBACK_QUOTES;
  return quotes;
}

/** Today's date in Los Angeles, so the daily shuffle flips at local midnight. */
function pacificDate(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same order all day, a new order tomorrow, so quotes don't repeat back to back. */
function dailyShuffle<T extends { text: string }>(list: T[]): T[] {
  const rand = seededRandom(pacificDate());
  const out = [...list].sort((a, b) => (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function tips(): LoaderCardData[] {
  const mac = typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent || "");
  const mod = mac ? "⌘" : "Ctrl+";
  // Every shortcut here exists in the code: Scout.tsx (Cmd/Ctrl+J opens Scout, Esc stops a run),
  // CommandPalette.tsx (Cmd/Ctrl+K palette, Cmd/Ctrl+/ sidebar).
  return [
    { kind: "tip", text: `Press ${mod}J to open Scout from anywhere.` },
    { kind: "tip", text: `Press ${mod}K to jump to any page.` },
    { kind: "tip", text: "Esc stops Scout mid-run." },
    { kind: "tip", text: "Say “keep going” and Scout picks up where it stopped." },
    { kind: "tip", text: `Press ${mod}/ to hide or show the sidebar.` },
  ];
}

/** Weave lists by pattern; when a list runs dry its slot goes to whatever is left. Every card appears once. */
function weave(pattern: string[], lists: Record<string, LoaderCardData[]>): LoaderCardData[] {
  const used: Record<string, number> = {};
  const total = Object.values(lists).reduce((n, l) => n + l.length, 0);
  const take = (k: string): LoaderCardData | null => {
    const i = used[k] ?? 0;
    if (!lists[k] || i >= lists[k].length) return null;
    used[k] = i + 1;
    return lists[k][i];
  };
  const out: LoaderCardData[] = [];
  for (let i = 0; out.length < total; i++) {
    const c = take(pattern[i % pattern.length]) ?? take("Q") ?? take("F") ?? take("T");
    if (!c) break;
    out.push(c);
  }
  return out;
}

function buildSequence(mode: LoaderCardsMode): LoaderCardData[] {
  const q = dailyShuffle(currentQuotes());
  // The partner portal is Eli's view: quotes only, whatever the caller asked for.
  if (isPartnerPath()) return q;
  if (mode === "full" && facts.length) {
    return weave(["F", "Q", "F", "T", "F", "Q"], { F: facts, Q: q, T: tips() });
  }
  return weave(["Q", "Q", "T"], { Q: q, T: tips() });
}

function readCursor(): number {
  try {
    const n = parseInt(sessionStorage.getItem(CURSOR_KEY) ?? "0", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** The next card in the feed; each call moves the per-session cursor on, so every loader shows a new one. */
export function nextLoaderCard(mode: LoaderCardsMode): LoaderCardData | null {
  const seq = buildSequence(mode);
  if (!seq.length) return null;
  const at = readCursor();
  try {
    sessionStorage.setItem(CURSOR_KEY, String(at + 1));
  } catch {
    /* ignore */
  }
  return seq[at % seq.length];
}

/** Pull the admin deck (facts + quotes). Quietly does nothing if the call fails. */
export async function loadAdminLoaderDeck(): Promise<void> {
  try {
    const { data, error } = await rpc("admin_loader_cards");
    if (error || !data) return;
    const d = data as { facts?: RawFact[]; quotes?: RawQuote[] };
    facts = (d.facts ?? [])
      .map((f): LoaderCardData | null => {
        const text = (f.text ?? "").trim();
        if (!text) return null;
        if (f.kind === "quote") return { kind: "quote", text, author: f.author ?? undefined };
        return { kind: "fact", text, sub: f.sub || undefined };
      })
      .filter((f): f is LoaderCardData => !!f);
    if (d.quotes?.length) setQuotes(d.quotes);
  } catch {
    /* keep the last deck */
  }
}

/** Partner portal: quotes only. */
export async function loadPartnerLoaderQuotes(): Promise<void> {
  try {
    const { data, error } = await rpc("partner_loader_quotes");
    if (error || !Array.isArray(data)) return;
    setQuotes(data as RawQuote[]);
  } catch {
    /* keep what we have */
  }
}

/** Facts live in memory for as long as the admin shell is open, never longer. */
export function clearLoaderFacts() {
  facts = [];
}

/**
 * Start the admin deck: fetch once when the browser is idle, then every 10 minutes while the shell is open.
 * Returns a stop function (which also forgets the facts).
 */
export function startAdminLoaderDeck(): () => void {
  let stopped = false;
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
  const run = () => { if (!stopped) void loadAdminLoaderDeck(); };
  const idleId = w.requestIdleCallback ? w.requestIdleCallback(run) : window.setTimeout(run, 1500);
  const timer = window.setInterval(run, REFRESH_MS);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    if (w.cancelIdleCallback && w.requestIdleCallback) w.cancelIdleCallback(idleId);
    else window.clearTimeout(idleId);
    clearLoaderFacts();
  };
}
