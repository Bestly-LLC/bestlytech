/**
 * /admin/maya: Maya Desk. Maya is Bestly's Sales & Service phone agent, (213) 641-0074: support for every Bestly product,
 * privacy requests (CCPA, 45 days), and Bestly Agent demo requests.
 *   Needs follow-up   support_tickets that are not leads, soonest due first (admin_maya_tickets 'open')
 *   Leads             demo requests (kind sales_lead)
 *   Calls             her recent calls with transcripts (edge fn maya-admin)
 *   Done              closed tickets, with Reopen
 * Data: support_tickets via admin_maya_tickets / admin_maya_ticket_set / admin_maya_counts (admin only). Line health: ava_line_health 'maya'.
 * Plan: docs/maya-desk-opusplan.md. Nothing here touches Ava or Reese.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Headset } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { LineStatus, rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { TicketCard, type TicketAct } from "@/components/admin/maya/TicketCard";
import { MayaCalls } from "@/components/admin/maya/MayaCalls";
import type { Ticket } from "@/components/admin/maya/mayaFormat";

type Seg = "open" | "leads" | "calls" | "done";
type Counts = { open: number; overdue: number; leads: number; privacy_open: number };
const SEG_KEY = "maya-desk-segment";
const SEGS: { id: Seg; label: string }[] = [
  { id: "open", label: "Needs follow-up" }, { id: "leads", label: "Leads" }, { id: "calls", label: "Calls" }, { id: "done", label: "Done" },
];
const NB = " ";

function readSeg(): Seg {
  try { const v = localStorage.getItem(SEG_KEY); if (v === "open" || v === "leads" || v === "calls" || v === "done") return v; } catch { /* private mode */ }
  return "open";
}

function Stat({ label, value, warn }: { label: string; value: number | undefined; warn?: boolean }) {
  const hot = warn && (value ?? 0) > 0;
  return (
    <div className={cn("rounded-2xl px-3 py-3 ring-1", hot ? "bg-orange-500/10 ring-orange-500/30" : "bg-white/[0.04] ring-white/10")}>
      <div className={cn("text-[26px] font-semibold leading-none tabular-nums", hot ? "text-orange-300" : "text-white")}>{value ?? "–"}</div>
      <div className={cn("mt-1.5 text-[12px]", hot ? "text-orange-200" : "text-white/60")}>{label}</div>
    </div>
  );
}

