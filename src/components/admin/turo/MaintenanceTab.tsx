/**
 * Turo Watch → Maintenance. Mae's desk for Blue Steel: tread estimates for each tire pair, pressures, the other
 * wear items, guest flags and the next Costco slot. Recommend-only. The Costco booker is a DRY RUN: it records the slot
 * it would take and never books anything.
 */
import { useState } from "react";
import { AlertTriangle, CalendarCheck, CheckCircle2, Eye, ExternalLink, Gauge, Loader2, RefreshCw, Wrench, XCircle, HelpCircle } from "lucide-react";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TirePsiGrid } from "./TirePsiGrid";
import { cn } from "@/lib/utils";
import { act, agoText, card, dayOnly, fieldCls, muted, nb, pillPrimary, pillSecondary, useAdminRpc, whenLA } from "./repShared";

interface Item {
  id: string; item: string; label: string; installed_on: string | null; installed_miles: number | null; vendor: string | null; tread_32nds: number | null;
  tread_source: string | null; status: string; due_by: string | null; est_remaining_mi: number | null; notes: string | null; last_check: string | null;
  meta: { baseline?: string } | null;
}
interface Ev { id: number; at: string; kind: string; item: string | null; text: string | null; value: Record<string, unknown> | null }
interface Maint {
  settings: { costco_mode: string; warn_32nds: number; replace_32nds: number; new_32nds: number; tire_vendor: string; costco_waitwhile: string; min_gap_hours: number } | null;
  items: Item[]; events: Ev[];
  car: { tires: Record<string, number | null> | null; odometer: number | null; at: string | null; low_psi: number | null };
  trips: { reservation_id: number; guest_first: string; starts_at: string; ends_at: string; status: string }[];
  job: { last_run_at: string | null; last_ok: boolean | null } | null;
}

