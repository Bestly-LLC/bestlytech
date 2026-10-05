/**
 * /admin/roofguard - RoofGuard caller, Phase 1: the lead list and the phone finder.
 *
 * Data: rg_leads (1,161 companies from Jared's RoofGuard sheet, admin-only RLS), rg_stats() for the
 * health card, rg_kick() for "Find now". The finder is edge fn roofguard-enrich (pg_cron every 5 min);
 * its watchdog is rg_watch() (every 10 min, raises roofguard.enrich to Scout). See bestly_memory
 * roofguard/caller-agent/plan.
 *
 * Calling rule shown on the page: a number is dialable only once its line type is verified as a
 * landline or VoIP (Phase 2). Scraped numbers stay "unverified" until then.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { AvaOrb } from "@/components/admin/roofguard/AvaOrb";
import { VoiceSwitcher } from "@/components/admin/roofguard/VoiceSwitcher";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, ExternalLink, Loader2, Phone, RefreshCw, Search, Zap } from "lucide-react";
import { AvaCalls } from "@/components/admin/roofguard/AvaCalls";
import { AvaScorecard, AvaScoreStrip } from "@/components/admin/roofguard/AvaScorecard";
import { AvaCoach } from "@/components/admin/roofguard/AvaCoach";
import { onOpenCall, onOpenCoach } from "@/components/admin/roofguard/coachBus";
import { AvaTopBar } from "@/components/admin/roofguard/AvaDialer";
import { AvaSettingsSheet } from "@/components/admin/roofguard/AvaSettings";
import { VoicePicker } from "@/components/admin/roofguard/AvaVoice";

type Tab = "calls" | "scorecard" | "coach" | "leads" | "setup";
const TABS: { id: Tab; label: string }[] = [{ id: "calls", label: "Calls" }, { id: "scorecard", label: "Scorecard" }, { id: "coach", label: "Coach" }, { id: "leads", label: "Leads" }, { id: "setup", label: "Setup" }];
const hashTab = (): Tab => { const h = window.location.hash.slice(1); return (TABS.some((t) => t.id === h) ? h : "calls") as Tab; };

/** iOS-style segmented control */
function Segmented({ value, onChange }: { value: Tab; onChange: (t: Tab) => void }) {
  return (
    <div role="tablist" aria-label="RoofGuard sections" className="inline-flex rounded-xl bg-white/[0.06] p-1 ring-1 ring-white/10">
      {TABS.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn("min-h-[36px] min-w-[72px] rounded-lg px-3 text-sm font-medium transition-colors sm:min-w-[84px] sm:px-4",
            value === t.id ? "bg-white text-black shadow-sm" : "text-white/65 hover:text-white")}>{t.label}</button>
      ))}
    </div>
  );
}

type Contact = { name: string; title: string; linkedin: string };
type Cand = { e164: string; display: string; source: string; url: string; score: number; hits?: number; context: string };
type Lead = {
  id: string; company: string; state: string; timezone: string; risk_tier: string; category: string;
  site_model: string | null; roof_volume: string | null; priority: number; escalate: boolean;
  contacts: Contact[]; notes: string | null; pitch: string; pitch_source: string;
  website: string | null; phone: string | null; phone_source: string | null; phone_source_url: string | null;
  phone_confidence: number | null; phone_candidates: Cand[]; line_type: string;
  enrich_status: "pending" | "working" | "found" | "not_found" | "error"; enrich_error: string | null; enriched_at: string | null;
  dnc: boolean;
};
type Stats = {
  total: number; with_phone: number; dialable: number;
  by_status: Partial<Record<Lead["enrich_status"], number>>;
  last_run: { started_at: string; finished_at: string | null; claimed: number; found: number; not_found: number; errors: number } | null;
  open_issue: { title: string; body: string | null; opened_at: string } | null;
};

const COLS = "id,company,state,timezone,risk_tier,category,site_model,roof_volume,priority,escalate,contacts,notes,pitch,pitch_source,website,phone,phone_source,phone_source_url,phone_confidence,phone_candidates,line_type,enrich_status,enrich_error,enriched_at,dnc";
const PAGE = 60;

