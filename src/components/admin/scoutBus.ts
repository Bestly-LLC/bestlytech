/**
 * How the rest of the admin talks to Scout without importing it.
 *
 *   askScout("Why is this failing?", { about: "row detail..." })  opens Scout and sends it
 *   openScout()                                                     just opens it
 *
 * Scout listens for these window events (see Scout.tsx). `about` is extra context
 * for that one question - the item's title, detail, a URL - so Scout starts from
 * the thing Jared clicked instead of asking what he means.
 */
export const SCOUT_ASK_EVENT = "bestly:scout-ask";
export const SCOUT_OPEN_EVENT = "bestly:scout-open";

export interface ScoutAsk {
  text: string;
  about?: string;
  /** Start a fresh conversation instead of adding to the open one. Default true. */
  fresh?: boolean;
}

export function askScout(text: string, opts: Omit<ScoutAsk, "text"> = {}) {
  // Open Scout first so its event listener is mounted, then send the ask.
  window.dispatchEvent(new Event(SCOUT_OPEN_EVENT));
  // A 80ms gap is enough for the open animation to start and the listener to attach.
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent<ScoutAsk>(SCOUT_ASK_EVENT, { detail: { text, fresh: true, ...opts } }));
  }, 80);
}

export function openScout() {
  window.dispatchEvent(new Event(SCOUT_OPEN_EVENT));
}

/** Open Scout on one existing conversation (the stuck card's "Open Scout's thread"). Scout listens in Scout.tsx. */
export const SCOUT_THREAD_EVENT = "bestly:scout-thread";

export function openScoutThread(threadId: string) {
  window.dispatchEvent(new CustomEvent<{ threadId: string }>(SCOUT_THREAD_EVENT, { detail: { threadId } }));
}

/**
 * Open the call debrief (Scout's review of a recorded call, waiting on Jared's OK) from anywhere in the admin:
 *
 *   openDebrief(id)   that one
 *   openDebrief()     the newest one waiting
 *
 * CallDebriefHost (mounted once in AdminLayout) listens. The same sheet also opens from /admin?debrief=<id>.
 */
export const DEBRIEF_OPEN_EVENT = "bestly:debrief-open";

export function openDebrief(id?: string | null) {
  window.dispatchEvent(new CustomEvent<{ id: string | null }>(DEBRIEF_OPEN_EVENT, { detail: { id: id ?? null } }));
}
