/**
 * Jared's iCloud address book -> ava_contacts, so Ava knows who is calling her by name.
 * Jared's ask, 2026-10-05: "how about we connect my contacts from icloud/mac/apple?"
 *
 * Contacts come over CardDAV from contacts.icloud.com using the SAME app-specific password already in Vault for her
 * calendar (ava_caldav_icloud_user / ava_caldav_icloud_pass), so there is nothing new for him to set up. Personal Ava
 * only: RoofGuard's leads live in rg_leads and are not touched.
 *
 * What is imported: the name, the phone numbers, and the company. NOT the notes on his Apple contacts: anything in
 * ava_contacts.notes is read into her prompt on a call, and his private notes about people have no business there.
 * Self-contained on purpose (its own dav() and XML helpers) so the working calendar code is left alone.
 */

export type Creds = { user: string; pass: string };
export type Person = { name: string; phone: string; org: string | null; uid: string | null };

export const ICLOUD_CONTACTS_BASE = "https://contacts.icloud.com";

const authHeader = (c: Creds) => `Basic ${btoa(`${c.user}:${c.pass}`)}`;
const site = (u: string) => { try { return new URL(u).hostname.split(".").slice(-2).join("."); } catch { return "?"; } };
const absolute = (href: string, base: string) => { try { return new URL(href, base).toString(); } catch { return href; } };

/** Redirects by hand: fetch() drops Authorization across hosts and iCloud sends you to a per-account pXX host.
 *  Same method, same body, same login on every hop, and only ever to the same site. */
async function dav(url: string, method: string, c: Creds, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; url: string }> {
  let cur = url;
  for (let hop = 0; hop < 6; hop++) {
    const res = await fetch(cur, { method, headers: { authorization: authHeader(c), "content-type": "application/xml; charset=utf-8", ...headers }, body, redirect: "manual" });
    const loc = res.headers.get("location");
    if ([301, 302, 303, 307, 308].includes(res.status) && loc) {
      await res.text().catch(() => "");
      const next = absolute(loc, cur);
      if (site(next) !== site(cur)) throw new Error("the contacts server redirected somewhere unexpected");
      cur = next; continue;
    }
    return { status: res.status, text: await res.text().catch(() => ""), url: cur };
  }
  throw new Error("the contacts server redirected too many times");
}

const NS = "(?:[\\w-]+:)?";
const blocks = (xml: string, tag: string) => xml.match(new RegExp(`<${NS}${tag}[\\s>][\\s\\S]*?</${NS}${tag}>`, "gi")) ?? [];
const first = (xml: string, tag: string) => new RegExp(`<${NS}${tag}[^>]*>([\\s\\S]*?)</${NS}${tag}>`, "i").exec(xml)?.[1]?.trim() ?? null;
const hasEl = (xml: string, tag: string) => new RegExp(`<${NS}${tag}[\\s/>]`, "i").test(xml);
const unxml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^p\d+-/, "pNN-"); } catch { return "?"; } };
const tagList = (xml: string) => [...new Set((xml.match(/<(?:[\w-]+:)?[\w-]+/g) ?? []).map((t) => t.replace(/^<(?:[\w-]+:)?/, "")))].slice(0, 24).join(",");

