/**
 * The Settings sheet, one per Ava (the gear button in each page's top bar).
 *   Personal Ava: daily spend cap, morning brief (switch, time, preview), calendar hours and booking calendar, missed-call forwarding and its voice.
 *   RoofGuard Ava: daily spend cap.
 * Set-and-forget controls live here so the page itself shows only what changes day to day. Every control saves on its own and says so.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, Settings } from "lucide-react";
import { ScrollSheet } from "./AvaSheet";
import { SpendCapEditor, rpcArgs, type Source } from "./AvaShared";
import { CalendarSettingsControls } from "./AvaCalendars";
import { CellForwardingControls, CellSwitch } from "./AvaCell";

const ring = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";
const field = "min-h-[44px] w-full appearance-none rounded-xl bg-white/[0.06] px-3 text-[15px] text-white ring-1 ring-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

const from = (t: string) => supabase.from(t as never) as unknown as {
  select: (c: string) => { eq: (c: string, v: unknown) => { maybeSingle: () => PromiseLike<{ data: unknown; error: { message: string } | null }> } };
  update: (p: object) => { eq: (c: string, v: unknown) => PromiseLike<{ error: { message: string } | null }> };
};

/** 5:00 AM .. 11:00 AM in quarter hours; minutes after midnight, Pacific. The nbsp keeps "8:00 AM" on one line. */
const minuteLabel = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const MINUTES = Array.from({ length: 25 }, (_, i) => 300 + i * 15);

type Preview = { title: string; body: string; empty: boolean; calendar: "missing" | "cached" | "failed"; day: string; last: { day: string; status: string; at: string } | null };

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="border-t border-white/10 py-5 first:border-t-0 first:pt-0">
      <h3 className="text-[15px] font-semibold text-white">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-white/60">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function MorningBrief() {
  const [on, setOn] = useState<boolean | null>(null);
  const [minute, setMinute] = useState(480);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [prev, setPrev] = useState<Preview | null>(null);
  const [pbusy, setPbusy] = useState(false);
  const [perr, setPerr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await from("ava_settings").select("brief_enabled, brief_minute").eq("id", true).maybeSingle();
    if (error || !data) { setMsg({ ok: false, text: "Couldn't load the brief settings." }); return; }
    const d = data as { brief_enabled: boolean | null; brief_minute: number | null };
    setOn(d.brief_enabled !== false); setMinute(d.brief_minute ?? 480);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (patch: { brief_enabled?: boolean; brief_minute?: number }) => {
    setBusy(true); setMsg(null);
    const { error } = await from("ava_settings").update(patch).eq("id", true);
    setBusy(false);
    if (error) { setMsg({ ok: false, text: `Couldn't save that. ${error.message}` }); void load(); return; }
    setMsg({ ok: true, text: "Saved" }); setTimeout(() => setMsg(null), 2500);
  };

  const preview = async () => {
    setPbusy(true); setPerr(null);
    // fill tomorrow's calendar first, so the preview shows what the real brief will say
    const fill = await supabase.functions.invoke("ava-assistant", { body: { action: "today", day_offset: 1 } });
    const r = await rpcArgs<Preview>("admin_ava_brief_preview");
    setPbusy(false);
    if (r.error || !r.data) { setPerr(r.error?.message ?? "Couldn't build the preview."); return; }
    setPrev(r.data);
    if (fill.error || fill.data?.ok === false) setPerr("Her calendar didn't answer, so the preview may be missing tomorrow's events.");
  };

  if (on === null) return msg ? <p role="alert" className="text-sm text-red-300">{msg.text}</p> : <Loader2 className="mx-auto h-5 w-5 animate-spin text-white/50" aria-label="Loading" />;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p id="brief-switch" className="text-[15px] font-medium text-white">Send me a morning brief</p>
          <p className="mt-0.5 text-xs text-white/60">One push with your messages, call-backs, calendar and what needs you. It stays quiet on days with nothing to say.</p>
        </div>
        <CellSwitch on={on} busy={busy} labelledBy="brief-switch" onChange={(v) => { setOn(v); void save({ brief_enabled: v }); }} />
      </div>
      <div>
        <label htmlFor="brief-time" className="mb-1 block text-[13px] font-medium text-white">Send it at</label>
        <select id="brief-time" value={minute} disabled={busy || !on} onChange={(e) => { const m = Number(e.target.value); setMinute(m); void save({ brief_minute: m }); }} className={cn(field, "disabled:opacity-50")}>
          {MINUTES.map((m) => <option key={m} value={m} className="bg-[#1c1c1e]">{minuteLabel(m)}</option>)}
        </select>
        <p className="mt-1 text-xs text-white/60">Pacific time. If it runs more than 15{" "}minutes late you get an alert.</p>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={cn("inline-flex items-center gap-1.5 text-sm", msg.ok ? "text-emerald-300" : "text-red-300")}>
        {msg.ok ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}{msg.text}</p>}
      <div>
        <button type="button" onClick={() => void preview()} disabled={pbusy}
          className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/10 px-4 text-[15px] font-medium text-white hover:bg-white/15 disabled:opacity-50", ring)}>
          {pbusy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Preview tomorrow's brief</button>
        {perr && <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{perr}</p>}
        {prev && (
          <div className="mt-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10" aria-live="polite">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-white/55">{prev.title}</p>
            {prev.empty
              ? <p className="mt-1 text-sm text-white/70">Nothing to say tomorrow, so no push would go out.</p>
              : <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-white">{prev.body}</p>}
            {prev.last && <p className="mt-2 text-xs text-white/55">Last brief ({prev.last.day}): {prev.last.status === "sent" ? "sent" : prev.last.status === "skipped" ? "skipped, nothing to say" : "failed"}.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export function AvaSettingsSheet({ source, open, onOpenChange }: { source: Source; open: boolean; onOpenChange: (o: boolean) => void }) {
  const personal = source === "ava";
  return (
    <ScrollSheet open={open} onClose={() => onOpenChange(false)} title={<><Settings className="h-5 w-5 text-white/70" aria-hidden />{personal ? "Ava settings" : "RoofGuard Ava settings"}</>}
      description={personal ? "Things you set once. Each one saves as you change it." : "Limits for the RoofGuard line. Each one saves as you change it."}>
      <div className="pb-4">
        <Group title="Spending" hint="Her outgoing calls stop for the day at this amount.">
          <SpendCapEditor source={source} />
        </Group>
        {personal && (
          <>
            <Group title="Morning brief"><MorningBrief /></Group>
            <Group title="Calendar" hint="When she may offer times, and where booked meetings go."><CalendarSettingsControls /></Group>
            <Group title="Missed calls on your cell"><CellForwardingControls /></Group>
          </>
        )}
      </div>
    </ScrollSheet>
  );
}

/** The gear in each page's top bar. 44px, icon plus the word "Settings" so it is never a mystery icon. */
export function SettingsButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog"
      className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-2xl bg-white/[0.04] px-3.5 text-[15px] font-medium text-white/85 ring-1 ring-white/10 transition hover:bg-white/[0.08] motion-reduce:transition-none", ring, className)}>
      <Settings className="h-4 w-4" aria-hidden /><span>Settings</span>
    </button>
  );
}
