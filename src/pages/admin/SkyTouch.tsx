/**
 * /admin/skytouch: SkyTouch controls (team slugs skytouch-triage, skytouch-morning). Migration 20261011050000_skytouch_pi.sql.
 * SkyTouch moved off two Claude scheduled tasks onto the Pi (free, no AI). Everything ships PAUSED. This page is the only
 * place that switches it on: a master switch, one switch per job, and the two things that let the bot act on its own
 * (the first hello to a brand-new inquiry, and the morning text to Jared). Gmail and calendar logins are saved write-only
 * into Vault (skytouch_connect): the page can read when they were saved, never the value.
 *
 * Talks only to the admin RPCs skytouch_admin / skytouch_set / skytouch_connect / skytouch_card_close.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, Check, CheckCircle2, CircleAlert, Copy, Loader2, PauseCircle, Server, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section, Segmented, Sheet, Switch, btnPlain, btnPrimary, btnTinted, card, field, label, pill, secondary, tertiary, tint } from "./laxUi";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
const nw = "whitespace-nowrap";

type Job = {
  job: "skytouch_triage" | "skytouch_morning"; label: string; runs_on: string; cost: string; schedule: string; what: string; on: boolean;
  next_tick: string; last_run_at: string | null; last_ok: boolean | null; last_summary: string | null; replaces: string;
};
type Card = {
  id: string; kind: "intake_draft" | "intake_sent" | "needs_approval" | "flagged" | "stale" | "calendar_gap" | "availability";
  client_number: string | null; client_name: string | null; ask: string | null; why: string | null; suggested_reply: string | null;
  fits_hours: boolean | null; jared_said: string | null; status: string; created_at: string;
};
type Brief = { generated_at?: string; calendar?: string; days?: { label: string; items: { time: string; title: string }[] }[]; ask_note?: string; gaps?: number } | null;
type Admin = {
  settings: { master_enabled: boolean; triage_enabled: boolean; morning_enabled: boolean; auto_first_reply: boolean; morning_text_jared: boolean; stale_hours: number };
  jobs: Job[];
  connection: { gmail_at: string | null; calendar_at: string | null; gmail_ready: boolean; calendar_ready: boolean };
  availability: { date: string | null; text: string | null };
  brief: Brief;
  counts: { new?: number; at?: string } | null;
  cards: Card[];
};
type SetArgs = Partial<{ p_master: boolean; p_triage: boolean; p_morning: boolean; p_auto_first_reply: boolean; p_morning_text_jared: boolean; p_stale_hours: number }>;

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const phone = (n: string | null) => {
  const d = (n ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : n ?? "";
};
const KIND: Record<Card["kind"], { t: string; c: string }> = {
  needs_approval: { t: "Needs your yes", c: pill.orange },
  intake_draft: { t: "First hello, ready", c: pill.blue },
  intake_sent: { t: "First hello failed", c: pill.orange },
  flagged: { t: "Flagged, nothing sent", c: pill.orange },
  stale: { t: "Too old to answer", c: pill.orange },
  calendar_gap: { t: "Not on calendar", c: pill.blue },
  availability: { t: "Availability", c: pill.blue },
};

export default function SkyTouch() {
  const [a, setA] = useState<Admin | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<null | "auto" | "text">(null);
  const [pw, setPw] = useState("");
  const [urls, setUrls] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await rpc("skytouch_admin");
    if (error) toast.error(error.message); else setA(data as Admin);
  }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 30000); return () => window.clearInterval(id); }, [load]);

  const set = async (args: SetArgs, done?: string) => {
    setBusy(true);
    const { data, error } = await rpc("skytouch_set", args as Record<string, unknown>);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setA(data as Admin);
    if (done) toast.success(done);
  };
  const connect = async () => {
    setSaving(true);
    const { error } = await rpc("skytouch_connect", { p_gmail_app_password: pw || null, p_calendar_urls: urls || null });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    setPw(""); setUrls(""); toast.success("Saved. It never shows here again."); void load();
  };
  const close = async (id: string, status: "done" | "dismissed") => {
    const { error } = await rpc("skytouch_card_close", { p_id: id, p_status: status });
    if (error) toast.error(error.message); else void load();
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("Copied"); } catch { toast.error("Could not copy"); }
  };

  if (!a) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 pb-16 sm:px-0">
        <PageHeader title="SkyTouch" description="Front desk for the massage practice" />
        <Loader2 className="h-5 w-5 animate-spin text-white/50" aria-label="Loading" />
      </div>
    );
  }

  const s = a.settings;
  const [triage, morning] = [a.jobs.find((j) => j.job === "skytouch_triage"), a.jobs.find((j) => j.job === "skytouch_morning")];
  const waiting = a.cards.filter((c) => c.status === "open" && ["needs_approval", "intake_draft"].includes(c.kind)).length;
  const staleOpts = Array.from(new Set([6, 12, 24, 48, s.stale_hours])).sort((x, y) => x - y);

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pb-16 sm:px-0">
      <PageHeader title="SkyTouch" description="Front desk for the massage practice. Runs on the Pi, free, no AI." />

      <section className={cn(card, !s.master_enabled && "ring-1 ring-[#FF9F0A66] bento:ring-[#FF950066]")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p role="status" className={cn("text-[17px] font-semibold", label)}>{s.master_enabled ? "SkyTouch is running" : "SkyTouch is paused"}</p>
            <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
              {s.master_enabled
                ? "Each job below runs only if its own switch is on too."
                : "Nothing reads your texts, nothing is sent, and no alerts fire. The old Claude tasks stay switched off as the fallback."}
            </p>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", nw, s.master_enabled ? pill.green : pill.orange)}>
            {s.master_enabled ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <PauseCircle className="h-3.5 w-3.5" aria-hidden />}
            {s.master_enabled ? "On" : "Paused"}
          </span>
        </div>
        <div className="mt-3">
          <Switch checked={s.master_enabled} disabled={busy} onChange={(v) => void set({ p_master: v }, v ? "SkyTouch resumed" : "SkyTouch paused")}
            label="Master switch" detail="Off stops every SkyTouch job at once. It is the first thing each job checks." />
        </div>
        {waiting > 0 && (
          <p className={cn("mt-2 flex items-start gap-1.5 text-[13px]", tint.orange)}>
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span><span className={nw}>{waiting} {waiting === 1 ? "client is" : "clients are"}</span> waiting on you, listed at the bottom.</span>
          </p>
        )}
      </section>

      <Section title="Jobs" footer="Both jobs live on the Pi and cost nothing: plain rules, no AI, so no client text is ever sent to a model.">
        {[triage, morning].map((j) => j && (
          <section key={j.job} className={card} aria-label={j.label}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={cn("text-[17px] font-semibold", label)}>{j.label}</p>
                <p className={cn("mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px]", secondary)}>
                  <Server className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className={nw}>Runs on the {j.runs_on}</span><span aria-hidden>·</span><span className={nw}>{j.cost}</span><span aria-hidden>·</span><span className={nw}>{j.schedule}</span>
                </p>
              </div>
              <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", nw, j.on ? pill.green : pill.orange)}>
                {j.on ? "Running" : "Paused"}
              </span>
            </div>
            <p className={cn("mt-2 text-[14px] leading-snug", label)}>{j.what}</p>

            <div className="mt-3">
              <Switch checked={j.job === "skytouch_triage" ? s.triage_enabled : s.morning_enabled} disabled={busy}
                onChange={(v) => void set(j.job === "skytouch_triage" ? { p_triage: v } : { p_morning: v })}
                label={`${j.label} on`} detail={s.master_enabled ? undefined : "Stays paused until the master switch is on."} />
              {j.job === "skytouch_triage" && (
                <>
                  <Switch checked={s.auto_first_reply} disabled={busy}
                    onChange={(v) => (v ? setConfirm("auto") : void set({ p_auto_first_reply: false }, "First hello is back to a draft"))}
                    label="Send the first hello by itself"
                    detail="Off: the hello waits as a draft card. On: a brand-new inquiry gets one fixed hello. Nothing else is ever sent without you." />
                  <div className="py-2">
                    <p className={cn("text-[15px]", label)}>Too old to answer after</p>
                    <p className={cn("mb-1.5 mt-0.5 text-[13px]", secondary)}>A text older than this is flagged, never answered.</p>
                    <Segmented ariaLabel="Stale window" value={String(s.stale_hours)} onChange={(v) => void set({ p_stale_hours: Number(v) })}
                      options={staleOpts.map((h) => ({ value: String(h), label: `${h} hr` }))} />
                  </div>
                </>
              )}
              {j.job === "skytouch_morning" && (
                <Switch checked={s.morning_text_jared} disabled={busy}
                  onChange={(v) => (v ? setConfirm("text") : void set({ p_morning_text_jared: false }, "Morning text is off"))}
                  label="Text me each morning for my hours"
                  detail="Sends one fixed question to your own cell only, never to a client. Off: it still reads the calendar and checks for gaps." />
              )}
            </div>

            <dl className={cn("mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]", secondary)}>
              <dt>Next check</dt>
              <dd className={label}><span className={nw}>{stamp(j.next_tick)}</span>{!j.on && <span className={secondary}> (will skip while paused)</span>}</dd>
              <dt>Last run</dt>
              <dd className={label}>
                {j.last_run_at
                  ? <><span className={nw}>{stamp(j.last_run_at)}</span>{j.last_summary ? <span className={j.last_ok === false ? tint.orange : secondary}>{`. ${j.last_summary}`}</span> : null}</>
                  : <span className={secondary}>Has not run yet. It starts once the Pi has the job installed.</span>}
              </dd>
              <dt>Replaces</dt>
              <dd className={label}>{j.replaces}, now switched off</dd>
            </dl>
          </section>
        ))}
      </Section>

      <Section title="Connection" footer="Saved write-only in Supabase Vault. The values never come back to this page; only the time they were saved does.">
        <section className={card}>
          <div className="space-y-4">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn("text-[15px] font-semibold", label)}>Gmail app password</p>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", nw, a.connection.gmail_ready ? pill.green : pill.orange)}>
                  {a.connection.gmail_ready ? `Saved ${a.connection.gmail_at ? stamp(a.connection.gmail_at) : ""}` : "Not connected yet"}
                </span>
              </div>
              <p className={cn("mb-2 mt-0.5 text-[13px] leading-snug", secondary)}>
                For jareds.mac@gmail.com, where Google Voice forwards client texts. Create it at myaccount.google.com/apppasswords (16 letters). Until it is saved, both jobs say &quot;Gmail not connected yet&quot; and do nothing.
              </p>
              <input className={field} type="password" autoComplete="off" spellCheck={false} placeholder="abcd efgh ijkl mnop" value={pw} onChange={(e) => setPw(e.target.value)} aria-label="Gmail app password" />
            </div>
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn("text-[15px] font-semibold", label)}>Calendar addresses <span className={cn("font-normal", secondary)}>(optional)</span></p>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", nw, a.connection.calendar_ready ? pill.green : pill.orange)}>
                  {a.connection.calendar_ready ? `Saved ${a.connection.calendar_at ? stamp(a.connection.calendar_at) : ""}` : "Not connected yet"}
                </span>
              </div>
              <p className={cn("mb-2 mt-0.5 text-[13px] leading-snug", secondary)}>
                One per line. In Google Calendar: Settings, your calendar, &quot;Secret address in iCal format&quot;. Read only. Without these the morning check skips the calendar part.
              </p>
              <textarea className={cn(field, "min-h-[88px] resize-y font-mono text-[13px]")} spellCheck={false} placeholder="https://calendar.google.com/calendar/ical/your-address/basic.ics" value={urls} onChange={(e) => setUrls(e.target.value)} aria-label="Calendar addresses" />
            </div>
            <button type="button" className={cn(btnPrimary, nw)} disabled={saving || (!pw && !urls)} onClick={() => void connect()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}Save to Vault
            </button>
          </div>
        </section>
      </Section>

      <Section title="Today">
        <section className={card}>
          <p className={cn("text-[13px]", secondary)}>Your hours today</p>
          <p className={cn("mt-0.5 text-[15px]", label)}>
            {a.availability.text && a.availability.date ? <>{a.availability.text} <span className={cn("text-[13px]", secondary)}>({a.availability.date})</span></> : "Nothing from you yet today. Text your open hours and the front desk picks them up."}
          </p>
          {a.counts?.at && <p className={cn("mt-2 text-[13px]", secondary)}>Last text check <span className={nw}>{a.counts.at}</span>: {a.counts.new ?? 0} new {a.counts.new === 1 ? "thread" : "threads"}.</p>}
          {a.brief?.days && a.brief.days.length > 0 && (
            <div className="mt-4 border-t border-[#38383A] pt-3 bento:border-[#C6C6C8]">
              <p className={cn("flex items-center gap-1.5 text-[15px] font-semibold", label)}><CalendarDays className="h-4 w-4" aria-hidden />Next 7 days</p>
              {a.brief.calendar && a.brief.calendar !== "ok" && <p className={cn("mt-1 text-[13px]", tint.orange)}>Calendar: {a.brief.calendar}.</p>}
              <ul className="mt-2 space-y-2">
                {a.brief.days.filter((d) => d.items.length > 0).map((d) => (
                  <li key={d.label}>
                    <p className={cn("text-[13px] font-semibold", label)}>{d.label}</p>
                    <ul className={cn("mt-0.5 space-y-0.5 text-[13px]", secondary)}>
                      {d.items.map((it, i) => <li key={i}><span className={nw}>{it.time}</span> · {it.title}</li>)}
                    </ul>
                  </li>
                ))}
                {a.brief.days.every((d) => d.items.length === 0) && <li className={cn("text-[13px]", secondary)}>Nothing booked.</li>}
              </ul>
              {a.brief.generated_at && <p className={cn("mt-2 text-xs", tertiary)}>Brief made at <span className={nw}>{a.brief.generated_at}</span>.</p>}
            </div>
          )}
        </section>
      </Section>

      <Section title="Waiting on you" footer="Nothing here has been sent. A suggested reply is a draft: send it from your own phone, then tap Done.">
        {a.cards.length === 0 ? (
          <section className={card}><p className={cn("text-[15px]", secondary)}>All clear. No client is waiting.</p></section>
        ) : a.cards.map((c) => (
          <section key={c.id} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={cn("text-[15px] font-semibold", label)}>
                {c.client_name || "Unknown name"} <span className={cn("font-normal", nw, secondary)}>{phone(c.client_number)}</span>
              </p>
              <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold", nw, KIND[c.kind]?.c ?? pill.blue)}>{KIND[c.kind]?.t ?? c.kind}</span>
            </div>
            {c.ask && <p className={cn("mt-2 whitespace-pre-wrap break-words text-[15px] leading-snug", label)}>{c.ask}</p>}
            {c.why && <p className={cn("mt-1.5 text-[13px] leading-snug", secondary)}>{c.why}</p>}
            {c.fits_hours != null && (
              <p className={cn("mt-1.5 flex items-center gap-1.5 text-[13px]", c.fits_hours ? tint.green : tint.orange)}>
                {c.fits_hours ? <Check className="h-4 w-4" aria-hidden /> : <X className="h-4 w-4" aria-hidden />}
                {c.fits_hours ? "That time fits your hours today." : "That time is outside your hours today."}
              </p>
            )}
            {c.jared_said && <p className={cn("mt-1.5 text-[13px]", secondary)}>You texted: {c.jared_said}</p>}
            {c.suggested_reply && (
              <div className="mt-3 rounded-[14px] bg-[#2C2C2E] p-3 bento:bg-[#7676801f]">
                <p className={cn("text-[11px] uppercase tracking-wide", secondary)}>Suggested reply</p>
                <p className={cn("mt-0.5 whitespace-pre-wrap break-words text-[15px] leading-snug", label)}>{c.suggested_reply}</p>
                <button type="button" className={cn(btnPlain, "mt-1")} aria-label={`Copy the suggested reply for ${c.client_name || phone(c.client_number)}`} onClick={() => void copy(c.suggested_reply ?? "")}><Copy className="h-4 w-4" aria-hidden />Copy</button>
              </div>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className={cn(btnTinted, nw)} aria-label={`Mark ${c.client_name || phone(c.client_number)} done`} onClick={() => void close(c.id, "done")}><Check className="h-4 w-4" aria-hidden />Done</button>
              <button type="button" className={cn(btnPlain, nw)} aria-label={`Dismiss ${c.client_name || phone(c.client_number)}`} onClick={() => void close(c.id, "dismissed")}>Dismiss</button>
              <span className={cn("ml-auto text-xs", nw, tertiary)}>{stamp(c.created_at)}</span>
            </div>
          </section>
        ))}
      </Section>

      <Sheet open={confirm === "auto"} onClose={() => setConfirm(null)} title="Send the first hello by itself?"
        footer={<div className="flex flex-wrap gap-2"><button type="button" className={btnPrimary} onClick={() => { setConfirm(null); void set({ p_auto_first_reply: true }, "First hello is automatic"); }}>Turn on</button><button type="button" className={btnTinted} onClick={() => setConfirm(null)}>Cancel</button></div>}>
        <p className={cn("text-[15px] leading-snug", label)}>When a brand-new inquiry arrives with no service or time in it, the Pi texts back one fixed hello asking which service and 60 or 90 minutes.</p>
        <p className={cn("mt-2 text-[13px] leading-snug", secondary)}>It never sends the address, a price, or anything else. Every other text waits for your yes. It sends at most once per thread, ever.</p>
      </Sheet>
      <Sheet open={confirm === "text"} onClose={() => setConfirm(null)} title="Text you each morning?"
        footer={<div className="flex flex-wrap gap-2"><button type="button" className={btnPrimary} onClick={() => { setConfirm(null); void set({ p_morning_text_jared: true }, "Morning text is on"); }}>Turn on</button><button type="button" className={btnTinted} onClick={() => setConfirm(null)}>Cancel</button></div>}>
        <p className={cn("text-[15px] leading-snug", label)}>At 8:11 AM the Pi texts your own cell once: &quot;What&apos;s your availability today?&quot; Your reply becomes today&apos;s hours.</p>
        <p className={cn("mt-2 text-[13px] leading-snug", secondary)}>It can only reply on your own thread and refuses any other number.</p>
      </Sheet>
    </div>
  );
}
