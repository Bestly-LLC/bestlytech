/**
 * "Calendars" card on /admin/ava (personal Ava only).
 * Ava reads your iCloud and Nextcloud calendars to find open times ("Find times" on a message) and writes a booked meeting to the one
 * Nextcloud calendar you mark "Ava books here". She sees free or busy only, never what an event is.
 *   Logins     typed here, sent straight to the vault by an admin-only database function, never shown again. A saved login only ever
 *              shows as "Connected". Nextcloud already has Bestly's login on file, so it works without typing anything.
 *   Calendars  every calendar the login can see, each with an include switch. Turned-off calendars are ignored.
 *   Hours      the days and hours she may offer (default weekdays, 9:00 AM to 6:00 PM Pacific).
 *   Turo       a Turo trip only blocks a window around each pickup and each return, not the days between.
 */
import { useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { AlertTriangle, CalendarDays, Check, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { invokeError } from "./AvaActions";
import { calChanged, useCalStatus, type CalHours, type CalProvider, type CalProviderStatus } from "./avaCal";
import { agoText } from "./AvaShared";
import { CollapsibleSection } from "./CollapsibleSection";

const rpc = () => supabase.rpc.bind(supabase) as unknown as (f: string, a: object) => Promise<{ error: { message: string } | null }>;
const hour12 = (h: number) => (h === 0 || h === 24 ? "12:00\u00a0AM" : h === 12 ? "12:00\u00a0PM" : h > 12 ? `${h - 12}:00\u00a0PM` : `${h}:00\u00a0AM`);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NAME: Record<CalProvider, string> = { nextcloud: "Nextcloud", icloud: "iCloud" };
const input = "h-11 w-full rounded-xl bg-white/[0.05] px-3 text-[15px] text-white outline-none ring-1 ring-white/10 placeholder:text-white/40 focus:ring-white/25";
const btn = "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 text-[15px] font-medium transition motion-safe:active:scale-[0.98] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60";

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className="grid min-h-[44px] min-w-[56px] shrink-0 place-items-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40">
      <span className={cn("relative block h-[31px] w-[51px] rounded-full transition-colors", on ? "bg-[#FFA270]" : "bg-white/20")}>
        <span className={cn("absolute left-0 top-[2px] block h-[27px] w-[27px] rounded-full bg-white shadow transition-transform", on ? "translate-x-[22px]" : "translate-x-[2px]")} />
      </span>
    </button>
  );
}

function StatusLine({ p, name, fallback }: { p: CalProviderStatus; name: string; fallback?: ReactNode }) {
  if (!p.connected) return <span className="text-sm text-white/60">{fallback ?? "Not connected"}</span>;
  if (p.checked && !p.checked.ok) return <span className="inline-flex items-center gap-1.5 text-sm text-red-300"><AlertTriangle className="h-4 w-4" aria-hidden />Can't read {name}: {p.checked.error ?? "login failed"}</span>;
  if (p.checked?.ok) return <span className="inline-flex items-center gap-1.5 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4" aria-hidden />Connected · checked {agoText(p.checked.at)}</span>;
  return <span className="text-sm text-white/60">Saved, not checked yet</span>;
}

