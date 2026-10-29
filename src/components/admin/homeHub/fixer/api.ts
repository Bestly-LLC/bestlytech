import { supabase } from "@/integrations/supabase/client";
import { fetchAgentState } from "@/services/homeHubApi";

/* Tinker's fixer: rows and calls. Contract: docs/ha-fixer-opusplan.md. Tables ha_fixes and ha_inventory (admin only, signed-in read). */

export type FixStatus =
  | "gathering" | "analyzing" | "proposed" | "diagnosed" | "applying" | "applied" | "undoing" | "undone" | "failed" | "discarded" | "handoff";

export type DiffLine = { t: " " | "+" | "-" | "="; s: string };

export type FixRow = {
  id: string;
  created_at: string;
  updated_at: string;
  question: string;
  focus: string | null;
  status: FixStatus;
  window_note: string | null;
  entities: { id: string; name: string }[] | null;
  timeline: { t: string; text: string }[] | null;
  suspects: { key: string; name: string; kind: string; where: string; file: string | null; entity_id: string | null; last_run: string; ran: boolean; why: string }[] | null;
  story: string[] | null;
  culprit: { key: string; entity_id: string | null; name: string; kind: string; where: string; file: string | null; why: string } | null;
  confidence: "high" | "medium" | "low" | null;
  fix: { type: "item_edit" | "package_patch" | "turn_off"; name?: string; item?: string } | null;
  before_plain: string[] | null;
  after_plain: string[] | null;
  diff: DiffLine[] | null;
  risky: boolean;
  risk_reason: string | null;
  applied_at: string | null;
  undone_at: string | null;
  restart_note: string | null;
  error: string | null;
  needs_agent_update: boolean;
  wait_tries: number | null;
  handoff_prompt: string | null;
  handback: string | null;
};

export type InvItem = {
  entity_id: string;
  name: string;
  kind: "automation" | "script";
  state: string | null;
  last_run: string | null;
  where: "ui" | "package" | "unknown";
  file: string | null;
  id: string | null;
  line: string;
  mine: boolean;
};

export type Inventory = {
  captured_at: string | null;
  requested_at: string | null;
  view: InvItem[];
  counts: { automations: number; scripts: number; on: number; off: number; ui: number; package: number; unknown: number; packages: number } | null;
  error: string | null;
};

export type FixerOp = "diagnose" | "revise" | "apply" | "undo" | "discard" | "handoff" | "inventory" | "toggle";
export type FixerResult = { ok: boolean; row?: FixRow; error?: string; pending?: boolean; needsAgent?: boolean; state?: string };

/** The function's own plain-words error wins over the transport's generic one. */
async function errorText(error: unknown, data: unknown): Promise<string> {
  const fromData = (data as { error?: unknown } | null)?.error;
  if (typeof fromData === "string" && fromData) return fromData;
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (typeof body?.error === "string" && body.error) return body.error;
    } catch { /* not JSON */ }
  }
  const msg = (error as { message?: string } | null)?.message ?? "";
  if (/failed to send|fetch|network/i.test(msg)) return "Could not reach Tinker. Check your connection.";
  if (/not found|404/i.test(msg)) return "Tinker's fixing tools are not switched on yet. They work once the backend is deployed.";
  return msg || "Something went wrong on the way to Tinker.";
}

export async function callFixer(body: { op: FixerOp } & Record<string, unknown>): Promise<FixerResult> {
  try {
    const { data, error } = await supabase.functions.invoke("ha-fixer", { body });
    const d = data as FixerResult | null;
    if (error || d?.ok === false) return { ok: false, error: await errorText(error, data), needsAgent: d?.needsAgent };
    return { ok: true, row: d?.row, pending: d?.pending, state: d?.state };
  } catch (e) {
    return { ok: false, error: await errorText(e, null) };
  }
}

/** Plain version compare: is a older than b? */
export function versionLt(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0), pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0);
  return false;
}

export const FIXER_AGENT = "1.6.2";

export async function readAgentVersion(): Promise<string | null> {
  try { return (await fetchAgentState())?.version ?? null; } catch { return null; }
}
