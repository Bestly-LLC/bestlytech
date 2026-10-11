/**
 * Data layer for the agent template page (AgentDesk). Plan: docs/agent-template-opusplan.md.
 * Everything reads admin RPCs (admin_agent, admin_agent_spend, admin_agent_calls, admin_agent_coach, ...) and talks to the
 * agent-hub edge function for anything that touches the voice platform. The ElevenLabs key never reaches the browser.
 * rpcArgs is the loose rpc caller the Ava pages use, so no generated types are needed for the new functions.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invokeError } from "@/components/admin/roofguard/AvaActions";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";

export { rpcArgs };

export type AgentHealth = { ok: boolean; problems: string[] | null; healed: boolean; checked_at: string; last_ok_at: string | null; last_sync_at: string | null };
export type AgentSettings = { cost_per_min?: number; daily_cap?: number; coach_on?: boolean; watch?: string | null };
export type AgentInfo = {
  slug: string; name: string; purpose: string; kind: "legacy" | "template"; page_url: string | null; elevenlabs_agent_id: string | null;
  phone_number_id: string | null; line_e164: string | null; voice_id: string | null; llm: string | null; orb_hue: number; status: "draft" | "live" | "paused";
  modules: string[]; settings: AgentSettings | null; tool_ids: string[]; webhook: boolean; health: AgentHealth | null;
  last_call_no: number | null; last_call_at: string | null; calls_total: number; unread: number;
};
export type AgentSpend = { today: number; cap: number; over: boolean; month: number };

/** Fired whenever something on the page changes the agent (settings saved, setup re-run, a call marked read) so every part refreshes. */
export const AGENT_CHANGED = "agent:changed";
export const announceAgentChanged = (slug: string) => { try { window.dispatchEvent(new CustomEvent(AGENT_CHANGED, { detail: slug })); } catch { /* no window */ } };

export const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function usePolled<T>(slug: string, rpc: string, ms = 60000) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    const r = await rpcArgs<T>(rpc, { p_slug: slug });
    if (r.error) { setErr(r.error.message); return; }
    setErr(null); setData(r.data);
  }, [slug, rpc]);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, ms);
    const h = (e: Event) => { if ((e as CustomEvent<string>).detail === slug) void load(); };
    window.addEventListener(AGENT_CHANGED, h);
    return () => { clearInterval(t); window.removeEventListener(AGENT_CHANGED, h); };
  }, [load, ms, slug]);
  return { data, err, reload: load };
}

export const useAgent = (slug: string) => usePolled<AgentInfo>(slug, "admin_agent");
export const useAgentSpend = (slug: string) => usePolled<AgentSpend>(slug, "admin_agent_spend");

/** One shape for both outcomes (the project compiles without strict null checks, which cannot narrow a true/false union). */
export type Hub<T> = { ok: boolean; data: T; error: string };

/** Call the agent-hub edge function as the signed-in admin. Errors come back as plain words. */
export async function hub<T = Record<string, unknown>>(body: Record<string, unknown>, fallback = "Something went wrong. Try again in a minute."): Promise<Hub<T>> {
  const { data, error } = await supabase.functions.invoke("agent-hub", { body });
  if (error || !data || (data as { ok?: boolean }).ok === false) {
    return { ok: false, data: undefined as unknown as T, error: await invokeError(error, data as { error?: string } | null, fallback) };
  }
  return { ok: true, data: data as T, error: "" };
}

/** Same door, for answers that are audio (a voice sample). */
export async function hubBlob(body: Record<string, unknown>): Promise<Blob | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const base = (import.meta.env.VITE_SUPABASE_URL as string) ?? "";
  const res = await fetch(`${base}/functions/v1/agent-hub`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token ?? ""}`, apikey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "") as string },
    body: JSON.stringify(body),
  }).catch(() => null);
  return res?.ok ? await res.blob() : null;
}

/** Shared button and field styles, matching the Ava and Maya pages. */
export const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
export const press = "motion-safe:transition-transform motion-safe:duration-100 motion-safe:active:scale-[0.97]";
export const btnQuiet = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white/[0.07] px-4 text-[15px] font-medium text-white ring-1 ring-white/10 hover:bg-white/[0.12] disabled:opacity-50 ${ring} ${press}`;
export const btnPrimary = `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-white px-4 text-[15px] font-semibold text-black hover:bg-white/90 disabled:opacity-40 ${ring} ${press}`;
export const fieldCls = "w-full rounded-xl bg-white/[0.05] px-3 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/50 focus:ring-white/25";
export const boxCls = "rounded-2xl bg-white/[0.04] p-5 text-[15px] text-white/75 ring-1 ring-white/10";

/** Copy text to the clipboard (with the old execCommand fallback the RoofGuard CopyButton uses). Returns true when it worked. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
    catch { return false; }
  }
}

/**
 * A note waiting for the Prompt section ("Try with free AI" on the Tailor card). The Prompt body only exists while its section is open,
 * so the note is parked here and read when the body mounts; if it is already mounted it also hears PROMPT_NOTE.
 */
export const pendingPromptNote = new Map<string, string>();
export const PROMPT_NOTE = "agent:prompt-note";
