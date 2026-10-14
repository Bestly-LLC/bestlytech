/**
 * /admin/cost-cutter: Penny, Bestly's Cost Cutter (free, no Claude tokens). Lives under Money in the sidebar.
 * Penny finds money Bestly pays for and does not use. She pauses and flags, she never cancels or deletes on her own.
 *   Question    the one thing she is asking right now: Keep it, Cut it, or Not sure (cost_cutter_answer)
 *   Findings    open savings she found, each one tap to mark done, park or "not useful" (she learns from that)
 *   Bank feed   the read-only Mercury token. Write-only field: saved to the Vault, only "saved at" ever comes back
 *   Services    every merchant she watches and what you told her about it
 *   Settings    the smallest monthly charge worth a question, and the savings size worth a push
 * Data: cost_cutter_admin() (admin only). Migration 20261011070200_penny_admin_and_mercury_token.sql.
 */
import { Lines } from "@/components/Lines";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Check, CircleAlert, Landmark, Loader2, Lock, Scissors } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { cn } from "@/lib/utils";
import { btnPlain, btnPrimary, btnTinted, card, field, label, pill, secondary, Section, separator, tertiary, tint } from "./laxUi";
import { rpc, shortDay, shortTime } from "./settlementsShared";

type Question = { id: string; merchant: string; question: string; options: string[]; asked_at: string; est_monthly_usd: number | null; guess: string | null };
type Finding = { id: string; kind: string; title: string; why: string | null; todo: string | null; saving: number | null; created_at: string };
type Merchant = { merchant: string; source: string; status: string; cadence: string | null; est_monthly_usd: number | null; last_seen: string | null; guess: string | null; keep_until: string | null };
type Lesson = { subject: string; decision: string; reason: string | null; decided_at: string };
type Overview = {
  settings: { min_monthly_usd: number; push_min_monthly_usd: number };
  token: { saved: boolean; saved_at: string | null };
  feed: { waiting_on_token: boolean; job: { last_run_at: string; ok: boolean; summary: string | null } | null; bank_merchants: number; last_bank_update: string | null };
  question: Question | null; queued: number;
  findings: Finding[]; merchants: Merchant[]; avenues: { name: string; kind: string; first_seen: string }[]; lessons: Lesson[];
  saved_monthly_usd: number;
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** A dollar amount (and its "/mo") stays in one piece. */
function Nb({ text }: { text: string }) {
  const parts = text.split(/(\$[\d,]+(?:\.\d+)?(?:\/mo)?)/g);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}
const perMonth = (n: number | null) => (n == null ? "Usage based" : <span className="whitespace-nowrap">{money(n)}/mo</span>);
const stamp = (iso: string) => <span className="whitespace-nowrap">{shortDay(iso)}, {shortTime(iso)}</span>;

const STATUS: Record<string, { word: string; cls: string }> = {
  unknown: { word: "New", cls: pill.blue }, asked: { word: "Asked", cls: pill.blue }, keep: { word: "Keeping", cls: pill.green },
  cut: { word: "Cut", cls: pill.orange }, watch: { word: "Watching", cls: pill.orange },
};
const DECISION: Record<string, string> = { keep: "Keep", cut: "Cut", not_now: "Not sure", useful: "Useful", not_useful: "Not useful" };

function Stat({ title, value, sub }: { title: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className={cn(card, "p-4")}>
      <p className={cn("text-[13px]", secondary)}>{title}</p>
      <p className={cn("mt-1 text-[22px] font-semibold leading-tight tabular-nums", label)}>{value}</p>
      {sub && <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}><Lines>{sub}</Lines></p>}
    </div>
  );
}

