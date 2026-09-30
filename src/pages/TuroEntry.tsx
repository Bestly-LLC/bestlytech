/**
 * /turo-key (home pickup) and /turo-lax (LAX delivery) — the one link in the Turo booking message.
 * The guest types the phone number and last name on their Turo account; the server finds their trip and sends them to
 * /t/<token>. The device remembers the trip, so a return visit is one tap ("Continue"). The key itself is still held
 * until license + host check-in are confirmed (see lax_guest_public), so signing in here never releases anything early.
 * Host test: open /turo-key?test=1 (or /turo-lax?test=1) — it prefills the demo login (555-555-0100 / Test).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Kind = "home" | "lax";
const MEM = "bestly-trip-entry";
type Mem = { token: string; first: string };
const readMem = (): Mem | null => { try { const m = JSON.parse(localStorage.getItem(MEM) || "null"); return m?.token ? m : null; } catch { return null; } };

const fmtPhone = (v: string) => {
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
};

export default function TuroEntry({ kind }: { kind: Kind }) {
  const nav = useNavigate();
  const test = useMemo(() => new URLSearchParams(window.location.search).get("test") === "1", []);
  const [mem, setMem] = useState<Mem | null>(() => (test ? null : readMem()));
  const [phone, setPhone] = useState(test ? "(555) 555-0100" : "");
  const [last, setLast] = useState(test ? "Test" : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { document.title = "Your Blue Steel trip"; }, []);

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setErr(""); setBusy(true);
    try {
      const { data, error } = await (supabase.rpc as any)("guest_entry_lookup", { p_kind: kind, p_phone: phone, p_last: last }); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (error) throw error;
      if (data?.ok && data.token) {
        if (!data.demo) { try { localStorage.setItem(MEM, JSON.stringify({ token: data.token, first: data.first || "" })); } catch { /* private mode */ } }
        nav(`/t/${data.token}`);
        return;
      }
      setErr(data?.reason === "slow_down"
        ? "Too many tries. Please wait 15 minutes, or message me in Turo chat."
        : data?.reason === "missing"
          ? "Enter the 10-digit phone number and your last name."
          : "We couldn't find a trip with that phone and last name. Use the phone number and last name on your Turo account, or message me in Turo chat.");
    } catch { setErr("Something went wrong. Check your connection and try again."); } finally { setBusy(false); }
  };

  const field = "h-[52px] w-full rounded-[14px] bg-white px-4 text-[17px] text-black outline-none ring-1 ring-black/10 placeholder:text-black/35 focus:ring-2 focus:ring-[#007aff] dark:bg-[#1c1c1e] dark:text-white dark:ring-white/10 dark:placeholder:text-white/35 dark:focus:ring-[#0a84ff]";
  return (
    <div className="min-h-screen bg-[#f2f2f7] text-black dark:bg-black dark:text-white" style={{ paddingTop: "max(28px, env(safe-area-inset-top))", paddingBottom: "max(24px, env(safe-area-inset-bottom))", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}>
      <main className="mx-auto max-w-[460px] px-5">
        <p className="mt-6 text-[13px] font-semibold uppercase tracking-[0.14em] text-black/50 dark:text-white/50">Blue Steel · Tesla Model 3</p>
        <h1 className="mt-1 text-[34px] font-bold leading-tight">{mem ? `Welcome back${mem.first ? `, ${mem.first}` : ""}` : "Your trip page"}</h1>
        <p className="mb-6 mt-2 text-[17px] leading-snug text-black/60 dark:text-white/60">
          {mem ? "Pick up where you left off."
            : kind === "lax" ? "Your Tesla key, garage pass, the car's spot and climate buttons all live here."
              : "Your Tesla key, the car's spot and climate buttons all live here."}
        </p>
        {mem ? (
          <>
            <button onClick={() => nav(`/t/${mem.token}`)} className="flex min-h-[52px] w-full items-center justify-center rounded-[14px] bg-[#007aff] text-[17px] font-semibold text-white active:opacity-80 dark:bg-[#0a84ff]">Continue</button>
            <button onClick={() => { try { localStorage.removeItem(MEM); } catch { /* ignore */ } setMem(null); }} className="mt-2 min-h-[44px] w-full text-[15px] font-medium text-[#007aff] dark:text-[#0a84ff]">Not you? Sign in again</button>
          </>
        ) : (
          <form onSubmit={go} className="space-y-3" noValidate>
            <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-black/55 dark:text-white/55">Phone number on your Turo account</span>
              <input className={field} type="tel" inputMode="tel" autoComplete="tel" placeholder="(555) 555-5555" value={phone} onChange={(e) => setPhone(fmtPhone(e.target.value))} /></label>
            <label className="block"><span className="mb-1.5 block text-[13px] font-medium text-black/55 dark:text-white/55">Last name</span>
              <input className={field} type="text" autoComplete="family-name" autoCapitalize="words" placeholder="Last name" value={last} onChange={(e) => setLast(e.target.value)} /></label>
            {err && <p role="alert" className="rounded-xl bg-[#ff3b30]/10 px-4 py-3 text-[15px] leading-snug text-[#d70015] dark:text-[#ff6961]">{err}</p>}
            <button type="submit" disabled={busy} className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-[#007aff] text-[17px] font-semibold text-white active:opacity-80 disabled:opacity-60 dark:bg-[#0a84ff]">
              {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden />}Open my trip
            </button>
            <p className="pt-2 text-center text-[13px] leading-snug text-black/45 dark:text-white/45">
              Your key appears here once your license is checked and the car is ready. Upload your driver&apos;s license in the Turo app if you haven&apos;t yet.
            </p>
          </form>
        )}
      </main>
    </div>
  );
}
