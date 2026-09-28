/**
 * Sign the wall — thin client for the coaster-gated RPCs (see migration 20260927234500_wall_sign_nfc_emojis.sql).
 * A coaster tap (bestly.tech/sign/<code>) opens a 20-minute signing session; the token lives in localStorage so
 * reloads and rotating the phone keep working.
 */
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args) as Promise<{ data: any; error: { message: string } | null }>;

const STORE = "bestly-sign-session";

export type Session = {
  token: string;
  expiresAt: number;
  legacy: boolean;
  legacyUntil: string | null;
  signed: number;
  emoji: string | null;
};

export type WallEmoji = { id: number; emoji: string; x: number; y: number; size: number };

export function deviceId(): string {
  try {
    let id = localStorage.getItem("bestly-sign-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("bestly-sign-device", id);
    }
    return id;
  } catch {
    return "";
  }
}

function remember(token: string, expiresAt: number) {
  try { localStorage.setItem(STORE, JSON.stringify({ token, expiresAt })); } catch { /* private mode: session lasts this page only */ }
}
export function forget() {
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
}
function stored(): { token: string; expiresAt: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) || "null");
    return v && typeof v.token === "string" && v.expiresAt > Date.now() ? v : null;
  } catch {
    return null;
  }
}

/** Resolve access: a fresh coaster code wins, then a still-valid stored session, then the legacy bare link. */
export async function resolveSession(code: string | null): Promise<Session | null> {
  if (!code) {
    const s = stored();
    if (s) {
      const { data } = await rpc("wall_sign_check", { p_token: s.token });
      if (data?.ok) {
        return { token: s.token, expiresAt: Date.parse(data.expires_at), legacy: !!data.legacy, legacyUntil: data.legacy_until ?? null, signed: data.signed ?? 0, emoji: data.emoji ?? null };
      }
      forget();
    }
  }
  const { data, error } = await rpc("wall_sign_open", { p_code: code ?? "", p_device: deviceId() });
  if (error) throw new Error(error.message);
  if (!data?.ok) {
    // a bad/retired code: fall back to a session this phone already has
    if (code) return resolveSession(null).catch(() => null);
    return null;
  }
  const exp = Date.parse(data.expires_at);
  remember(data.token, exp);
  return { token: data.token, expiresAt: exp, legacy: !!data.legacy, legacyUntil: data.legacy_until ?? null, signed: 0, emoji: null };
}

export async function signWall(token: string, args: { name: string; strokes: number[][]; times?: number[][]; color: string; aspect: number }) {
  const { data, error } = await rpc("wall_sign_tap", {
    p_token: token, p_name: args.name, p_strokes: args.strokes, p_color: args.color, p_aspect: args.aspect, p_device: deviceId(),
    p_times: args.times && args.times.length === args.strokes.length ? args.times : null,
  });
  if (error) throw new Error(error.message);
  nudge(data?.ping, "sign", { id: data?.id });
  return { id: Number(data.id), badgeNo: Number(data.badge_no ?? data.id) };
}

export async function takenEmojis(token: string): Promise<string[]> {
  const { data, error } = await rpc("wall_emoji_taken", { p_token: token });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { emoji: string }[]).map((r) => r.emoji);
}

export type ClaimResult = {
  ok: boolean;
  reason?: "taken" | "not_emoji" | "already" | "sign_first";
  taken?: string[];
  emoji?: WallEmoji;
};

export async function claimEmoji(token: string, emoji: string): Promise<ClaimResult> {
  const { data, error } = await rpc("wall_emoji_claim", { p_token: token, p_emoji: emoji });
  if (error) throw new Error(error.message);
  if (data?.ok) nudge(data.ping, "emoji", { id: data.emoji?.id });
  return data as ClaimResult;
}

export async function emailBadge(token: string, email: string, png: string, name: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wall-badge-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify({ token, email, png, name }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok && j.ok ? { ok: true } : { ok: false, error: j.error || "That didn't send. Try again?" };
  } catch {
    return { ok: false, error: "No connection. Save it to your phone instead?" };
  }
}

/** Backup nudge on the wall's side channel; the database already pushed the event live. */
function nudge(ping: string | undefined, event: string, payload: Record<string, unknown>) {
  if (!ping) return;
  try {
    const ch = supabase.channel(ping);
    void ch.send({ type: "broadcast", event, payload }).finally(() => void supabase.removeChannel(ch));
  } catch {
    /* best effort */
  }
}