export default function CostCutter() {
  const [d, setD] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [token, setToken] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [floor, setFloor] = useState("");
  const [pushMin, setPushMin] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await rpc<Overview>("cost_cutter_admin");
    if (error || !data) { setFailed(true); return; }
    setFailed(false); setD(data);
    setFloor((v) => v || String(data.settings.min_monthly_usd));
    setPushMin((v) => v || String(data.settings.push_min_monthly_usd));
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  const run = async (key: string, fn: string, args: object, ok: string) => {
    setBusy(key);
    const { error } = await rpc(fn, args);
    setBusy(null);
    if (error) { toast.error(error.message || "That didn't save. Try again."); return false; }
    toast.success(ok); await load(); return true;
  };

  const answer = async (q: Question, option: string) => {
    if (await run(`q:${option}`, "cost_cutter_answer", { p_question: q.id, p_answer: option, p_reason: reason.trim() || null },
      option.toLowerCase().startsWith("cut") ? `Got it. Penny adds a cancel to-do for ${q.merchant}.` : `Got it. Penny filed ${q.merchant}.`)) setReason("");
  };

  const saveToken = async () => {
    if (await run("token", "mercury_token_save", { p_value: token.trim() }, "Saved. Penny and Bank Watch pick it up on their next run.")) { setToken(""); setReplacing(false); }
  };

  if (failed && !d) {
    return (
      <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <PageHeader title="Cost Cutter" description="Penny, Cost Cutter" />
        <p className={cn("mt-6 flex items-center gap-2 text-[15px]", tint.orange)}><CircleAlert className="h-4 w-4" aria-hidden /> Couldn&rsquo;t load Penny. <button type="button" className={btnPlain} onClick={() => void load()}>Try again</button></p>
      </div>
    );
  }
  if (!d) {
    return (
      <div className="mx-auto max-w-4xl px-4 pb-16 sm:px-6">
        <PageHeader title="Cost Cutter" description="Penny, Cost Cutter" />
        <Loader2 className="mt-6 h-5 w-5 animate-spin text-white/50" aria-label="Loading" />
      </div>
    );
  }

  const watched = d.merchants.filter((m) => m.status !== "cut");
  const watchedTotal = watched.reduce((n, m) => n + (m.est_monthly_usd ?? 0), 0);
  const needToken = !d.token.saved;
  const showTokenField = needToken || replacing;

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 pb-16 sm:px-6">
      <PageHeader title="Cost Cutter" description="Penny, Cost Cutter. She finds money you pay for and don't use. She pauses and flags; she never cancels or deletes on her own." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat title="Saved so far" value={<span className="whitespace-nowrap">{money(d.saved_monthly_usd)}/mo</span>} sub="Done findings plus paused projects" />
        <Stat title="Watching" value={`${watched.length} ${watched.length === 1 ? "service" : "services"}`} sub={watchedTotal ? <span className="whitespace-nowrap">{money(watchedTotal)}/mo known</span> : "Usage based so far"} />
        <Stat title="Open findings" value={d.findings.length} sub={d.findings.length ? "Below" : "Nothing waiting"} />
        <Stat title="Her question" value={d.question ? "Waiting" : d.queued ? `${d.queued} queued` : "None"} sub={d.question ? "On you" : "She asks one a day"} />
      </div>

      <Section title="Penny's question" footer={`She only asks about charges of ${money(d.settings.min_monthly_usd)} a month or more, one at a time, once a day. Your answer is remembered: Keep means she won't ask again for 180 days.`}>
        <div className={card}>
          {d.question ? (
            <>
              <p className={cn("text-[17px] font-semibold leading-snug", label)}><Nb text={d.question.question} /></p>
              <p className={cn("mt-1 text-[13px]", secondary)}>Asked {stamp(d.question.asked_at)}</p>
              <label className="mt-4 block">
                <span className={cn("text-[13px]", secondary)}>Why (optional, she learns from it)</span>
                <input className={cn(field, "mt-1")} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="For example: needed for Cookie Yeti" />
              </label>
              <div className="mt-4 flex flex-wrap gap-2">
                {d.question.options.map((o, i) => (
                  <button key={o} type="button" disabled={busy !== null} className={i === 0 ? btnPrimary : btnTinted} onClick={() => void answer(d.question as Question, o)}>
                    {busy === `q:${o}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : i === 0 ? <Check className="h-4 w-4" aria-hidden /> : i === 1 ? <Scissors className="h-4 w-4" aria-hidden /> : null}{o}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className={cn("text-[15px] leading-snug", secondary)}>
              {d.queued ? `${d.queued} ${d.queued === 1 ? "question is" : "questions are"} lined up. Penny asks the biggest charge first, tomorrow morning.`
                : needToken ? "Nothing to ask yet. Once the bank feed below is connected she reads your recurring charges and asks about the ones she doesn't recognize."
                : "Nothing to ask. She'll bring a new question when she sees an unfamiliar recurring charge."}
            </p>
          )}
        </div>
      </Section>

      {d.findings.length > 0 && (
        <Section title="Findings" footer="Done means the saving is real and counts toward the total. Park hides it for now. Not useful tells Penny to stop raising things like it.">
          <div className={cn(card, "divide-y p-0", separator)}>
            {d.findings.map((f) => (
              <div key={f.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <p className={cn("min-w-0 flex-1 text-[16px] font-semibold leading-snug", label)}><Nb text={f.title} /></p>
                  {f.saving != null && <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold", pill.green)}>Saves {money(f.saving)}/mo</span>}
                </div>
                {(f.why || f.todo) && <p className={cn("mt-1 text-[14px] leading-snug", secondary)}><Nb text={[f.why, f.todo].filter(Boolean).join(" ")} /></p>}
                <p className={cn("mt-1 text-[13px]", tertiary)}>Found {stamp(f.created_at)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={busy !== null} className={btnTinted} onClick={() => void run(`f:${f.id}`, "cost_cutter_finding_set", { p_id: f.id, p_status: "done" }, "Marked done.")}>Done</button>
                  <button type="button" disabled={busy !== null} className={btnTinted} onClick={() => void run(`f:${f.id}`, "cost_cutter_finding_set", { p_id: f.id, p_status: "parked" }, "Parked.")}>Park</button>
                  <button type="button" disabled={busy !== null} className={btnPlain} onClick={() => void run(`f:${f.id}`, "cost_cutter_feedback", { p_finding: f.id, p_useful: false }, "Got it. Penny won't raise this again for a while.")}>Not useful</button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section id="bank-feed" title="Bank feed"
        footer="Create the token in Mercury under Settings, API tokens, and choose Read only. It is saved write-only in the Vault: this page can replace it but never shows it again. Penny and Bank Watch (the Settlements bank matcher) both use it. Only totals per merchant are kept, never raw transactions or account numbers.">
        <div className={card}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={cn("flex items-center gap-2 text-[17px] font-semibold", label)}><Landmark className="h-5 w-5" aria-hidden /> Mercury, read only</p>
              <p className={cn("mt-1 text-[14px] leading-snug", secondary)}>
                {needToken ? "Not connected. Penny only sees what Bestly's own apps spend until you add a token."
                  : <>Token saved {d.token.saved_at ? stamp(d.token.saved_at) : ""}. {d.feed.bank_merchants ? `${d.feed.bank_merchants} bank ${d.feed.bank_merchants === 1 ? "merchant" : "merchants"} tracked${d.feed.last_bank_update ? `, last updated ${shortDay(d.feed.last_bank_update)}` : ""}.` : "Waiting for the next Monday 7:50 AM run."}</>}
              </p>
            </div>
            <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", needToken ? pill.orange : pill.green)}>
              {needToken ? <CircleAlert className="h-3.5 w-3.5" aria-hidden /> : <Check className="h-3.5 w-3.5" aria-hidden />}{needToken ? "Needs a token" : "Connected"}
            </span>
          </div>
          {showTokenField ? (
            <div className="mt-4 space-y-3">
              <input className={field} type="password" autoComplete="off" spellCheck={false} placeholder="Paste the read-only Mercury token" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Mercury read-only token" />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnPrimary} disabled={busy !== null || token.trim().length < 20} onClick={() => void saveToken()}>
                  {busy === "token" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}Save to Vault
                </button>
                {replacing && <button type="button" className={btnTinted} onClick={() => { setReplacing(false); setToken(""); }}>Cancel</button>}
              </div>
            </div>
          ) : (
            <div className="mt-3"><button type="button" className={btnPlain} onClick={() => setReplacing(true)}>Replace token</button></div>
          )}
          {d.feed.job && (
            <p className={cn("mt-4 text-[13px] leading-snug", d.feed.job.ok ? secondary : tint.orange)}>
              Last run {stamp(d.feed.job.last_run_at)}: {d.feed.job.summary ?? (d.feed.job.ok ? "ok" : "problem")}
            </p>
          )}
        </div>
      </Section>

      <Section title="Services Penny watches" footer="Services paid for inside Bestly (AI, phones, video) are checked against their own usage. Bank charges appear here once the feed is connected.">
        <div className={cn(card, "divide-y p-0", separator)}>
          {d.merchants.length === 0 && <p className={cn("p-5 text-[15px]", secondary)}>Nothing yet.</p>}
          {d.merchants.map((m) => {
            const s = STATUS[m.status] ?? { word: m.status, cls: pill.blue };
            return (
              <div key={m.merchant} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[16px] font-medium", label)}>{m.merchant}</p>
                  <p className={cn("text-[13px] leading-snug", secondary)}>
                    {[m.guess, m.source === "internal" ? "Inside Bestly" : "Bank"].filter(Boolean).join(" · ")}
                    {m.keep_until && new Date(m.keep_until) > new Date() ? <> · Keeping until <span className="whitespace-nowrap">{shortDay(`${m.keep_until}T12:00:00Z`)}</span></> : null}
                  </p>
                </div>
                <span className={cn("text-[14px] tabular-nums", secondary)}>{perMonth(m.est_monthly_usd)}</span>
                <span className={cn("whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", s.cls)}>{s.word}</span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Settings" footer="Penny raises her own question floor after you pass on three small charges in a row. You can set either number by hand here.">
        <div className={cn(card, "grid gap-4 sm:grid-cols-2")}>
          <SettingField title="Ask about charges of at least" suffix="/mo" value={floor} onChange={setFloor} busy={busy === "s:min"}
            onSave={() => void run("s:min", "cost_cutter_setting_set", { p_key: "min_monthly_usd", p_value: Number(floor) }, "Saved.")} />
          <SettingField title="Push me for savings of at least" suffix="/mo" value={pushMin} onChange={setPushMin} busy={busy === "s:push"}
            onSave={() => void run("s:push", "cost_cutter_setting_set", { p_key: "push_min_monthly_usd", p_value: Number(pushMin) }, "Saved.")} />
        </div>
      </Section>

      {(d.lessons.length > 0 || d.avenues.length > 0) && (
        <Section title="What Penny learned">
          <div className={cn(card, "space-y-4")}>
            {d.lessons.length > 0 && (
              <ul className="space-y-1.5">
                {d.lessons.map((l, i) => (
                  <li key={i} className={cn("text-[14px] leading-snug", secondary)}>
                    <span className={label}>{l.subject}</span> · {DECISION[l.decision] ?? l.decision}{l.reason ? `: ${l.reason}` : ""} · <span className="whitespace-nowrap">{shortDay(l.decided_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            {d.avenues.length > 0 && (
              <p className={cn("text-[13px] leading-snug", secondary)}>
                Also watching {d.avenues.length} spend and usage {d.avenues.length === 1 ? "table" : "tables"} on her own: {d.avenues.map((a) => a.name).join(", ")}.
              </p>
            )}
          </div>
        </Section>
      )}
      <p className={cn("px-4 text-[13px]", tertiary)}>All times are Pacific.</p>
    </div>
  );
}

function SettingField({ title, suffix, value, onChange, onSave, busy }: { title: string; suffix: string; value: string; onChange: (v: string) => void; onSave: () => void; busy: boolean }) {
  const n = Number(value);
  return (
    <div>
      <p className={cn("text-[14px] font-medium", label)}>{title}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <span className={cn("text-[16px]", secondary)}>$</span>
        <input className={cn(field, "max-w-[8rem] tabular-nums")} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} aria-label={title} />
        <span className={cn("whitespace-nowrap text-[15px]", secondary)}>{suffix}</span>
        <button type="button" className={btnTinted} disabled={busy || !value || !Number.isFinite(n)} onClick={onSave}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Save"}
        </button>
      </div>
    </div>
  );
}