const rpc = (fn: string) =>
  supabase.rpc(fn as never) as unknown as Promise<{ data: unknown; error: { message: string } | null }>;
const leadsTable = () => supabase.from("rg_leads" as never) as unknown as {
  select: (c: string) => { order: (c: string, o: { ascending: boolean }) => { range: (a: number, b: number) => Promise<{ data: Lead[] | null; error: { message: string } | null }> } };
  update: (p: Partial<Lead>) => { eq: (c: string, v: string) => Promise<{ error: { message: string } | null }> };
};

const time12 = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  : "never";
const fmtPhone = (e164: string | null) => {
  const d = (e164 ?? "").replace(/\D/g, "").replace(/^1/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164 ?? "";
};
const label = (s: string) => s.replace(/_/g, " ");

const STATUS_STYLE: Record<Lead["enrich_status"], string> = {
  found: "bg-emerald-500/15 text-emerald-300",
  not_found: "bg-white/10 text-white/60",
  pending: "bg-sky-500/15 text-sky-300",
  working: "bg-sky-500/15 text-sky-300",
  error: "bg-amber-500/15 text-amber-300",
};
const STATUS_TEXT: Record<Lead["enrich_status"], string> = {
  found: "Phone found", not_found: "No number yet", pending: "In line", working: "Looking now", error: "Retrying",
};

function Stat({ n, label, tone }: { n: number | undefined; label: string; tone?: "good" | "warn" }) {
  return (
    <div className={cn("min-w-[104px] flex-1 rounded-2xl p-3 ring-1",
      tone === "warn" ? "bg-amber-500/10 ring-amber-500/30" : tone === "good" ? "bg-emerald-500/[0.07] ring-emerald-500/25" : "bg-white/[0.03] ring-white/10")}>
      <div className="text-2xl font-semibold tabular-nums text-white">{n ?? "—"}</div>
      <div className="mt-1 text-xs text-white/55">{label}</div>
    </div>
  );
}

// One-tap copy: a small pill that copies its text and flashes "Copied".
function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1200);
  };
  return (
    <button type="button" onClick={copy} title={`Copy ${text.length > 60 ? text.slice(0, 60) + "…" : text}`}
      className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-xs ring-1 transition-colors",
        done ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" : "text-white/75 ring-white/15 hover:bg-white/10 hover:text-white", className)}>
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{done ? "Copied" : label}
    </button>
  );
}

// Everything needed for a call, as one paste.
const callCard = (l: Lead) => [
  l.company,
  l.phone ? `Phone: ${fmtPhone(l.phone)}` : "Phone: not found yet",
  ...l.contacts.map((c) => `Ask for: ${c.name}, ${c.title}`),
  l.website ? `Website: ${l.website}` : "",
  "",
  `Angle: ${l.pitch}`,
].filter((x, i, arr) => x !== "" || (i > 0 && arr[i - 1] !== "")).join("\n");

function Section({ title, copy, children }: { title: string; copy?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/45">{title}</div>
        {copy && <CopyButton text={copy} />}
      </div>
      {children}
    </div>
  );
}

