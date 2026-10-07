// Spam Desk helpers shared by spam-desk and scout-daily (2026-10-07).
// Pure functions: no network, no database. Anything that reads or writes rows lives in the callers.

/** Mail providers anyone can sign up with: block the address, never the whole domain. */
export const FREEMAIL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "rocketmail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "gmx.net", "mail.com", "zoho.com",
  "yandex.com", "yandex.ru", "mail.ru", "qq.com", "163.com", "126.com", "sina.com", "fastmail.com", "hey.com", "comcast.net", "att.net",
  "verizon.net", "sbcglobal.net", "cox.net", "earthlink.net", "charter.net", "bellsouth.net",
]);

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/** "Name <A@B.com>" or "a@b.com" -> "a@b.com" (lower case), or "" when there is no address. */
export function addrOf(from: string | null | undefined): string {
  const s = String(from ?? "");
  const m = s.match(/<([^<>\s]+@[^<>\s]+)>/) ?? s.match(/([^\s<>"',;]+@[^\s<>"',;]+)/);
  return (m ? m[1] : "").trim().toLowerCase().replace(/[.,;]+$/, "");
}

export const domainOf = (addr: string) => addr.split("@")[1]?.toLowerCase() ?? "";

/** a.b.example.co.uk -> example.co.uk; mail.shop.com -> shop.com. Good enough for blocking and for claims. */
export function registrable(domain: string): string {
  const p = domain.toLowerCase().split(".").filter(Boolean);
  if (p.length <= 2) return p.join(".");
  const tld = p[p.length - 1], sld = p[p.length - 2];
  return (tld.length === 2 && SECOND_LEVEL.has(sld) ? p.slice(-3) : p.slice(-2)).join(".");
}

export type BlockRow = { pattern: string; kind: "address" | "domain" };

/** Is this sender on the blocklist (exact address, or the domain / any subdomain of it)? */
export function isBlocked(list: BlockRow[], from: string): BlockRow | null {
  const a = addrOf(from);
  if (!a) return null;
  const d = domainOf(a);
  for (const b of list) {
    if (b.kind === "address" && b.pattern === a) return b;
    if (b.kind === "domain" && (d === b.pattern || d.endsWith("." + b.pattern))) return b;
  }
  return null;
}

/** SQL ilike patterns from bestly_mail_protected ("%apple.com%") against an address. */
export function matchesProtected(patterns: string[], from: string): boolean {
  const a = addrOf(from) || String(from ?? "").toLowerCase();
  return patterns.some((p) => {
    const re = new RegExp("^" + p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".") + "$", "i");
    return re.test(a);
  });
}

/** First public IP in a Received header, IPv4 or IPv6. Private, loopback and link-local ranges do not count. */
export function publicIp(text: string): string | null {
  const cands: string[] = [];
  for (const m of text.matchAll(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/g)) cands.push(m[1]);
  for (const m of text.matchAll(/\[(?:IPv6:)?([0-9a-f:]{6,})\]/gi)) cands.push(m[1]);
  for (const c of cands) {
    if (c.includes(":")) {
      const l = c.toLowerCase();
      if (l === "::1" || l.startsWith("fe80") || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("::")) continue;
      return l;
    }
    const o = c.split(".").map(Number);
    if (o.some((n) => n > 255)) continue;
    const [a, b] = o;
    if (a === 10 || a === 127 || a === 0 || a >= 224) continue;
    if (a === 172 && b >= 16 && b <= 31) continue;
    if (a === 192 && b === 168) continue;
    if (a === 169 && b === 254) continue;
    if (a === 100 && b >= 64 && b <= 127) continue;
    if (a === 17) continue;           // Apple's own network: iCloud's relays are not the sender
    return c;
  }
  return null;
}

/** Header block of a raw .eml, unfolded, as [name, value][]. */
export function parseHeaders(eml: string): [string, string][] {
  const end = eml.search(/\r?\n\r?\n/);
  const head = (end === -1 ? eml : eml.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
  const out: [string, string][] = [];
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out.push([line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()]);
  }
  return out;
}

/**
 * The address of the network that handed the message to us: the newest Received header that names a public IP.
 * (Lower Received lines can be forged by the spammer; the top ones were written by our own provider's servers.)
 */
export function sendingIp(headers: [string, string][]): string | null {
  const SKIP = /\b(icloud\.com|me\.com|apple\.com|privateemail\.com|registrar-servers\.com|namecheap)\b/i;
  for (const [k, v] of headers) {
    if (k !== "received") continue;
    const from = v.match(/^from\s+(.*?)\s+by\s/i)?.[1] ?? "";
    if (SKIP.test(from)) continue;
    const ip = publicIp(from || v);
    if (ip) return ip;
  }
  return null;
}

/** Walk an RDAP entity tree for the first entity with this role that has an email. */
// deno-lint-ignore no-explicit-any
export function rdapEmail(entities: any[] | undefined, role: string): string | null {
  for (const e of entities ?? []) {
    if ((e.roles ?? []).includes(role)) {
      // deno-lint-ignore no-explicit-any
      const em = (e.vcardArray?.[1] ?? []).find((x: any) => x[0] === "email");
      const v = em?.[3];
      if (typeof v === "string" && /@/.test(v)) return v.toLowerCase();
    }
    const sub = rdapEmail(e.entities, role);
    if (sub) return sub;
  }
  return null;
}

/** 12-hour Los Angeles time for report text and notes: "Oct 6, 3:05 PM". */
export function laTime(iso: string | Date): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

export const STATUTE_NOTE =
  "Cal. Bus. & Prof. Code 17529.5: $1,000 per unsolicited commercial email that has a forged header, someone else's domain or a misleading subject line " +
  "($1,000,000 cap per incident); the $1,000 claim has a 1-year deadline. Not legal advice.";
