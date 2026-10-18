/**
 * Where a debrief can be reached from, and where its own links go.
 *
 *   /admin?debrief=<id>     the link Scout's push and the Needs-you row carry
 *   debrief:<id>            a Needs-you row key
 */

const ID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const IN_URL = new RegExp(`[?&]debrief=(${ID})`);
const IN_KEY = new RegExp(`^(?:call[_:-]?)?debrief[:_/-](${ID})$`, "i");

/** The debrief id inside a link such as "/admin?debrief=…", or null when it is some other link. */
export function debriefIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return IN_URL.exec(url)?.[1] ?? null;
}

/** The debrief id of a Needs-you row (from its link, or failing that its key). */
export function debriefIdFromRow(row: { key?: string | null; url?: string | null }): string | null {
  return debriefIdFromUrl(row.url) ?? (row.key ? IN_KEY.exec(row.key)?.[1] ?? null : null);
}

/** Studio opens on the "Her list" tab; Studio has no way to be told which client, it remembers the last one. */
export const STUDIO_HER_LIST_URL = "https://studio.bestly.tech/#todos";

/** The Nextcloud Files folder that holds a day's recordings: Meeting Recordings/<YYYY-MM-DD>. */
export function recordingsFolderUrl(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return `https://cloud.bestly.tech/apps/files/?dir=${encodeURIComponent(`/Meeting Recordings/${day}`)}`;
}