function LeadRow({ lead, onPick }: { lead: Lead; onPick: (lead: Lead, c: Cand) => void }) {
  const [open, setOpen] = useState(false);
  const c0 = lead.contacts?.[0];
  const toggle = () => setOpen((o) => !o);
  return (
    <li className="border-b border-white/[0.06] last:border-0">
      <div role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggle())}
        className="flex w-full cursor-pointer items-center gap-3 py-3 text-left hover:bg-white/[0.02]">
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl text-sm font-semibold tabular-nums",
          lead.priority >= 80 ? "bg-emerald-500/15 text-emerald-300" : lead.priority >= 60 ? "bg-white/10 text-white" : "bg-white/[0.04] text-white/50")}
          title="Call priority (0-100)">{lead.priority}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] text-white">{lead.company}</div>
          <div className="truncate text-xs text-white/45">
            {lead.state} · {label(lead.category)}{c0 ? ` · ${c0.name}, ${c0.title}` : ""}
          </div>
        </div>
        {lead.phone ? (
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden text-right sm:block">
              <div className="whitespace-nowrap text-sm tabular-nums text-white">{fmtPhone(lead.phone)}</div>
              <div className="whitespace-nowrap text-[11px] text-white/45">{lead.phone_confidence ?? "?"}% · {lead.phone_source}</div>
            </div>
            <CopyButton text={fmtPhone(lead.phone)} label="Phone" />
          </div>
        ) : <div className="hidden w-28 shrink-0 text-right text-xs text-white/35 sm:block">no number</div>}
        <span className={cn("hidden shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium md:inline", STATUS_STYLE[lead.enrich_status])}>
          {STATUS_TEXT[lead.enrich_status]}
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-white/40 transition-transform", open && "rotate-180")} />
      </div>

      {open && (
        <div className="mb-4 space-y-4 rounded-2xl bg-black/20 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={callCard(lead)} label="Copy call card" className="bg-white/10 text-white" />
            <CopyButton text={lead.company} label="Company" />
            {lead.phone && <CopyButton text={fmtPhone(lead.phone)} label={fmtPhone(lead.phone)} />}
            {lead.website && <CopyButton text={lead.website} label="Website" />}
          </div>

          <Section title="Who to ask for">
            <ul className="space-y-1.5">{lead.contacts.map((c) => (
              <li key={c.name + c.title} className="flex flex-wrap items-center gap-2 text-white/85">
                <span className="text-white">{c.name}</span><span className="text-white/50">{c.title}</span>
                <CopyButton text={c.name} label="Name" />
                <CopyButton text={`${c.name}, ${c.title}`} label="Name + title" />
                {c.linkedin && <>
                  <CopyButton text={c.linkedin} label="LinkedIn" />
                  <a href={c.linkedin} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-xs text-sky-300 hover:underline">Open <ExternalLink className="h-3 w-3" /></a>
                </>}
              </li>))}</ul>
            {lead.escalate && <p className="mt-1 text-xs text-amber-200">Sheet note: escalate past this contact to the facilities director.</p>}
          </Section>

          <Section title={`Pitch angle ${lead.pitch_source === "bespoke" ? "(researched)" : "(by category)"}`} copy={lead.pitch}>
            <p className="leading-relaxed text-white/80">{lead.pitch}</p>
          </Section>

          {lead.notes && (
            <Section title="Notes" copy={lead.notes}>
              <p className="leading-relaxed text-white/70">{lead.notes}</p>
            </Section>
          )}

          <Section title="Phone finder">
            <div className="text-xs text-white/55">
              {lead.website ? <a href={lead.website} target="_blank" rel="noopener noreferrer" className="text-sky-300 hover:underline">{lead.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a> : "No website found"}
              {" · "}checked {time12(lead.enriched_at)} · line type {lead.line_type}
              {lead.enrich_error ? ` · ${lead.enrich_error}` : ""}
            </div>
            {lead.phone_candidates?.length > 0 && (
              <ul className="mt-2 space-y-1.5">{lead.phone_candidates.map((c) => {
                const chosen = c.e164 === lead.phone;
                return (
                  <li key={c.e164} className={cn("flex items-center gap-3 rounded-xl p-2 ring-1", chosen ? "bg-emerald-500/[0.07] ring-emerald-500/25" : "ring-white/[0.06]")}>
                    <div className="w-32 shrink-0 tabular-nums text-white"><span className="whitespace-nowrap">{c.display}</span><div className="whitespace-nowrap text-[11px] text-white/45">score {Math.round(c.score)} · {c.source}</div></div>
                    <div className="min-w-0 flex-1 truncate text-xs text-white/50" title={c.context}>{c.context}</div>
                    <CopyButton text={c.display} />
                    {!chosen && (
                      <button type="button" onClick={() => onPick(lead, c)} className="shrink-0 whitespace-nowrap rounded-lg px-2 py-1 text-xs text-white/80 ring-1 ring-white/15 hover:bg-white/5">Use this</button>
                    )}
                  </li>);
              })}</ul>
            )}
          </Section>
        </div>
      )}
    </li>
  );
}

