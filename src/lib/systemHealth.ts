import { supabase } from "@/integrations/supabase/client";

/**
 * Live system health, computed on the client from data the schema actually has.
 * Shared by SystemPulse (full banner) and the admin home "Status" row (one chip).
 *
 *   - AI Generator         last `ai_generation_log` row (any status = alive; success = healthy)
 *   - Cron Heartbeat       last `pattern_fix_log` row
 *   - Email Pipeline       failure count last 24h vs sent count
 *   - External Services    aggregate of `external_health` (from probe-external fn)
 *
 * Plus `system_alert_state.down_systems`, the SMS-firing source of truth. A failed read of any
 * probe reads as degraded ("couldn't read") or unverified, never as healthy.
 */

export type HealthStatus = "ok" | "warn" | "down" | "unknown";

export interface SubsystemState {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
}

export interface SystemHealth {
  subsystems: SubsystemState[];
  downSystems: string[];
  lastChecked: string | null;
  alertUnknown: boolean;
}

export function hoursAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

export function formatAge(iso: string | null | undefined): string {
  const h = hoursAgo(iso);
  if (h === null) return "never";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export async function fetchSystemHealth(): Promise<SystemHealth> {
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  // Run all probes in parallel — every probe is non-blocking.
  const [
    aiGenSuccessRes,
    aiGenLatestRes,
    cronRes,
    emailSentRes,
    emailFailedRes,
    externalRes,
    alertStateRes,
  ] = await Promise.all([
    supabase
      .from("ai_generation_log")
      .select("created_at")
      .eq("status", "success")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("ai_generation_log")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("pattern_fix_log")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("email_send_log")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("created_at", dayAgo),
    supabase
      .from("email_send_log")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", dayAgo),
    // external_health created by P0-5 migration; soft-fail if not deployed yet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from("external_health" as any).select("service, status, last_checked") as any),
    supabase
      .from("system_alert_state")
      .select("down_systems, last_checked")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const subsystems: SubsystemState[] = [];

  // 1. AI Generator — uses latest activity (heartbeat or success) for liveness
  const lastAiSuccess = aiGenSuccessRes.data?.[0]?.created_at ?? null;
  const lastAiActivity = aiGenLatestRes.data?.[0]?.created_at ?? null;
  const aiSuccessHours = hoursAgo(lastAiSuccess);
  const aiActivityHours = hoursAgo(lastAiActivity);
  let aiStatus: HealthStatus;
  let aiDetail: string;
  if (aiGenLatestRes.error || aiGenSuccessRes.error) {
    aiStatus = "warn";
    aiDetail = "couldn't read";
  } else if (aiActivityHours === null) {
    aiStatus = "down";
    aiDetail = "no activity ever";
  } else if (aiActivityHours > 24) {
    aiStatus = "down";
    aiDetail = `silent ${formatAge(lastAiActivity)}`;
  } else if (aiSuccessHours !== null && aiSuccessHours <= 24) {
    aiStatus = "ok";
    aiDetail = formatAge(lastAiSuccess);
  } else if (aiSuccessHours !== null && aiSuccessHours <= 72) {
    aiStatus = "warn";
    aiDetail = formatAge(lastAiSuccess);
  } else {
    // Generator is alive (ran within 24h) but no recent successes — idle is ok
    aiStatus = "ok";
    aiDetail = `idle — ${formatAge(lastAiActivity)}`;
  }
  subsystems.push({ key: "ai", label: "AI Generator", status: aiStatus, detail: aiDetail });

  // 2. Cron Heartbeat — pattern_fix_log writes a heartbeat every 3h
  const lastCron = cronRes.data?.[0]?.created_at ?? null;
  const cronHours = hoursAgo(lastCron);
  const cronStatus: HealthStatus = cronRes.error
    ? "warn"
    : cronHours === null ? "down" : cronHours > 6 ? "down" : cronHours > 4 ? "warn" : "ok";
  subsystems.push({ key: "cron", label: "Cron", status: cronStatus, detail: cronRes.error ? "couldn't read" : formatAge(lastCron) });

  // 3. Email Pipeline — failures vs sent in 24h
  const sent24 = emailSentRes.count ?? 0;
  const failed24 = emailFailedRes.count ?? 0;
  let emailStatus: HealthStatus;
  let emailDetail: string;
  if (emailSentRes.error || emailFailedRes.error) {
    emailStatus = "warn";
    emailDetail = "couldn't read";
  } else if (failed24 === 0 && sent24 === 0) {
    emailStatus = "unknown";
    emailDetail = "idle 24h";
  } else if (failed24 > sent24) {
    emailStatus = "down";
    emailDetail = `${failed24} fail / ${sent24} ok`;
  } else if (failed24 > 0) {
    emailStatus = "warn";
    emailDetail = `${failed24} fail / ${sent24} ok`;
  } else {
    emailStatus = "ok";
    emailDetail = `${sent24} ok`;
  }
  subsystems.push({ key: "email", label: "Email", status: emailStatus, detail: emailDetail });

  // 4. External Services — aggregate from probe-external
  const ext = (externalRes as { data: Array<{ service: string; status: string }> | null }).data;
  if (ext && ext.length > 0) {
    const downCount = ext.filter((s) => s.status === "down").length;
    const warnCount = ext.filter((s) => s.status === "warn").length;
    const extStatus: HealthStatus = downCount > 0 ? "down" : warnCount > 0 ? "warn" : "ok";
    const extDetail = downCount > 0 ? `${downCount} down` : warnCount > 0 ? `${warnCount} degraded` : `${ext.length} ok`;
    subsystems.push({ key: "external", label: "External", status: extStatus, detail: extDetail });
  } else {
    subsystems.push({ key: "external", label: "External", status: "unknown", detail: "probe pending" });
  }

  const alertState = alertStateRes.data as { down_systems?: string[] | null; last_checked?: string | null } | null;
  return {
    subsystems,
    downSystems: alertState?.down_systems ?? [],
    lastChecked: alertState?.last_checked ?? null,
    alertUnknown: !!alertStateRes.error,
  };
}

export function healthHeadlineStatus(h: SystemHealth): HealthStatus {
  if (h.downSystems.length > 0) return "down";
  if (h.subsystems.some((s) => s.status === "down")) return "down";
  if (h.subsystems.some((s) => s.status === "warn")) return "warn";
  if (h.subsystems.length === 0) return "unknown";
  if (h.alertUnknown) return "warn";
  return "ok";
}

/** Names of what is failing, worst first. Empty when everything is OK. */
export function failingSystems(h: SystemHealth): string[] {
  const status = healthHeadlineStatus(h);
  if (h.downSystems.length > 0) return h.downSystems;
  if (status === "down") return h.subsystems.filter((s) => s.status === "down").map((s) => s.label);
  if (status === "warn") return h.subsystems.filter((s) => s.status === "warn").map((s) => s.label);
  return [];
}

export function healthHeadlineText(h: SystemHealth): string {
  const status = healthHeadlineStatus(h);
  const failing = failingSystems(h);
  if (h.downSystems.length > 0) return `System alert: ${h.downSystems.join(", ")}`;
  if (status === "down") return `System alert: ${failing.join(", ")}`;
  if (status === "warn") {
    if (failing.length === 0 && h.alertUnknown) return "Health unverified: couldn't read system_alert_state";
    return `Degraded: ${failing.join(", ")}`;
  }
  if (status === "unknown") return "Status unknown";
  return "All systems operational";
}
