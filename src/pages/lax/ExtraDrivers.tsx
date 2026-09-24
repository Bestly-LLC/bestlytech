/**
 * "Add a driver": extra Tesla keys, but ONLY for drivers Turo has approved.
 * Two gates: (1) the guest confirms they added the driver in the Turo app and accepts the insurance terms,
 * (2) the key is made only after Turo's "has added another driver ... approved to drive" email arrives for this trip.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock, Copy, FlaskConical, Loader2, MessageSquare, Share2, ShieldAlert, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { track } from "./track";

const ACCENT = "var(--trip-accent)";
type Drv = { id: number; name: string; state: "waiting" | "making" | "ready" | "added" | "ended" | "problem"; link?: string | null; expires_at?: string | null; approved_by?: string };
type Data = { drivers: Drv[]; turo_approved: string[] };

const rpc = <T,>(fn: string, args: Record<string, unknown>) =>
  supabase.rpc(fn as never, args as never) as unknown as Promise<{ data: T | null; error: { message: string } | null }>;

export const ackText = (name: string) =>
  `I added ${name || "this driver"} as an additional driver in the Turo app and Turo approved them. I understand only Turo-approved drivers are covered by Turo's protection. I won't let anyone else drive this car, and I'm responsible if an unapproved person does.`;

const STEPS = [
  <>Open the <b className="text-white">Turo app</b> → <b className="text-white">Trips</b> → tap this trip.</>,
  <>Find <b className="text-white">Drivers</b> (or "Additional drivers") → <b className="text-white">Add driver</b>.</>,
  <>Enter their email or phone. Turo texts them to make an account and verify their license.</>,
  <>Wait until Turo says they're <b className="text-white">approved to drive</b>. Usually minutes, sometimes longer.</>,
  <>Come back here and add them below. Their own key appears once Turo confirms.</>,
];

export default function ExtraDrivers({ token, ended, embedded }: { token: string; ended?: boolean; embedded?: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const demo = token.startsWith("demo-");  // host demo page: the whole flow runs locally

  const load = useCallback(async () => {
    if (token.startsWith("demo-")) { setData((d) => d ?? { drivers: [], turo_approved: [] }); return; }
    const { data } = await rpc<Data>("lax_guest_drivers", { p_token: token });
    if (data) setData(data);
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  // Keep checking while someone is waiting on Turo or their key is being made.
  const pending = data?.drivers.some((d) => d.state === "waiting" || d.state === "making");
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30000);
    return () => window.clearInterval(id);
  }, [pending, load]);

  const submit = async () => {
    setErr(null);
    if (name.trim().length < 2) { setErr("Enter their name as it shows in Turo."); return; }
    if (!ack) { setErr("Please confirm they're added and approved in Turo."); return; }
    setBusy(true);
    if (demo) {
      await new Promise((r) => setTimeout(r, 500));
      setBusy(false);
      setData((d) => ({ drivers: [...(d?.drivers ?? []), { id: Date.now(), name: name.trim(), state: "waiting" }], turo_approved: [] }));
      setName(""); setAck(false); setOpen(false);
      return;
    }
    const { data, error } = await rpc<Data>("lax_guest_driver_add", { p_token: token, p_name: name.trim(), p_ack: true, p_ack_text: ackText(name.trim()), p_device: navigator.userAgent.slice(0, 120) });
    setBusy(false);
    if (error) { setErr(error.message.replace(/^.*?: /, "")); return; }
    track(token, "driver_add", { name: name.trim() });
    if (data) setData(data);
    setName(""); setAck(false); setOpen(false);
  };
  const cancel = async (id: number) => {
    if (demo) { setData((d) => d && { ...d, drivers: d.drivers.filter((x) => x.id !== id) }); return; }
    const { data } = await rpc<Data>("lax_guest_driver_cancel", { p_token: token, p_id: id }); if (data) setData(data);
  };
  const demoStep = (id: number, state: Drv["state"], link?: string) => setData((d) => d && { ...d, drivers: d.drivers.map((x) => x.id === id ? { ...x, state, link: link ?? x.link } : x) });
  const shareText = (d: Drv) => `Hi ${d.name}! Here's your own Tesla key for our trip. Open it on your phone and tap Accept, signed in to your Tesla app: ${d.link}`;
  const share = async (d: Drv) => {
    if (!d.link) return;
    const text = shareText(d);
    track(token, "driver_share", { id: d.id });
    try { if (navigator.share) { await navigator.share({ title: "Tesla key", text }); return; } } catch { /* cancelled */ }
    try { await navigator.clipboard.writeText(d.link); setCopied(d.id); window.setTimeout(() => setCopied(null), 2500); } catch { /* ignore */ }
  };

  if (ended) return null;
  const drivers = data?.drivers ?? [];
  return (
    <section id="drivers" className={embedded ? "mt-5 scroll-mt-4 border-t border-white/10 pt-4" : "mt-6 scroll-mt-4 rounded-3xl bg-white/[0.06] p-4 ring-1 ring-white/10"}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>Extra drivers</p>
      <h3 className={`mt-1 font-bold leading-snug text-white ${embedded ? "text-[17px]" : "text-[20px]"}`} style={{ fontFamily: "var(--trip-title-font, 'Josefin Sans', Futura, 'Avenir Next', sans-serif)" }}>
        {drivers.length ? "Your drivers" : "Someone else driving?"}
      </h3>

      {drivers.length > 0 && (
        <ul className="mt-3 space-y-2">
          {drivers.map((d) => (
            <li key={d.id} className="rounded-2xl bg-black/20 p-3 ring-1 ring-white/10">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-white">
                  {d.state === "added" ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : d.state === "problem" ? <ShieldAlert className="h-4 w-4 text-red-300" />
                    : d.state === "ready" ? <Share2 className="h-4 w-4" style={{ color: ACCENT }} /> : <Clock className="h-4 w-4 text-white/60" />}
                  {d.name}
                </p>
                {d.state === "waiting" && <button type="button" onClick={() => void cancel(d.id)} aria-label={`Remove ${d.name}`} className="grid h-9 w-9 place-items-center rounded-full text-white/50 hover:text-white"><X className="h-4 w-4" /></button>}
              </div>
              <p className="mt-1 text-[13px] leading-relaxed text-white/70" aria-live="polite">
                {d.state === "waiting" && <>Waiting for Turo to confirm {d.name} is approved. Their key shows up here automatically, so no need to message.</>}
                {d.state === "making" && <>Turo approved {d.name}. Making their key now…</>}
                {d.state === "ready" && <>Send this to {d.name}. It's their own one-time key: they tap it and the car is added to <i>their</i> Tesla app.</>}
                {d.state === "added" && <>{d.name}'s phone is set up as a key.</>}
                {d.state === "ended" && <>Access ended with the trip.</>}
                {d.state === "problem" && <>Something went wrong making this key. Jared's been notified and will fix it.</>}
              </p>
              {d.state === "ready" && d.link && (
                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                  <a href={`sms:?&body=${encodeURIComponent(shareText(d))}`} onClick={() => track(token, "driver_share", { id: d.id, via: "sms" })}
                    className="flex h-12 items-center justify-center gap-2 rounded-2xl text-[15px] font-bold text-[#132726] active:scale-[0.99]" style={{ background: ACCENT }}>
                    <MessageSquare className="h-4 w-4" />Text {d.name} their key
                  </a>
                  <button type="button" onClick={() => void share(d)} aria-label={`More ways to send ${d.name} the key`} className="flex h-12 items-center justify-center gap-1.5 rounded-2xl bg-white/[0.09] px-4 text-[14px] font-semibold text-white ring-1 ring-white/15 active:scale-[0.99]">
                    {copied === d.id ? <><Copy className="h-4 w-4" />Copied</> : <><Share2 className="h-4 w-4" />Share</>}
                  </button>
                </div>
              )}
              {demo && d.state === "waiting" && (
                <button type="button" onClick={() => { demoStep(d.id, "making"); window.setTimeout(() => demoStep(d.id, "ready", "https://www.tesla.com/_rs/1/DEMO-KEY"), 1500); }}
                  className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-amber-300/60 text-[13px] font-semibold text-amber-200">
                  <FlaskConical className="h-4 w-4" />Demo: pretend Turo's approval email arrived
                </button>
              )}
              {demo && d.state === "ready" && (
                <button type="button" onClick={() => demoStep(d.id, "added")}
                  className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-amber-300/60 text-[13px] font-semibold text-amber-200">
                  <FlaskConical className="h-4 w-4" />Demo: pretend {d.name} accepted it
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!open ? (
        <>
          {!drivers.length && <p className="text-[15px] leading-relaxed text-white/80">Anyone else who drives must be <b className="text-white">added and approved in Turo first</b>. Then they get their own phone key here. Everyone drives with a phone key; there&apos;s no key card or remote unlock.</p>}
          <button type="button" onClick={() => { setOpen(true); track(token, "driver_open"); }} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white/[0.09] text-[15px] font-semibold text-white ring-1 ring-white/15 active:scale-[0.99]">
            <UserPlus className="h-5 w-5" style={{ color: ACCENT }} /> Add a driver
          </button>
        </>
      ) : (
        <div className="mt-3">
          <div className="flex gap-2 rounded-2xl bg-red-500/10 p-3 text-[13px] leading-relaxed text-red-100 ring-1 ring-red-300/25">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
            <p><b>Important:</b> Turo's protection only covers drivers Turo has approved on this trip. Anyone else driving isn't insured, and the renter is responsible for any damage.</p>
          </div>
          <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-white/60">First, in the Turo app</p>
          <ol className="mt-2 space-y-2.5">
            {STEPS.map((s, i) => (
              <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-white/80">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold text-[#132726]" style={{ background: ACCENT }}>{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
          <label htmlFor="xd-name" className="mt-5 block text-[13px] font-semibold text-white/80">Driver's name (as it shows in Turo)</label>
          <input id="xd-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={60} placeholder="e.g. Michael"
            className="mt-1.5 h-12 w-full rounded-xl bg-black/25 px-3 text-[16px] text-white ring-1 ring-white/15 placeholder:text-white/35 focus:outline-none focus:ring-2" />
          <label className="mt-4 flex cursor-pointer gap-3 rounded-2xl bg-black/20 p-3 ring-1 ring-white/10">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#E8A93A]" />
            <span className="text-[13px] leading-relaxed text-white/85">{ackText(name.trim())}</span>
          </label>
          {err && <p role="alert" className="mt-2 text-[13px] text-red-300">{err}</p>}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={() => { setOpen(false); setErr(null); }} className="h-12 flex-1 rounded-2xl text-[15px] font-semibold text-white/70 ring-1 ring-white/15">Cancel</button>
            <button type="button" onClick={() => void submit()} disabled={busy || !ack || name.trim().length < 2}
              className="flex h-12 flex-[2] items-center justify-center gap-2 rounded-2xl text-[15px] font-bold text-[#132726] disabled:opacity-40" style={{ background: ACCENT }}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}They're approved in Turo
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
