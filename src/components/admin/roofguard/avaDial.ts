/**
 * Dialer plumbing shared by both Avas.
 *   requestDial   any button (Call again, Call back, Reply by call) asks the dialer to open prefilled; the DialerSheet that
 *                 handles that kind of call listens for the event, so no page has to pass state down.
 *   recents       the last five numbers dialed from THIS browser, per kind of call (localStorage, always in try/catch:
 *                 private windows and blocked storage just mean no recents, never an error).
 */
/** `bridge`: Ava calls a company's main line, gets a human, then hands the call to Jared's cell. The org name rides in
 *  `company`, the same field the RoofGuard demo uses, so recents keep working without a second field. */
export type DialMode = "personal" | "demo" | "bridge";
/** `closes`: the call whose suggested-action buttons are finished once this call goes out (Call back, Reply by call). */
export type DialRequest = { mode: DialMode; phone: string; name?: string; purpose?: string; company?: string; closes?: { source: "ava" | "roofguard"; callId: string } };
export type Recent = { phone: string; name: string; purpose: string; company: string; connect?: boolean; voice?: "jared"; at: number };

export const DIAL_EVENT = "ava-dial-request";
export const requestDial = (r: DialRequest) => { try { window.dispatchEvent(new CustomEvent<DialRequest>(DIAL_EVENT, { detail: r })); } catch { /* no window */ } };

const KEY = (m: DialMode) => `ava-dial-recents-${m}`;
const MAX = 5;

export function loadRecents(mode: DialMode): Recent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(mode)) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is Recent => !!r && typeof r.phone === "string" && /^\d{10}$/.test(r.phone)).slice(0, MAX);
  } catch { return []; }
}

/** Newest first; the same number moves to the top instead of repeating. */
export function saveRecent(mode: DialMode, r: Omit<Recent, "at">): Recent[] {
  const next = [{ ...r, at: Date.now() }, ...loadRecents(mode).filter((x) => x.phone !== r.phone)].slice(0, MAX);
  try { localStorage.setItem(KEY(mode), JSON.stringify(next)); } catch { /* storage blocked: recents are a convenience */ }
  return next;
}
