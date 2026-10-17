/**
 * /admin/roofguard-outreach: RoofGuard Outreach (team slug roofguard-outreach). Migration 20261011232000_roofguard_outreach_pi.sql.
 * The outreach bot moved off a Claude scheduled task onto the Pi (free AI, weekdays 9:00 AM). It is DRAFT-ONLY: the Pi never emails
 * anyone. Every email it writes waits here. Jared sends the ones he likes from his own mail (To, Cc and Bcc are filled in for him),
 * then taps "I sent it" so the follow-up clock starts. Skip drops a draft; "Never contact" suppresses the company for good.
 *
 * Talks only to the admin RPCs rg_outreach_admin / rg_outreach_set / rg_outreach_draft_decide / rg_outreach_review_decide / rg_outreach_called.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, Check, CheckCircle2, CircleAlert, Copy, Loader2, Mail, PauseCircle, Phone, Server } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section, Segmented, Sheet, Switch, btnDestructivePlain, btnPlain, btnPrimary, btnTinted, card, label, pill, secondary, tertiary, tint } from "./laxUi";

const rpc = (fn: string, args?: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
const nw = "whitespace-nowrap";

type Kind = "first" | "touch2" | "touch3" | "loop2" | "loop3" | "intro" | "summary_reply";
type Draft = {
  id: string; kind: Kind; to_email: string; cc: string | null; bcc: string; subject: string; body: string; hook_quote: string | null; hook_url: string | null;
  created_at: string; company: string; city: string | null; state: string | null; track: "A" | "B" | null;
};
type Call = {
  id: string; company: string; city: string | null; state: string | null; track: "A" | "B" | null; tz: string | null; phone: string; contact_name: string | null;
  contact_title: string | null; services: string | null; fit_note: string | null; status: string; emailed: boolean;
};
type Admin = {
  settings: { enabled: boolean; daily_first_touch_cap: number; pending_cap: number };
  job: { job: string; description: string; last_run_at: string | null; last_ok: boolean | null; last_summary: string | null; replaced_claude_task: string | null } | null;
  counts: { pending: number; sent_total: number; active: number; resting: number; replied: number; introduced: number; opted_out: number; bounced: number; ledger: number };
  drafts: Draft[];
  review: { id: string; company: string; status: string; review_note: string | null; updated_at: string }[];
  calls: Call[];
  recent: { id: string; kind: Kind; status: string; subject: string; decided_at: string | null; company: string }[];
};

const KIND: Record<Kind, { t: string; c: string }> = {
  intro: { t: "Reply: intro to Eli", c: pill.orange },
  summary_reply: { t: "Reply: program summary", c: pill.orange },
  first: { t: "First email", c: pill.blue },
  touch2: { t: "Follow-up, day 4", c: pill.blue },
  touch3: { t: "Last note, day 9", c: pill.blue },
  loop2: { t: "Second pass", c: pill.blue },
  loop3: { t: "Final pass", c: pill.blue },
};

const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Los_Angeles" });
const phoneFmt = (n: string) => n;

const CALL_STEPS: string[] = [
  "INTRO: \"Hi {Name}, this is Jared Best, how's your day going so far?\" (let them answer) \"I'll be quick, I know you're working.\"",
  "QUALIFY: \"I'm reaching out to commercial cleaning and building-maintenance companies specifically. Quick question and I'll know if this is even worth your time: do any of your clients own their buildings, rather than lease?\" If no: \"Got it, then this probably isn't for you. Appreciate the minute.\" Disqualify cleanly.",
  "PRESENT: \"Most of those owners don't know their roof warranty is void. The fine print requires ongoing maintenance nobody performs, so it lapsed years ago. And most warranties cut off around 55 to 70 mile an hour winds, which an ordinary bad storm clears. There's a program that covers all of it (inspections, 24/7 repairs, full roof renewal) for a flat monthly cost instead of a capital project.\"",
  "CLOSE (one ask): \"You wouldn't do any roof work and you don't need a license. You make the introduction, and it pays you 2% every month for the life of that contract. Want me to have Eli, the guy who runs it, give you a call?\" Then stop talking.",
  "REHASH (after the yes): \"While I've got you, roughly how many of your clients own their buildings? And what kind mostly: warehouses, retail, medical?\"",
];
const OBJECTIONS: [string, string][] = [
  ["Busy, not interested, all set (first ten seconds)", "\"I understand.\" (pause) \"This'll only take a moment.\" Then resume."],
  ["We don't do roofing", "\"That's actually why I'm calling. You don't touch a roof. You make one introduction.\""],
  ["My clients lease", "\"Some, sure. Any of them own?\""],
  ["What's the catch", "\"No catch. Cold-calling building owners about roofs doesn't work. You already have the trust, that's the whole thing.\""],
  ["What does it pay", "\"2% residual, monthly, for the life of the contract. Eli can give you the exact structure. Want me to connect you?\""],
  ["Send me something", "That is a yes. \"Happy to. What's the best address?\""],
  ["Too busy", "\"You don't do anything. I hand you to Eli and he takes it from there.\""],
];

const fullText = (d: Draft) =>
  `To: ${d.to_email}\n${d.cc ? `Cc: ${d.cc}\n` : ""}Bcc: ${d.bcc}\nSubject: ${d.subject}\n\n${d.body}`;
const mailto = (d: Draft) =>
  `mailto:${encodeURIComponent(d.to_email)}?${[d.cc ? `cc=${encodeURIComponent(d.cc)}` : "", `bcc=${encodeURIComponent(d.bcc)}`, `subject=${encodeURIComponent(d.subject)}`, `body=${encodeURIComponent(d.body)}`]
    .filter(Boolean).join("&")}`;

export default function RoofGuardOutreach() {
  const [a, setA] = useState<Admin | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [never, setNever] = useState<Draft | null>(null);
  const [script, setScript] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await rpc("rg_outreach_admin");
    if (error) toast.error(error.message); else setA(data as Admin);
  }, []);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 60000); return () => window.clearInterval(id); }, [load]);

  const call = async (key: string, fn: string, args: Record<string, unknown>, done?: string) => {
    setBusy(key);
    const { data, error } = await rpc(fn, args);
    setBusy(null);
    if (error) { toast.error(error.message); void load(); return; }
    setA(data as Admin);
    if (done) toast.success(done);
  };
  const copy = async (text: string, what = "Copied") => {
    try { await navigator.clipboard.writeText(text); toast.success(what); } catch { toast.error("Could not copy"); }
  };

  if (!a) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 px-4 pb-16 sm:px-0">
        <PageHeader title="RoofGuard Outreach" description="Partner-recruit emails, drafted for your approval" />
        <Loader2 className="h-5 w-5 animate-spin text-white/50" aria-label="Loading" />
      </div>
    );
  }

  const s = a.settings;
  const j = a.job;
  const replies = a.drafts.filter((d) => d.kind === "intro" || d.kind === "summary_reply");
  const rest = a.drafts.filter((d) => d.kind !== "intro" && d.kind !== "summary_reply");
  const capOpts = Array.from(new Set([5, 10, 15, 20, s.daily_first_touch_cap])).sort((x, y) => x - y);

  const DraftCard = ({ d }: { d: Draft }) => (
    <section className={card} aria-label={`${d.company}: ${KIND[d.kind].t}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn("text-[17px] font-semibold", label)}>{d.company}</p>
          <p className={cn("text-[13px]", secondary)}>
            {[d.city, d.state].filter(Boolean).join(", ")}{d.track ? <span className={nw}>{d.city || d.state ? " · " : ""}Track {d.track}</span> : null}
          </p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold", nw, KIND[d.kind].c)}>{KIND[d.kind].t}</span>
      </div>

      <dl className={cn("mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]", secondary)}>
        <dt>To</dt><dd className={cn("break-all", label)}>{d.to_email}</dd>
        {d.cc && (<><dt>Cc</dt><dd className={cn("break-all", label)}>{d.cc}</dd></>)}
        <dt>Bcc</dt><dd className={cn("break-all", label)}>{d.bcc}</dd>
        <dt>Subject</dt><dd className={label}>{d.subject}</dd>
      </dl>

      <div className="mt-3 rounded-[14px] bg-[#2C2C2E] p-3 bento:bg-[#7676801f]">
        <p className={cn("whitespace-pre-wrap break-words text-[14px] leading-snug", label)}>{d.body}</p>
      </div>
      {d.hook_quote && (
        <p className={cn("mt-2 text-[13px] leading-snug", secondary)}>
          First line is based on their own site: &quot;{d.hook_quote}&quot;{d.hook_url ? <> (<a className="underline" href={d.hook_url} target="_blank" rel="noreferrer">open</a>)</> : null}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <a className={cn(btnPrimary, nw)} href={mailto(d)} aria-label={`Open the email to ${d.company} in your mail app`}><Mail className="h-4 w-4" aria-hidden />Open in Mail</a>
        <button type="button" className={cn(btnPlain, nw)} onClick={() => void copy(fullText(d), "Email copied")} aria-label={`Copy the email to ${d.company}`}><Copy className="h-4 w-4" aria-hidden />Copy</button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" className={cn(btnTinted, nw)} disabled={busy === d.id} aria-label={`Mark the email to ${d.company} as sent`}
          onClick={() => void call(d.id, "rg_outreach_draft_decide", { p_id: d.id, p_action: "sent" }, "Recorded. The follow-up clock has started.")}>
          {busy === d.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}I sent it
        </button>
        <button type="button" className={cn(btnPlain, nw)} disabled={busy === d.id} aria-label={`Skip the email to ${d.company}`}
          onClick={() => void call(d.id, "rg_outreach_draft_decide", { p_id: d.id, p_action: "skipped" }, "Skipped")}>Skip</button>
        <button type="button" className={cn(btnDestructivePlain, nw)} onClick={() => setNever(d)} aria-label={`Never contact ${d.company}`}><Ban className="h-4 w-4" aria-hidden />Never contact</button>
        <span className={cn("ml-auto text-xs", nw, tertiary)}>{stamp(d.created_at)}</span>
      </div>
    </section>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pb-16 sm:px-0">
      <PageHeader title="RoofGuard Outreach" description="Partner-recruit emails for building-services companies. The Pi writes them; you send them." />

      <section className={cn(card, !s.enabled && "ring-1 ring-[#FF9F0A66] bento:ring-[#FF950066]")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p role="status" className={cn("text-[17px] font-semibold", label)}>{s.enabled ? "Drafting is on" : "Drafting is paused"}</p>
            <p className={cn("mt-0.5 text-[13px] leading-snug", secondary)}>
              Nothing is ever sent from here. Every email waits below until you send it yourself and tap &quot;I sent it&quot;.
            </p>
          </div>
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", nw, s.enabled ? pill.green : pill.orange)}>
            {s.enabled ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <PauseCircle className="h-3.5 w-3.5" aria-hidden />}
            {s.enabled ? "On" : "Paused"}
          </span>
        </div>
        <div className="mt-3">
          <Switch checked={s.enabled} disabled={busy === "set"} onChange={(v) => void call("set", "rg_outreach_set", { p_enabled: v }, v ? "Drafting resumed" : "Drafting paused")}
            label="Draft emails" detail="Off: the Pi still reads replies and opt-outs, but writes no new drafts." />
          <div className="py-2">
            <p className={cn("text-[15px]", label)}>New first emails per day, at most</p>
            <p className={cn("mb-1.5 mt-0.5 text-[13px]", secondary)}>The Pi also stops when {s.pending_cap} drafts are already waiting for you.</p>
            <Segmented ariaLabel="Daily first emails" value={String(s.daily_first_touch_cap)} onChange={(v) => void call("set", "rg_outreach_set", { p_daily_cap: Number(v) })}
              options={capOpts.map((n) => ({ value: String(n), label: String(n) }))} />
          </div>
        </div>
        <dl className={cn("mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]", secondary)}>
          <dt>Runs</dt>
          <dd className={cn("flex items-center gap-1.5", label)}><Server className="h-3.5 w-3.5 shrink-0" aria-hidden /><span>On the Pi, weekdays 9:00 AM, free AI</span></dd>
          <dt>Last run</dt>
          <dd className={label}>
            {j?.last_run_at
              ? <><span className={nw}>{stamp(j.last_run_at)}</span><span className={j.last_ok === false ? tint.orange : secondary}>{j.last_summary ? `. ${j.last_summary}` : ""}</span></>
              : <span className={secondary}>Has not run yet.</span>}
          </dd>
          <dt>Replaces</dt>
          <dd className={label}>The Claude scheduled task, now switched off</dd>
        </dl>
      </section>

      <section className={cn(card, "grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4")} aria-label="Counts">
        {[
          ["Waiting for you", a.counts.pending], ["Following up", a.counts.active], ["Resting", a.counts.resting], ["Replied", a.counts.replied],
          ["Introduced", a.counts.introduced], ["Opted out", a.counts.opted_out], ["Bounced", a.counts.bounced], ["Companies tracked", a.counts.ledger],
        ].map(([t, n]) => (
          <div key={String(t)}>
            <p className={cn("text-[22px] font-semibold leading-none tabular-nums", label)}>{n}</p>
            <p className={cn("mt-1 text-[12px] leading-tight", secondary)}>{t}</p>
          </div>
        ))}
      </section>

      {a.review.length > 0 && (
        <Section title="A reply needs your eyes" footer="The Pi could not tell what these replies meant, so it stopped all emails to them. Nothing is drafted until you sort it.">
          {a.review.map((r) => (
            <section key={r.id} className={card}>
              <div className="flex items-center justify-between gap-2">
                <p className={cn("text-[15px] font-semibold", label)}>{r.company}</p>
                <span className={cn("text-xs", nw, tertiary)}>{stamp(r.updated_at)}</span>
              </div>
              {r.review_note && <p className={cn("mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-snug", label)}>{r.review_note}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" className={cn(btnTinted, nw)} disabled={busy === r.id} onClick={() => void call(r.id, "rg_outreach_review_decide", { p_id: r.id, p_action: "interested" }, "Marked interested")}>Interested</button>
                <button type="button" className={cn(btnPlain, nw)} disabled={busy === r.id} onClick={() => void call(r.id, "rg_outreach_review_decide", { p_id: r.id, p_action: "not_interested" }, "Retired")}>Not interested</button>
                <button type="button" className={cn(btnDestructivePlain, nw)} disabled={busy === r.id} onClick={() => void call(r.id, "rg_outreach_review_decide", { p_id: r.id, p_action: "opt_out" }, "Suppressed for good")}><Ban className="h-4 w-4" aria-hidden />Opted out</button>
              </div>
            </section>
          ))}
        </Section>
      )}

      {replies.length > 0 && (
        <Section title="Someone wrote back" footer="Send these first. A real person is waiting. The intro copies Eli Cooper.">
          {replies.map((d) => <DraftCard key={d.id} d={d} />)}
        </Section>
      )}

      <Section title="Drafts to review" footer="Each one follows the standing rules: honest subject, the word renewal, no partners named, no deadlines, no income promises, the compliance footer, and a Bcc to you.">
        {rest.length === 0 ? (
          <section className={card}>
            <p className={cn("flex items-center gap-1.5 text-[15px]", secondary)}><CircleAlert className="h-4 w-4 shrink-0" aria-hidden />Nothing is waiting. The next run is the next weekday at 9:00 AM.</p>
          </section>
        ) : rest.map((d) => <DraftCard key={d.id} d={d} />)}
      </Section>

      <Section title="Call sheet" footer="Phone-only companies are never emailed. Dial 8 to 10 AM or 3 to 5 PM their local time, Tuesday to Thursday.">
        {a.calls.length === 0 ? (
          <section className={card}><p className={cn("text-[15px]", secondary)}>No one to dial right now.</p></section>
        ) : a.calls.map((c) => (
          <section key={c.id} className={card}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className={cn("text-[15px] font-semibold", label)}>{c.company}</p>
                <p className={cn("text-[13px]", secondary)}>{[c.city, c.state].filter(Boolean).join(", ")}{c.track ? <span className={nw}> · Track {c.track}</span> : null}</p>
              </div>
              <span className={cn("inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold", nw, c.status === "phone_only" ? pill.orange : pill.blue)}>
                {c.status === "phone_only" ? "Phone only" : c.emailed ? "Emailed" : "Not emailed"}
              </span>
            </div>
            <dl className={cn("mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]", secondary)}>
              <dt>Ask for</dt><dd className={label}>{c.contact_name ? `${c.contact_name}${c.contact_title ? `, ${c.contact_title}` : ""}` : "Whoever maintains the buildings"}</dd>
              <dt>Number</dt><dd className={label}><a className={cn("underline", nw)} href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{phoneFmt(c.phone)}</a>{c.tz ? <span className={secondary}> · {c.tz} time</span> : null}</dd>
              {(c.services || c.fit_note) && (<><dt>They do</dt><dd className={label}>{c.services || c.fit_note}</dd></>)}
            </dl>
            <div className="mt-2 flex flex-wrap items-center gap-x-3">
              <a className={cn(btnTinted, nw)} href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} aria-label={`Call ${c.company}`}><Phone className="h-4 w-4" aria-hidden />Call</a>
              <button type="button" className={cn(btnPlain, nw)} disabled={busy === c.id} aria-label={`Mark ${c.company} as called`}
                onClick={() => void call(c.id, "rg_outreach_called", { p_id: c.id }, "Marked called")}><Check className="h-4 w-4" aria-hidden />Called</button>
            </div>
          </section>
        ))}
        <section className={card}>
          <button type="button" className={cn(btnPlain, nw)} onClick={() => setScript(true)}>Show the call script and objections</button>
        </section>
      </Section>

      {a.recent.length > 0 && (
        <Section title="Recently decided">
          <section className={card}>
            <ul className="space-y-1.5">
              {a.recent.map((r) => (
                <li key={r.id} className={cn("flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]", secondary)}>
                  <span className={label}>{r.company} <span className={secondary}>· {KIND[r.kind]?.t ?? r.kind}</span></span>
                  <span className={nw}>{r.status === "sent" ? "Sent" : "Skipped"}{r.decided_at ? ` · ${stamp(r.decided_at)}` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        </Section>
      )}

      <Sheet open={never !== null} onClose={() => setNever(null)} title={never ? `Never contact ${never.company}?` : ""}
        footer={<div className="flex flex-wrap gap-2">
          <button type="button" className={btnPrimary} onClick={() => { const d = never; setNever(null); if (d) void call(d.id, "rg_outreach_draft_decide", { p_id: d.id, p_action: "never" }, "Suppressed for good"); }}>Never contact</button>
          <button type="button" className={btnTinted} onClick={() => setNever(null)}>Cancel</button></div>}>
        <p className={cn("text-[15px] leading-snug", label)}>This company is suppressed for good. No first email, no follow-up, no second pass.</p>
        <p className={cn("mt-2 text-[13px] leading-snug", secondary)}>The same suppression happens automatically when someone replies STOP.</p>
      </Sheet>

      <Sheet open={script} onClose={() => setScript(false)} title="The call"
        footer={<button type="button" className={btnTinted} onClick={() => setScript(false)}>Close</button>}>
        <ol className="space-y-3">
          {CALL_STEPS.map((t, i) => (
            <li key={i} className={cn("text-[14px] leading-snug", label)}><span className={cn("mr-1 font-semibold", nw)}>{i + 1}.</span>{t}</li>
          ))}
        </ol>
        <p className={cn("mb-1 mt-4 text-[13px] font-semibold", label)}>Objections: repeat, reassure, resume</p>
        <ul className="space-y-2">
          {OBJECTIONS.map(([k, v]) => (
            <li key={k} className="text-[14px] leading-snug"><span className={cn("font-semibold", label)}>{k}.</span> <span className={secondary}>{v}</span></li>
          ))}
        </ul>
        <p className={cn("mt-4 text-[13px] leading-snug", secondary)}>Say renewal, never the other word. Never name a partner, because there are none yet.</p>
      </Sheet>
    </div>
  );
}
