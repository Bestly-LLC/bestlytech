/**
 * Partner-portal failures go to Scout, not to the partner.
 * partner_report_error opens (or refreshes) a monitor incident keyed partner.<where>,
 * which the fix ladder picks up: auto fix -> free AI -> Scout -> one tap for Jared.
 * Throttled per spot so a broken screen doesn't raise on every render.
 */
import { supabase } from "@/integrations/supabase/client";

const last = new Map<string, number>();
const QUIET_MS = 10 * 60_000;
const USER_ERRORS = /rate_limited|cancelled|aborted|not_allowed/i;

export function reportToScout(where: string, detail?: unknown) {
  const text = detail instanceof Error ? detail.message : typeof detail === "string" ? detail : JSON.stringify(detail ?? "");
  if (USER_ERRORS.test(text)) return;
  const now = Date.now();
  if (now - (last.get(where) ?? 0) < QUIET_MS) return;
  last.set(where, now);
  void supabase.rpc("partner_report_error" as never, { p_where: where, p_detail: `${text}\n${window.location.pathname}${window.location.search}` } as never)
    .then(() => undefined, () => undefined);
}