// Calling side (Phase 2). Built and guarded, switched off until the voice + phone accounts exist.
type CallStats = {
  settings: { calling_enabled: boolean; window_start_hour: number; window_end_hour: number; max_attempts: number;
    min_gap_bdays: number; daily_cap: number; pilot_limit: number | null; agent_id: string | null; phone_number_id: string | null;
    test_phone: string | null; callback_number: string | null; from_number: string | null; setup_log: { at: string; m: string }[] };
  keys: Record<"elevenlabs_api_key" | "telnyx_api_key" | "elevenlabs_webhook_secret", boolean>;
  unverified: number; dialable: number; mobile: number; calls_total: number; test_calls: number; calls_24h: number;
  booked: number; dnc: number; callbacks_due: number;
  by_outcome: Record<string, number>;
  openers: { key: string; label: string; active: boolean; calls: number; reached: number; kept_talking: number;
    booked: number; book_rate: number | null; score: number; script: string }[];
  open_issue: { title: string; body: string | null } | null;
};

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((100 * n) / d)}%` : "—");

function OpenerTest({ openers }: { openers: CallStats["openers"] }) {
  const active = openers.filter((o) => o.active);
  const exploring = active.some((o) => o.reached < 30);
  const leader = !exploring ? [...active].sort((a, b) => b.score - a.score)[0]?.key : undefined;
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-white/45">Opener test</div>
        <div className="text-[11px] text-white/45">
          {exploring ? "Testing evenly until each opener reaches 30 decision makers" : "80% of calls use the leader, 20% keep testing"}
        </div>
      </div>
      <ul className="space-y-1.5">{openers.map((o) => (
        <li key={o.key} className={cn("rounded-xl p-3 ring-1", o.key === leader ? "bg-emerald-500/[0.07] ring-emerald-500/25" : "ring-white/[0.08]")}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-medium text-white">{o.label}</span>
            {o.key === leader && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">Leading</span>}
            {!o.active && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/50">Paused</span>}
            <span className="ml-auto flex gap-3 whitespace-nowrap text-xs tabular-nums text-white/60">
              <span>{o.reached} reached</span>
              <span>{pct(o.kept_talking, o.reached)} kept talking</span>
              <span className="text-white">{o.booked} booked ({pct(o.booked, o.reached)})</span>
            </span>
          </div>
          <div className="mt-1 text-xs leading-relaxed text-white/50">{o.script.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => `[${k.replace(/_/g, " ")}]`)}</div>
        </li>))}</ul>
    </div>
  );
}
const hour12 = (h: number) => `${((h + 11) % 12) + 1}:00\u00a0${h < 12 || h === 24 ? "AM" : "PM"}`;

const settingsTable = () => supabase.from("rg_settings" as never) as unknown as {
  update: (p: Record<string, unknown>) => { eq: (c: string, v: boolean) => Promise<{ error: { message: string } | null }> };
};
const toE164 = (v: string) => {
  const d = v.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `+1${d}` : null;
};

const KEY_FIELDS: { name: "elevenlabs_api_key" | "telnyx_api_key"; label: string; hint: string }[] = [
  { name: "elevenlabs_api_key", label: "ElevenLabs API key", hint: "elevenlabs.io → Developers → API keys" },
  { name: "telnyx_api_key", label: "Telnyx API key", hint: "portal.telnyx.com → Auth → API Keys, starts with KEY" },
];

function KeySlot({ f, saved, onSaved }: { f: (typeof KEY_FIELDS)[number]; saved: boolean; onSaved: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setErr(null);
    const { error } = await (supabase.rpc as unknown as (fn: string, a: Record<string, string>) => Promise<{ error: { message: string } | null }>)("rg_key_put", { p_name: f.name, p_value: v });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setV(""); onSaved();
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-40 shrink-0 text-xs text-white/70">{f.label}</div>
      {saved && !v ? <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Saved in Vault</span> : null}
      <input type="password" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} placeholder={saved ? "Replace…" : f.hint}
        className="min-w-[180px] flex-1 rounded-lg bg-black/20 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 ring-1 ring-white/10 focus:outline-none focus:ring-white/25" />
      <button type="button" disabled={!v || busy} onClick={() => void save()} className="rounded-lg px-2.5 py-1.5 text-xs text-white ring-1 ring-white/15 hover:bg-white/10 disabled:opacity-40">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}</button>
      {err && <div className="w-full text-xs text-red-300">{err}</div>}
    </div>
  );
}

// Defined outside CallingCard so typing in a step's inputs never remounts them.
function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      {done ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
        : <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] text-white/70 ring-1 ring-white/25">{n}</span>}
      <div className="min-w-0 flex-1">
        <div className={cn("text-sm", done ? "text-white/55" : "text-white")}>{title}</div>
        {children && <div className="mt-2 space-y-2">{children}</div>}
      </div>
    </li>
  );
}
function Btn({ id, busy, onClick, children, disabled }: { id: string; busy: string | null; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || busy !== null}
      className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-xs text-white ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-40">
      {busy === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{children}</button>
  );
}

function CallingCard() {
  const [c, setC] = useState<CallStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [cbNumber, setCbNumber] = useState("");
  const load = useCallback(async () => {
    const { data, error } = await rpc("rg_call_stats");
    if (error) { setErr(error.message); return; }
    const cs = data as CallStats;
    setErr(null); setC(cs);
    setTestPhone((t) => t || cs.settings.test_phone || "");
    setCbNumber((t) => t || cs.settings.callback_number || "");
  }, []);
  useEffect(() => { void load(); }, [load]);

  const action = async (a: "setup" | "test_call" | "line_types", msg: string) => {
    setBusy(a); setNote(null);
    const { error } = await (supabase.rpc as unknown as (fn: string, x: Record<string, string>) => Promise<{ error: { message: string } | null }>)("rg_caller_action", { p_action: a });
    setBusy(null);
    if (error) { setErr(error.message); return; }
    setNote(msg);
    setTimeout(() => void load(), a === "line_types" ? 90000 : 30000);
  };
  const saveSetting = async (patch: Record<string, unknown>, what: string) => {
    const { error } = await settingsTable().update({ ...patch, updated_at: new Date().toISOString(), updated_by: "admin" }).eq("id", true);
    if (error) { setErr(error.message); return; }
    setNote(`${what} saved.`); void load();
  };

  if (err) return <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Calling: {err}</div>;
  if (!c) return null;
  const s = c.settings;
  const keysIn = c.keys.elevenlabs_api_key && c.keys.telnyx_api_key;
  const setUp = !!s.agent_id && !!s.phone_number_id;
  const linesChecked = c.unverified === 0 && c.dialable > 0;
  const tested = c.test_calls > 0;
  const hasCallback = !!s.callback_number;
  const canGoLive = keysIn && setUp && linesChecked && tested && hasCallback;

  return (
    <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
      <div className="flex items-center gap-3">
        <div className={cn("grid h-10 w-10 place-items-center rounded-xl", s.calling_enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/60")}>
          <Phone className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-lg font-semibold text-white">Calling: {s.calling_enabled ? "on" : "off"}</div>
          <div className="text-xs text-white/55">
            Weekdays {hour12(s.window_start_hour)}–{hour12(s.window_end_hour)} lead's local time · up to {s.max_attempts} tries, {s.min_gap_bdays}+ business days apart · {s.daily_cap} calls/day{s.pilot_limit ? ` · pilot: ${s.pilot_limit} leads` : ""}
          </div>
        </div>
      </div>
      {c.open_issue && <p className="mt-3 text-sm text-amber-200">{c.open_issue.title}{c.open_issue.body ? `: ${c.open_issue.body}` : ""}</p>}
      {note && <p className="mt-3 text-sm text-sky-200">{note}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Stat n={c.dialable} label="ready to dial" />
        <Stat n={c.calls_total} label="calls made" />
        <Stat n={c.booked} label="meetings booked" tone={c.booked > 0 ? "good" : undefined} />
        <Stat n={c.callbacks_due} label="callbacks set" />
        <Stat n={c.dnc} label="do-not-call" />
      </div>

      {c.openers?.length > 0 && <OpenerTest openers={c.openers} />}

      {!s.calling_enabled && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/45">Go live</div>
          <ol className="space-y-4">
            <Step n={1} done={keysIn} title="Open an ElevenLabs account and a Telnyx account, buy one local number in Telnyx (about $1/month), then paste the 2 keys here. They go straight to Vault and never show again.">
              {KEY_FIELDS.map((f) => <KeySlot key={f.name} f={f} saved={c.keys[f.name]} onSaved={() => { setNote(`${f.label} saved in Vault.`); void load(); }} />)}
            </Step>
            <Step n={2} done={setUp} title={setUp ? `Voice agent set up, calling from ${s.from_number ?? "your Telnyx number"}` : "Set up the voice agent (script, voice, 3 openers, voicemail, call logging, Telnyx phone line), all automatic"}>
              {keysIn && <Btn busy={busy} id="setup" onClick={() => void action("setup", "Setting up the voice agent… this takes about 30 seconds.")}>{setUp ? "Re-run setup" : "Set up voice agent"}</Btn>}
              {s.setup_log?.length > 0 && <ul className="space-y-0.5 text-xs text-white/50">{s.setup_log.map((l, i) => <li key={i}>{l.m}</li>)}</ul>}
            </Step>
            <Step n={3} done={linesChecked} title={linesChecked ? `Line types checked · ${c.mobile} mobiles skipped` : `Check which of the ${c.unverified} numbers are business lines (Telnyx lookup, a fraction of a cent each); mobiles are never called`}>
              {keysIn && !linesChecked && <Btn busy={busy} id="line_types" onClick={() => void action("line_types", "Checking line types… up to 400 per run, about 90 seconds. Press again if some remain.")}>Check line types</Btn>}
            </Step>
            <Step n={4} done={tested} title={tested ? `Test call done (${c.test_calls})` : "Test call: Ava calls your phone with a real lead's script"}>
              <div className="flex flex-wrap items-center gap-2">
                <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="Your cell, e.g. (816) 500-7236" inputMode="tel"
                  className="w-56 rounded-lg bg-black/20 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 ring-1 ring-white/10 focus:outline-none focus:ring-white/25" />
                <Btn busy={busy} id="test_phone" disabled={!toE164(testPhone)} onClick={() => void saveSetting({ test_phone: toE164(testPhone) }, "Test number")}>Save</Btn>
                {setUp && s.test_phone && <Btn busy={busy} id="test_call" onClick={() => void action("test_call", "Calling your phone now…")}>Call my phone</Btn>}
              </div>
            </Step>
            <Step n={5} done={hasCallback} title="Callback number Ava reads out in voicemails (required on automated calls)">
              <div className="flex flex-wrap items-center gap-2">
                <input value={cbNumber} onChange={(e) => setCbNumber(e.target.value)} placeholder="Number prospects can call back" inputMode="tel"
                  className="w-56 rounded-lg bg-black/20 px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 ring-1 ring-white/10 focus:outline-none focus:ring-white/25" />
                <Btn busy={busy} id="cb" disabled={!toE164(cbNumber)} onClick={() => void saveSetting({ callback_number: toE164(cbNumber) }, "Callback number")}>Save</Btn>
              </div>
            </Step>
            <Step n={6} done={false} title="Turn on the 20-lead pilot (weekdays, local business hours, max 20 calls a day)">
              <Btn busy={busy} id="golive" disabled={!canGoLive} onClick={() => void saveSetting({ calling_enabled: true, pilot_limit: 20 }, "Pilot is on")}>Start pilot</Btn>
              {!canGoLive && <div className="text-xs text-white/40">Unlocks when steps 1–5 are done.</div>}
            </Step>
          </ol>
        </div>
      )}
      {s.calling_enabled && (
        <div className="mt-4">
          <Btn busy={busy} id="pause" onClick={() => void saveSetting({ calling_enabled: false }, "Calling paused")}>Pause calling</Btn>
        </div>
      )}
    </div>
  );
}

export default function RoofGuard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kicking, setKicking] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | Lead["enrich_status"]>("all");
  const [state, setState] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const [tab, setTabState] = useState<Tab>(hashTab);
  const [studio, setStudio] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setTab = (t: Tab) => { setTabState(t); history.replaceState(null, "", `#${t}`); };
  const [callingOn, setCallingOn] = useState<boolean | null>(null);
  // the Coach asks for its tab (Reply guard "See the rule", Scorecard "Manage rules") or for a call's sheet (reviews feed, "See calls")
  useEffect(() => {
    const go = (t: Tab) => { setTabState(t); history.replaceState(null, "", `#${t}`); };
    const a = onOpenCoach("roofguard", () => go("coach"));
    const b = onOpenCall("roofguard", () => go("calls"));
    return () => { a(); b(); };
  }, []);
  useEffect(() => {
    void rpc("rg_call_stats").then(({ data }) => setCallingOn(!!(data as CallStats | null)?.settings?.calling_enabled));
  }, [tab]);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, ...pages] = await Promise.all([
      rpc("rg_stats"),
      leadsTable().select(COLS).order("priority", { ascending: false }).range(0, 999),
      leadsTable().select(COLS).order("priority", { ascending: false }).range(1000, 1999),
    ]);
    setLoading(false);
    const e = s.error ?? pages.find((p) => p.error)?.error;
    if (e) { setErr(e.message); return; }
    setErr(null);
    setStats(s.data as Stats);
    setLeads(pages.flatMap((p) => p.data ?? []));
  }, []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 60000); return () => clearInterval(t); }, [load]);

  const kick = async () => {
    setKicking(true);
    const { error } = await rpc("rg_kick");
    setKicking(false);
    if (error) { setErr(error.message); return; }
    setTimeout(() => void load(), 45000);
  };

  const pick = async (lead: Lead, c: Cand) => {
    const patch = { phone: c.e164, phone_source: "manual", phone_source_url: c.url, phone_confidence: 100, enrich_status: "found" as const, line_type: "unverified" };
    const { error } = await leadsTable().update(patch).eq("id", lead.id);
    if (error) { setErr(error.message); return; }
    setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, ...patch } : l)));
  };

  const states = useMemo(() => [...new Set(leads.map((l) => l.state))].sort(), [leads]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) =>
      (status === "all" || l.enrich_status === status || (status === "pending" && l.enrich_status === "working")) &&
      (state === "all" || l.state === state) &&
      (!needle || l.company.toLowerCase().includes(needle) || l.category.includes(needle) ||
        l.contacts.some((c) => c.name.toLowerCase().includes(needle))));
  }, [leads, q, status, state]);
  useEffect(() => setShown(PAGE), [q, status, state]);

  const bs = stats?.by_status ?? {};
  const left = (bs.pending ?? 0) + (bs.working ?? 0);
  const healthy = !!stats && !stats.open_issue;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
      <AvaOrb size={72} label="RoofGuard Ava" />
      <div className="min-w-0 flex-1">
      <PageHeader title="RoofGuard" description="Ava, the AI caller: who she's calling, what she's saying, and how each call ended."
        actions={tab !== "leads" ? undefined : <div className="flex gap-2">
          <button type="button" onClick={() => void kick()} disabled={kicking || left === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm text-white ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-40">
            {kicking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Find now</button>
          <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-white/80 ring-1 ring-white/15 hover:bg-white/5">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh</button>
        </div>} />
      </div>
      </div>

      <AvaTopBar onCalled={() => setTab("calls")} onOpenSettings={() => setSettingsOpen(true)} extra={<VoiceSwitcher source="rg" onMore={() => { setTab("setup"); setStudio((n) => n + 1); setTimeout(() => document.getElementById("voice-studio-roofguard")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120); }} />} />
      <Segmented value={tab} onChange={setTab} />
      <AvaSettingsSheet source="roofguard" open={settingsOpen} onOpenChange={setSettingsOpen} />

      {tab === "calls" && <>
        <AvaScoreStrip onOpen={() => setTab("scorecard")} />
        <AvaCalls callingOn={callingOn} onOpenSetup={() => setTab("setup")} />
      </>}
      {tab === "scorecard" && <AvaScorecard admin />}
      {tab === "coach" && <AvaCoach source="roofguard" admin />}
      {tab === "setup" && <div className="space-y-5"><CallingCard /><VoicePicker source="roofguard" openSignal={studio} /></div>}

      {tab === "leads" && <>
      {err && <div className="rounded-2xl bg-red-500/10 p-4 text-sm text-red-200 ring-1 ring-red-500/40">Could not load: {err}</div>}

      {stats && (
        <div className={cn("rounded-3xl p-5 ring-1", healthy ? "bg-emerald-500/[0.06] ring-emerald-500/25" : "bg-amber-500/[0.06] ring-amber-500/30")}>
          <div className="flex items-center gap-3">
            {healthy ? <CheckCircle2 className="h-6 w-6 text-emerald-400" /> : <AlertTriangle className="h-6 w-6 text-amber-300" />}
            <div>
              <div className="text-lg font-semibold text-white">
                {stats.open_issue ? stats.open_issue.title : left > 0 ? `Finding numbers · ${left} to go` : "Phone finder done"}
              </div>
              <div className="text-xs text-white/55">
                Last run {time12(stats.last_run?.started_at)}
                {stats.last_run ? ` · ${stats.last_run.found} found of ${stats.last_run.claimed}` : ""} · runs every 5 min, watchdog every 10
              </div>
            </div>
          </div>
          {stats.open_issue?.body && <p className="mt-3 text-sm text-amber-200">{stats.open_issue.body}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Stat n={stats.total} label="leads" />
            <Stat n={stats.with_phone} label="phones found" tone="good" />
            <Stat n={bs.not_found} label="no number yet" />
            <Stat n={left} label="in line" />
            <Stat n={bs.error} label="retrying" tone={(bs.error ?? 0) > 0 ? "warn" : undefined} />
            <Stat n={stats.dialable} label="ready to dial" />
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-white/45"><Phone className="h-3.5 w-3.5" />
            Ready to dial = line type checked as a business landline or VoIP. That check comes with the dialer (Phase 2); mobiles are never called.</p>
        </div>
      )}

      <div className="rounded-3xl bg-white/[0.03] p-5 ring-1 ring-white/10">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, contact, or category"
              className="w-full rounded-xl bg-black/20 py-2 pl-9 pr-3 text-sm text-white placeholder:text-white/35 ring-1 ring-white/10 focus:outline-none focus:ring-white/25" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}
            className="rounded-xl bg-black/20 px-3 py-2 text-sm text-white ring-1 ring-white/10">
            <option value="all">All statuses</option>
            <option value="found">Phone found</option>
            <option value="not_found">No number yet</option>
            <option value="pending">In line</option>
            <option value="error">Retrying</option>
          </select>
          <select value={state} onChange={(e) => setState(e.target.value)}
            className="rounded-xl bg-black/20 px-3 py-2 text-sm text-white ring-1 ring-white/10">
            <option value="all">All states</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="mb-1 text-xs text-white/45">{filtered.length} leads · highest call priority first</div>
        <ul>{filtered.slice(0, shown).map((l) => <LeadRow key={l.id} lead={l} onPick={pick} />)}</ul>
        {filtered.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-3 w-full rounded-xl py-2 text-sm text-white/70 ring-1 ring-white/10 hover:bg-white/5">
            Show {Math.min(PAGE, filtered.length - shown)} more
          </button>
        )}
      </div>
      </>}
    </div>
  );
}
