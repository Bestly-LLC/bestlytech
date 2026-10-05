/**
 * A tiny event bus so the Coach (rules, reviews) and the rest of each Ava page can talk without prop-drilling.
 * Window events, so it works across the RoofGuard tabs (the Coach tab and the Calls tab are never mounted together).
 *
 *   openCoach(source, ruleId?)   show the Coach (RoofGuard: switch to its Coach tab; Ava: open the section) and, if a rule id
 *                                is given, jump to that rule in the playbook. Used by the Reply guard's "See the rule" and
 *                                the Scorecard's "Manage rules".
 *   coachChanged(source)         something about the playbook changed elsewhere (Reply guard taught or approved a rule):
 *                                the Coach refreshes.
 *   openCall(source, id, lead?)  open a call's existing sheet (RoofGuard: switch to Calls; Ava: the page's message sheet).
 *                                The target takes the request with takePendingCall() once its list has loaded.
 */
export type CoachSource = "ava" | "roofguard";

const OPEN_COACH = "coach:open";
const CHANGED = "coach:changed";
const OPEN_CALL = "coach:open-call";

let pendingFocus: { source: CoachSource; ruleId: string } | null = null;
let pendingCall: { source: CoachSource; callId: string; leadId: string | null } | null = null;

export const openCoach = (source: CoachSource, ruleId?: string | null) => {
  if (ruleId) pendingFocus = { source, ruleId };
  window.dispatchEvent(new CustomEvent(OPEN_COACH, { detail: { source } }));
};
export const onOpenCoach = (source: CoachSource, fn: () => void) => {
  const h = (e: Event) => { if ((e as CustomEvent<{ source: CoachSource }>).detail?.source === source) fn(); };
  window.addEventListener(OPEN_COACH, h);
  return () => window.removeEventListener(OPEN_COACH, h);
};
/** the rule the manager should jump to (read once) */
export const takePendingFocus = (source: CoachSource) => {
  const p = pendingFocus;
  if (p && p.source === source) { pendingFocus = null; return p.ruleId; }
  return null;
};

export const coachChanged = (source: CoachSource) => window.dispatchEvent(new CustomEvent(CHANGED, { detail: { source } }));
export const onCoachChanged = (source: CoachSource, fn: () => void) => {
  const h = (e: Event) => { if ((e as CustomEvent<{ source: CoachSource }>).detail?.source === source) fn(); };
  window.addEventListener(CHANGED, h);
  return () => window.removeEventListener(CHANGED, h);
};

export const openCall = (source: CoachSource, callId: string, leadId?: string | null) => {
  pendingCall = { source, callId, leadId: leadId ?? null };
  window.dispatchEvent(new CustomEvent(OPEN_CALL, { detail: { source } }));
};
export const onOpenCall = (source: CoachSource, fn: () => void) => {
  const h = (e: Event) => { if ((e as CustomEvent<{ source: CoachSource }>).detail?.source === source) fn(); };
  window.addEventListener(OPEN_CALL, h);
  return () => window.removeEventListener(OPEN_CALL, h);
};
export const takePendingCall = (source: CoachSource) => {
  const p = pendingCall;
  if (p && p.source === source) { pendingCall = null; return p; }
  return null;
};
export const hasPendingCall = (source: CoachSource) => pendingCall?.source === source;