const STATUS: Record<string, { word: string; icon: typeof CheckCircle2; tone: string }> = {
  ok: { word: "OK", icon: CheckCircle2, tone: "bg-emerald-400/15 text-emerald-200 bento:bg-emerald-100 bento:text-emerald-800" },
  watch: { word: "Watch", icon: Eye, tone: "bg-amber-400/15 text-amber-200 bento:bg-amber-100 bento:text-amber-800" },
  due: { word: "Due", icon: AlertTriangle, tone: "bg-orange-400/15 text-orange-200 bento:bg-orange-100 bento:text-orange-800" },
  overdue: { word: "Replace now", icon: XCircle, tone: "bg-red-400/15 text-red-200 bento:bg-red-100 bento:text-red-800" },
  unknown: { word: "No date on file", icon: HelpCircle, tone: "bg-white/10 text-white/80 bento:bg-black/5 bento:text-[#333]" },
};
function Chip({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.unknown;
  const Icon = s.icon;
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", s.tone)}><Icon className="h-3.5 w-3.5" aria-hidden />{s.word}</span>;
}

const miles = (n: number | null | undefined) => (n == null ? "–" : nb(`${Math.round(n).toLocaleString("en-US")} mi`));
const tread = (n: number | null | undefined) => (n == null ? "–" : `${n}/32"`);

function TireCard({ it, set, reload, odo }: { it: Item; set: Maint["settings"]; reload: () => void; odo: number | null }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);
  const axle = it.item === "front_tires" ? "Front" : "Rear";
  const max = set?.new_32nds ?? 10, warn = set?.warn_32nds ?? 4, rep = set?.replace_32nds ?? 3;
  const t = it.tread_32nds;
  const width = t == null ? 0 : Math.max(2, Math.min(100, (t / max) * 100));
  const markDone = async () => { const r = await act(setBusy, "done", "maint_set", { p_action: "done", p_data: { item: it.item, installed_on: new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }), vendor: set?.tire_vendor ?? null } }, "Saved as new tires"); if (r) reload(); };
  return (
    <section className={cn(card, "space-y-3 p-5")} aria-label={`${axle} tires`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-white">{axle} tires</h2>
          <p className={cn("mt-0.5 text-sm", muted)}>Michelin Primacy MXM4 · {it.vendor ?? "vendor unknown"} · put on {dayOnly(it.installed_on)}, {it.installed_on?.slice(0, 4)}</p>
        </div>
        <div className="flex items-center gap-1">
          <Chip status={it.status} />
          <ActionMenu label={`More for ${axle.toLowerCase()} tires`} items={[{ label: "These were just replaced", icon: Wrench, onSelect: () => setAsk(true) }]} />
        </div>
      </header>
      <div className="flex items-end justify-between gap-3">
        <p className="whitespace-nowrap text-4xl font-bold tabular-nums text-white">{tread(t)}</p>
        <p className={cn("text-right text-sm", muted)}>
          {it.tread_source === "measured" || it.tread_source === "manual" || it.tread_source === "photo" ? "From your last reading" : "Estimate from miles driven"}
        </p>
      </div>
      <div className="relative h-3 rounded-full bg-white/10 bento:bg-black/10" role="img" aria-label={`${axle} tread ${t ?? "unknown"} thirty-seconds of an inch. Warn at ${warn}, replace at ${rep}.`}>
        <div className={cn("h-full rounded-full", t != null && t <= rep ? "bg-red-300 bento:bg-red-500" : t != null && t <= warn ? "bg-amber-300 bento:bg-amber-500" : "bg-emerald-300 bento:bg-emerald-500")} style={{ width: `${width}%` }} />
        {[warn, rep].map((v) => <div key={v} className="absolute -top-1 h-5 w-0.5 rounded bg-white/70 bento:bg-black/60" style={{ left: `${(v / max) * 100}%` }} aria-hidden />)}
      </div>
      <p className={cn("text-sm", muted)}>Warn at <span className="whitespace-nowrap">{warn}/32"</span>, replace at <span className="whitespace-nowrap">{rep}/32"</span>. New is about <span className="whitespace-nowrap">{max}/32"</span>.</p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className={muted}>Left at this wear</dt><dd className="whitespace-nowrap font-semibold tabular-nums text-white">{miles(it.est_remaining_mi)}</dd></div>
        <div><dt className={muted}>Replace by about</dt><dd className="whitespace-nowrap font-semibold text-white">{it.due_by ? dayOnly(it.due_by) : "–"}</dd></div>
        <div><dt className={muted}>Put on at</dt><dd className="whitespace-nowrap font-semibold tabular-nums text-white">{miles(it.installed_miles)}</dd></div>
        <div><dt className={muted}>Car now</dt><dd className="whitespace-nowrap font-semibold tabular-nums text-white">{miles(odo)}</dd></div>
      </dl>
      {it.meta?.baseline === "derived" && <p className={cn("text-sm", muted)}>The mileage when these went on is worked out from TezLab and the car, not read off the receipt. A reading below replaces it.</p>}
      <AlertDialog open={ask} onOpenChange={setAsk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark the {axle.toLowerCase()} tires as new today?</AlertDialogTitle>
            <AlertDialogDescription>Mae restarts the wear count from today at the car's current mileage, with about {max}/32" of tread.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void markDone()}>{busy === "done" ? "Saving" : "Mark as new"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function TreadForm({ reload }: { reload: () => void }) {
  const [front, setFront] = useState(""); const [rear, setRear] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const bad = (v: string) => v !== "" && !(Number(v) >= 0 && Number(v) <= 14);
  const save = async () => {
    const r = await act(setBusy, "tread", "maint_set", { p_action: "tread", p_data: { front, rear, note } }, "Reading saved. Mae uses it from now on.");
    if (r) { setFront(""); setRear(""); setNote(""); reload(); }
  };
  return (
    <section className={cn(card, "space-y-3 p-5")} aria-labelledby="tread-h">
      <div>
        <h2 id="tread-h" className="text-base font-semibold text-white">Enter a tread reading</h2>
        <p className={cn("mt-1 text-sm", muted)}>Penny test or a gauge, in 32nds of an inch. Your number replaces the estimate and Mae counts miles from it.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label htmlFor="tr-front" className="text-sm text-white/80">Front</label><input id="tr-front" inputMode="decimal" value={front} onChange={(e) => setFront(e.target.value)} placeholder='e.g. 3.5' className={cn(fieldCls, "mt-1 h-11")} aria-invalid={bad(front)} /></div>
        <div><label htmlFor="tr-rear" className="text-sm text-white/80">Rear</label><input id="tr-rear" inputMode="decimal" value={rear} onChange={(e) => setRear(e.target.value)} placeholder='e.g. 6' className={cn(fieldCls, "mt-1 h-11")} aria-invalid={bad(rear)} /></div>
      </div>
      {(bad(front) || bad(rear)) && <p role="alert" className="text-sm text-red-300 bento:text-red-700">Tread is between 0 and 14 thirty-seconds.</p>}
      <div><label htmlFor="tr-note" className="text-sm text-white/80">Note (optional)</label><input id="tr-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="penny test, inner edge" className={cn(fieldCls, "mt-1 h-11")} /></div>
      <button className={pillPrimary} disabled={!!busy || bad(front) || bad(rear) || (front === "" && rear === "")} onClick={() => void save()}>
        {busy === "tread" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Save reading
      </button>
    </section>
  );
}

function PressureCard({ car }: { car: Maint["car"] }) {
  const tires = car.tires;
  return (
    <section className={cn(card, "space-y-3 p-5")} aria-labelledby="psi-h">
      <div className="flex items-baseline justify-between gap-2"><h2 id="psi-h" className="text-base font-semibold text-white">Tire pressure</h2><p className={cn("text-sm", muted)}>{agoText(car.at)}</p></div>
      {tires ? <div className="flex items-center gap-5"><TirePsiGrid tires={tires} low={car.low_psi ?? 37} size="lg" /><p className={cn("text-sm", muted)}>In psi. Mae takes a reading every hour and flags a tire that keeps losing pressure against the other three. Low is under <span className="whitespace-nowrap">{car.low_psi ?? 37} psi</span>.</p></div>
        : <p className={cn("text-sm", muted)}>The car has not reported pressures yet.</p>}
    </section>
  );
}

function CostcoCard({ d }: { d: Maint }) {
  const slot = d.events.find((e) => e.kind === "booking");
  const s = d.settings;
  const due = d.items.filter((i) => ["due", "overdue"].includes(i.status) && i.item.endsWith("tires"));
  return (
    <section className={cn(card, "space-y-3 p-5")} aria-labelledby="costco-h">
      <div className="flex items-start justify-between gap-2">
        <h2 id="costco-h" className="flex items-center gap-2 text-base font-semibold text-white"><CalendarCheck className="h-5 w-5" aria-hidden /> Costco tire slot</h2>
        <span className="whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/90 bento:bg-black/5 bento:text-[#333]">Dry run</span>
      </div>
      {due.length === 0 && <p className={cn("text-sm", muted)}>No tires are due, so Mae is not looking for a slot.</p>}
      {slot ? <p className="rounded-xl bg-white/[0.04] p-3 text-[0.95rem] text-white/90 bento:bg-[var(--bento-well)]">{slot.text}<span className={cn("mt-1 block text-sm", muted)}>Found {whenLA(slot.at)}</span></p>
        : due.length > 0 && <p className={cn("text-sm", muted)}>No slot found yet that clears your trips by {s?.min_gap_hours ?? 24} hrs.</p>}
      <p className={cn("text-sm", muted)}>Mae only records the slot she would take. Nothing is booked, and she never books over a trip. When you are ready, book it yourself on Costco's page.</p>
      {s && <a className={cn(pillSecondary, "w-fit")} href={s.costco_waitwhile} target="_blank" rel="noreferrer">Open Costco {s.tire_vendor.replace("Costco ", "")} <ExternalLink className="h-4 w-4" aria-hidden /></a>}
    </section>
  );
}

function OtherItems({ items, reload }: { items: Item[]; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const done = async (it: Item) => { const r = await act(setBusy, it.item, "maint_set", { p_action: "done", p_data: { item: it.item, installed_on: new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" }) } }, `${it.label} marked done today`); if (r) reload(); };
  return (
    <section className={cn(card, "p-5")} aria-labelledby="items-h">
      <h2 id="items-h" className="text-base font-semibold text-white">Other wear items</h2>
      <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-black/5">
        {items.map((it) => (
          <li key={it.id} className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-[0.95rem] font-medium text-white">{it.label}</p>
              <p className={cn("mt-0.5 text-sm", muted)}>{it.installed_on ? `Changed ${dayOnly(it.installed_on)}, ${it.installed_on.slice(0, 4)}` : it.notes}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Chip status={it.status} />
              {it.item !== "brakes" && <ActionMenu label={`More for ${it.label}`} items={[{ label: busy === it.item ? "Saving" : "Changed today", icon: Wrench, onSelect: () => done(it) }]} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Log({ events }: { events: Ev[] }) {
  const flags = events.filter((e) => e.kind === "guest_flag" && (e.value?.flag as string | undefined)?.toLowerCase() !== "car location");
  const rest = events.filter((e) => !["guest_flag", "booking"].includes(e.kind)).slice(0, 8);
  return (
    <>
      <section className={cn(card, "p-5")} aria-labelledby="flags-h">
        <h2 id="flags-h" className="text-base font-semibold text-white">Guest maintenance flags</h2>
        {flags.length === 0 ? <p className={cn("mt-2 text-sm", muted)}>No maintenance flags from guests.</p>
          : <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-black/5">{flags.map((e) => <li key={e.id} className="py-3 text-[0.95rem] text-white/85">{e.text}<span className={cn("mt-1 block text-sm", muted)}>{whenLA(e.at)}</span></li>)}</ul>}
      </section>
      <section className={cn(card, "p-5")} aria-labelledby="log-h">
        <h2 id="log-h" className="text-base font-semibold text-white">Mae's notes</h2>
        {rest.length === 0 ? <p className={cn("mt-2 text-sm", muted)}>Nothing yet.</p>
          : <ul className="mt-2 divide-y divide-white/[0.06] bento:divide-black/5">{rest.map((e) => <li key={e.id} className="py-3 text-[0.95rem] text-white/85">{e.text ?? `${e.kind} logged`}<span className={cn("mt-1 block text-sm", muted)}>{whenLA(e.at)}</span></li>)}</ul>}
      </section>
    </>
  );
}

export default function MaintenanceTab() {
  const { data, error, load } = useAdminRpc<Maint>("maint_admin");
  if (!data) {
    return error
      ? <div className={cn(card, "space-y-3 p-5")} role="alert"><p className="text-white">Could not load Maintenance: {error}</p><button className={pillSecondary} onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden /> Retry</button></div>
      : <div className="space-y-4" aria-busy="true"><Skeleton className="h-64 rounded-2xl" /><Skeleton className="h-48 rounded-2xl" /></div>;
  }
  const tires = data.items.filter((i) => i.item.endsWith("tires")).sort((a, b) => (a.item === "front_tires" ? -1 : b.item === "front_tires" ? 1 : 0));
  const others = data.items.filter((i) => !i.item.endsWith("tires"));
  const reload = () => void load();
  return (
    <div className="space-y-5">
      <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", muted)}>
        <span className="inline-flex items-center gap-1.5"><Gauge className="h-4 w-4" aria-hidden /> Blue Steel at <span className="whitespace-nowrap font-medium text-white">{miles(data.car.odometer)}</span></span>
        <span>Mae checked {agoText(data.job?.last_run_at)}</span>
      </p>
      {tires.length === 0 ? <div className={card}><EmptyState compact icon={Wrench} title="No tire records yet" description="Mae fills these in on her first hourly pass." /></div>
        : <div className="grid items-start gap-4 lg:grid-cols-2">{tires.map((t) => <TireCard key={t.id} it={t} set={data.settings} reload={reload} odo={data.car.odometer} />)}</div>}
      <CostcoCard d={data} />
      <div className="grid items-start gap-4 lg:grid-cols-2"><PressureCard car={data.car} /><TreadForm reload={reload} /></div>
      <OtherItems items={others} reload={reload} />
      <Log events={data.events} />
    </div>
  );
}
