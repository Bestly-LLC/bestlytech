/**
 * /admin/settlements: Nickel, Settlements Clerk (team slug settlements). Migrations 20261010240000_settlements_nickel.sql onward.
 * Nickel finds class action settlements Jared may qualify for, files them after his "Yes, file all", and checks them off as paid
 * (Mercury deposit, USPS mail scan, payment email, or the Got paid button). Not to be confused with /admin/claims (Turo damage claims).
 *
 * Layout v2 (Jared, 2026-10-10): summary strip that doubles as the tab bar, one queue at a time on the left, a right rail for
 * claim details / answers / recent activity / things to sort. Every change can be undone (toast + Recent list -> settlement_undo_last),
 * and any claim can be archived.
 *
 * Hard rule: a claim form is a sworn statement. "Yes, file all" only approves the Ready claims on screen (ids passed explicitly).
 */
import { Lines } from "@/components/Lines";
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BadgeDollarSign, Check, CircleAlert, ExternalLink, FileCheck2, History, Inbox, Loader2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section, Sheet, btnDestructivePlain, btnPlain, btnPrimary, btnTinted, card, field, label, secondary, tertiary, tint } from "./laxUi";
import { count, rpc, shortDay, shortTime, usd, dayFromYmd, daysUntil } from "./settlementsShared";
import { DigestCard, Digest, Fact, Profile, ProfileCard } from "./settlementsParts";
import { Claim, ClaimCard, Payment } from "./settlementsCard";

type Unmatched = { id: number; via: "mail" | "email"; summary: string | null; amount_cents: number | null; at: string };
type BankUnmatched = { id: number; txn_id: string; amount_cents: number | null; posted_at: string | null; counterparty: string | null; description: string | null; why: string | null };
type Board = {
  claims: Claim[]; unmatched: Unmatched[]; paid_total_cents: number; paid_count: number; paid_unknown_amount: number; last_scan: string | null;
  open_settlements?: number; worker: { last_ok_at: string | null; last_summary: string | null; ok: boolean | null } | null;
  filer?: { at: string; ok: boolean; summary: string | null } | null;
};
type Change = { id: number; at: string; claim_id: string; name: string; by: string; is_undo: boolean; from_status: string; to_status: string; archive_change: boolean; archived: boolean; undoable: boolean };
type Tab = "needs" | "questions" | "ready" | "filing" | "waiting" | "paid" | "skipped" | "archived";

const STATUS: Record<string, string> = {
  found: "Question", ready: "Ready to file", approved: "Approved", filing: "Filing", needs_you: "Needs you", filed: "Filed",
  paid: "Paid", denied: "Denied", skipped: "Skipped", expired: "Expired",
};
const TAB_ORDER: Tab[] = ["needs", "questions", "ready", "filing", "waiting", "paid", "skipped", "archived"];
const TAB_LABEL: Record<Tab, string> = {
  needs: "Needs you", questions: "Questions", ready: "Ready to file", filing: "Being filed", waiting: "Waiting for money",
  paid: "Paid", skipped: "Said no", archived: "Archived",
};
const TAB_HINT: Record<Tab, string> = {
  needs: "Nickel filled these in, but the site wants something only you have (usually a claim code from your notice or a CAPTCHA).",
  questions: "A yes moves it to Ready to file. Nothing is filed until you tap Yes, file all.",
  ready: "",
  filing: "Approved. The Claim Filer on the Mac mini submits these every 30 minutes.",
  waiting: "Filed. Nickel watches Mercury, your USPS mail scans and your inbox for the money.",
  paid: "Money received. Mercury deposits are matched automatically.",
  skipped: "Settlements you said no to. Change your answer if you were wrong.",
  archived: "Hidden from every other list. Restore one to bring it back.",
};

function tabOf(c: Claim): Tab | null {
  if (c.archived_at || c.status === "denied" || c.status === "expired") return "archived";
  switch (c.status) {
    case "needs_you": return "needs";
    case "found": return c.match === "ask" ? "questions" : null;
    case "ready": return "ready";
    case "approved": case "filing": return "filing";
    case "filed": return "waiting";
    case "paid": return "paid";
    case "skipped": return c.match === "ask" ? "skipped" : null;
    default: return null;
  }
}

