/** Ava's errands: personal call tasks ("settle my LADWP bill this week"). No metrics. "Call now" reuses the personal Ava dialer. */
import { useRef, useState } from "react";
import { Check, Phone, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { rpcArgs } from "@/components/admin/roofguard/AvaShared";
import { DialerSheet } from "@/components/admin/roofguard/AvaDialer";
import { requestDial } from "@/components/admin/roofguard/avaDial";
import { cn } from "@/lib/utils";
import { btnMain, btnQuiet, Empty, Gate, Panel } from "./parts";
import { errText, usePipelineRpc } from "./lib";
import type { Errand } from "./types";

const digits10 = (v: string) => v.replace(/\D/g, "").replace(/^1(?=\d{10})/, "").slice(0, 10);
const dueText = (d: string | null) => {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day)));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  return { label, late: d.slice(0, 10) < today, today: d.slice(0, 10) === today };
};
const field = "h-11 w-full rounded-xl bg-white/[0.06] px-3 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus:ring-white/30";

export function AvaErrands() {
  const { data, loading, missing, error, reload, hold } = usePipelineRpc<Errand[] | { errands: Errand[] }>("ava_errands_list");
  const rows: Errand[] = Array.isArray(data) ? data : data?.errands ?? [];
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: "", who: "", phone: "", details: "", due: "" });
  const [busy, setBusy] = useState(false);
  const [dialOpen, setDialOpen] = useState(false);
  const calling = useRef<string | null>(null);

  const run = async (fn: string, args: Record<string, unknown>, ok: string) => {
    hold(true);
    const { error: e } = await rpcArgs(fn, args);
    hold(false);
    if (e) { toast.error(errText(e)); return false; }
    toast.success(ok); void reload(); return true;
  };
  const add = async () => {
    if (!f.title.trim()) return;
    setBusy(true);
    const ok = await run("ava_errand_put", {
      p_title: f.title.trim(), p_who: f.who.trim() || null, p_phone: digits10(f.phone) || null, p_details: f.details.trim() || null, p_due_by: f.due || null,
    }, "Errand added");
    setBusy(false);
    if (ok) { setF({ title: "", who: "", phone: "", details: "", due: "" }); setAdding(false); }
  };
  const callNow = (e: Errand) => {
    const phone = digits10(e.phone ?? "");
    if (phone.length !== 10) return;
    calling.current = e.id;
    requestDial({ mode: "personal", phone, name: e.who ?? "", purpose: [e.title, e.details].filter(Boolean).join(". ") });
  };

  const open = rows.filter((r) => r.status === "open" || r.status === "calling");
  const done = rows.filter((r) => r.status === "done").slice(0, 3);

  return (
    <Panel className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold text-white">Ava: errands</h3>
          <p className="text-[14px] text-white/60">Calls you want Ava to make for you, like settling a bill.</p>
        </div>
        <button type="button" onClick={() => setAdding((v) => !v)} className={btnQuiet} aria-expanded={adding}><Plus className="h-4 w-4" aria-hidden />New errand</button>
      </div>

      {adding && (
        <form className="space-y-2 rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <label className="block text-[13px] text-white/70">What should Ava get done?
            <input className={cn(field, "mt-1")} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Settle my LADWP bill" maxLength={120} /></label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block text-[13px] text-white/70">Who to call
              <input className={cn(field, "mt-1")} value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })} placeholder="LADWP billing" maxLength={60} /></label>
            <label className="block text-[13px] text-white/70">Their phone number
              <input className={cn(field, "mt-1")} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="(213) 555-0100" maxLength={20} /></label>
          </div>
          <label className="block text-[13px] text-white/70">Anything Ava should know (optional)
            <textarea className={cn(field, "mt-1 h-auto min-h-[88px] py-2")} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} maxLength={600} /></label>
          <label className="block text-[13px] text-white/70">Done by (optional)
            <input type="date" className={cn(field, "mt-1 sm:max-w-[200px]")} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={busy || !f.title.trim()} className={btnMain}>Save errand</button>
            <button type="button" onClick={() => setAdding(false)} className={btnQuiet}>Cancel</button>
          </div>
        </form>
      )}

      <Gate loading={loading} missing={missing} error={error} hasData={data != null} h={90} onRetry={() => void reload()}>
        {open.length === 0 && !adding ? <Empty>No open errands. Add one and Ava can call for you.</Empty> : (
          <ul className="space-y-2">
            {open.map((e) => {
              const d = dueText(e.due_by), canCall = digits10(e.phone ?? "").length === 10;
              return (
                <li key={e.id} className="rounded-xl bg-white/[0.04] p-3 ring-1 ring-white/10">
                  <p className="text-[16px] font-medium text-white">{e.title}</p>
                  <p className="text-[13px] text-white/60">
                    {e.who ? `${e.who}` : "No contact added"}
                    {d && <span className={cn(d.late ? "text-orange-300" : d.today ? "text-amber-200" : "")}>{" · "}{d.late ? "Was due" : d.today ? "Due today" : "Due"}{d.today ? "" : <>{" "}{d.label}</>}</span>}
                    {e.status === "calling" && <span className="text-sky-300">{" · "}Ava is on it</span>}
                  </p>
                  {e.details && <p className="mt-1 text-[14px] text-white/70">{e.details}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {canCall && <button type="button" onClick={() => callNow(e)} className={btnMain}><Phone className="h-4 w-4" aria-hidden />Call now</button>}
                    <button type="button" onClick={() => void run("ava_errand_set", { p_id: e.id, p_status: "done" }, "Marked done")} className={btnQuiet}><Check className="h-4 w-4" aria-hidden />Done</button>
                    <button type="button" onClick={() => void run("ava_errand_set", { p_id: e.id, p_status: "cancelled" }, "Errand dropped")} className={btnQuiet}><X className="h-4 w-4" aria-hidden />Drop it</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {done.length > 0 && <p className="text-[13px] text-white/50">Recently done: {done.map((d) => d.title).join(", ")}</p>}
      </Gate>

      <DialerSheet kinds={["personal"]} open={dialOpen} onOpenChange={setDialOpen}
        onCalled={() => { const id = calling.current; calling.current = null; if (id) void run("ava_errand_set", { p_id: id, p_status: "calling" }, "Ava is calling"); }} />
    </Panel>
  );
}
