/**
 * Partner portal -> Ava -> Meetings. Eli connects Google Calendar once; each meeting Ava booked can then go on his
 * calendar (the meeting with a Meet link, plus a private prep brief 15 minutes before) with one tap.
 * Edge fn partner-google does the Google work; this only shows state and asks. Times are 12-hour, in the lead's zone.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AlertTriangle, CalendarPlus, CheckCircle2, Loader2, Video } from "lucide-react";
import { useKpis, type Kpis } from "@/components/admin/roofguard/AvaScorecard";
import { DEFAULT_TZ, formatMeeting, fromLocalInput, parseMeetingTime, toLocalInput } from "@/lib/meetingTime";

type Booked = Kpis["booked_list"][number];
type Status = { connected: boolean; email: string | null; needs_reconnect: boolean };
type Done = { text: string; url: string | null };

const BTN = "inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-40";
const QUIET = "inline-flex min-h-[2.75rem] items-center rounded-lg px-2 text-sm text-white/65 underline-offset-2 hover:text-white hover:underline disabled:opacity-40";

/** "Tue, Oct 14 at 2:00 PM CDT" with the clock part kept on one line. */
function When({ iso, tz }: { iso: string; tz: string }) {
  const [day, time] = formatMeeting(iso, tz).split(" at ");
  return <>{day} at <span className="whitespace-nowrap">{time}</span></>;
}

/** Tomorrow, 10:00 AM, in the lead's zone: where the picker starts when there is nothing better. */
function fallbackGuess(tz: string): string {
  const t = new Date(Date.now() + 86_400_000);
  const day = toLocalInput(t, tz).slice(0, 10);
  return `${day}T10:00`;
}

