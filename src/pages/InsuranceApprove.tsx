/**
 * /y/<code starting with i> - Jared's one tap on an insurance claim (Insurance Filer, a tool of Claims Closer).
 *
 * Two kinds of decision land here, and nothing goes out until he taps:
 *   file_claim   the guest's insurer's claim form is filled in and stopped just before Send. He sees every answer, what was left blank and
 *                why, the terms on the form, the photos and the screenshots, then Send or No. A form that needed a person (a CAPTCHA) turns
 *                into a hand-off: the answers to copy, a link, and a box for the claim number once he has filed it himself.
 *   send_mail    a reply to the adjuster or to Turo, written and waiting. He can fix a word, see the attachments, then Send or No.
 *
 * Runs only inside the signed-in admin (AdminRoute). There is no Face ID step here, unlike Ava's approvals: this is the owner tapping on his
 * own claim, and every tap is checked against the hash of what he was shown (a changed fact makes the link stale instead of sending).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, Check, ChevronDown, Clock, ExternalLink, Loader2, Paperclip, Pencil, Send, ShieldCheck, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { AdminMark } from "@/components/AdminMark";
import { Nums } from "@/components/admin/cc/stuckLib";
import { copyText } from "@/lib/copyForClaude";
import { cn } from "@/lib/utils";

/* ───────── shapes ───────── */

type Row = Record<string, unknown>;
type Field = { key: string; group: string; label: string; value: string; confidence: string | null };
type Blank = { key: string; label: string; why: string };
type Attachment = { photo_id?: string; name: string; bytes?: number | null; source?: string };
type Draft = { id: string; status: string; to: string; cc: string | null; subject: string; body: string; attachments: Attachment[]; error: string | null };
type Summary = {
  kind?: string; insurer?: string; manual?: boolean; blocked_reason?: string | null; claim_url?: string | null; consent_clicked?: boolean;
  consent: string[]; fields: Field[]; unknown: Blank[]; inferred: string[]; left_blank: Blank[]; turo_claim_no: string | null;
  to?: string; cc?: string | null; from?: string; about?: string;
};
type Approval = {
  code: string; kind: "file_claim" | "send_mail"; title: string; status: string; hash: string; expires_at: string; seconds_left: number; stale: boolean;
  summary: Summary; case: { title: string; insurer: string; policy_no: string | null; claim_no: string | null; stage: string | null }; draft: Draft | null;
};
type Pic = { id: string; source: string; step: string | null; description: string | null; mime: string | null; url: string | null };
type Media = { photos: Pic[]; shots: Pic[] };
type Phase = "idle" | "working" | "sent" | "filed" | "declined";

const TZ = "America/Los_Angeles";
const clock = (iso: string | number) => new Date(iso).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

const GROUPS: Record<string, string> = {
  reporter: "You", policy: "The policy", driver: "The driver", vehicle: "The car", loss: "What happened", estimate: "The estimate", turo: "Turo", other: "Other",
};
const SOURCE_NAME: Record<string, string> = {
  guest_report: "Guest's photos", checkin: "Check-in photos", return: "Return photos", before: "Before the trip", after: "After the trip", estimate_doc: "Repair estimate",
};

const REFUSED: Record<string, string> = {
  expired: "This link expired. Claims Closer will write a new one.",
  stale: "Something changed after this was prepared, so I did not send it. A fresh version is on its way.",
  not_found: "That link isn't valid.",
  need_claim_number: "Type the claim number first.",
  manual_only: "This form needs a person. Use the hand-off below.",
  draft_not_waiting: "This email was already handled.",
};
const refusal = (r?: string) => (r && r.startsWith("already_") ? "You already answered this one." : REFUSED[r ?? ""] ?? "That didn't go through. Try again.");

const CSS = `
.ia-in { animation: ia-in 320ms cubic-bezier(0.2, 0.9, 0.3, 1) both; }
@keyframes ia-in { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.ia-press { transition: transform 110ms ease, opacity 150ms ease, background-color 150ms ease; touch-action: manipulation; }
.ia-press:active:not(:disabled) { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) { .ia-in { animation: none !important } .ia-press { transition: none } }
`;

const card = "rounded-2xl border border-white/10 bg-white/[0.05] p-4 bento:border-white/5 bento:bg-[#fff]";
const label = "text-[0.8125rem] font-medium text-white/65";
const bigBtn = "ia-press flex h-[3.25rem] w-full items-center justify-center gap-2 rounded-2xl text-[1.0625rem] font-semibold";
const focus = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A84FF]";