export default function Settlements() {
  const [board, setBoard] = useState<Board | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [bank, setBank] = useState<BankUnmatched[]>([]);
  const [changes, setChanges] = useState<Change[]>([]);
  const [paidSheet, setPaidSheet] = useState<{ id: string; name: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [digest, setDigest] = useState<Digest | null | undefined>(undefined);
  const [digestBusy, setDigestBusy] = useState(false);
  const [tab, setTab] = useState<Tab | null>(null);
  const [params] = useSearchParams();
  const digestId = params.get("digest");

  const load = useCallback(async () => {
    const [b, p, u, r] = await Promise.all([
      rpc<Board>("settlements_board"),
      rpc<Payment[]>("settlement_payments_list"),
      rpc<BankUnmatched[]>("settlement_bank_unmatched_list"),
      rpc<Change[]>("settlement_recent_changes", { p_limit: 12 }),
    ]);
    if (b.error) toast.error(b.error.message); else if (b.data) setBoard(b.data);
    if (!p.error && Array.isArray(p.data)) setPayments(p.data);
    if (!u.error && Array.isArray(u.data)) setBank(u.data);
    if (!r.error && Array.isArray(r.data)) setChanges(r.data);
  }, []);
  const loadProfile = useCallback(async () => {
    const { data, error } = await rpc<Profile>("settlement_profile_get");
    setProfile(error ? null : (data ?? {}));
  }, []);
  const loadFacts = useCallback(async () => {
    const { data, error } = await rpc<Fact[]>("settlement_facts_list");
    setFacts(error || !Array.isArray(data) ? null : data);
  }, []);
  const loadDigest = useCallback(async () => {
    if (!digestId) { setDigest(undefined); return; }
    const { data, error } = await rpc<Digest>("settlement_digest_get", { p_digest: digestId });
    if (error) { toast.error(error.message); setDigest(null); return; }
    setDigest(data ?? null);
  }, [digestId]);
  useEffect(() => {
    void load(); void loadProfile(); void loadFacts();
    const t = setInterval(() => { if (!document.hidden) { void load(); void loadFacts(); } }, 60000);
    return () => clearInterval(t);
  }, [load, loadProfile, loadFacts]);
  useEffect(() => { void loadDigest(); }, [loadDigest]);

  /* ---------------------------------------------------------------- lists */
  const lists = useMemo(() => {
    const out: Record<Tab, Claim[]> = { needs: [], questions: [], ready: [], filing: [], waiting: [], paid: [], skipped: [], archived: [] };
    for (const c of board?.claims ?? []) { const t = tabOf(c); if (t) out[t].push(c); }
    out.paid.sort((a, b) => Date.parse(b.paid_at ?? "0") - Date.parse(a.paid_at ?? "0"));
    out.archived.sort((a, b) => Date.parse(b.archived_at ?? b.updated_at ?? "0") - Date.parse(a.archived_at ?? a.updated_at ?? "0"));
    return out;
  }, [board]);
  const payByClaim = useMemo(() => {
    const m = new Map<string, Payment[]>();
    for (const p of payments) { const xs = m.get(p.claim_id) ?? []; xs.push(p); m.set(p.claim_id, xs); }
    return m;
  }, [payments]);
  const paidTotal = lists.paid.reduce((n, c) => n + (c.amount_cents ?? 0), 0);
  const paidUnknown = lists.paid.filter((c) => c.amount_cents == null).length;
  const nextDeadline = useMemo(() => {
    const open = [...lists.needs, ...lists.questions, ...lists.ready].map((c) => c.settlement.deadline).filter((d): d is string => !!d && daysUntil(d) >= 0);
    return open.sort()[0] ?? null;
  }, [lists]);
  const activeTab: Tab = tab ?? (TAB_ORDER.find((t) => t !== "skipped" && t !== "archived" && lists[t].length > 0) ?? "questions");

  /* ---------------------------------------------------------------- actions (all undoable) */
  const undoClaims = useCallback(async (ids: string[]) => {
    let ok = 0; let msg = "";
    for (const id of ids) {
      const { error } = await rpc("settlement_undo_last", { p_claim: id });
      if (error) msg = error.message; else ok += 1;
    }
    if (ok) toast.success(ok === 1 ? "Undone." : `Undid ${ok}.`);
    if (msg) toast.error(msg);
    void load(); void loadFacts();
  }, [load, loadFacts]);

  /** Optimistic update, the RPC, roll back on failure, then a toast with Undo. */
  const act = useCallback(async (optimistic: (b: Board) => Board, call: () => Promise<{ error: { message: string } | null }>, ok: string, undo?: () => void) => {
    const before = board;
    if (before) setBoard(optimistic(before));
    const { error } = await call();
    if (error) { if (before) setBoard(before); toast.error(error.message); return false; }
    toast.success(ok, undo ? { action: { label: "Undo", onClick: undo }, duration: 8000 } : undefined);
    void load();
    return true;
  }, [board, load]);
  const patch = (ids: string[], f: (c: Claim) => Claim) => (b: Board): Board => ({ ...b, claims: b.claims.map((c) => (ids.includes(c.id) ? f(c) : c)) });

  const approveAll = () => {
    const ids = lists.ready.map((c) => c.id);
    if (!ids.length) return;
    void act(patch(ids, (c) => ({ ...c, status: "approved", approved_at: new Date().toISOString() })),
      () => rpc("settlement_approve_all", { p_ids: ids }),
      `Approved ${ids.length}. The Claim Filer submits ${ids.length === 1 ? "it" : "them"} within 30 minutes.`, () => void undoClaims(ids));
  };
  const setFact = useCallback(async (key: string, answer: boolean | null) => {
    const { error } = await rpc<number>("settlement_fact_set", { p_key: key, p_answer: answer });
    if (error) { toast.error(error.message); return false; }
    void load(); void loadFacts();
    return true;
  }, [load, loadFacts]);
  const answer = (group: Claim[], yes: boolean) => {
    const c = group[0];
    const ids = group.map((x) => x.id);
    const before = board;
    if (before) setBoard(patch(ids, (x) => ({ ...x, status: yes ? "ready" : "skipped", answer: yes }))(before));
    const done = (ok: boolean) => {
      if (!ok) { if (before) setBoard(before); return; }
      const undo = c.fact_key ? () => void setFact(c.fact_key!, null).then((r) => r && toast.success("Undone.")) : () => void undoClaims([c.id]);
      toast.success(yes ? (ids.length === 1 ? "Moved it to Ready to file." : `Moved ${ids.length} settlements to Ready to file.`) : "Got it. Nickel won't file it.",
        { action: { label: "Undo", onClick: undo }, duration: 8000 });
    };
    if (c.fact_key) void setFact(c.fact_key, yes).then(done);
    else void rpc("settlement_answer", { p_id: c.id, p_yes: yes }).then(({ error }) => { if (error) toast.error(error.message); else { void load(); void loadFacts(); } done(!error); });
  };
  const skip = (c: Claim) => void act(patch([c.id], (x) => ({ ...x, status: "skipped" })), () => rpc("settlement_skip", { p_id: c.id }),
    "Skipped. Nickel won't file it.", () => void undoClaims([c.id]));
  const archive = (c: Claim, on: boolean) => void act(patch([c.id], (x) => ({ ...x, archived_at: on ? new Date().toISOString() : null })),
    () => rpc("settlement_archive", { p_id: c.id, p_on: on }), on ? "Archived." : "Restored.", () => void undoClaims([c.id]));
  const markFiled = (c: Claim, conf: string) => void act(
    patch([c.id], (x) => ({ ...x, status: "filed", filed_at: new Date().toISOString(), confirmation: conf || x.confirmation, needs_you_url: null, needs_you_why: null })),
    () => rpc("settlement_mark_filed", { p_id: c.id, p_confirmation: conf || null }), "Marked as filed. Nickel watches for the money.", () => void undoClaims([c.id]));
  const openPaid = (c: Claim) => { setAmount(c.amount_cents != null ? (c.amount_cents / 100).toFixed(2) : ""); setPaidSheet({ id: c.id, name: c.settlement.name }); };
  const submitPaid = () => {
    if (!paidSheet) return;
    const n = parseFloat(amount);
    const cents = amount.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
    const { id } = paidSheet;
    setPaidSheet(null);
    void act(patch([id], (x) => ({ ...x, status: "paid", paid_at: x.paid_at ?? new Date().toISOString(), paid_via: x.paid_via ?? "button", amount_cents: cents ?? x.amount_cents })),
      () => rpc("settlement_mark_paid", { p_id: id, p_amount_cents: cents }), cents ? `Saved ${usd(cents)}.` : "Checked off as paid.", () => void undoClaims([id]));
  };
  const resolveMail = (u: Unmatched, claim: Claim | null) => void act(
    (b) => ({ ...b, unmatched: b.unmatched.filter((x) => x.id !== u.id) }),
    () => rpc("settlement_unmatched_resolve", { p_unmatched: u.id, p_claim: claim?.id ?? null }),
    claim ? `Checked off ${claim.settlement.name}.` : "Dismissed.", claim ? () => void undoClaims([claim.id]) : undefined);
  const resolveBank = async (u: BankUnmatched, claim: Claim | null) => {
    setBank((xs) => xs.filter((x) => x.id !== u.id));
    const { error } = await rpc("settlement_bank_unmatched_resolve", { p_unmatched: u.id, p_claim: claim?.id ?? null });
    if (error) { toast.error(error.message); void load(); return; }
    toast.success(claim ? `Matched to ${claim.settlement.name}.` : "Dismissed.", claim ? { action: { label: "Undo", onClick: () => void undoClaims([claim.id]) }, duration: 8000 } : undefined);
    void load();
  };
  const confirmDigest = async () => {
    if (!digestId || !digest || digestBusy) return;
    setDigestBusy(true);
    const before = digest;
    const ids = new Set(digest.claims.filter((c) => c.status === "ready").map((c) => c.id));
    setDigest({ ...digest, acted_at: new Date().toISOString(), approved_n: ids.size, claims: digest.claims.map((c) => (ids.has(c.id) ? { ...c, status: "approved" } : c)) });
    const { data, error } = await rpc<{ state: string; n: number }>("settlement_digest_confirm", { p_digest: digestId });
    setDigestBusy(false);
    if (error) { setDigest(before); toast.error(error.message); return; }
    if (data?.state === "approved") toast.success(`Approved ${data.n}. The Claim Filer submits ${data.n === 1 ? "it" : "them"} within 30 minutes.`, { action: { label: "Undo", onClick: () => void undoClaims([...ids]) }, duration: 8000 });
    else if (data?.state === "already") toast.message("That digest was already approved.");
    else toast.error("That digest can no longer be approved. Review Ready to file below.");
    void load(); void loadDigest();
  };

  /* ---------------------------------------------------------------- question groups (one card per shared fact) */
  const questionGroups = useMemo(() => {
    const groups: Claim[][] = [];
    const byKey = new Map<string, Claim[]>();
    for (const c of lists.questions) {
      if (c.fact_key) { const g = byKey.get(c.fact_key); if (g) g.push(c); else { const n = [c]; byKey.set(c.fact_key, n); groups.push(n); } }
      else groups.push([c]);
    }
    return groups;
  }, [lists.questions]);

  const waitingAndPaid = [...lists.waiting, ...lists.paid];
  const scanLine = board?.last_scan ? <>Scanned <span className="whitespace-nowrap">{shortDay(board.last_scan)}, {shortTime(board.last_scan)}</span></> : "No scan yet";

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <PageHeader title="Settlements" description="Nickel, Settlements Clerk" />
        {board && (
          <p className={cn("pb-1 text-[13px]", secondary)}>
            {scanLine}{board.open_settlements != null && <> · <span className="whitespace-nowrap">{board.open_settlements} open settlements checked</span></>}
            {board.filer?.summary && <> · Filer: {board.filer.summary}</>}
            {board.worker && board.worker.ok === false && <span className={tint.orange}> · Last scan had a problem</span>}
          </p>
        )}
      </div>

      {!board ? <Loader2 className="mt-6 h-5 w-5 animate-spin text-white/50" aria-label="Loading" /> : (
        <>
          {/* Summary strip, which is also the tab bar for the main queues. */}
          <div className="mt-4 grid grid-cols-3 gap-2 lg:grid-cols-6">
            <Stat active={activeTab === "paid"} onClick={() => setTab("paid")} label="Received" tone="green"
              value={<span className="whitespace-nowrap">{usd(paidTotal)}</span>}
              sub={lists.paid.length ? <>{count(lists.paid.length, "settlement")}{paidUnknown ? `, ${paidUnknown} amount unknown` : ""}</> : "Nothing yet"} />
            <Stat active={activeTab === "needs"} onClick={() => setTab("needs")} label="Needs you" value={lists.needs.length} tone={lists.needs.length ? "orange" : undefined} sub="Codes, CAPTCHAs" />
            <Stat active={activeTab === "questions"} onClick={() => setTab("questions")} label="Questions" value={questionGroups.length} tone={questionGroups.length ? "blue" : undefined}
              sub={lists.questions.length > questionGroups.length ? count(lists.questions.length, "settlement") : "Yes or no"} />
            <Stat active={activeTab === "ready"} onClick={() => setTab("ready")} label="Ready to file" value={lists.ready.length} tone={lists.ready.length ? "blue" : undefined} sub="Needs your yes" />
            <Stat active={activeTab === "filing" || activeTab === "waiting"} onClick={() => setTab(lists.filing.length ? "filing" : "waiting")} label="In progress"
              value={lists.filing.length + lists.waiting.length} sub={<>{count(lists.filing.length, "filing", "filing")} · {count(lists.waiting.length, "filed", "filed")}</>} />
            <Stat label="Next deadline" value={nextDeadline ? <span className="whitespace-nowrap">{dayFromYmd(nextDeadline)}</span> : "None"}
              tone={nextDeadline && daysUntil(nextDeadline) < 7 ? "orange" : undefined}
              sub={nextDeadline ? <span className="whitespace-nowrap">{daysUntil(nextDeadline)} days left</span> : "Nothing open"} />
          </div>

          {profile && !profile.confirmed_at && (
            <a href="#claim-details" className={cn(card, "mt-3 flex items-center gap-2.5 p-3.5 ring-1 ring-[#FF9F0A66] bento:ring-[#FF950066]")}>
              <CircleAlert className={cn("h-5 w-5 shrink-0", tint.orange)} aria-hidden />
              <span className={cn("text-[15px] font-medium leading-snug", label)}>Nickel can&rsquo;t file anything until you confirm your claim details.</span>
            </a>
          )}

          {digestId && digest !== undefined && (
            <div className="mt-4"><DigestCard digest={digest} detailsConfirmed={profile == null || !!profile.confirmed_at} busy={digestBusy} onConfirm={() => void confirmDigest()} /></div>
          )}

          <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* ------------------------------------------------ main queue */}
            <main className="min-w-0">
              <nav aria-label="Lists" className="flex flex-wrap gap-1.5">
                {TAB_ORDER.map((t) => {
                  const n = t === "questions" ? questionGroups.length : lists[t].length;
                  if (!n && t !== activeTab && (t === "skipped" || t === "archived" || t === "filing")) return null;
                  return (
                    <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={activeTab === t}
                      className={cn("inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-semibold transition-colors duration-150",
                        activeTab === t ? "bg-[#636366] text-[#fff] bento:bg-[#000] bento:text-[#fff]" : "bg-[#7676803d] text-[#fff] hover:bg-[#76768052] bento:bg-[#7676801f] bento:text-[#000]")}>
                      {TAB_LABEL[t]} <span className={cn("tabular-nums", activeTab === t ? "opacity-80" : "opacity-60")}>{n}</span>
                    </button>
                  );
                })}
              </nav>
              {TAB_HINT[activeTab] && <p className={cn("mt-2 text-[13px] leading-snug", secondary)}>{TAB_HINT[activeTab]}</p>}

              <div className="mt-3 space-y-3">
                {activeTab === "ready" && lists.ready.length > 0 && (
                  <div className={cn(card, "sticky top-2 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 p-3.5 ring-1 ring-[#0A84FF66] bento:ring-[#007AFF66]")}>
                    <button type="button" className={cn(btnPrimary, "basis-full sm:basis-auto")} onClick={approveAll}>
                      <FileCheck2 className="h-5 w-5" aria-hidden /> Yes, file all <span className="whitespace-nowrap">({lists.ready.length})</span>
                    </button>
                    <p className={cn("min-w-0 flex-1 basis-60 text-[13.5px] leading-snug", label)}>
                      Tapping yes means you&rsquo;re swearing you&rsquo;re part of each class below. Not sure about one? Skip it first.
                    </p>
                  </div>
                )}

                {activeTab === "questions" && questionGroups.map((g) => {
                  const c = g[0];
                  return (
                    <ClaimCard key={c.fact_key ?? c.id} c={c} onArchive={archive} highlight="blue"
                      actions={<>
                        <button type="button" className={cn(btnPrimary, "min-w-[84px]")} onClick={() => answer(g, true)}>Yes</button>
                        <button type="button" className={cn(btnTinted, "min-w-[84px]")} onClick={() => answer(g, false)}>No</button>
                      </>}>
                      <div className="mt-3">
                        <p className={cn("text-[16px] font-semibold leading-snug", label)}>{c.question ?? "Were you part of this class?"}</p>
                        {g.length > 1 && (
                          <p className={cn("mt-1 text-[13px] leading-snug", tint.blue)}>
                            Your answer also covers {g.slice(1).map((x) => x.settlement.name).join(", ")}.
                          </p>
                        )}
                        {c.fact_key && g.length === 1 && <p className={cn("mt-1 text-[13px]", secondary)}>Nickel remembers your answer for any matching settlement.</p>}
                      </div>
                    </ClaimCard>
                  );
                })}

                {activeTab === "ready" && lists.ready.map((c) => (
                  <ClaimCard key={c.id} c={c} onArchive={archive}
                    actions={<button type="button" className={btnDestructivePlain} onClick={() => skip(c)}><X className="h-4 w-4" aria-hidden /> Skip</button>} />
                ))}

                {activeTab === "needs" && lists.needs.map((c) => <NeedsYou key={c.id} c={c} onFiled={markFiled} onArchive={archive} />)}

                {activeTab === "filing" && lists.filing.map((c) => (
                  <ClaimCard key={c.id} c={c} onArchive={archive}
                    actions={<>
                      <span className={cn("inline-flex items-center gap-1.5 text-[13.5px]", secondary)}>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {c.status === "filing" ? "Filing now" : <>Approved <span className="whitespace-nowrap">{shortDay(c.approved_at)}</span></>}
                      </span>
                      {c.status === "approved" && <button type="button" className={cn(btnPlain, "text-[14px]")} onClick={() => void undoClaims([c.id])}><Undo2 className="h-4 w-4" aria-hidden /> Take back</button>}
                    </>} />
                ))}

                {activeTab === "waiting" && lists.waiting.map((c) => (
                  <ClaimCard key={c.id} c={c} payments={payByClaim.get(c.id)} onArchive={archive}
                    actions={<button type="button" className={btnTinted} onClick={() => openPaid(c)}><BadgeDollarSign className="h-4 w-4" aria-hidden /> Got paid</button>}>
                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-3">
                      <Info term="Filed" value={c.filed_at ? shortDay(c.filed_at) : "Date unknown"} />
                      <Info term="Confirmation" value={c.confirmation || "None yet"} breakAll />
                      <Info term="Paid by" value={c.payout_method || "Not recorded"} />
                    </dl>
                  </ClaimCard>
                ))}

                {activeTab === "paid" && lists.paid.map((c) => (
                  <ClaimCard key={c.id} c={c} payments={payByClaim.get(c.id)} onArchive={archive}
                    actions={<>
                      {c.amount_cents != null
                        ? <span className={cn("whitespace-nowrap text-[17px] font-bold tabular-nums", tint.green)}>{usd(c.amount_cents)}</span>
                        : <button type="button" className={btnTinted} onClick={() => openPaid(c)}>Add amount</button>}
                      <span className={cn("text-[13px]", secondary)}>
                        {c.paid_source === "mercury" ? "Mercury deposit" : c.paid_via === "mail" ? "USPS mail scan" : c.paid_via === "email" ? "Payment email" : "You marked it"} · <span className="whitespace-nowrap">{shortDay(c.paid_at)}</span>
                      </span>
                      <button type="button" className={cn(btnPlain, "text-[14px]")} onClick={() => void undoClaims([c.id])}><Undo2 className="h-4 w-4" aria-hidden /> Not paid</button>
                    </>} />
                ))}

                {activeTab === "skipped" && lists.skipped.map((c) => (
                  <ClaimCard key={c.id} c={c} onArchive={archive}
                    actions={<button type="button" className={btnTinted} onClick={() => (c.fact_key ? answer([c], true) : void undoClaims([c.id]))}>Actually, yes</button>} />
                ))}

                {activeTab === "archived" && lists.archived.map((c) => (
                  <ClaimCard key={c.id} c={c} payments={payByClaim.get(c.id)} onArchive={c.archived_at ? archive : undefined}
                    actions={<span className={cn("text-[13px]", secondary)}>{STATUS[c.status] ?? c.status}{c.archived_at ? <> · archived <span className="whitespace-nowrap">{shortDay(c.archived_at)}</span></> : ""}</span>} />
                ))}

                {(activeTab === "questions" ? questionGroups.length : lists[activeTab].length) === 0 && (
                  <div className={cn(card, "py-8 text-center")}>
                    <Inbox className={cn("mx-auto h-7 w-7", tertiary)} aria-hidden />
                    <p className={cn("mt-2 text-[15px] font-semibold", label)}>Nothing in {TAB_LABEL[activeTab]}</p>
                    <p className={cn("mx-auto mt-1 max-w-sm text-[14px] leading-snug", secondary)}>
                      Nickel scans every morning at <span className="whitespace-nowrap">7:20 AM</span> and sends one digest at <span className="whitespace-nowrap">9:05 AM</span>.
                    </p>
                  </div>
                )}
              </div>
            </main>

            {/* ------------------------------------------------ right rail */}
            <aside className="min-w-0 space-y-6">
              {profile && <div id="claim-details" className="scroll-mt-24"><ProfileCard profile={profile} onSaved={setProfile} /></div>}

              {(board.unmatched.length > 0 || bank.length > 0) && (
                <Section title="To sort" footer="Looks like settlement money, but Nickel couldn't tell which claim. Assigning one checks it off as paid.">
                  {bank.map((u) => <SortRow key={`b${u.id}`} kind="Mercury" when={u.posted_at} amount={u.amount_cents} text={[u.counterparty, u.description].filter(Boolean).join(" · ") || "Deposit"}
                    claims={waitingAndPaid} onResolve={(c) => void resolveBank(u, c)} />)}
                  {board.unmatched.map((u) => <SortRow key={`m${u.id}`} kind={u.via === "mail" ? "USPS mail" : "Email"} when={u.at} amount={u.amount_cents} text={u.summary || "No description"}
                    claims={waitingAndPaid} onResolve={(c) => resolveMail(u, c)} />)}
                </Section>
              )}

              {changes.length > 0 && (
                <Section title="Recent">
                  <section className={cn(card, "p-3")}>
                    <ul className="divide-y divide-[#38383A] bento:divide-[#C6C6C8]">
                      {changes.slice(0, 10).map((e) => (
                        <li key={e.id} className="flex items-start gap-2.5 py-2 first:pt-0.5 last:pb-0.5">
                          <History className={cn("mt-0.5 h-4 w-4 shrink-0", tertiary)} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-[13.5px] font-medium leading-snug", label)}>{e.name}</p>
                            <p className={cn("text-[12.5px] leading-snug", secondary)}>
                              {e.is_undo ? "Undone: " : ""}
                              {e.archive_change ? (e.archived ? "Archived" : "Restored") : <>{STATUS[e.from_status] ?? e.from_status} → {STATUS[e.to_status] ?? e.to_status}</>}
                              {" · "}{e.by === "jared" ? "you" : "Nickel"} · <span className="whitespace-nowrap">{shortDay(e.at)}, {shortTime(e.at)}</span>
                            </p>
                          </div>
                          {e.undoable && (
                            <button type="button" className={cn(btnPlain, "shrink-0 text-[13px]")} onClick={() => void undoClaims([e.claim_id])} aria-label={`Undo ${e.name}`}>
                              <Undo2 className="h-4 w-4" aria-hidden /> Undo
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                </Section>
              )}

              {facts && facts.length > 0 && <Answers facts={facts} onSet={(k, a) => {
                const prev = facts.find((f) => f.key === k)?.answer ?? null;
                setFacts(facts.map((f) => (f.key === k ? { ...f, answer: a, answered_at: a == null ? null : new Date().toISOString() } : f)));
                void setFact(k, a).then((ok) => ok && toast.success(a == null ? "Forgotten." : "Saved.", { action: { label: "Undo", onClick: () => void setFact(k, prev) }, duration: 8000 }));
              }} />}
            </aside>
          </div>
        </>
      )}

      <Sheet open={!!paidSheet} onClose={() => setPaidSheet(null)} title="Got paid"
        footer={<button type="button" className={cn(btnPrimary, "w-full")} onClick={submitPaid}><Check className="h-4 w-4" aria-hidden /> Mark as paid</button>}>
        <p className={cn("text-[15px] font-medium leading-snug", label)}>{paidSheet?.name}</p>
        <label className="mt-3 block">
          <span className={cn("text-[13px]", secondary)}>How much did you get? (optional)</span>
          <div className="relative mt-1">
            <span className={cn("pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[16px]", secondary)}>$</span>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00"
              className={cn(field, "pl-7")} aria-label="Amount received in dollars" onKeyDown={(e) => { if (e.key === "Enter") submitPaid(); }} />
          </div>
        </label>
        <p className={cn("mt-2 text-[13px] leading-snug", secondary)}>Leave it blank if you don&rsquo;t know yet. A Mercury deposit fills it in automatically.</p>
      </Sheet>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Stat({ label: text, value, sub, tone, active, onClick }: {
  label: string; value: ReactNode; sub?: ReactNode; tone?: "green" | "orange" | "blue"; active?: boolean; onClick?: () => void;
}) {
  const body = (
    <>
      <span className={cn("block text-[11px] font-semibold uppercase leading-tight tracking-[0.03em] sm:text-[12px]", secondary)}>{text}</span>
      <span className={cn("mt-1 block text-[20px] font-bold leading-none sm:text-[24px] tabular-nums tracking-[-0.02em]", tone ? tint[tone] : label)}>{value}</span>
      {sub && <span className={cn("mt-1.5 block text-[12px] leading-snug sm:text-[12.5px]", secondary)}><Lines>{sub}</Lines></span>}
    </>
  );
  const cls = cn(card, "flex h-full flex-col items-start justify-start p-3 text-left sm:p-3.5 transition-[box-shadow,transform] duration-150", active && "ring-2 ring-[#0A84FF] bento:ring-[#007AFF]");
  return onClick
    ? <button type="button" onClick={onClick} aria-pressed={active} className={cn(cls, "active:scale-[0.98]")}>{body}</button>
    : <div className={cls}>{body}</div>;
}

function Info({ term, value, breakAll }: { term: string; value: string; breakAll?: boolean }) {
  return <div><dt className={tertiary}>{term}</dt><dd className={cn(breakAll ? "break-all" : "", label)}>{value}</dd></div>;
}

function NeedsYou({ c, onFiled, onArchive }: { c: Claim; onFiled: (c: Claim, conf: string) => void; onArchive: (c: Claim, on: boolean) => void }) {
  const [conf, setConf] = useState("");
  return (
    <ClaimCard c={c} onArchive={onArchive} highlight="orange"
      actions={<>
        {c.needs_you_url && <a href={c.needs_you_url} target="_blank" rel="noreferrer" className={btnPrimary}>Open the form <ExternalLink className="h-4 w-4" aria-hidden /></a>}
        <span className="flex flex-1 basis-64 items-center gap-2">
          <input value={conf} onChange={(e) => setConf(e.target.value)} placeholder="Confirmation #" className={cn(field, "w-36 min-w-0 flex-1 py-2 sm:max-w-[11rem]")}
            aria-label="Confirmation number" autoCapitalize="characters" />
          <button type="button" className={cn(btnTinted, "shrink-0")} onClick={() => onFiled(c, conf.trim())}><Check className="h-4 w-4" aria-hidden /> I submitted it</button>
        </span>
      </>}>
      <p className={cn("mt-3 flex items-start gap-1.5 rounded-[12px] bg-[#FF9F0A1a] px-3 py-2.5 text-[14.5px] font-medium leading-snug bento:bg-[#FF95001a]", label)}>
        <CircleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", tint.orange)} aria-hidden />
        <span>{c.needs_you_why || "Nickel could not finish this one and needs you to submit it."}</span>
      </p>
    </ClaimCard>
  );
}

function SortRow({ kind, when, amount, text, claims, onResolve }: {
  kind: string; when: string | null; amount: number | null; text: string; claims: Claim[]; onResolve: (c: Claim | null) => void;
}) {
  const [pick, setPick] = useState("");
  const chosen = claims.find((c) => c.id === pick) ?? null;
  return (
    <section className={cn(card, "p-3.5")}>
      <p className={cn("text-[12.5px]", secondary)}>
        {kind}{when && <> · <span className="whitespace-nowrap">{shortDay(when)}</span></>}{amount != null && <> · <span className="whitespace-nowrap font-semibold">{usd(amount)}</span></>}
      </p>
      <p className={cn("mt-0.5 text-[14px] leading-snug", label)}>{text}</p>
      {claims.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={cn(field, "min-w-0 flex-1 basis-40 py-2")} aria-label="Which claim is this for">
            <option value="">Which claim?</option>
            {claims.map((c) => <option key={c.id} value={c.id}>{c.settlement.name}</option>)}
          </select>
          <button type="button" className={btnTinted} disabled={!chosen} onClick={() => onResolve(chosen)}>Assign</button>
        </div>
      ) : <p className={cn("mt-1 text-[13px]", secondary)}>No filed claims to assign it to yet.</p>}
      <button type="button" className={cn(btnDestructivePlain, "mt-1")} onClick={() => onResolve(null)}>Dismiss</button>
    </section>
  );
}

/** Your answers: open questions first; answered ones fold away so the rail stays short. */
function Answers({ facts, onSet }: { facts: Fact[]; onSet: (key: string, answer: boolean | null) => void }) {
  const open = facts.filter((f) => f.answer == null);
  const yes = facts.filter((f) => f.answer === true);
  const no = facts.filter((f) => f.answer === false);
  const Row = ({ f }: { f: Fact }) => (
    <li className="py-2.5 first:pt-0.5 last:pb-0.5">
      <p className={cn("text-[14px] leading-snug", label)}>{f.question}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={f.answer === true} className={cn(f.answer === true ? btnPrimary : btnTinted, "min-h-[32px] min-w-[56px] px-3 text-[13px]")} onClick={() => onSet(f.key, true)}>Yes</button>
        <button type="button" aria-pressed={f.answer === false} className={cn(f.answer === false ? btnPrimary : btnTinted, "min-h-[32px] min-w-[56px] px-3 text-[13px]")} onClick={() => onSet(f.key, false)}>No</button>
        {f.answer != null && <button type="button" className={cn(btnDestructivePlain, "ml-1")} onClick={() => onSet(f.key, null)}>Forget</button>}
        {f.claims_count > 0 && <span className={cn("ml-auto text-[12px]", tertiary)}>{count(f.claims_count, "settlement")}</span>}
      </div>
    </li>
  );
  const Group = ({ title, xs, startOpen }: { title: string; xs: Fact[]; startOpen?: boolean }) => xs.length ? (
    <details className="group" open={startOpen}>
      <summary className={cn("flex min-h-[40px] cursor-pointer list-none items-center justify-between text-[14px] font-semibold", label)}>
        <span>{title}</span><span className={cn("tabular-nums", secondary)}>{xs.length}</span>
      </summary>
      <ul className="divide-y divide-[#38383A] bento:divide-[#C6C6C8]">{xs.map((f) => <Row key={f.key} f={f} />)}</ul>
    </details>
  ) : null;
  return (
    <Section title="Your answers" footer="Answer once. Nickel reuses it for every matching settlement, and you can change any answer.">
      <section className={cn(card, "space-y-1 p-3.5")}>
        <Group title="Not answered" xs={open} startOpen />
        <Group title="You said yes" xs={yes} />
        <Group title="You said no" xs={no} />
      </section>
    </Section>
  );
}