export default function MayaDesk() {
  const [seg, setSeg] = useState<Seg>(readSeg);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [rows, setRows] = useState<Ticket[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const req = useRef(0);
  const pending = useRef(0);     // writes in flight: a poll must not resurrect a card that was just closed

  const loadCounts = useCallback(async () => {
    const { data } = await rpcArgs<Counts>("admin_maya_counts");
    if (data) setCounts(data);
  }, []);

  const loadRows = useCallback(async (s: Seg) => {
    if (s === "calls") return;
    const id = ++req.current;
    const { data, error } = await rpcArgs<Ticket[]>("admin_maya_tickets", { p_view: s });
    if (id !== req.current || pending.current > 0) return;
    if (error) { setErr("Couldn't load tickets. Try again in a minute."); return; }
    setErr(null); setRows(data ?? []);
  }, []);

  const pick = (s: Seg) => {
    setSeg(s);
    try { localStorage.setItem(SEG_KEY, s); } catch { /* private mode */ }
  };

  // Load the list for the chosen segment, then keep it and the counts fresh every 60 seconds while the tab is visible.
  useEffect(() => {
    setRows(null); setErr(null);
    void loadRows(seg); void loadCounts();
    const t = setInterval(() => { if (!document.hidden) { void loadRows(seg); void loadCounts(); } }, 60000);
    const vis = () => { if (!document.hidden) { void loadRows(seg); void loadCounts(); } };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [seg, loadRows, loadCounts]);

  const onAct: TicketAct = async (t, status, note) => {
    const before = rows;
    setRows((r) => (r ?? []).filter((x) => x.code !== t.code));       // optimistic
    pending.current += 1;
    const { error } = await rpcArgs("admin_maya_ticket_set", { p_code: t.code, p_status: status, p_note: note });
    pending.current -= 1;
    if (error) {
      setRows(before);
      toast.error(`Couldn't update ${t.code}. Try again.`);
      return;
    }
    void loadCounts();
    if (status === "open") { toast.success(`${t.code} reopened`); return; }
    toast(`${t.code} marked ${status === "spam" ? "spam" : "done"}`, {
      duration: 5000,
      action: { label: "Undo", onClick: async () => {
        const u = await rpcArgs("admin_maya_ticket_set", { p_code: t.code, p_status: "open", p_note: null });
        if (u.error) toast.error(`Couldn't undo for ${t.code}.`);
        void loadRows(seg); void loadCounts();
      } },
    });
  };

  const empty: Record<Exclude<Seg, "calls">, string> = {
    open: "Nothing waiting. Maya has it covered.",
    leads: "No demo requests waiting. When someone asks for a Bestly Agent demo on the phone, it lands here.",
    done: "Nothing closed yet.",
  };
  const badge = (s: Seg) => s === "open" ? counts?.open : s === "leads" ? counts?.leads : undefined;
  const idx = SEGS.findIndex((s) => s.id === seg);

  return (
    <div className="space-y-5 pb-24">
      <header className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-[2rem] font-bold leading-[1.1] tracking-[-0.015em] text-white sm:text-3xl">
              <Headset className="h-7 w-7 text-white/70" aria-hidden />Maya
            </h1>
            <p className="mt-1.5 text-[15px] text-white/65">
              Sales &amp; Service{" · "}
              <a href="tel:+12136410074" className="whitespace-nowrap text-sky-300 underline-offset-2 hover:underline">(213){NB}641-0074</a>
            </p>
          </div>
          <LineStatus source="maya" />
        </div>
        <div className="grid grid-cols-4 gap-2" aria-label="Maya at a glance">
          <Stat label="Open" value={counts?.open} />
          <Stat label="Overdue" value={counts?.overdue} warn />
          <Stat label="Leads" value={counts?.leads} />
          <Stat label="Privacy" value={counts?.privacy_open} />
        </div>
      </header>

      <div role="tablist" aria-label="Maya Desk views" className="relative grid grid-cols-4 rounded-2xl bg-white/[0.06] p-1 ring-1 ring-white/10">
        <span aria-hidden className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-xl bg-white/[0.14] shadow-sm motion-safe:transition-transform motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{ transform: `translateX(${idx * 100}%)` }} />
        {SEGS.map((s) => {
          const n = badge(s.id);
          return (
            <button key={s.id} type="button" role="tab" aria-selected={seg === s.id} onClick={() => pick(s.id)}
              className={cn("relative z-10 flex min-h-[44px] flex-col items-center justify-center rounded-xl px-1 text-center text-[13px] font-medium leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 sm:text-[15px]",
                seg === s.id ? "text-white" : "text-white/65 hover:text-white")}>
              <span>{s.label}</span>
              {n != null && n > 0 && <span className="text-[12px] tabular-nums text-white/70">{n}</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" className="space-y-3">
        {seg === "calls" ? <MayaCalls /> : (<>
          {err && (
            <div role="alert" className="rounded-2xl bg-amber-500/10 p-4 text-[15px] text-amber-100 ring-1 ring-amber-500/30">
              <p>{err}</p>
              <button type="button" onClick={() => void loadRows(seg)} className="mt-2 min-h-[44px] rounded-xl bg-white/10 px-4 font-medium text-white hover:bg-white/15">Retry</button>
            </div>
          )}
          {rows === null && !err && Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-[150px] rounded-2xl bg-white/[0.04] ring-1 ring-white/10 motion-safe:animate-pulse" aria-hidden />
          ))}
          {rows?.length === 0 && <p className="rounded-2xl bg-white/[0.04] p-5 text-[15px] text-white/75 ring-1 ring-white/10">{empty[seg]}</p>}
          {rows?.map((t) => <TicketCard key={t.code} t={t} mode={seg === "leads" ? "lead" : seg === "done" ? "done" : "followup"} onAct={onAct} />)}
          {seg === "done" && rows && rows.length >= 100 && <p className="text-[13px] text-white/55">Showing the 100 most recent.</p>}
        </>)}
      </div>
    </div>
  );
}