export function AvaCalendars({ className }: { className?: string }) {
  const { status, error, reload } = useCalStatus();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  // login fields live only in this component's state; they are cleared the moment they are saved
  const [icUser, setIcUser] = useState(""); const [icPass, setIcPass] = useState("");
  const [ncUser, setNcUser] = useState(""); const [ncPass, setNcPass] = useState("");
  const [ncOverride, setNcOverride] = useState(false);

  const call = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key); setMsg(null);
    const { data, error: e } = await supabase.functions.invoke("ava-assistant", { body });
    setBusy(null);
    if (e || !data?.ok) { setMsg({ t: "err", m: await invokeError(e, data, "That didn't work. Try again in a minute.") }); calChanged(); return false; }
    setMsg({ t: "ok", m: ok }); calChanged(); return true;
  };
  const saveLogin = async (p: CalProvider, user: string, pass: string) => {
    if (!user.trim() || !pass.trim()) { setMsg({ t: "err", m: "Fill in both fields." }); return; }
    setBusy(`login-${p}`); setMsg(null);
    const names = p === "icloud" ? ["ava_caldav_icloud_user", "ava_caldav_icloud_pass"] : ["ava_caldav_nextcloud_user", "ava_caldav_nextcloud_pass"];
    const a = await rpc()("ava_cal_secret_put", { p_name: names[0], p_value: user.trim() });
    const b = a.error ? a : await rpc()("ava_cal_secret_put", { p_name: names[1], p_value: pass.trim() });
    if (p === "icloud") { setIcUser(""); setIcPass(""); } else { setNcUser(""); setNcPass(""); setNcOverride(false); }
    if (b.error) { setBusy(null); setMsg({ t: "err", m: "Couldn't save the login. Try again." }); return; }
    const { data, error: e } = await supabase.functions.invoke("ava-assistant", { body: { action: "cal_test", provider: p } });
    setBusy(null); calChanged();
    if (e || !data?.ok) { setMsg({ t: "err", m: `Saved, but ${NAME[p]} didn't accept it. ${await invokeError(e, data, "Check the login and try again.")}` }); return; }
    setMsg({ t: "ok", m: `${NAME[p]} is connected. ${(data.calendars ?? []).length} calendars found.` });
  };

  if (!status) {
    return (
      <CollapsibleSection id="ava-calendars" anchorId="ava-calendars" title="Calendars" icon={<CalendarDays className="h-4 w-4 text-[#FFA270]" />} summary={error ? "Couldn't load" : "Loading…"} className={className}>
        <div className="px-4 py-4">
          {error ? <p role="alert" className="text-sm text-red-300">{error} <button type="button" onClick={reload} className="min-h-[44px] underline">Retry</button></p>
            : <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-white/50" aria-label="Loading" /></div>}
        </div>
      </CollapsibleSection>
    );
  }

  const selected = new Set(status.selected);
  const toggleCal = async (id: string, on: boolean) => {
    const next = on ? [...selected, id] : [...selected].filter((x) => x !== id);
    await call("sel", { action: "cal_save", selected: next }, "Saved.");
  };

  const Calendars = ({ p, provider }: { p: CalProviderStatus; provider: CalProvider }) => (
    p.calendars.length === 0 ? null : (
      <ul className="mt-2 divide-y divide-white/5 rounded-2xl bg-white/[0.03] ring-1 ring-white/10">
        {p.calendars.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 pr-1">
            <span className="min-w-0 flex-1 py-2 text-[15px] text-white">{c.name}</span>
            {status.book_to === c.id && <span className="inline-flex min-h-[44px] items-center gap-1 px-2 text-[13px] font-semibold text-[#FFA270]"><Check className="h-4 w-4" aria-hidden />Ava books here</span>}
            <Switch on={selected.has(c.id)} onChange={(v) => void toggleCal(c.id, v)} label={`Use ${c.name} to find free times`} disabled={busy !== null} />
          </li>
        ))}
      </ul>
    )
  );

  const ticked = [...status.nextcloud.calendars, ...status.icloud.calendars].filter((c) => selected.has(c.id)).map((c) => c.name);
  const summary = (
    <>
      {ticked.length ? `${ticked.slice(0, 2).join(", ")}${ticked.length > 2 ? ` +${ticked.length - 2}` : ""}` : "No calendars ticked"}
      {" · "}
      <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", status.find_times.ok ? "text-emerald-300" : "text-amber-300")}>
        {status.find_times.ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}{status.find_times.ok ? "OK" : "Needs attention"}</span>
    </>
  );
  const badge = (
    <span className={cn("hidden items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline-flex", status.find_times.ok ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300")}>
      {status.find_times.ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}{status.find_times.ok ? "Find times is on" : "Find times is off"}</span>
  );

  return (
    <CollapsibleSection id="ava-calendars" anchorId="ava-calendars" title="Calendars" icon={<CalendarDays className="h-4 w-4 text-[#FFA270]" />} summary={summary} badge={badge} className={className}>
      <div className="space-y-5 px-4 py-4">
        <p className="text-sm text-white/70">Ava reads these to find open times for you. She sees only free or busy, never what an event is. Nothing is booked until you tap a time.</p>
        {!status.find_times.ok && status.find_times.reason && <p role="status" className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/25">{status.find_times.reason}</p>}

        {/* Nextcloud */}
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h4 className="text-[15px] font-semibold text-white">Nextcloud <span className="font-normal text-white/55">· cloud.bestly.tech</span></h4>
            <StatusLine p={status.nextcloud} name="Nextcloud" fallback="Not connected. Add a login below." />
          </div>
          {status.nextcloud.shared_login && <p className="mt-1 text-xs text-white/55">Using Bestly's existing Nextcloud login. Nothing to type.</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void call("test-nextcloud", { action: "cal_test", provider: "nextcloud" }, "Nextcloud is connected.")} disabled={busy !== null || !status.nextcloud.connected} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>
              {busy === "test-nextcloud" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}{status.nextcloud.calendars.length ? "Check again" : "Connect and find calendars"}</button>
            <button type="button" onClick={() => setNcOverride((v) => !v)} className={cn(btn, "text-white/65 hover:bg-white/5")}>{ncOverride ? "Hide login" : "Use a different login"}</button>
          </div>
          {ncOverride && (
            <form className="mt-2 grid gap-2" onSubmit={(e) => { e.preventDefault(); void saveLogin("nextcloud", ncUser, ncPass); }} autoComplete="off">
              <input value={ncUser} onChange={(e) => setNcUser(e.target.value)} className={input} placeholder="Nextcloud username" aria-label="Nextcloud username" autoComplete="off" autoCapitalize="none" spellCheck={false} />
              <input value={ncPass} onChange={(e) => setNcPass(e.target.value)} type="password" className={input} placeholder="Nextcloud app password" aria-label="Nextcloud app password" autoComplete="new-password" />
              <button type="submit" disabled={busy !== null} className={cn(btn, "bg-[#FFA270] font-semibold text-[#1c1c1e] hover:bg-[#ffb48a]")}>
                {busy === "login-nextcloud" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save login</button>
            </form>
          )}
          <Calendars p={status.nextcloud} provider="nextcloud" />
        </div>

        {/* iCloud */}
        <div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h4 className="text-[15px] font-semibold text-white">iCloud</h4>
            <StatusLine p={status.icloud} name="iCloud" fallback="Not connected" />
          </div>
          {!status.icloud.connected ? (
            <>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-white/70">
                <li>Open Apple's account page and sign in.</li>
                <li>Go to Sign-In and Security, then App-Specific Passwords, and make one named "Ava".</li>
                <li>Paste your Apple ID and that password here. Your real Apple password is never used.</li>
              </ol>
              <a href="https://appleid.apple.com/account/manage" target="_blank" rel="noopener noreferrer"
                className={cn(btn, "mt-2 bg-white/10 text-white hover:bg-white/15")}><ExternalLink className="h-4 w-4" aria-hidden />Open appleid.apple.com</a>
              <form className="mt-2 grid gap-2" onSubmit={(e) => { e.preventDefault(); void saveLogin("icloud", icUser, icPass); }} autoComplete="off">
                <input value={icUser} onChange={(e) => setIcUser(e.target.value)} className={input} placeholder="Apple ID (your email)" aria-label="Apple ID" inputMode="email" autoComplete="off" autoCapitalize="none" spellCheck={false} />
                <input value={icPass} onChange={(e) => setIcPass(e.target.value)} type="password" className={input} placeholder="App-specific password (xxxx-xxxx-xxxx-xxxx)" aria-label="App-specific password" autoComplete="new-password" />
                <button type="submit" disabled={busy !== null} className={cn(btn, "bg-[#FFA270] font-semibold text-[#1c1c1e] hover:bg-[#ffb48a]")}>
                  {busy === "login-icloud" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Connect iCloud</button>
              </form>
            </>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void call("test-icloud", { action: "cal_test", provider: "icloud" }, "iCloud is connected.")} disabled={busy !== null} className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>
                {busy === "test-icloud" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}Check again</button>
              <button type="button" onClick={() => void call("disc-icloud", { action: "cal_disconnect", provider: "icloud" }, "iCloud is disconnected.")} disabled={busy !== null} className={cn(btn, "text-white/65 hover:bg-white/5")}>Disconnect</button>
            </div>
          )}
          <Calendars p={status.icloud} provider="icloud" />
        </div>

        {msg && <p role={msg.t === "err" ? "alert" : "status"} className={cn("text-sm", msg.t === "err" ? "text-red-300" : "text-emerald-300")}>{msg.m}</p>}
      </div>
    </CollapsibleSection>
  );
}

/**
 * The set-and-forget calendar choices, shown in Settings (not on the Calendars card): which days and hours Ava may offer, how long a Turo
 * trip blocks around pickup and return, and which Nextcloud calendar she writes booked meetings to.
 */
export function CalendarSettingsControls() {
  const { status, error, reload } = useCalStatus();
  const [hours, setHours] = useState<CalHours | null>(null);
  const [turo, setTuro] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  if (!status) return error ? <p role="alert" className="text-sm text-red-300">{error} <button type="button" onClick={reload} className="min-h-[44px] underline">Retry</button></p>
    : <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-white/50" aria-label="Loading calendar settings" /></div>;
  const h = hours ?? status.hours;
  const turoVal = turo ?? status.turo_window_min;
  const hoursChanged = !!hours && JSON.stringify(hours) !== JSON.stringify(status.hours);
  const selected = new Set(status.selected);
  const writable = status.nextcloud.calendars.filter((c) => c.writable && selected.has(c.id));
  const save = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key); setMsg(null);
    const { data, error: e } = await supabase.functions.invoke("ava-assistant", { body });
    setBusy(null);
    if (e || !data?.ok) { setMsg({ t: "err", m: await invokeError(e, data, "That didn't work. Try again in a minute.") }); calChanged(); return false; }
    setMsg({ t: "ok", m: ok }); calChanged(); return true;
  };
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="ava-book-to" className="mb-1 block text-[13px] font-medium text-white">Ava books here</label>
        <select id="ava-book-to" value={status.book_to ?? ""} disabled={busy !== null}
          onChange={(e) => void save("book", { action: "cal_save", book_to: e.target.value || null }, e.target.value ? "Ava will add booked meetings to that calendar." : "Ava won't add anything to a calendar.")}
          className={cn(input, "appearance-none")}>
          <option value="" className="bg-[#1c1c1e]">Nowhere (she only offers times)</option>
          {writable.map((c) => <option key={c.id} value={c.id} className="bg-[#1c1c1e]">{c.name}</option>)}
        </select>
        <p className="mt-1 text-xs text-white/55">{writable.length ? "Only Nextcloud calendars you turned on can take a booking." : "Turn on a Nextcloud calendar in the Calendars section to pick one."}</p>
      </div>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-[13px] font-medium text-white">When she can offer times</legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
          {DAYS.map((d, i) => {
            const on = h.days.includes(i);
            return <button key={d} type="button" aria-pressed={on} onClick={() => setHours({ ...h, days: on ? h.days.filter((x) => x !== i) : [...h.days, i].sort() })}
              className={cn("min-h-[44px] min-w-[48px] rounded-xl px-3 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60", on ? "bg-[#FFA270] text-[#1c1c1e]" : "bg-white/[0.07] text-white/70 ring-1 ring-white/10")}>{d}</button>;
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block"><span className="mb-1 block text-xs text-white/60">From</span>
            <select value={h.start} onChange={(e) => setHours({ ...h, start: Number(e.target.value), end: Math.max(h.end, Number(e.target.value) + 1) })} className={cn(input, "appearance-none")}>
              {Array.from({ length: 24 }, (_, i) => <option key={i} value={i} className="bg-[#1c1c1e]">{hour12(i)}</option>)}</select></label>
          <label className="block"><span className="mb-1 block text-xs text-white/60">Until</span>
            <select value={h.end} onChange={(e) => setHours({ ...h, end: Number(e.target.value) })} className={cn(input, "appearance-none")}>
              {Array.from({ length: 24 }, (_, i) => i + 1).filter((i) => i > h.start).map((i) => <option key={i} value={i} className="bg-[#1c1c1e]">{hour12(i)}</option>)}</select></label>
        </div>
        <p className="text-xs text-white/55">Pacific time. Times are never offered sooner than an hour and a half from now.</p>
        <label className="block"><span className="mb-1 block text-xs text-white/60">Turo trips block this long around each pickup and each return</span>
          <select value={turoVal} onChange={(e) => setTuro(Number(e.target.value))} className={cn(input, "appearance-none")}>
            {[0, 30, 60, 90, 120].map((m) => <option key={m} value={m} className="bg-[#1c1c1e]">{m === 0 ? "Don't block Turo trips" : `${m}\u00a0minutes before and after`}</option>)}</select></label>
        <p className="text-xs text-white/55">The days in between stay free. Ava gets pickup and return times from Turo Watch, from any calendar named Turo, and from any event with "Turo" in it.</p>
        <button type="button" disabled={busy !== null || (!hoursChanged && turoVal === status.turo_window_min) || h.days.length === 0}
          onClick={() => void save("hours", { action: "cal_save", hours: h, turo_window_min: turoVal }, "Saved.").then((ok) => { if (ok) { setHours(null); setTuro(null); } })}
          className={cn(btn, "bg-white/10 text-white hover:bg-white/15")}>{busy === "hours" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Save hours</button>
      </fieldset>
      {msg && <p role={msg.t === "err" ? "alert" : "status"} className={cn("text-sm", msg.t === "err" ? "text-red-300" : "text-emerald-300")}>{msg.m}</p>}
    </div>
  );
}
