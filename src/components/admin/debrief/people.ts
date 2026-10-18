/**
 * Who the to-dos are for, in words Jared reads: "Elizabeth", never a slug or an id.
 * The server names her outright (`person`); if it ever does not, it is the one guest on the call who is not on the team.
 */
import { nice, possessive } from "./format";

const TEAM = new Set(["jared", "eli", "scout", "scout-notetaker", "notetaker", "bestly", "bestly-notetaker"]);

const firstWord = (s: string) => s.trim().split(/[\s-]+/)[0] ?? "";

export interface PersonSource {
  /** `person` from the server: used exactly as written ("Elizabeth", or "Bestly Test" for the test client). */
  contactName?: string | null;
  clientName?: string | null;
  clientSlug?: string | null;
  people?: string[];
}

/** The client's name, or "" when nothing says who she is (the screen then says "her"). */
export function personFor(src: PersonSource): string {
  const said = src.contactName?.trim();
  if (said) return said;

  const guests = (src.people ?? [])
    .map((p) => firstWord(p))
    .filter((p) => p && !TEAM.has(p.toLowerCase()));
  if (guests.length) {
    // On a call with several guests, prefer the one the client record is named after.
    const hay = `${src.clientName ?? ""} ${src.clientSlug ?? ""}`.toLowerCase();
    const named = guests.find((g) => hay.includes(g.toLowerCase()));
    return nice(named ?? guests[0]);
  }
  return "";
}

/** "Elizabeth's list", or "her list" when we do not know her name. */
export const herList = (person: string) => (person ? `${possessive(person)} list` : "her list");

/** "Elizabeth" or "her": the word that stands for the client mid-sentence. */
export const herWord = (person: string) => person || "her";

/** Jared and Eli are the two people a to-do can be handed to besides the client. */
export const TEAM_OWNERS = ["jared", "eli"] as const;

/** The three words the screen needs for the client, from whatever the list row and the full debrief know. */
export function labelsFor(
  header: PersonSource | null | undefined,
  row: { person?: string | null; clientName?: string | null; clientSlug?: string | null } | null | undefined,
): { person: string; who: string; list: string } {
  const person = personFor({
    contactName: header?.contactName ?? row?.person,
    clientName: header?.clientName ?? row?.clientName,
    clientSlug: header?.clientSlug ?? row?.clientSlug,
    people: header?.people,
  });
  return { person, who: herWord(person), list: herList(person) };
}
