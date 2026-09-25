/**
 * Vesta invite codes, managed from bestly.tech/admin/vesta.
 * Talks to edge fn vesta-admin (checks the admin role, then calls the Vesta project's
 * bridge_* RPCs with the write token from Vault). Codes look like VESTA-7QK2MX
 * (no 0/O/1/I). Each code gets a short invite link: vesta-app.bestly.tech/?i=CODE,
 * which opens the sign-up form with the code already filled in.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Check, Copy, KeyRound, Loader2, Plus } from "lucide-react";

type Code = { code: string; label: string | null; max_uses: number; uses: number; is_active: boolean;
  expires_at: string | null; created_at: string; joined: number };

const APP = "https://vesta-app.bestly.tech";
const inviteLink = (code: string) => `${APP}/?i=${code}`;
const inviteMessage = (code: string) =>
  `You're invited to Vesta — a private, women-only space to talk, ask anything anonymously, and get support.\n\n` +
  `Tap to join: ${inviteLink(code)}\n(Your invite code is ${code}. It works once.)`;

const date12 = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

function statusOf(c: Code): { label: string; tone: string } {
  if (!c.is_active) return { label: "Turned off", tone: "text-white/40" };
  if (c.expires_at && new Date(c.expires_at) < new Date()) return { label: "Expired", tone: "text-white/40" };
  if (c.uses >= c.max_uses) return { label: "Used", tone: "text-emerald-300" };
  return { label: c.max_uses > 1 ? `${c.max_uses - c.uses} of ${c.max_uses} left` : "Unused", tone: "text-amber-200" };
}

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("vesta-admin", { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data as { ok: boolean; codes: unknown };
}

export function VestaInvites() {
  const { toast } = useToast();
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(10);
  const [label, setLabel] = useState("");
  const [uses, setUses] = useState(1);
  const [days, setDays] = useState<string>("");
  const [fresh, setFresh] = useState<string[]>([]);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const r = await call({ action: "list" }); setCodes(r.codes as Code[]); setErr(null); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((k) => (k === key ? null : k)), 1600); }
    catch { toast({ title: "Couldn't copy", description: "Select the text and copy it by hand.", variant: "destructive" }); }
  };

  const generate = async () => {
    setBusy(true);
    try {
      const r = await call({ action: "create", count, label: label.trim(), max_uses: uses, expires_days: days === "" ? null : Number(days) });
      const made = r.codes as string[];
      setFresh(made);
      toast({ title: `${made.length} code${made.length === 1 ? "" : "s"} made`, description: "Copy them below, or copy the ready-to-send message." });
      void load();
    } catch (e) {
      toast({ title: "Couldn't make codes", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const setActive = async (code: string, active: boolean) => {
    try { await call({ action: "set_active", code, active }); void load(); }
    catch (e) { toast({ title: "Couldn't change it", description: e instanceof Error ? e.message : String(e), variant: "destructive" }); }
  };

  const shown = useMemo(() => (codes ?? []).filter((c) => filter === "all" || statusOf(c).label.match(/Unused|left/)), [codes, filter]);
  const openCount = (codes ?? []).filter((c) => statusOf(c).label.match(/Unused|left/)).length;

  const field = "w-full rounded-xl bg-black/30 px-3 py-2.5 text-[15px] text-white ring-1 ring-white/15 placeholder:text-white/30 focus:outline-none focus:ring-white/40";
  const CopyBtn = ({ k, text, label: l }: { k: string; text: string; label: string }) => (
    <button type="button" onClick={() => void copy(k, text)}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-white/80 ring-1 ring-white/15 hover:bg-white/5">
      {copied === k ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}{copied === k ? "Copied" : l}
    </button>
  );

  return (
    <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-white/70" />
        <h2 className="text-lg font-semibold text-white">Invite codes</h2>
        <span className="ml-auto text-xs text-white/50">{codes ? `${openCount} ready to give out` : ""}</span>
      </div>
      <p className="mt-1 text-sm text-white/55">Each woman needs one code to join. Send her the link — it opens Vesta with her code already filled in.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <label className="text-xs text-white/60">How many
          <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} className={cn(field, "mt-1")} /></label>
        <label className="text-xs text-white/60 sm:col-span-3">Who they're for (only you see this)
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="e.g. Rohit · Delhi group" className={cn(field, "mt-1")} /></label>
        <label className="text-xs text-white/60">Women per code
          <input type="number" min={1} max={500} value={uses} onChange={(e) => setUses(Math.max(1, Math.min(500, Number(e.target.value) || 1)))} className={cn(field, "mt-1")} /></label>
        <label className="text-xs text-white/60">Expires after
          <select value={days} onChange={(e) => setDays(e.target.value)} className={cn(field, "mt-1")}>
            <option value="">Never</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option>
          </select></label>
        <div className="flex items-end sm:col-span-2">
          <button type="button" onClick={() => void generate()} disabled={busy}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[15px] font-semibold text-[#111114] hover:bg-white/90 disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Make {count} code{count === 1 ? "" : "s"}
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-white/40">Tip: one code per woman keeps it personal. Use "women per code" above 1 only for a trusted group leader.</p>

      {fresh.length > 0 && (
        <div className="mt-4 rounded-2xl bg-emerald-500/[0.07] p-4 ring-1 ring-emerald-500/25">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-emerald-200">Just made</span>
            <span className="ml-auto" />
            <CopyBtn k="fresh-codes" text={fresh.join("\n")} label="Copy codes" />
            <CopyBtn k="fresh-links" text={fresh.map(inviteLink).join("\n")} label="Copy links" />
            <CopyBtn k="fresh-msgs" text={fresh.map(inviteMessage).join("\n\n———\n\n")} label="Copy messages" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2 font-mono text-sm text-white">{fresh.map((c) => <span key={c} className="rounded-lg bg-black/30 px-2 py-1">{c}</span>)}</div>
        </div>
      )}

      <div className="mt-5 flex items-center gap-2">
        {(["open", "all"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)}
            className={cn("rounded-full px-3 py-1 text-xs ring-1", filter === f ? "bg-white text-[#111114] ring-white" : "text-white/70 ring-white/15")}>
            {f === "open" ? "Ready to give out" : "All codes"}</button>))}
        <span className="ml-auto text-xs text-white/40">{codes ? `${shown.length} shown` : ""}</span>
      </div>

      {err && <p className="mt-3 text-sm text-red-300">Couldn't load codes: {err}</p>}
      {!codes && !err && <p className="mt-3 flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>}
      {codes && (
        <ul className="mt-2 max-h-[420px] overflow-y-auto">{shown.map((c) => {
          const st = statusOf(c);
          return (
            <li key={c.code} className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] py-2.5 last:border-0">
              <span className="font-mono text-[15px] text-white">{c.code}</span>
              <span className={cn("text-xs", st.tone)}>{st.label}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-white/45">{c.label || "—"} · made {date12(c.created_at)}{c.expires_at ? ` · ends ${date12(c.expires_at)}` : ""}</span>
              {st.label.match(/Unused|left/) && <>
                <CopyBtn k={`l-${c.code}`} text={inviteLink(c.code)} label="Link" />
                <CopyBtn k={`m-${c.code}`} text={inviteMessage(c.code)} label="Message" />
              </>}
              <button type="button" onClick={() => void setActive(c.code, !c.is_active)}
                className="rounded-lg px-2.5 py-1.5 text-xs text-white/60 ring-1 ring-white/10 hover:bg-white/5">{c.is_active ? "Turn off" : "Turn on"}</button>
            </li>);
        })}
        {shown.length === 0 && <li className="py-3 text-sm text-white/50">None here. Make some above.</li>}</ul>
      )}
    </div>
  );
}
