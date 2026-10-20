import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { ActionMenu } from "@/components/admin/ActionMenu";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Panel } from "@/components/admin/homeHub/shared";
import { Segmented, TAP } from "@/components/admin/kitchen/Segmented";
import { pollInterval } from "@/lib/polling";
import { Lines } from "@/components/Lines";
import { cn } from "@/lib/utils";
import { DoorOpen, Loader2, PartyPopper, Plus, RefreshCw, X } from "lucide-react";

// Ava's door line. Everything lives in Supabase: callbox_settings, callbox_expected, callbox_events, callbox_* RPCs.

type Mode = "smart" | "ask" | "party" | "off";
type Kind = "delivery" | "guest" | "other";

interface Settings {
  enabled: boolean; mode: Mode; unit_code: string | null; open_digit: string | null; caller_ids: string[] | null;
  party_until: string | null; ask_timeout_sec: number | null; last_selftest_at: string | null; last_selftest_ok: boolean | null;
}
interface Expected {
  id: string; label: string; kind: Kind; window_start: string; window_end: string; keywords: string[] | null;
  auto_open: boolean; uses: number | null; max_uses: number | null; source: string | null; note: string | null;
}
interface DoorEvent {
  id: string; code: string; caller: string | null; known_callbox: boolean | null; visitor_said: string | null;
  decision: string | null; status: string | null; outcome: string | null; created_at: string; decided_at: string | null;
}
interface State { settings: Settings | null; expected: Expected[]; events: DoorEvent[] }

const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args?: object) => Promise<{ data: unknown; error: { message: string } | null }>;

