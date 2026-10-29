// Family Cookbook: who is who, and who may see or change what.
// The server (SQL) is the real gate: Mom's recipes are visible to all three, and Jared's and Mariah's recipes are never
// sent to Mom in any list, search, count, Recently Deleted, check queue or photo. This file mirrors that rule so the
// screen can say the right thing ("Only you and Mariah can see this"); it never decides what data a person receives.

export type Role = "mom" | "jared" | "mariah";

export interface Person { id: Role; name: string; last: string; ini: string; reviewer: boolean }

export const PEOPLE: Record<Role, Person> = {
  mom: { id: "mom", name: "Mom", last: "Harris", ini: "Mo", reviewer: false },
  jared: { id: "jared", name: "Jared", last: "Best", ini: "J", reviewer: true },
  mariah: { id: "mariah", name: "Mariah", last: "Best", ini: "Ma", reviewer: true },
};

export interface Viewer { id: Role; name: string; last: string; reviewer: boolean }

/** Same rule as public._family_can_see(viewer, owner). `owner` is the recipe's family_by (Jared's Kitchen recipes count as Jared's). */
export function canSeeId(owner: Role, viewer: string | null | undefined): boolean {
  if (!viewer) return false;
  if (owner === "mom") return true;
  if (viewer === "mom") return false;
  return true; // Jared and Mariah see each other's
}

/** Only the owner or Jared can edit or delete. */
export function canEditRecipe(owner: Role, viewer: string | null | undefined): boolean {
  return !!viewer && (owner === viewer || viewer === "jared");
}

/** The people who can still be asked to look at a card (never someone who cannot see it, never the owner). */
export function otherReviewers(owner: Role): Role[] {
  return (["jared", "mariah"] as Role[]).filter((id) => id !== owner && canSeeId(owner, id));
}

/** The OmniCook switch is Jared's own machine: nobody else sees it. */
export const showsOmniCook = (viewer: string | null | undefined) => viewer === "jared";

/** What the home screen icon is called: follows the person. */
export function appTitle(v: Pick<Viewer, "last"> | null | undefined): string {
  return v && v.last ? v.last + " Cookbook" : "Family Cookbook";
}
/** The big title inside the app. */
export function bookTitle(v: Pick<Viewer, "last"> | null | undefined): string {
  return v && v.last ? "The " + v.last + " Cookbook" : "Family Cookbook";
}
export function manifestFor(v: Pick<Viewer, "last"> | null | undefined): string {
  if (!v || !v.last) return "/cookbook.webmanifest";
  return v.last.toLowerCase() === "harris" ? "/cookbook-harris.webmanifest" : "/cookbook-best.webmanifest";
}

/** One line under the title on a recipe: who can see it. */
export function visLine(owner: Role, viewer: string | null | undefined): string {
  if (owner === "mom") return "Shared with Jared and Mariah";
  const others = otherReviewers(owner);
  if (viewer === owner) return others.length ? "Only you and " + PEOPLE[others[0]].name + " can see this" : "Only you can see this";
  return "Only you and " + PEOPLE[owner].name + " can see this";
}
