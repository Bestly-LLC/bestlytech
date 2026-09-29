/**
 * /g/:token — the host's one-page confirm screen for a guest's key (opened from the Turo pick-up Live Activity).
 * Apple HIG: large title, grouped rows with clear status, one primary action at a time, 50pt targets, safe areas, light/dark.
 * The token is per trip and unguessable; it only flips the two host confirmations (license, check-in) for that trip.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Check, ExternalLink, Loader2, ShieldCheck } from "lucide-react";

const API = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/trip-gate";
type S = { reservation_id: number; first: string; starts_at: string; kind: string; license_ok: boolean; checkin_ok: boolean; released: boolean };

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function HostGate() {
  const { token = "" } = useParams();
  const [s, setS] = useState<S | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");

  const call = useCallback(async (d?: string) => {
    setBusy(true);
    try {
      const r = await fetch(`${API}?g=${encodeURIComponent(token)}`, d ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ do: d }) } : undefined);
      const j = await r.json();
      setS(j.state ?? null);
      if (d) setFlash(j.state?.released && (d === "license" || d === "checkin") ? "Done. Key released." : d.startsWith("undo") ? "Undone." : "Saved.");
    } catch { setS((p) => p ?? null); } finally { setBusy(false); }
  }, [token]);
  useEffect(() => { void call(); }, [call]);
  useEffect(() => { document.title = "Guest key"; }, []);

  const Row = ({ ok, title, sub }: { ok: boolean; title: string; sub: string }) => (
    <div className="flex min-h-[60px] items-center gap-3 border-b border-black/10 px-4 py-3 last:border-0 dark:border-white/10">
      <span className={`grid h-7 w-7 flex-none place-items-center rounded-full text-white ${ok ? "bg-[#34c759] dark:bg-[#30d158]" : "bg-[#ff9500] dark:bg-[#ff9f0a]"}`}>{ok ? <Check className="h-4 w-4" /> : <span className="text-sm font-bold">!</span>}</span>
      <div className="min-w-0 flex-1"><div className="text-[17px] font-semibold">{title}</div><div className="text-[15px] text-black/55 dark:text-white/55">{sub}</div></div>
    </div>
  );
  const Btn = ({ d, children, ghost }: { d: string; children: string; ghost?: boolean }) => (
    <button disabled={busy} onClick={() => void call(d)} className={ghost
      ? "min-h-[44px] px-2 text-[15px] font-medium text-[#007aff] dark:text-[#0a84ff]"
      : "flex min-h-[50px] w-full items-center justify-center gap-2 rounded-[14px] bg-[#007aff] text-[17px] font-semibold text-white active:opacity-80 disabled:opacity-60 dark:bg-[#0a84ff]"}>
      {busy && !ghost ? <Loader2 className="h-5 w-5 animate-spin" /> : null}{children}
    </button>
  );

  return (
    <div className="min-h-screen bg-[#f2f2f7] text-black dark:bg-black dark:text-white" style={{ paddingTop: "max(20px, env(safe-area-inset-top))", paddingBottom: "max(24px, env(safe-area-inset-bottom))", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif" }}>
      <main className="mx-auto max-w-[520px] px-4">
        {s === undefined && <div className="grid place-items-center pt-32"><Loader2 className="h-6 w-6 animate-spin text-black/40 dark:text-white/40" /></div>}
        {s === null && <><h1 className="mt-2 text-[34px] font-bold leading-tight">Link not found</h1><p className="text-[15px] text-black/55 dark:text-white/55">This trip link is not valid any more.</p></>}
        {s && (<>
          <h1 className="mt-2 text-[34px] font-bold leading-tight">{s.first || "Guest"}</h1>
          <p className="mb-5 text-[15px] text-black/55 dark:text-white/55">Pick-up {when(s.starts_at)} · {s.kind === "lax" ? "LAX" : "Home"}</p>
          {flash && <div className="mb-3 rounded-xl bg-white p-4 font-semibold text-[#34c759] dark:bg-[#1c1c1e] dark:text-[#30d158]">{flash}</div>}
          <div className={`mb-5 flex items-center gap-2 rounded-xl bg-white p-4 font-semibold dark:bg-[#1c1c1e] ${s.released ? "text-[#34c759] dark:text-[#30d158]" : "text-[#ff9500] dark:text-[#ff9f0a]"}`}>
            {s.released && <ShieldCheck className="h-5 w-5" />}{s.released ? "Key released. The guest can add it now." : "Key held. It releases the moment both are done."}
          </div>
          <div className="mb-5 overflow-hidden rounded-xl bg-white dark:bg-[#1c1c1e]">
            <Row ok={s.license_ok} title="Driver's license" sub={s.license_ok ? "Confirmed" : "Not confirmed yet"} />
            <Row ok={s.checkin_ok} title="Your check-in" sub={s.checkin_ok ? "Photos and staging done" : "Photos and staging not done yet"} />
          </div>
          <div className="space-y-2.5">
            {!s.license_ok && <Btn d="license">License looks good</Btn>}
            {!s.checkin_ok && <Btn d="checkin">Check-in done, release key</Btn>}
          </div>
          <a href={`https://turo.com/us/en/reservation/${s.reservation_id}`} className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 px-1 text-[15px] font-medium text-[#007aff] dark:text-[#0a84ff]">Check the trip photos in Turo <ExternalLink className="h-4 w-4" /></a>
          <div className="mt-2">{s.license_ok && <Btn d="undo_license" ghost>Undo license</Btn>}{s.checkin_ok && <Btn d="undo_checkin" ghost>Undo check-in</Btn>}</div>
        </>)}
      </main>
    </div>
  );
}