const TZ = "America/Los_Angeles";
const nb = (s: string) => s.replace(/ /g, " ");
const clock = (iso: string | number | Date) => nb(new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }));
const dayKey = (d: Date) => d.toLocaleDateString("en-US", { timeZone: TZ });
/** "3:05 PM" today, "Mon 3:05 PM" this week, "Oct 12, 3:05 PM" older. */
function when(iso: string | number | Date, nowMs: number) {
  const d = new Date(iso);
  const age = nowMs - d.getTime();
  if (dayKey(d) === dayKey(new Date(nowMs))) return clock(d);
  if (age < 6 * 86_400_000 && age > -6 * 86_400_000) return nb(`${d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short" })} ${clock(d)}`);
  return nb(`${d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" })}, ${clock(d)}`);
}
const minutesWord = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} hr` : `${m} min`);

const MODES: { key: Mode; label: string; blurb: string }[] = [
  { key: "smart", label: "Smart", blurb: "Opens for what you're expecting, asks you for anyone else." },
  { key: "ask", label: "Always ask", blurb: "Ava asks you every time before the door opens." },
  { key: "party", label: "Party", blurb: "Everyone gets in until a time you pick." },
  { key: "off", label: "Off", blurb: "Ava leaves the callbox alone." },
];

const KINDS: { key: Kind; label: string }[] = [
  { key: "delivery", label: "Delivery" },
  { key: "guest", label: "Guest" },
  { key: "other", label: "Other" },
];
const KIND_WORD: Record<Kind, string> = { delivery: "Delivery", guest: "Guest", other: "Other" };

const LENGTHS: { key: string; label: string; minutes: number | "today" }[] = [
  { key: "30", label: "30 min", minutes: 30 },
  { key: "60", label: "1 hr", minutes: 60 },
  { key: "120", label: "2 hr", minutes: 120 },
  { key: "240", label: "4 hr", minutes: 240 },
  { key: "today", label: "Today", minutes: "today" },
];

const QUICK: { label: string; kind: Kind; keywords: string[] }[] = [
  { label: "DoorDash", kind: "delivery", keywords: ["doordash", "door dash"] },
  { label: "Uber Eats", kind: "delivery", keywords: ["uber eats", "ubereats"] },
  { label: "Amazon", kind: "delivery", keywords: ["amazon"] },
  { label: "Instacart", kind: "delivery", keywords: ["instacart"] },
  { label: "A friend", kind: "guest", keywords: [] },
];

const SOURCE_WORD: Record<string, string> = {
  manual: "Added by you", email: "From your email", calendar: "From your calendar", turo: "From Turo", sms: "From a text",
};
const sourceWord = (s: string | null) => (s ? SOURCE_WORD[s] ?? `From ${s.replace(/_/g, " ")}` : "Added by you");

/** Friendly words for a door event. The backend's decision/status/outcome are terse; this is what Jared reads. */
function doorWords(e: DoorEvent): { text: string; tone: "good" | "bad" | "warn" | "quiet" } {
  const d = (e.decision ?? "").toLowerCase();
  const s = (e.status ?? "").toLowerCase();
  const o = (e.outcome ?? "").toLowerCase();
  if (s === "pending") return { text: "Waiting for you", tone: "warn" };
  if (d === "auto_open" || d === "expected") return { text: "Opened (expected)", tone: "good" };
  if (d === "party") return { text: "Opened (party)", tone: "good" };
  if (s === "expired" || o.includes("expired") || o.includes("message")) return { text: "No answer, took a message", tone: "warn" };
  if (s === "deny" || o.includes("denied") || o.includes("said no") || o.includes("sent off")) return { text: "You said no", tone: "quiet" };
  if (s === "open" || s === "done") return { text: o.includes("opened by") || d === "ask" || !d ? "You opened it" : "Opened", tone: "good" };
  const raw = d || s || "Unknown";
  return { text: raw.charAt(0).toUpperCase() + raw.slice(1).replace(/_/g, " "), tone: "quiet" };
}
const TONE: Record<string, string> = {
  good: "bg-emerald-500/15 text-emerald-200", bad: "bg-red-500/15 text-red-200", warn: "bg-amber-500/15 text-amber-200", quiet: "bg-white/[0.08] text-white/75",
};

/** A time of day ("21:30") becomes the next time that clock reads that, as an ISO string. */
function nextClock(hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= Date.now() + 30_000) d.setDate(d.getDate() + 1);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 0, 0);
  return d;
}
const hhmmOf = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

const fieldCls = "h-11 sm:h-10 text-base sm:text-sm bg-white/[0.04] border-white/[0.08]";
const chipCls = cn(TAP, "min-h-11 sm:min-h-9 whitespace-nowrap rounded-full border border-white/[0.12] bg-white/[0.03] px-3.5 text-sm font-medium text-white/85 hover:bg-white/[0.08] disabled:opacity-50 motion-safe:active:scale-[0.97] motion-safe:transition-transform");

export default function HomeHubCallbox() {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);

  // Party picker (local until he starts it, so tapping "Party" never opens the door by itself).
  const [picking, setPicking] = useState(false);
  const [partyTime, setPartyTime] = useState("");

  // Add form
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Kind>("delivery");
  const [later, setLater] = useState(false);
  const [startTime, setStartTime] = useState("");
  const [length, setLength] = useState("60");
  const [keywords, setKeywords] = useState("");
  const [adding, setAdding] = useState(false);
  const [digit, setDigit] = useState("");

  const load = useCallback(async () => {
    const { data: d, error: e } = await rpc("callbox_admin_state");
    if (e) setError(e.message.includes("admin only") ? "This page is only for the Bestly admin." : e.message);
    else { setData(d as State); setError(null); }
    setNow(Date.now());
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
    const iv = setInterval(() => { if (document.visibilityState === "visible") void load(); }, pollInterval(15_000));
    return () => clearInterval(iv);
  }, [load]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const s = data?.settings ?? null;
  useEffect(() => { if (s?.open_digit != null) setDigit(String(s.open_digit)); }, [s?.open_digit]);

  const save = useCallback(async (patch: Record<string, unknown>, ok?: string) => {
    setSaving(true);
    const { error: e } = await rpc("callbox_settings_set", { p: patch });
    setSaving(false);
    if (e) { toast.error(`Didn't save: ${e.message}`); return false; }
    if (ok) toast.success(ok);
    await load();
    return true;
  }, [load]);

  const partyLive = !!s && s.mode === "party" && !!s.party_until && Date.parse(s.party_until) > now;
  const shownMode: Mode = picking ? "party" : s?.mode ?? "smart";

  const onMode = (m: string) => {
    if (!s || saving) return;
    if (m === "party") { setPicking(true); if (!partyTime) setPartyTime(hhmmOf(new Date(Date.now() + 2 * 3_600_000))); return; }
    setPicking(false);
    void save({ mode: m, party_until: "" });
  };
  const startParty = async (until: Date) => {
    const ok = await save({ mode: "party", party_until: until.toISOString() }, `Party on until ${clock(until)}`);
    if (ok) setPicking(false);
  };

  const health = useMemo(() => {
    if (!s?.last_selftest_at) return { ok: null as boolean | null, text: "Ava hasn't checked the door line yet." };
    const t = when(s.last_selftest_at, now);
    return s.last_selftest_ok === false
      ? { ok: false, text: `Ava's last check of the door line failed at ${t}.` }
      : { ok: true, text: `Ava checked the door line at ${t}.` };
  }, [s?.last_selftest_at, s?.last_selftest_ok, now]);

  const upcoming = useMemo(
    () => (data?.expected ?? []).filter((x) => !x.window_end || Date.parse(x.window_end) > now),
    [data?.expected, now],
  );

  const lengthMinutes = (key: string): number | "today" => LENGTHS.find((l) => l.key === key)?.minutes ?? 60;

  const addExpected = async (o: { label: string; kind: Kind; keywords: string[] }) => {
    const start = later ? nextClock(startTime) ?? new Date() : new Date();
    const lm = lengthMinutes(length);
    const end = lm === "today" ? endOfToday() : new Date(start.getTime() + lm * 60_000);
    if (lm === "today" && end.getTime() <= start.getTime()) end.setTime(start.getTime() + 60 * 60_000);
    setAdding(true);
    const { error: e } = await rpc("callbox_expect_add", {
      p_label: o.label, p_kind: o.kind, p_start: start.toISOString(), p_end: end.toISOString(),
      p_keywords: o.keywords, p_source: "manual", p_source_ref: null, p_note: null, p_max_uses: null,
    });
    setAdding(false);
    if (e) { toast.error(`Couldn't add ${o.label}: ${e.message}`); return false; }
    toast.success(`Expecting ${o.label} until ${clock(end)}`);
    await load();
    return true;
  };

  const onAdd = async (ev: FormEvent) => {
    ev.preventDefault();
    const l = label.trim();
    if (!l || adding) return;
    const kw = keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
    if (await addExpected({ label: l, kind, keywords: kw })) { setLabel(""); setKeywords(""); }
  };

  const cancel = async (x: Expected) => {
    setData((d) => d && { ...d, expected: d.expected.filter((e) => e.id !== x.id) });
    const { error: e } = await rpc("callbox_expect_cancel", { p_id: x.id });
    if (e) toast.error(`Couldn't cancel ${x.label}: ${e.message}`);
    else toast.success(`Cancelled ${x.label}`);
    void load();
  };

  const removeCaller = (n: string) => {
    const next = (s?.caller_ids ?? []).filter((c) => c !== n);
    void save({ caller_ids: next }, "Number removed");
  };

  const digitDirty = !!s && digit !== String(s.open_digit ?? "");
  const digitValid = /^[0-9*#]$/.test(digit);

  if (!loaded) {
    return (
      <div className="space-y-6" aria-busy="true">
        <PageHeader title="Callbox" description="Ava answers the building callbox." />
        <Skeleton className="h-40 rounded-2xl bg-white/[0.05]" />
        <Skeleton className="h-56 rounded-2xl bg-white/[0.05]" />
      </div>
    );
  }
  if (error || !data || !s) {
    return (
      <div className="space-y-6">
        <PageHeader title="Callbox" description="Ava answers the building callbox." />
        <EmptyState icon={DoorOpen} title="Couldn't load the callbox" description={error ?? "No settings found."} action={<Button onClick={load}>Try again</Button>} />
      </div>
    );
  }

  const modeBlurb = MODES.find((m) => m.key === shownMode)?.blurb ?? "";

  return (
    <div className="relative space-y-6">
      <div className="absolute right-0 top-0 sm:hidden">
        <ActionMenu label="More callbox actions" className="h-11 w-11" items={[{ label: "Refresh now", icon: RefreshCw, onSelect: load }]} />
      </div>
      <PageHeader
        title="Callbox"
        description="Owner: Ava. She answers the building callbox and holds the visitor until you say."
        actions={<ActionMenu label="More callbox actions" className="hidden sm:inline-flex" items={[{ label: "Refresh now", icon: RefreshCw, onSelect: load }]} />}
      />

      {/* 1. Status */}
      <Panel title="Status">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="cb-enabled" className="text-base font-medium text-white">Ava answers the callbox</Label>
              <p className="mt-0.5 text-sm text-white/60">{s.enabled ? "On" : "Off. Visitors ring through to nobody."}</p>
            </div>
            <Switch id="cb-enabled" checked={s.enabled} disabled={saving} onCheckedChange={(v) => void save({ enabled: v }, v ? "Ava is answering" : "Ava stopped answering")} />
          </div>

          <div className={cn(!s.enabled && "opacity-50")}>
            <Segmented
              label="Mode" value={shownMode} onChange={onMode} dense className="w-full sm:w-auto"
              options={MODES.map((m) => ({ key: m.key, label: m.label }))}
            />
            <p className="mt-2 text-sm text-white/65"><Lines>{modeBlurb}</Lines></p>

            {shownMode === "party" && (
              <div className="mt-3 space-y-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200">
                {partyLive && !picking && s.party_until && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white"><PartyPopper className="mr-1.5 inline h-4 w-4" aria-hidden />Everyone gets in until {clock(s.party_until)}.</p>
                    <div className="flex gap-2">
                      <button type="button" className={chipCls} onClick={() => setPicking(true)}>Change time</button>
                      <button type="button" className={chipCls} disabled={saving} onClick={() => void save({ mode: "smart", party_until: "" }, "Party over")}>End party</button>
                    </div>
                  </div>
                )}
                {picking && (
                  <>
                    <p className="text-sm font-medium text-white">Everyone gets in until</p>
                    <div className="flex flex-wrap gap-2" role="group" aria-label="Quick party lengths">
                      {[1, 2, 4].map((h) => (
                        <button key={h} type="button" disabled={saving} className={chipCls} onClick={() => void startParty(new Date(Date.now() + h * 3_600_000))}>{h}{" "}hr</button>
                      ))}
                      <button type="button" disabled={saving} className={chipCls} onClick={() => void startParty(endOfToday())}>Tonight</button>
                    </div>
                    <div className="flex items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <Label htmlFor="cb-party-time" className="text-xs text-white/60">Or pick a time</Label>
                        <Input id="cb-party-time" type="time" value={partyTime} onChange={(e) => setPartyTime(e.target.value)} className={cn(fieldCls, "mt-1")} />
                      </div>
                      <Button disabled={saving || !nextClock(partyTime)} className="h-11 sm:h-10 shrink-0"
                        onClick={() => { const d = nextClock(partyTime); if (d) void startParty(d); }}>
                        {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <PartyPopper className="mr-1.5 h-4 w-4" aria-hidden />}
                        Start party
                      </Button>
                    </div>
                    <button type="button" className="text-sm text-white/60 underline-offset-2 hover:text-white hover:underline" onClick={() => setPicking(false)}>Cancel</button>
                  </>
                )}
              </div>
            )}
          </div>

          <p className={cn("flex items-start gap-2 text-sm", health.ok === false ? "text-amber-200" : "text-white/65")} role="status">
            <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", health.ok === true ? "bg-emerald-400" : health.ok === false ? "bg-amber-400" : "bg-white/30")} />
            <span><Lines>{health.text}</Lines></span>
          </p>
        </div>
      </Panel>

      {/* 2. Expecting */}
      <Panel title="Expecting">
        {upcoming.length === 0 ? (
          <p className="text-sm text-white/65"><Lines>Nothing expected. Add a delivery or a guest below and Ava will open the door for them.</Lines></p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {upcoming.map((x) => (
              <li key={x.id} className="flex items-start gap-3 py-3 first:pt-0">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium text-white">{x.label}</p>
                  <p className="mt-0.5 text-sm text-white/65">
                    {KIND_WORD[x.kind] ?? x.kind} · <span className="whitespace-nowrap">{when(x.window_start, now)}</span> to <span className="whitespace-nowrap">{when(x.window_end, now)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-white/55">
                    {sourceWord(x.source)}
                    {x.max_uses ? <> · <span className="whitespace-nowrap">{x.uses ?? 0} of {x.max_uses} used</span></> : null}
                    {!x.auto_open ? " · Asks you first" : ""}
                  </p>
                </div>
                <button type="button" onClick={() => void cancel(x)} aria-label={`Cancel ${x.label}`}
                  className={cn(TAP, "-my-1 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full bg-white/[0.06] px-3.5 text-sm font-medium text-white/80 hover:bg-white/[0.12] motion-safe:active:scale-[0.97] motion-safe:transition-transform")}>
                  <X className="h-4 w-4" aria-hidden />Cancel
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 border-t border-white/[0.08] pt-4">
          <p className="text-sm font-semibold text-white">Add someone you're expecting</p>
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-white/60">For how long (also used by the quick buttons)</p>
            <Segmented label="Length" value={length} onChange={setLength} dense className="w-full sm:w-auto" options={LENGTHS.map((l) => ({ key: l.key, label: l.label }))} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Quick add">
            {QUICK.map((q) => (
              <button key={q.label} type="button" disabled={adding} className={chipCls} onClick={() => void addExpected({ label: q.label, kind: q.kind, keywords: q.keywords })}>
                <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />{q.label}
              </button>
            ))}
          </div>

          <form onSubmit={onAdd} className="mt-4 space-y-3">
            <div>
              <Label htmlFor="cb-label" className="text-xs text-white/60">Who or what</Label>
              <Input id="cb-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} placeholder="Sam, pizza, plumber" autoComplete="off" className={cn(fieldCls, "mt-1")} />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-white/60">Kind</p>
              <Segmented label="Kind" value={kind} onChange={(v) => setKind(v as Kind)} className="w-full sm:w-auto" options={KINDS} />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-white/60">Starts</p>
              <Segmented label="Start" value={later ? "later" : "now"} onChange={(v) => { setLater(v === "later"); if (v === "later" && !startTime) setStartTime(hhmmOf(new Date(Date.now() + 3_600_000))); }}
                className="w-full sm:w-auto" options={[{ key: "now", label: "Now" }, { key: "later", label: "Later today" }]} />
              {later && <Input type="time" aria-label="Start time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={cn(fieldCls, "mt-2 sm:w-40")} />}
            </div>
            <div>
              <Label htmlFor="cb-kw" className="text-xs text-white/60">Words they might say (optional, separate with commas)</Label>
              <Input id="cb-kw" value={keywords} onChange={(e) => setKeywords(e.target.value)} maxLength={200} placeholder="sam, pizza" autoComplete="off" className={cn(fieldCls, "mt-1")} />
            </div>
            <Button type="submit" disabled={adding || !label.trim()} className="h-11 w-full sm:h-10 sm:w-auto motion-safe:active:scale-[0.97] motion-safe:transition-transform">
              {adding ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden />}
              Add
            </Button>
          </form>
        </div>
      </Panel>

      {/* 3. Door log */}
      <Panel title="Door log">
        {data.events.length === 0 ? (
          <p className="text-sm text-white/65"><Lines>No one has rung yet.</Lines></p>
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {data.events.map((e) => {
              const w = doorWords(e);
              return (
                <li key={e.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="break-words text-sm text-white/90">{e.visitor_said?.trim() ? `“${e.visitor_said.trim()}”` : "Didn't say who"}</p>
                    <p className="mt-0.5 text-xs text-white/55"><span className="whitespace-nowrap">{when(e.created_at, now)}</span></p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-right text-xs font-medium", TONE[w.tone])}>{w.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* 4. Small settings */}
      <Panel title="Settings">
        <div className="space-y-5">
          <div>
            <Label htmlFor="cb-digit" className="text-sm font-medium text-white">Open digit</Label>
            <p className="mt-0.5 text-xs text-white/60"><Lines>The key Ava presses on the callbox to open the door.</Lines></p>
            <div className="mt-2 flex items-center gap-2">
              <Input id="cb-digit" value={digit} onChange={(e) => setDigit(e.target.value.slice(0, 1))} inputMode="numeric" maxLength={1} className={cn(fieldCls, "w-16 text-center")} />
              <Button variant="secondary" disabled={!digitDirty || !digitValid || saving} className="h-11 sm:h-10" onClick={() => void save({ open_digit: digit }, `Ava will press ${digit}`)}>Save</Button>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-white">Callbox numbers Ava has learned</p>
            {(s.caller_ids ?? []).length === 0 ? (
              <p className="mt-1 text-sm text-white/65"><Lines>None yet. Ava learns one each time you open the door and leave the box checked.</Lines></p>
            ) : (
              <ul className="mt-1 divide-y divide-white/[0.06]">
                {(s.caller_ids ?? []).map((n) => (
                  <li key={n} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="whitespace-nowrap font-mono text-sm text-white/85">{n}</span>
                    <button type="button" disabled={saving} onClick={() => removeCaller(n)} aria-label={`Remove ${n}`}
                      className={cn(TAP, "inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-white/70 hover:bg-white/[0.08] hover:text-white disabled:opacity-50")}>
                      <X className="h-4 w-4" aria-hidden />Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">Unit code</p>
              <p className="mt-0.5 text-xs text-white/60">What visitors dial on the callbox.</p>
            </div>
            <span className="whitespace-nowrap font-mono text-base text-white">{s.unit_code ?? "Not set"}</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
