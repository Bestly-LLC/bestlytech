/**
 * The only way the site starts a Maya conversation: ask maya-session for a short-lived signed URL.
 * Maya's agent is private, so her public agent id alone no longer connects (Jared, 2026-10-11).
 */
import { supabase } from "@/integrations/supabase/client";

export type SessionResult = { ok: true; signedUrl: string; at: number } | { ok: false; error: string };

const FALLBACK = "Maya isn't available right now. Call (213) 641-0074, or try again in a minute.";

export async function getMayaSession(page: string): Promise<SessionResult> {
  try {
    const res = await supabase.functions.invoke("maya-session", { body: { op: "session", page } });
    let body = res.data as { ok?: boolean; signed_url?: string; error?: string } | null;
    if (res.error && !body) {
      try {
        body = await (res.error as { context?: Response }).context?.json();
      } catch {
        /* keep null */
      }
    }
    if (body?.ok && body.signed_url) return { ok: true, signedUrl: body.signed_url, at: Date.now() };
    return { ok: false, error: body?.error || FALLBACK };
  } catch {
    return { ok: false, error: FALLBACK };
  }
}

/** Signed URLs must start a call within about 15 minutes; refresh before that. */
export const SESSION_FRESH_MS = 12 * 60_000;

/** What went wrong on a visitor's device, for Maya's Line Check. Never throws, never blocks. */
export function mayaDiag(kind: string, detail: Record<string, string> = {}, page = window.location.pathname): void {
  void supabase.functions.invoke("maya-session", { body: { op: "diag", kind, detail, page } }).catch(() => {});
}