/* ───────── small parts ───────── */

function Fold({ title, count, children, start = false }: { title: string; count?: number; children: React.ReactNode; start?: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <section className={card}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn("ia-press flex min-h-[2.75rem] w-full items-center justify-between gap-3 text-left", focus)}>
        <span className="text-[1.0625rem] font-semibold">{title}{count != null && <span className="font-normal text-white/60"> · {count}</span>}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  );
}

function Thumbs({ pics, empty }: { pics: Pic[]; empty: string }) {
  if (pics.length === 0) return <p className="text-[0.9375rem] text-white/65">{empty}</p>;
  return (
    <ul className="grid grid-cols-3 gap-2">
      {pics.map((p) => (
        <li key={p.id}>
          {p.url && p.mime?.startsWith("image/") ? (
            <a href={p.url} target="_blank" rel="noreferrer" className={cn("block overflow-hidden rounded-xl bg-black/30", focus)} aria-label={`Open ${SOURCE_NAME[p.source] ?? p.source} full size`}>
              <img src={p.url} alt={p.description ?? SOURCE_NAME[p.source] ?? "Photo"} loading="lazy" className="aspect-square w-full object-cover" />
            </a>
          ) : (
            <div className="grid aspect-square place-items-center rounded-xl bg-white/[0.06] p-2 text-center text-[0.75rem] text-white/70">{SOURCE_NAME[p.source] ?? "File"}</div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Answers({ fields, inferred }: { fields: Field[]; inferred: string[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, Field[]>();
    for (const f of fields) m.set(f.group, [...(m.get(f.group) ?? []), f]);
    return [...m.entries()];
  }, [fields]);
  return (
    <div className="space-y-4">
      {groups.map(([g, rows]) => (
        <div key={g}>
          <p className={label}>{GROUPS[g] ?? g}</p>
          <dl className="mt-1 divide-y divide-white/10 bento:divide-black/5">
            {rows.map((f) => (
              <div key={f.key} className="flex items-start justify-between gap-4 py-2 text-[0.9375rem] leading-snug">
                <dt className="text-white/65">{f.label}</dt>
                <dd className="min-w-0 break-words text-right"><Nums text={f.value} />{inferred.includes(f.key) && <span className="block text-[0.75rem] text-amber-300 bento:text-amber-700">Worked out, not stated. Check it.</span>}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}

function Blanks({ rows }: { rows: Blank[] }) {
  if (rows.length === 0) return <p className="text-[0.9375rem] text-white/65">Nothing. Every answer the form asked for was filled in.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((b) => (
        <li key={b.key} className="text-[0.9375rem] leading-snug"><span className="font-medium">{b.label}.</span> <span className="text-white/65">{b.why}</span></li>
      ))}
    </ul>
  );
}

/* ───────── the page ───────── */

export default function InsuranceApprove() {
  const { code: raw = "" } = useParams();
  const code = raw.toLowerCase();
  const { bento } = useAdminTheme();
  const [ap, setAp] = useState<Approval | null>(null);
  const [media, setMedia] = useState<Media>({ photos: [], shots: [] });
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [claimNo, setClaimNo] = useState("");
  const [copied, setCopied] = useState(false);
  const run = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("ins_approval_get" as never, { p_code: code } as never);
    if (error) { setLoadErr(error.message.includes("admin only") ? "This is only for the Bestly admin." : "Couldn't open that. Check your connection and reload."); return; }
    const r = data as unknown as { ok: boolean; approval?: Row };
    if (!r?.ok || !r.approval) { setLoadErr("That link isn't valid."); return; }
    const a = r.approval;
    const s = (a.summary ?? {}) as Row;
    const d = a.draft as Row | null;
    const next: Approval = {
      code: str(a.code), kind: a.kind === "send_mail" ? "send_mail" : "file_claim", title: str(a.title), status: str(a.status), hash: str(a.hash), expires_at: str(a.expires_at),
      seconds_left: Number(a.seconds_left ?? 0), stale: a.stale === true,
      summary: {
        kind: str(s.kind), insurer: str(s.insurer), manual: s.manual === true, blocked_reason: str(s.blocked_reason) || null, claim_url: str(s.claim_url) || null, consent_clicked: s.consent_clicked === true,
        consent: arr<string>(s.consent).filter((x) => typeof x === "string"), fields: arr<Field>(s.fields), unknown: arr<Blank>(s.unknown), inferred: arr<string>(s.inferred),
        left_blank: arr<Blank>(s.left_blank), turo_claim_no: str(s.turo_claim_no) || null, to: str(s.to), cc: str(s.cc) || null, from: str(s.from), about: str(s.about),
      },
      case: { title: str((a.case as Row)?.title), insurer: str((a.case as Row)?.insurer), policy_no: str((a.case as Row)?.policy_no) || null, claim_no: str((a.case as Row)?.claim_no) || null, stage: str((a.case as Row)?.stage) || null },
      draft: d ? { id: str(d.id), status: str(d.status), to: str(d.to), cc: str(d.cc) || null, subject: str(d.subject), body: str(d.body), attachments: arr<Attachment>(d.attachments), error: str(d.error) || null } : null,
    };
    setLoadErr(null);
    setAp(next);
    setSubject(next.draft?.subject ?? "");
    setBody(next.draft?.body ?? "");
    if (next.status === "declined") setPhase("declined");
  }, [code]);

  const loadMedia = useCallback(async () => {
    const { data } = await supabase.functions.invoke("insurance-filer", { body: { op: "approval_media", code } });
    const m = data as { ok?: boolean; photos?: Pic[]; shots?: Pic[] } | null;
    if (m?.ok) setMedia({ photos: arr<Pic>(m.photos), shots: arr<Pic>(m.shots) });
  }, [code]);

  useEffect(() => { void load(); void loadMedia(); }, [load, loadMedia]);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const left = ap ? Math.max(0, Math.floor((Date.parse(ap.expires_at) - now) / 1000)) : 0;
  const status = ap?.status ?? "pending";
  const live = !!ap && status === "pending" && left > 0 && !ap.stale;
  const busy = phase === "working";
  const insurer = ap?.case.insurer || ap?.summary.insurer || "the insurer";
  const manual = ap?.kind === "file_claim" && ap.summary.manual === true;
  const dirty = !!ap?.draft && (subject !== ap.draft.subject || body !== ap.draft.body);

  const decide = async (decision: "approve" | "decline" | "filed") => {
    if (!ap || run.current) return;
    if (decision !== "decline" && !live) return;
    run.current = true; setPhase("working"); setMsg(null);
    try {
      let hash = ap.hash;
      if (decision === "approve" && dirty && ap.draft) {          // the words changed: save them first, and send the hash of the NEW words
        const { data: e, error: ee } = await supabase.rpc("ins_draft_edit" as never, { p_code: ap.code, p_subject: subject, p_body: body } as never);
        const ed = e as unknown as { ok: boolean; reason?: string; problem?: string; hash?: string } | null;
        if (ee || !ed?.ok || !ed.hash) {
          setPhase("idle");
          setMsg(ed?.reason === "blocked" ? `I can't send that wording: ${ed.problem ?? "it breaks a rule"}.` : ed?.reason === "too_short" ? "That is too short to send." : refusal(ed?.reason));
          return;
        }
        hash = ed.hash;
      }
      const { data, error } = await supabase.rpc("ins_approval_decide" as never, { p_code: ap.code, p_decision: decision, p_hash: hash, p_claim_no: decision === "filed" ? claimNo.trim() : null } as never);
      const d = data as unknown as { ok: boolean; reason?: string } | null;
      if (error || !d?.ok) { setPhase("idle"); setMsg(refusal(d?.reason)); void load(); return; }
      try { navigator.vibrate?.(12); } catch { /* no haptics here */ }
      setPhase(decision === "decline" ? "declined" : decision === "filed" ? "filed" : "sent");
    } finally { run.current = false; }
  };

  const copyAnswers = async () => {
    if (!ap) return;
    const text = ap.summary.fields.map((f) => `${f.label}: ${f.value}`).join("\n");
    if (await copyText(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
  };

  const shell = cn("admin-shell flex min-h-dvh flex-col text-white", bento ? "admin-bento bg-[#F3F2EE]" : "bg-black");
  const pad = { paddingTop: "max(env(safe-area-inset-top), 16px)" };

  if (loadErr) {
    return (
      <div className={shell} style={pad}>
        <style>{CSS}</style>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-5 text-center" role="alert">
          <AlertCircle className="h-10 w-10 text-white/60" aria-hidden />
          <h1 className="mt-5 text-[1.5rem] font-semibold tracking-[-0.02em]">Can't open this</h1>
          <p className="mt-2 text-[1.0625rem] leading-relaxed text-white/60">{loadErr}</p>
          <Link to="/admin" className={cn(bigBtn, "mt-8 bg-white text-black", focus)}>Open the admin</Link>
        </main>
      </div>
    );
  }
  if (!ap) {
    return (
      <div className={shell}>
        <main className="grid flex-1 place-items-center" aria-busy="true" aria-label="Opening the claim">
          <Loader2 className="h-6 w-6 animate-spin text-white/50 motion-reduce:animate-none" aria-hidden />
        </main>
      </div>
    );
  }

  /* ----- after a tap ----- */
  if (phase === "sent" || phase === "filed" || phase === "declined") {
    const title = phase === "declined" ? "You said no" : phase === "filed" ? "Claim number saved" : ap.kind === "file_claim" ? "Approved. Sending now" : "Approved. Sending the email";
    const text = phase === "declined"
      ? "Nothing was sent. Claims Closer will not move until you say go."
      : phase === "filed"
        ? "Claims Closer will watch for the adjuster and write you a reply to approve."
        : ap.kind === "file_claim"
          ? `I am sending the claim to ${insurer} now. The claim number shows up on the Command Center as soon as ${insurer} gives it.`
          : "It goes out from jared@bestly.tech. I only call it done once it shows in your Sent folder.";
    return (
      <div className={shell} style={pad}>
        <style>{CSS}</style>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center px-5 text-center" aria-live="polite">
          <div className={cn("ia-in grid h-24 w-24 place-items-center rounded-full", phase === "declined" ? "bg-white/10 text-white/70" : "bg-emerald-500/15 text-emerald-400 bento:text-emerald-600")}>
            {phase === "declined" ? <X className="h-11 w-11" aria-hidden /> : <Check className="h-12 w-12" aria-hidden />}
          </div>
          <h1 className="mt-6 text-[1.75rem] font-semibold leading-tight tracking-[-0.02em]">{title}</h1>
          <p className="mt-2 max-w-[19rem] text-[1.0625rem] leading-relaxed text-white/60">{text}</p>
        </main>
        <footer className="mx-auto w-full max-w-sm px-5 pt-4" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}>
          <Link to="/admin" className={cn(bigBtn, "bg-white text-black", focus)}>Done</Link>
        </footer>
      </div>
    );
  }

  const blocked =
    status === "declined" ? { warn: false, title: "You said no", body: "Nothing was sent." }
    : status === "expired" || (status === "pending" && left <= 0) ? { warn: true, title: "This expired", body: "Claims Closer will write a new one." }
    : ap.stale && status === "pending" ? { warn: true, title: "This changed", body: "A fact changed after the form was filled in, so I won't send it. I'm filling it again and you will get a new link." }
    : status !== "pending" ? { warn: false, title: "Already answered", body: "You already answered this one." }
    : null;

  const blanks = [...ap.summary.unknown, ...ap.summary.left_blank.filter((b) => !ap.summary.unknown.some((u) => u.key === b.key))];
  const isFile = ap.kind === "file_claim";
  const attachments = ap.draft?.attachments ?? [];
  const mailPhotos = media.photos.slice(0, 9);

  return (
    <div className={shell} style={pad}>
      <style>{CSS}</style>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-5 pb-6">
        <header className="pt-4 text-center">
          <AdminMark label="Bestly Admin" className="mx-auto h-10 w-10" />
          <p className="mt-4 text-[0.875rem] font-medium tracking-[0.01em] text-white/65">
            {isFile ? (manual ? "Claims Closer needs you to finish this one" : "Claims Closer filled in the claim form") : "Claims Closer wrote an email"}
          </p>
          <h1 className="mt-1 text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.025em] [text-wrap:balance]">{ap.title}</h1>
          <p className="mt-2 text-[0.9375rem] text-white/65">
            <Nums text={[ap.case.insurer, ap.case.policy_no ? `policy ${ap.case.policy_no}` : null, ap.case.claim_no ? `claim ${ap.case.claim_no}` : null].filter(Boolean).join(" · ")} />
          </p>
        </header>

        <div className="ia-in mt-6 space-y-3">
          {/* nothing has gone out: say so first */}
          <div className={cn(card, "flex gap-3")}>
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400 bento:text-emerald-600" aria-hidden />
            <p className="text-[1rem] leading-snug">{isFile
              ? manual ? `Nothing has been sent. ${insurer}'s form needs a person, so I stopped.` : `Nothing has been sent. The form is filled in and stopped just before Send.`
              : "Nothing has been sent. It goes out only when you tap Send."}</p>
          </div>

          {blocked && (
            <div className={cn("flex gap-3 rounded-2xl p-4", blocked.warn ? "bg-amber-400/10 text-amber-200 bento:bg-amber-50 bento:text-amber-800" : "bg-white/[0.05] text-white/80 bento:bg-[#fff]")} role="status">
              <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
              <div><p className="text-[1.0625rem] font-semibold">{blocked.title}</p><p className="mt-0.5 text-[0.9375rem] leading-snug opacity-85">{blocked.body}</p></div>
            </div>
          )}

          {isFile && manual && (
            <section className={card}>
              <p className="text-[1.0625rem] font-semibold">Why I stopped</p>
              <p className="mt-1 text-[0.9375rem] leading-snug text-white/75">{ap.summary.blocked_reason ?? `${insurer}'s site asked for a person to prove they are not a robot. I will not get around that.`}</p>
              {ap.summary.claim_url && (
                <a href={ap.summary.claim_url} target="_blank" rel="noreferrer" className={cn("ia-press mt-3 flex min-h-[2.75rem] items-center justify-center gap-2 rounded-xl bg-white/[0.12] px-4 text-[1rem] font-semibold", focus)}>
                  <ExternalLink className="h-4 w-4" aria-hidden /><span>Open the claim form</span>
                </a>
              )}
              <button type="button" onClick={() => void copyAnswers()} className={cn("ia-press mt-2 flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-xl bg-white/[0.12] px-4 text-[1rem] font-semibold", focus)}>
                {copied ? <Check className="h-4 w-4" aria-hidden /> : null}<span>{copied ? "Copied" : "Copy every answer"}</span>
              </button>
              <label className="mt-4 block text-[0.875rem] font-medium text-white/70" htmlFor="ia-claimno">{insurer} claim number, once you have filed it</label>
              <input id="ia-claimno" value={claimNo} onChange={(e) => setClaimNo(e.target.value)} autoCapitalize="characters" autoComplete="off" inputMode="text"
                className={cn("mt-1 h-12 w-full rounded-xl bg-white/[0.08] px-3 text-[1rem] outline-none ring-1 ring-white/15", focus)} placeholder="For example 26-1234567" />
            </section>
          )}

          {isFile && (
            <>
              <Fold title="What I filled in" count={ap.summary.fields.length} start={!manual}><Answers fields={ap.summary.fields} inferred={ap.summary.inferred} /></Fold>
              <Fold title="What I left blank" count={blanks.length} start={blanks.length > 0}><Blanks rows={blanks} /></Fold>
              {ap.summary.turo_claim_no && (
                <section className={card}><p className="text-[0.9375rem] leading-snug"><span className="font-semibold">Turo claim <Nums text={ap.summary.turo_claim_no} /></span> <span className="text-white/65">is told to {insurer} in this filing, as the same loss.</span></p></section>
              )}
              {ap.summary.consent.length > 0 && (
                <section className={card}>
                  <p className="text-[1.0625rem] font-semibold">Terms on the form</p>
                  {ap.summary.consent_clicked
                    ? <p className="mt-1 text-[0.9375rem] leading-snug text-amber-200 bento:text-amber-800">To reach the next pages I tapped "I Agree and Continue" for you. Nothing was sent.</p>
                    : <p className="mt-1 text-[0.9375rem] leading-snug text-amber-200 bento:text-amber-800">Sending also accepts these terms on your behalf.</p>}
                  <ul className="mt-2 space-y-2 text-[0.875rem] leading-snug text-white/70">{ap.summary.consent.map((c, i) => <li key={i} className="break-words">{c}</li>)}</ul>
                </section>
              )}
              <Fold title="Photos going with it" count={media.photos.length}><Thumbs pics={media.photos} empty="No photos yet. The form goes without them and I send them to the adjuster by email." /></Fold>
              <Fold title="What the form looked like" count={media.shots.length}><Thumbs pics={media.shots} empty="No screenshots were saved." /></Fold>
            </>
          )}

          {!isFile && ap.draft && (
            <>
              <section className={card}>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[0.9375rem]">
                  <dt className="text-white/65">To</dt><dd className="min-w-0 break-words text-right">{ap.draft.to}</dd>
                  {ap.draft.cc && <><dt className="text-white/65">Cc</dt><dd className="min-w-0 break-words text-right">{ap.draft.cc}</dd></>}
                  <dt className="text-white/65">From</dt><dd className="min-w-0 break-words text-right">{ap.summary.from || "jared@bestly.tech"}</dd>
                </dl>
                <div className="mt-3 border-t border-white/10 pt-3 bento:border-black/5">
                  <div className="flex items-center justify-between gap-3">
                    <p className={label}>Subject and message</p>
                    <button type="button" onClick={() => setEditing((v) => !v)} aria-pressed={editing} className={cn("ia-press inline-flex min-h-[2.75rem] items-center gap-1.5 rounded-xl px-3 text-[0.9375rem] font-medium text-white/80", focus)}>
                      <Pencil className="h-4 w-4" aria-hidden /><span>{editing ? "Done editing" : "Fix a word"}</span>
                    </button>
                  </div>
                  {editing ? (
                    <div className="mt-1 space-y-2">
                      <label className="sr-only" htmlFor="ia-subject">Subject</label>
                      <input id="ia-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={cn("h-12 w-full rounded-xl bg-white/[0.08] px-3 text-[1rem] outline-none ring-1 ring-white/15", focus)} />
                      <label className="sr-only" htmlFor="ia-body">Message</label>
                      <textarea id="ia-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className={cn("w-full rounded-xl bg-white/[0.08] p-3 text-[1rem] leading-relaxed outline-none ring-1 ring-white/15", focus)} />
                      <p className="text-[0.8125rem] text-white/60">The signature stays. I still check it against my rules when you tap Send.</p>
                    </div>
                  ) : (
                    <>
                      <p className="mt-1 text-[1.0625rem] font-semibold leading-snug">{subject}</p>
                      <p className="mt-2 whitespace-pre-wrap break-words text-[1rem] leading-relaxed">{body}</p>
                    </>
                  )}
                </div>
              </section>
              <Fold title="Attached" count={attachments.length} start={attachments.length > 0}>
                {attachments.length === 0 ? <p className="text-[0.9375rem] text-white/65">No attachments.</p> : (
                  <ul className="space-y-1.5">
                    {attachments.map((a, i) => (
                      <li key={a.photo_id ?? i} className="flex items-center gap-2 text-[0.9375rem]">
                        <Paperclip className="h-4 w-4 shrink-0 text-white/60" aria-hidden />
                        <span className="min-w-0 break-words">{a.name}</span>
                        {a.bytes ? <span className="ml-auto whitespace-nowrap text-white/60">{a.bytes >= 1_000_000 ? `${(a.bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(a.bytes / 1000))} KB`}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
                {mailPhotos.length > 0 && <div className="mt-3"><Thumbs pics={mailPhotos} empty="" /></div>}
              </Fold>
            </>
          )}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-1 text-[0.9375rem]">
            <dt className="text-white/65">Link expires</dt>
            <dd className="text-right"><span className="whitespace-nowrap">{clock(ap.expires_at)}</span>{live && <span className="text-white/65"> · <span className="whitespace-nowrap">{Math.ceil(left / 60)} min</span> left</span>}</dd>
          </dl>
          <p className="min-h-[1.25rem] px-1 text-[0.9375rem] text-red-400 bento:text-red-600" role={msg ? "alert" : undefined}>{msg}</p>
        </div>
        <div className="flex-1" />
      </main>

      <footer className="sticky bottom-0 mx-auto w-full max-w-md bg-gradient-to-t from-black via-black/95 to-black/0 px-5 pt-6 bento:from-[#F3F2EE] bento:via-[#F3F2EE]/95 bento:to-[#F3F2EE]/0" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 20px)" }}>
        {blocked ? (
          <Link to="/admin" className={cn(bigBtn, "bg-white text-black", focus)}>Done</Link>
        ) : (
          <>
            {manual ? (
              <button type="button" onClick={() => void decide("filed")} disabled={!live || busy || claimNo.trim().length < 4} className={cn(bigBtn, "bg-white text-black disabled:opacity-40", focus)}>
                {busy ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Check className="h-5 w-5" aria-hidden />}
                <span>I filed it. Save the claim number</span>
              </button>
            ) : (
              <button type="button" onClick={() => void decide("approve")} disabled={!live || busy} className={cn(bigBtn, "bg-white text-black disabled:opacity-40", focus)}>
                {busy ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Send className="h-5 w-5" aria-hidden />}
                <span>{busy ? "Working on it" : isFile ? `Send to ${insurer}` : dirty ? "Save my words and send" : "Send this email"}</span>
              </button>
            )}
            <button type="button" onClick={() => void decide("decline")} disabled={busy} className={cn("ia-press mt-2 flex h-12 w-full items-center justify-center rounded-2xl text-[1.0625rem] font-medium text-white/70 disabled:opacity-40", focus)}>
              No, don't
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
