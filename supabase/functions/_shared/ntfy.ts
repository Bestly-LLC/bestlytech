/**
 * ntfy push to the operator (Jared's phone).
 *
 * Every Bestly system event — new lead, brief submitted, intake submitted,
 * deposit paid, probe down, shield report — lands on one topic. Import with:
 *
 *   import { pushNtfy } from "../_shared/ntfy.ts";
 *
 * ntfy validates HTTP headers as ASCII (an em-dash in Title breaks the
 * request), so titles are passed through asciiHeader() for you. pushNtfy
 * never throws: failures are logged and reported back as ok:false.
 */

/** The operator alert topic — every Bestly system event lands here. */
export const NTFY_TOPIC = "bestly-sysalert-7q2k9mx4";
export const NTFY_BASE = "https://ntfy.sh";

/** ntfy headers must be ASCII — strip em-dash, smart quotes, etc. */
export function asciiHeader(s: string): string {
  return s
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // drop anything that isn't printable ASCII
    .replace(/[^\x20-\x7E]/g, "");
}

/** Topic resolution: explicit override, then the NTFY_TOPIC secret, then the default. */
export function resolveNtfyTopic(override?: string): string {
  return override ?? Deno.env.get("NTFY_TOPIC") ?? NTFY_TOPIC;
}

export type NtfyMessage = {
  /** Short header line; made ASCII-safe automatically. */
  title: string;
  /** Message body. Newlines are fine — they live in the POST body, not a header. */
  body: string;
  /** ntfy tags: emoji short names like "bell" or "white_check_mark". */
  tags?: string | string[];
  /** 1 (min) .. 5 (max); ntfy defaults to 3 when omitted. */
  priority?: string | number;
  /** URL the notification opens when tapped. */
  click?: string;
  /** Defaults to the shared operator topic (NTFY_TOPIC secret honored). */
  topic?: string;
};

export type NtfyResult = {
  ok: boolean;
  /** HTTP status; 0 means the request never made it to ntfy. */
  status: number;
  /** ntfy's response text (or the error message when status is 0). */
  text: string;
};

/** Send an operator alert. Never throws; logs and returns ok:false on failure. */
export async function pushNtfy(msg: NtfyMessage): Promise<NtfyResult> {
  const headers: Record<string, string> = { Title: asciiHeader(msg.title) };
  if (msg.tags) headers["Tags"] = Array.isArray(msg.tags) ? msg.tags.join(",") : msg.tags;
  if (msg.priority !== undefined) headers["Priority"] = String(msg.priority);
  if (msg.click) headers["Click"] = msg.click;
  const token = Deno.env.get("NTFY_TOKEN");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(`${NTFY_BASE}/${resolveNtfyTopic(msg.topic)}`, {
      method: "POST",
      headers,
      body: msg.body,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) console.error(`ntfy ${res.status}:`, text);
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    console.error("ntfy push failed", e);
    return { ok: false, status: 0, text: e instanceof Error ? e.message : String(e) };
  }
}