export function AvaMeetings() {
  const { k, err, reload } = useKpis(30000);
  const [conf, setConf] = useState<boolean | null>(null);        // is Google set up on our side
  const [st, setSt] = useState<Status | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, Done>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});

  const loadStatus = useCallback(async () => {
    const [rpc, fn] = await Promise.all([
      (supabase.rpc as unknown as (f: string) => Promise<{ data: Status[] | null }>)("partner_google_status"),
      supabase.functions.invoke("partner-google", { body: { action: "status" } }),
    ]);
    setSt(rpc.data?.[0] ?? { connected: false, email: null, needs_reconnect: false });
    setConf(fn.error ? false : fn.data?.configured !== false);
  }, []);
  useEffect(() => {
    void loadStatus();
    const onVis = () => { if (!document.hidden) void loadStatus(); };   // back from the Google tab
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadStatus]);

  const connect = async () => {
    setConnecting(true); setNote(null);
    const w = window.open("", "_blank");                              // opened now so phones do not block it
    const { data, error } = await supabase.functions.invoke("partner-google", { body: { action: "start" } });
    setConnecting(false);
    if (error || !data?.ok || !data.url) {
      w?.close();
      if (data?.configured === false) setConf(false);
      else setNote("Could not start the Google connection. Try again in a minute.");
      return;
    }
    if (w) w.location.href = data.url; else window.location.assign(data.url);
  };

  const disconnect = async () => {
    setConnecting(true);
    await supabase.functions.invoke("partner-google", { body: { action: "disconnect" } });
    setConnecting(false); void loadStatus(); void reload();
  };

  const add = async (b: Booked, startIso: string) => {
    setBusy(b.call_id); setFailed((f) => { const n = { ...f }; delete n[b.call_id]; return n; });
    const { data, error } = await supabase.functions.invoke("partner-google", { body: { action: "book", call_id: b.call_id, start_at: startIso, duration_min: 30 } });
    setBusy(null);
    if (error || !data?.ok) {
      let msg = data?.message as string | undefined;
      if (!msg && error && "context" in error) msg = await (error as { context: Response }).context.json().then((j) => j.message).catch(() => undefined);
      setFailed((f) => ({ ...f, [b.call_id]: msg ?? "The meeting did not reach your calendar. Try again in a minute." }));
      if (data?.code === "reconnect") void loadStatus();
      return;
    }
    setEditing(null);
    setDone((d) => ({ ...d, [b.call_id]: { text: data.updated ? "Calendar updated." : "Added to your calendar.", url: data.meet_url ?? null } }));
    void reload();
  };

  const connected = !!st?.connected && !st.needs_reconnect;

  return (
    <div className="space-y-4">
      {/* connection */}
      <section className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10 bento:bg-[var(--bento-well)]" aria-label="Google Calendar">
        {conf === null || st === null ? (
          <div className="h-12 animate-pulse rounded-xl bg-white/[0.04]" aria-label="Loading" />
        ) : conf === false ? (
          <div>
            <div className="text-[0.9375rem] font-semibold text-white">Google Calendar</div>
            <p className="mt-1 text-sm text-white/60">Not set up yet.</p>
          </div>
        ) : st.connected && st.needs_reconnect ? (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-amber-500/10 p-4 ring-1 ring-amber-400/30">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-300" aria-hidden />
            <p className="min-w-[200px] flex-1 text-sm text-amber-100">Ava can't add meetings to your calendar until you reconnect Google. It takes a few seconds.</p>
            <button type="button" onClick={() => void connect()} disabled={connecting} className={cn(BTN, "bg-amber-400 text-[#2B1D00]")}>
              {connecting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Reconnect Google Calendar</button>
          </div>
        ) : st.connected ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <CheckCircle2 className="h-5 w-5 text-emerald-300" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-white/85">Connected as <b className="text-white">{st.email ?? "your Google account"}</b></span>
            <button type="button" onClick={() => void disconnect()} disabled={connecting} className={QUIET}>Disconnect</button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-[200px] flex-1 text-sm text-white/70">Connect your Google Calendar once. Then each meeting Ava books can go on it with a Google Meet link, plus a private prep note 15 minutes before.</p>
            <button type="button" onClick={() => void connect()} disabled={connecting} className={cn(BTN, "bg-emerald-500 text-[#052E1F]")}>
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />}Connect Google Calendar</button>
          </div>
        )}
        {note && <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{note}</p>}
      </section>

      {/* meetings */}
      {err && <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load your meetings. Pull down to refresh in a minute.</div>}
      {!k && !err && <div className="h-32 animate-pulse rounded-3xl bg-white/[0.03] ring-1 ring-white/10" aria-label="Loading meetings" />}
      {k && k.booked_list.length === 0 && (
        <p className="rounded-3xl bg-white/[0.03] p-5 text-sm text-white/60 ring-1 ring-white/10">No meetings yet. They show up here the moment Ava books one.</p>
      )}
      {k && k.booked_list.length > 0 && (
        <ul className="space-y-3">
          {k.booked_list.map((b) => {
            const tz = b.timezone || DEFAULT_TZ;
            const onCal = !!b.cal_event_id && !!b.cal_start_at;
            const parsed = parseMeetingTime(b.meeting_times, tz, new Date(), new Date(b.booked_at));
            const isEditing = editing === b.call_id;
            const value = picked[b.call_id] ?? toLocalInput(onCal ? b.cal_start_at! : parsed.start_at ?? fallbackGuess(tz), tz);
            const pickedIso = fromLocalInput(value, tz);
            const contact = [b.dm_name, b.dm_title].filter(Boolean).join(", ");
            const working = busy === b.call_id;
            const ok = done[b.call_id];
            const askToPick = isEditing || (!onCal && parsed.confidence === "low");
            return (
              <li key={b.call_id} className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10 bento:bg-[var(--bento-well)]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[0.9375rem] font-semibold text-white">{b.company}</span>
                  <span className="text-xs text-white/60">{b.state}</span>
                </div>
                {contact && <div className="text-xs text-white/60">{contact}</div>}

                {onCal && !isEditing && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                    <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden />
                    <span className="min-w-0 flex-1 text-sm text-white/85"><When iso={b.cal_start_at!} tz={tz} /></span>
                    {b.cal_meet_url && (
                      <a href={b.cal_meet_url} target="_blank" rel="noreferrer" className={cn(BTN, "bg-sky-500/20 text-sky-200 ring-1 ring-sky-400/30")}>
                        <Video className="h-4 w-4" aria-hidden />Join</a>
                    )}
                    <button type="button" className={QUIET} onClick={() => { setEditing(b.call_id); setDone((d) => { const n = { ...d }; delete n[b.call_id]; return n; }); }}>Change time</button>
                  </div>
                )}

                {!onCal && !askToPick && parsed.start_at && (
                  <p className="mt-3 text-sm text-white/85">Proposed: <b className="text-white"><When iso={parsed.start_at} tz={tz} /></b></p>
                )}
                {askToPick && (
                  <div className="mt-3 space-y-2">
                    {!onCal && b.meeting_times && <p className="text-sm text-white/70">They said: <span className="text-white">{b.meeting_times}</span></p>}
                    <label className="block">
                      <span className="mb-1 block text-xs text-white/60">Date and time <span className="whitespace-nowrap">({formatMeeting(pickedIso ?? new Date(), tz).split(" ").pop()})</span></span>
                      <input type="datetime-local" value={value} onChange={(e) => setPicked((p) => ({ ...p, [b.call_id]: e.target.value }))}
                        className="h-[3.25rem] w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[1.0625rem] tabular-nums text-white outline-none focus:border-white/30 [color-scheme:dark]" />
                    </label>
                  </div>
                )}

                {(!onCal || isEditing) && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {connected ? (
                      <button type="button" disabled={working || (askToPick && !pickedIso)} onClick={() => { const s = askToPick ? pickedIso : parsed.start_at; if (s) void add(b, s); }}
                        className={cn(BTN, "bg-emerald-500 text-[#052E1F]")}>
                        {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarPlus className="h-4 w-4" aria-hidden />}
                        {working ? "Adding…" : isEditing ? "Update calendar" : "Add to my calendar"}</button>
                    ) : (
                      <p className="text-sm text-white/60">{st?.needs_reconnect ? "Reconnect Google Calendar above to add this." : conf === false ? "" : "Connect Google Calendar above to add this."}</p>
                    )}
                    {!onCal && !askToPick && <button type="button" className={QUIET} onClick={() => setEditing(b.call_id)}>Pick a different time</button>}
                    {isEditing && <button type="button" className={QUIET} onClick={() => setEditing(null)} disabled={working}>Cancel</button>}
                  </div>
                )}

                {!b.meeting_email && <p className="mt-2 text-xs text-white/55">No email from them, so no invite goes to them. It still goes on your calendar.</p>}
                {ok && !isEditing && (
                  <p role="status" className="mt-3 flex flex-wrap items-center gap-x-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" aria-hidden />{ok.text}{ok.url && !onCal && <a href={ok.url} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">Join</a>}</p>
                )}
                {failed[b.call_id] && <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{failed[b.call_id]}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
