/**
 * Flat Tire Desk (/admin/tires, Jared 2026-10-29: "how can we automate this for myself to make it easy on me").
 *
 * When a tire fails during a trip (Tesla's hard tire warning, or the guest writes about a flat in the Turo chat), Car Guard
 * opens an incident, finds tire shops near the car and Ava calls them: is a 235/45R18 in stock, the price installed, can they
 * take a tow-in now. Jared gets a push with the ranked shortlist and only taps here:
 *   - Send tow plan: the picked shop goes to the guest in the Turo chat (Turo: the host chooses where the car is towed).
 *   - Approve: the shop's quote; logged on the Claims Closer case and confirmed in the Turo chat (Turo: a replacement tire
 *     needs the host's OK, equal or better quality).
 * The page refreshes itself while Ava is still working. Engine: supabase/functions/tire-next-steps, migration 20261030030000.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Loader2, MapPin, Phone, PhoneCall } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Lines } from "@/components/Lines";
import { Section, btnPlain, btnPrimary, btnTinted, card, field, label, pill, secondary, tertiary, tint } from "./laxUi";

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

interface Result { reached: boolean; in_stock: "yes" | "no" | "unknown"; brand?: string; price_each?: number | null; tow_in_now: "yes" | "no" | "unknown"; ready_in?: string; notes?: string }
interface Shop { name: string; phone?: string; address?: string; hours?: string; open_now?: boolean | null; mi: number; src: string; call_id?: string | null; call_error?: string; result?: Result }
interface Incident {
  id: string; reservation_id: number; guest_first: string | null; reason: string | null; status: string;
  lat: number | null; lon: number | null; car_at: string | null; shops: Shop[]; tesla: Shop | null; src: string | null;
  picked: (Shop & { idx: number; at: string }) | null; approved: { note: string; at: string } | null;
  log: { at: string; text: string }[]; opened_at: string; msgs: Record<string, { status: string; sent_at: string | null }> | null;
}
interface Data { incidents: Incident[]; trip: { reservation_id: number; guest_first: string | null } | null; tire_size: string | null }

const WORKING = ["finding", "calling", "collecting"];
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const nw = (s: string) => <span className="whitespace-nowrap">{s}</span>;

function stage(i: Incident): { text: string; tone: keyof typeof pill } {
  switch (i.status) {
    case "finding": return { text: "Finding shops", tone: "blue" };
    case "calling": case "collecting": return { text: "Ava is calling", tone: "blue" };
    case "ready": return { text: "Pick a shop", tone: "orange" };
    case "picked": return { text: i.msgs?.tire_next?.status === "sent" ? "Tow plan sent" : "Sending tow plan", tone: "green" };
    case "approved": return { text: "Tire approved", tone: "green" };
    default: return { text: "Closed", tone: "blue" };
  }
}

function said(s: Shop): string {
  const r = s.result;
  if (s.call_error) return "Ava couldn't call";
  if (!s.call_id) return s.phone ? "Not called" : "No phone number";
  if (!r) return "On the phone";
  if (!r.reached) return r.notes || "No answer";
  return [r.in_stock === "yes" ? `In stock${r.brand ? ` (${r.brand})` : ""}` : r.in_stock === "no" ? "No tire in stock" : "Stock unclear",
    r.price_each ? `$${Math.round(r.price_each)} installed` : null,
    r.tow_in_now === "yes" ? "can take it now" : r.tow_in_now === "no" ? "can't take it now" : null,
    r.ready_in || null].filter(Boolean).join(" · ");
}

function ShopRow({ s, idx, primary, canPick, onPick, busy, picked }: { s: Shop; idx: number; primary: boolean; canPick: boolean; onPick: (i: number) => void; busy: boolean; picked: boolean }) {
  const good = s.result?.in_stock === "yes";
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className={cn("text-[15px] font-semibold", label)}>{s.name} <span className={cn("text-[13px] font-normal", secondary)}>{nw(`${s.mi} mi`)}</span></p>
        <p className={cn("mt-0.5 text-[13px]", good ? tint.green : secondary)}>{said(s)}</p>
        {s.result?.notes && s.result.reached && <p className={cn("mt-0.5 text-[13px]", tertiary)}><Lines>{s.result.notes}</Lines></p>}
        <p className={cn("mt-0.5 text-[13px]", tertiary)}>
          {s.address}{s.address && s.phone ? " · " : ""}{s.phone && <a className="whitespace-nowrap underline-offset-2 hover:underline" href={`tel:${s.phone.replace(/\D/g, "")}`}>{s.phone}</a>}
        </p>
      </div>
      {picked ? <span className={cn("inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-semibold sm:min-h-[36px]", tint.green)}><Check className="h-4 w-4" /> Picked</span>
        : canPick && <button type="button" disabled={busy} onClick={() => onPick(idx)} className={primary ? btnPrimary : btnTinted}>Send tow plan</button>}
    </li>
  );
}

function IncidentCard({ i, reload }: { i: Incident; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const st = stage(i);
  const working = WORKING.includes(i.status);
  const canPick = ["ready", "picked"].includes(i.status) && i.msgs?.tire_next?.status !== "sent";
  const pick = async (idx: number) => {
    setBusy(true);
    const { error } = await rpc("tire_desk_pick", { p_id: i.id, p_idx: idx });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Tow plan is going to the guest in the Turo chat"); reload(); }
  };
  const approve = async () => {
    setBusy(true);
    const { error } = await rpc("tire_desk_approve", { p_id: i.id, p_note: note });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Approved. The guest gets it in the Turo chat."); setNote(""); reload(); }
  };
  const close = async () => {
    const { error } = await rpc("tire_desk_close", { p_id: i.id });
    if (error) toast.error(error.message); else reload();
  };
  return (
    <div className={cn(card, "space-y-3")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("text-[17px] font-semibold", label)}>{i.guest_first ?? "Guest"}'s trip <span className={cn("text-[13px] font-normal", tertiary)}>{nw(when(i.opened_at))}</span></p>
          {i.reason && <p className={cn("mt-0.5 text-[13px]", secondary)}><Lines>{i.reason}</Lines></p>}
        </div>
        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold", pill[st.tone])}>
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : st.tone === "orange" ? <CircleAlert className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}{st.text}
        </span>
      </div>

      {i.lat != null && i.lon != null && (
        <a className={btnPlain} href={`https://maps.apple.com/?q=${i.lat},${i.lon}`} target="_blank" rel="noreferrer"><MapPin className="h-4 w-4" /> Where the car is</a>
      )}

      {working && (
        <p className={cn("flex items-center gap-2 text-[13px]", secondary)}>
          <PhoneCall className="h-4 w-4 shrink-0" />
          <Lines>{i.status === "finding" ? "Looking up tire shops near the car." : "Ava is calling shops to check stock, price and whether they can take a tow-in now. Your shortlist comes as a push."}</Lines>
        </p>
      )}

      {i.shops.length > 0 && (
        <ul className="divide-y divide-[#38383A] bento:divide-[#C6C6C8]">
          {i.shops.slice(0, 5).map((s, n) => (
            <ShopRow key={s.name + n} s={s} idx={n} primary={n === 0} canPick={canPick} onPick={pick} busy={busy} picked={i.picked?.idx === n} />
          ))}
        </ul>
      )}
      {!working && i.shops.length === 0 && (
        <p className={cn("text-[13px]", secondary)}><Lines>No tire shops were found near the car. Message the guest in the Turo chat where to tow it.</Lines></p>
      )}
      {i.tesla && <p className={cn("text-[13px]", tertiary)}><Lines>{`Wheel or suspension damage: ${i.tesla.name}${i.tesla.address ? `, ${i.tesla.address}` : ""}.`}</Lines></p>}

      {(i.status === "picked" || i.status === "approved") && (
        <div className="space-y-2">
          <p className={cn("text-[13px] font-semibold", label)}>The shop's quote</p>
          {i.approved
            ? <p className={cn("flex items-center gap-1.5 text-[15px]", tint.green)}><Check className="h-4 w-4 shrink-0" /><Lines>{`Approved: ${i.approved.note}`}</Lines></p>
            : <div className="flex flex-wrap gap-2">
                <input className={cn(field, "min-w-0 flex-1")} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Brand and price, e.g. Michelin Primacy, $289 installed" aria-label="What you approve" />
                <button type="button" className={btnPrimary} disabled={busy || note.trim().length < 3} onClick={approve}>Approve</button>
              </div>}
          <p className={cn("text-[12px]", tertiary)}><Lines>Turo's rule: a new tire needs your OK and must be the same quality or better. Approving logs it on the claim and tells the guest in the Turo chat.</Lines></p>
        </div>
      )}

      {i.status !== "closed" && !working && (
        <div className="flex justify-end"><button type="button" className={btnPlain} onClick={close}>Close</button></div>
      )}
    </div>
  );
}

export default function TireDesk() {
  const [d, setD] = useState<Data | null>(null);
  const [starting, setStarting] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await rpc("tire_desk_admin");
    if (error) { toast.error("Couldn't read the Tire Desk."); return; }
    setD(data as Data);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const busy = !!d?.incidents.some((i) => WORKING.includes(i.status));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(t);
  }, [busy, load]);

  const open = d?.incidents.filter((i) => i.status !== "closed") ?? [];
  const past = d?.incidents.filter((i) => i.status === "closed") ?? [];
  const tripOpen = !!d?.trip && open.some((i) => i.reservation_id === d.trip!.reservation_id);
  const start = async () => {
    if (!d?.trip) return;
    setStarting(true);
    const { error } = await rpc("tire_desk_start", { p_res: d.trip.reservation_id });
    setStarting(false);
    if (error) toast.error(error.message); else { toast.success("On it. Ava will call shops near the car."); void load(); }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pb-16 sm:px-0">
      <PageHeader title="Tire Desk" description="When a tire fails on a trip, Car Guard finds shops near the car and Ava calls them. You pick one, and the guest gets the tow plan in the Turo chat." />
      {!d ? <Loader2 className="h-5 w-5 animate-spin text-white/50" /> : (
        <>
          {d.trip && !tripOpen && (
            <div className={cn(card, "flex flex-wrap items-center justify-between gap-3")}>
              <p className={cn("text-[15px]", label)}><Lines>{`${d.trip.guest_first ?? "A guest"} has the car right now. Guest called you about a tire?`}</Lines></p>
              <button type="button" className={btnTinted} disabled={starting} onClick={start}>
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />} Find a shop now
              </button>
            </div>
          )}
          <Section title="Now" footer={d.tire_size ? `Tire size: ${d.tire_size}.` : undefined}>
            {open.length ? open.map((i) => <IncidentCard key={i.id} i={i} reload={load} />)
              : <p className={cn(card, "text-[15px]", secondary)}><Lines>Nothing going on. A Tesla tire warning or a guest writing about a flat starts this by itself.</Lines></p>}
          </Section>
          {past.length > 0 && (
            <Section title="Earlier">
              {past.map((i) => <IncidentCard key={i.id} i={i} reload={load} />)}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