const PRINCIPAL_XML = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`;
const HOME_XML = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:cd="urn:ietf:params:xml:ns:carddav"><d:prop><cd:addressbook-home-set/></d:prop></d:propfind>`;
const BOOKS_XML = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`;
const CARDS_XML = `<?xml version="1.0" encoding="utf-8"?><cd:addressbook-query xmlns:d="DAV:" xmlns:cd="urn:ietf:params:xml:ns:carddav"><d:prop><cd:address-data/></d:prop><cd:filter/></cd:addressbook-query>`;

/** Every address book on the account. `trace` records each step with nothing private in it (no login, no account number). */
export async function addressBooks(c: Creds, trace: string[] = []): Promise<string[]> {
  const p1 = await dav(ICLOUD_CONTACTS_BASE, "PROPFIND", c, PRINCIPAL_XML, { depth: "0" });
  trace.push(`1 principal: ${p1.status} at ${hostOf(p1.url)}`);
  if (p1.status === 401) throw new Error("iCloud refused the login. The app-specific password may have been revoked.");
  if (p1.status >= 400) throw new Error(`iCloud said ${p1.status} when asked where the contacts are.`);
  const principal = first(first(p1.text, "current-user-principal") ?? "", "href");
  if (!principal) { trace.push(`1 tags: ${tagList(p1.text)}`); throw new Error("iCloud didn't say where the contacts are"); }

  const p2 = await dav(absolute(unxml(principal), p1.url), "PROPFIND", c, HOME_XML, { depth: "0" });
  trace.push(`2 home: ${p2.status} at ${hostOf(p2.url)}`);
  const home = first(first(p2.text, "addressbook-home-set") ?? "", "href");
  if (!home) { trace.push(`2 tags: ${tagList(p2.text)}`); throw new Error("iCloud didn't list an address book home"); }

  const p3 = await dav(absolute(unxml(home), p2.url), "PROPFIND", c, BOOKS_XML, { depth: "1" });
  trace.push(`3 books: ${p3.status} at ${hostOf(p3.url)}`);
  const books: string[] = [];
  for (const r of blocks(p3.text, "response")) {
    const href = first(r, "href");
    if (!href || !hasEl(first(r, "resourcetype") ?? "", "addressbook")) continue;
    books.push(absolute(unxml(href), p3.url));
  }
  trace.push(`3 found ${books.length} address book(s)`);
  return books;
}

/** vCard lines, unfolded (a line starting with a space or tab continues the one before it). */
const unfold = (card: string) => card.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");

/** +1XXXXXXXXXX for a real US or Canada number, else null. Extensions, short codes and foreign numbers are skipped:
 *  Ava can only dial North America, and a half-number in here would just be a contact she can never match. */
export function toE164(v: string): string | null {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `+1${d}` : null;
}

const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").replace(/\s+/g, " ").trim();

/** One vCard -> one row per usable phone number (a person with a mobile and a home line becomes two rows, same name). */
export function parseCard(card: string): Person[] {
  const lines = unfold(card).split("\n");
  let fn = "", n = "", org = "", uid = "";
  const tels: string[] = [];
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const name = line.slice(0, colon).toUpperCase().replace(/^ITEM\d+\./, "").split(";")[0];
    const value = line.slice(colon + 1);
    if (name === "FN" && !fn) fn = unescape(value);
    else if (name === "N" && !n) n = unescape(value.split(";").slice(0, 2).reverse().filter(Boolean).join(" "));
    else if (name === "ORG" && !org) org = unescape(value.split(";")[0] ?? "");
    else if (name === "UID" && !uid) uid = value.trim().slice(0, 120);
    else if (name === "TEL") tels.push(value);
  }
  const who = (fn || n || org).slice(0, 60);
  if (!who) return [];
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const t of tels) {
    const phone = toE164(t);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push({ name: who, phone, org: org && org !== who ? org.slice(0, 60) : null, uid: uid || null });
  }
  return out;
}

/** Everyone in the account with a dialable North American number. Same phone in two contacts: the first name wins. */
export async function fetchPeople(c: Creds, trace: string[] = []): Promise<{ people: Person[]; cards: number; books: number }> {
  const books = await addressBooks(c, trace);
  const byPhone = new Map<string, Person>();
  let cards = 0;
  for (const book of books) {
    const r = await dav(book, "REPORT", c, CARDS_XML, { depth: "1" });
    if (r.status >= 400) { trace.push(`4 ${hostOf(r.url)} returned ${r.status}, skipped`); continue; }
    const got = blocks(r.text, "response");
    cards += got.length;
    for (const resp of got) {
      const data = first(resp, "address-data");
      if (!data) continue;
      for (const p of parseCard(unxml(data))) if (!byPhone.has(p.phone)) byPhone.set(p.phone, p);
    }
  }
  trace.push(`4 ${cards} card(s) -> ${byPhone.size} number(s)`);
  return { people: [...byPhone.values()], cards, books: books.length };
}
