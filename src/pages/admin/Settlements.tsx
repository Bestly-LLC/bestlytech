/**
 * /admin/settlements: Nickel, Settlements Clerk (team slug settlements). Migration 20261010240000_settlements_nickel.sql.
 * Nickel finds class action settlements Jared may qualify for, files them after one "Yes, file all" tap, and checks them off as paid
 * (USPS mail scan, payment email, or the Got paid button). This page talks only to the admin RPCs settlements_board / settlement_*.
 * Not to be confused with /admin/claims (Claims Closer, Turo damage claims).
 *
 * Hard rule: a claim form is a sworn statement. "Yes, file all" only approves the claims that are on screen when it is tapped
 * (the ids are passed explicitly), so nothing Jared has not seen can be approved.
 */
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BadgeDollarSign, Check, ChevronRight, CircleAlert, ExternalLink, FileCheck2, Loader2, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/admin/PageHeader";
import { Section, Sheet, btnDestructivePlain, btnPlain, btnPrimary, btnTinted, card, field, label, secondary, tertiary, tint } from "./laxUi";
import { ClassDefinition, DeadlineChip, Nb, count, rpc, shortDay, shortTime, usd } from "./settlementsShared";
import { DigestCard, Digest, Fact, FactsSection, Profile, ProfileCard } from "./settlementsParts";

type Evidence = { kind?: string; ref?: string; summary?: string };
type SettlementInfo = { name: string; defendant: string | null; administrator: string | null; claim_url: string | null; info_url: string | null;
  class_definition: string | null; proof_required: boolean | null; est_payout: string | null; deadline: string | null; status: string };
type Claim = { id: string; status: string; match: string; evidence: Evidence[] | null; question: string | null; answer: boolean | null; approved_at: string | null;
  filed_at: string | null; confirmation: string | null; payout_method: string | null; needs_you_url: string | null; needs_you_why: string | null;
  amount_cents: number | null; paid_at: string | null; paid_via: "mail" | "email" | "button" | null; notes: string | null; settlement: SettlementInfo;
  fact_key?: string | null }; // fact_key: shared question key, read defensively (added to the board by the facts work)
type Unmatched = { id: number; via: "mail" | "email"; summary: string | null; amount_cents: number | null; at: string };
type Board = { claims: Claim[]; unmatched: Unmatched[]; paid_total_cents: number; paid_count: number; paid_unknown_amount: number; last_scan: string | null;
  worker: { last_ok_at: string | null; last_summary: string | null; ok: boolean | null } | null };

const VIA: Record<string, string> = { mail: "USPS mail", email: "Payment email", button: "You" };

function Why({ items }: { items: Evidence[] }) {
  if (!items.length) return <p className={cn("mt-2 text-[13px]", secondary)}>No records attached. Nickel is relying on your answer.</p>;
  return (
    <div className="mt-3">
      <p className={cn("text-[13px] font-semibold", label)}>Why Nickel thinks you qualify</p>
      <ul className="mt-1 space-y-1">
        {items.map((e, i) => (
          <li key={i} className={cn("flex items-start gap-2 text-[14px] leading-snug", secondary)}>
            <Check className={cn("mt-0.5 h-4 w-4 shrink-0", tint.green)} aria-hidden />
            <span><Nb text={e.summary ?? e.ref ?? "Matched your records"} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Facts({ s }: { s: SettlementInfo }) {
  return (
    <div className="mt-1 space-y-0.5">
      <p><DeadlineChip ymd={s.deadline} /></p>
      {s.est_payout && <p className={cn("text-[13px]", secondary)}>Estimated payout <span className={label}><Nb text={s.est_payout} /></span></p>}
      {s.proof_required != null && (
        <p className={cn("text-[13px]", secondary)}>{s.proof_required ? "Proof of purchase needed" : "No proof needed"}</p>
      )}
    </div>
  );
}

function Title({ s, right }: { s: SettlementInfo; right?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className={cn("text-[17px] font-semibold leading-snug", label)}>{s.name}</p>
        {(s.defendant || s.administrator) && (
          <p className={cn("text-[13px]", secondary)}>{[s.defendant && `Against ${s.defendant}`, s.administrator && `Run by ${s.administrator}`].filter(Boolean).join(" · ")}</p>
        )}
      </div>
      {right}
    </div>
  );
}

export default function Settlements() {
  const [board, setBoard] = useState<Board | null>(null);
  const [paidSheet, setPaidSheet] = useState<{ id: string; name: string; hasAmount: boolean } | null>(null);
  const [amount, setAmount] = useState("");
  // null = the RPC is not there (section stays hidden), undefined = still loading
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [facts, setFacts] = useState<Fact[] | null>(null);
  const [digest, setDigest] = useState<Digest | null | undefined>(undefined);
  const [digestBusy, setDigestBusy] = useState(false);
  const [params] = useSearchParams();
  const digestId = params.get("digest");

  const load = useCallback(async () => {
    const { data, error } = await rpc<Board>("settlements_board");
    if (error) { toast.error(error.message); return; }
    if (data) setBoard(data);
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

  /** Optimistic update: show the result now, call the database, put it back if it fails, then re-read the truth. */
  const act = useCallback(async (optimistic: (b: Board) => Board, call: () => Promise<{ error: { message: string } | null }>, ok: string) => {
    const before = board;
    if (before) setBoard(optimistic(before));
    const { error } = await call();
    if (error) { if (before) setBoard(before); toast.error(error.message); return false; }
    toast.success(ok);
    void load();
    return true;
  }, [board, load]);

  const patch = (id: string, f: (c: Claim) => Claim) => (b: Board): Board => ({ ...b, claims: b.claims.map((c) => (c.id === id ? f(c) : c)) });
  const by = (s: string) => board?.claims.filter((c) => c.status === s) ?? [];

  const ready = by("ready");
  const asks = (board?.claims ?? []).filter((c) => c.status === "found" && c.match === "ask");
  // Questions that share a fact_key are shown once ("applies to N settlements"); a claim with no fact_key stays on its own.
  const askGroups = useMemo(() => {
    const groups: { key: string | null; claims: Claim[] }[] = [];
    const byKey = new Map<string, { key: string | null; claims: Claim[] }>();
    for (const c of asks) {
      if (c.fact_key) {
        const g = byKey.get(c.fact_key);
        if (g) g.claims.push(c); else { const n = { key: c.fact_key, claims: [c] }; byKey.set(c.fact_key, n); groups.push(n); }
      } else groups.push({ key: null, claims: [c] });
    }
    return groups;
  }, [asks]); // eslint-disable-line react-hooks/exhaustive-deps
  const needs = by("needs_you");
  const filing = (board?.claims ?? []).filter((c) => c.status === "approved" || c.status === "filing");
  const filed = by("filed");
  const paid = useMemo(() => [...by("paid")].sort((a, b) => Date.parse(b.paid_at ?? "0") - Date.parse(a.paid_at ?? "0")), [board]); // eslint-disable-line react-hooks/exhaustive-deps
  const paidTotal = paid.reduce((n, c) => n + (c.amount_cents ?? 0), 0);
  const paidUnknown = paid.filter((c) => c.amount_cents == null).length;

  const approveAll = () => {
    const ids = ready.map((c) => c.id);
    if (!ids.length) return;
    void act(
      (b) => ({ ...b, claims: b.claims.map((c) => (ids.includes(c.id) ? { ...c, status: "approved", approved_at: new Date().toISOString() } : c)) }),
      () => rpc("settlement_approve_all", { p_ids: ids }),
      `Approved ${ids.length}. Nickel is filing ${ids.length === 1 ? "it" : "them"} now.`,
    );
  };
  const answer = (c: Claim, yes: boolean) => void act(patch(c.id, (x) => ({ ...x, status: yes ? "ready" : "skipped" })), () => rpc("settlement_answer", { p_id: c.id, p_yes: yes }),
    yes ? "Thanks. It moved to Ready to file." : "Skipped.");
  const confirmDigest = async () => {
    if (!digestId || !digest || digestBusy) return;
    setDigestBusy(true);
    const before = digest;
    const ids = new Set(digest.claims.filter((c) => c.status === "ready").map((c) => c.id));
    setDigest({ ...digest, acted_at: new Date().toISOString(), approved_n: ids.size, claims: digest.claims.map((c) => (ids.has(c.id) ? { ...c, status: "approved" } : c)) });
    const { data, error } = await rpc<{ state: string; n: number }>("settlement_digest_confirm", { p_digest: digestId });
    setDigestBusy(false);
    if (error) { setDigest(before); toast.error(error.message); return; }
    if (data?.state === "approved") toast.success(`Approved ${data.n}. Nickel is filing ${data.n === 1 ? "it" : "them"} now.`);
    else if (data?.state === "already") toast.message("That digest was already approved.");
    else toast.error("That digest can no longer be approved. Review the Ready list below.");
    void load(); void loadDigest();
  };
  const setFact = async (key: string, answer: boolean | null) => {
    const before = facts;
    setFacts((f) => (f ? f.map((x) => (x.key === key ? { ...x, answer, answered_at: answer == null ? null : new Date().toISOString() } : x)) : f));
    const { error } = await rpc<number>("settlement_fact_set", { p_key: key, p_answer: answer });
    if (error) { setFacts(before); toast.error(error.message); return false; }
    void load(); void loadFacts();
    return true;
  };
  const answerFact = (key: string, yes: boolean, ids: string[]) => {
    const before = board;
    if (before) setBoard({ ...before, claims: before.claims.map((c) => (ids.includes(c.id) ? { ...c, status: yes ? "ready" : "skipped" } : c)) });
    void setFact(key, yes).then((ok) => {
      if (!ok && before) setBoard(before);
      else if (ok) toast.success(yes ? "Thanks. Matching settlements moved to Ready to file." : "Skipped. Nickel will not file those.");
    });
  };
  const skip = (c: Claim) => void act(patch(c.id, (x) => ({ ...x, status: "skipped" })), () => rpc("settlement_skip", { p_id: c.id }), "Skipped. Nickel will not file it.");
  const markFiled = (c: Claim, conf: string) => void act(
    patch(c.id, (x) => ({ ...x, status: "filed", filed_at: new Date().toISOString(), confirmation: conf || x.confirmation, needs_you_url: null, needs_you_why: null })),
    () => rpc("settlement_mark_filed", { p_id: c.id, p_confirmation: conf || null }), "Marked as filed. Nickel watches for the money.");
  const undoPaid = (c: Claim) => void act(patch(c.id, (x) => ({ ...x, status: "filed", paid_at: null, paid_via: null })), () => rpc("settlement_undo_paid", { p_id: c.id }), "Back to waiting for money.");
  const resolve = (u: Unmatched, claim: Claim | null) => void act(
    (b) => ({
      ...b, unmatched: b.unmatched.filter((x) => x.id !== u.id),
      claims: claim ? b.claims.map((c) => (c.id === claim.id ? { ...c, status: "paid", paid_at: new Date().toISOString(), paid_via: u.via, amount_cents: u.amount_cents ?? c.amount_cents } : c)) : b.claims,
    }),
    () => rpc("settlement_unmatched_resolve", { p_unmatched: u.id, p_claim: claim?.id ?? null }),
    claim ? `Checked off ${claim.settlement.name}.` : "Dismissed.");

  const openPaid = (c: Claim) => { setAmount(c.amount_cents != null ? (c.amount_cents / 100).toFixed(2) : ""); setPaidSheet({ id: c.id, name: c.settlement.name, hasAmount: c.amount_cents != null }); };
  const submitPaid = () => {
    if (!paidSheet) return;
    const n = parseFloat(amount);
    const cents = amount.trim() && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
    const { id } = paidSheet;
    setPaidSheet(null);
    void act(
      patch(id, (x) => ({ ...x, status: "paid", paid_at: x.paid_at ?? new Date().toISOString(), paid_via: x.paid_via ?? "button", amount_cents: cents ?? x.amount_cents })),
      () => rpc("settlement_mark_paid", { p_id: id, p_amount_cents: cents }), cents ? `Saved ${usd(cents)}.` : "Checked off as paid.");
  };

  const empty = board && board.claims.length === 0;
  const scanLine = board?.last_scan
    ? <>Last scan <span className="whitespace-nowrap">{shortDay(board.last_scan)}, {shortTime(board.last_scan)}</span></>
    : "No scan yet";

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pb-16 sm:px-0">
      <div>
        <PageHeader title="Settlements" description="Nickel, Settlements Clerk" />
        {board && (
          <p className={cn("mt-1.5 text-[13px]", secondary)}>
            {scanLine}
            {board.worker && board.worker.ok === false && <span className={tint.orange}> · Last run had a problem{board.worker.last_summary ? `: ${board.worker.last_summary}` : ""}</span>}
          </p>
        )}
      </div>

      {!board ? <Loader2 className="h-5 w-5 animate-spin text-white/50" aria-label="Loading" /> : (
        <>
          {digestId && digest !== undefined && (
            <DigestCard digest={digest} detailsConfirmed={profile == null || !!profile.confirmed_at} busy={digestBusy} onConfirm={() => void confirmDigest()} />
          )}

          {profile && <ProfileCard profile={profile} onSaved={setProfile} />}

          {empty && (
            <section className={cardCenter}>
              <BadgeDollarSign className={cn("mx-auto h-8 w-8", tint.blue)} aria-hidden />
              <p className={cn("mt-3 text-[17px] font-semibold", label)}>Nothing to file yet</p>
              <p className={cn("mx-auto mt-1 max-w-sm text-[15px] leading-snug", secondary)}>
                Nickel scans for new settlements every morning at <span className="whitespace-nowrap">7:20 AM</span>. Your first digest arrives at <span className="whitespace-nowrap">9:05 AM</span>.
              </p>
            </section>
          )}

          {paid.length > 0 && (
            <Section title="Paid">
              <section className={card}>
                <p className={cn("text-[34px] font-bold leading-none tabular-nums tracking-[-0.02em]", tint.green)}><span className="whitespace-nowrap">{usd(paidTotal)}</span></p>
                <p className={cn("mt-1.5 text-[15px]", secondary)}>
                  from <span className="whitespace-nowrap">{paid.length} {paid.length === 1 ? "settlement" : "settlements"}</span>
                  {paidUnknown > 0 && <> · <span className="whitespace-nowrap">+ {paidUnknown} with unknown amount</span></>}
                </p>
                <ul className="mt-3 divide-y divide-[#38383A] bento:divide-[#C6C6C8]">
                  {paid.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-3">
                      <div className="min-w-0 flex-1 basis-48">
                        <p className={cn("text-[15px] font-medium leading-snug", label)}>{c.settlement.name}</p>
                        <p className={cn("text-[13px]", secondary)}>
                          {VIA[c.paid_via ?? "button"] ?? "You"} · <span className="whitespace-nowrap">{shortDay(c.paid_at)}</span>
                        </p>
                      </div>
                      {c.amount_cents != null
                        ? <span className={cn("whitespace-nowrap text-[15px] font-semibold tabular-nums", label)}>{usd(c.amount_cents)}</span>
                        : <button type="button" className={btnPlain} onClick={() => openPaid(c)}>Add amount</button>}
                      {(c.paid_via === "mail" || c.paid_via === "email") && (
                        <button type="button" className={btnPlain} onClick={() => undoPaid(c)}><Undo2 className="h-4 w-4" aria-hidden /> Undo</button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </Section>
          )}

          {ready.length > 0 && (
            <Section title="Ready to file">
              <section className={card}>
                <button type="button" className={cn(btnPrimary, "w-full text-[17px] sm:min-h-[44px]")} onClick={approveAll}>
                  <FileCheck2 className="h-5 w-5" aria-hidden /> Yes, file all <span className="whitespace-nowrap">({ready.length})</span>
                </button>
                <p className={cn("mt-3 text-[14px] leading-snug", label)}>Tapping yes means you&rsquo;re swearing you&rsquo;re part of each class below.</p>
                <p className={cn("mt-1 text-[13px] leading-snug", secondary)}>Not sure about one? Skip it first. Skipped claims are never filed.</p>
                {profile && !profile.confirmed_at && <p className={cn("mt-1 text-[13px] leading-snug", tint.orange)}>Confirm your claim details above first, or Nickel will wait to file.</p>}
              </section>
              {ready.map((c) => (
                <section key={c.id} className={card}>
                  <Title s={c.settlement} />
                  <Facts s={c.settlement} />
                  <Why items={c.evidence ?? []} />
                  <ClassDefinition text={c.settlement.class_definition} />
                  <div className="mt-3 flex flex-wrap items-center gap-x-4">
                    <button type="button" className={btnDestructivePlain} onClick={() => skip(c)}><X className="h-4 w-4" aria-hidden /> Skip</button>
                    {c.settlement.info_url && (
                      <a href={c.settlement.info_url} target="_blank" rel="noreferrer" className={cn(btnPlain, "text-[14px]")}>Settlement website <ExternalLink className="h-4 w-4" aria-hidden /></a>
                    )}
                  </div>
                </section>
              ))}
            </Section>
          )}

          {askGroups.length > 0 && (
            <Section title="Quick questions" footer="A yes moves it to Ready to file. Nothing is filed until you tap Yes, file all.">
              {askGroups.map((g) => {
                const c = g.claims[0];
                const many = g.claims.length > 1;
                const yes = (v: boolean) => (g.key ? answerFact(g.key, v, g.claims.map((x) => x.id)) : answer(c, v));
                return (
                  <section key={g.key ?? c.id} className={card}>
                    {many ? (
                      <>
                        <p className={cn("text-[16px] font-medium leading-snug", label)}>{c.question ?? "Were you part of this class?"}</p>
                        <p className={cn("mt-1 text-[13px] font-semibold", tint.blue)}>Applies to {count(g.claims.length, "settlement")}</p>
                        <ul className="mt-2 divide-y divide-[#38383A] bento:divide-[#C6C6C8]">
                          {g.claims.map((x) => (
                            <li key={x.id} className="py-2 first:pt-0 last:pb-0">
                              <p className={cn("text-[15px] font-medium leading-snug", label)}>{x.settlement.name}</p>
                              <p><DeadlineChip ymd={x.settlement.deadline} /></p>
                              <ClassDefinition text={x.settlement.class_definition} />
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      <>
                        <Title s={c.settlement} />
                        <Facts s={c.settlement} />
                        <p className={cn("mt-3 text-[16px] font-medium leading-snug", label)}>{c.question ?? "Were you part of this class?"}</p>
                        <ClassDefinition text={c.settlement.class_definition} />
                      </>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={btnPrimary} onClick={() => yes(true)}>Yes</button>
                      <button type="button" className={btnTinted} onClick={() => yes(false)}>No</button>
                    </div>
                    {g.key && <p className={cn("mt-2 text-[13px]", secondary)}>Nickel remembers your answer for matching settlements.</p>}
                  </section>
                );
              })}
            </Section>
          )}

          {needs.length > 0 && (
            <Section title="Needs you" footer="Nickel filled these in but a site wants a person (usually a CAPTCHA). Open the form, tap submit, then come back.">
              {needs.map((c) => <NeedsYouCard key={c.id} c={c} onFiled={markFiled} />)}
            </Section>
          )}

          {filing.length > 0 && (
            <Section title="Being filed">
              <section className={card}>
                <ul className="divide-y divide-[#38383A] bento:divide-[#C6C6C8]">
                  {filing.map((c) => (
                    <li key={c.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                      <Loader2 className={cn("mt-0.5 h-4 w-4 shrink-0 animate-spin", secondary)} aria-hidden />
                      <div className="min-w-0">
                        <p className={cn("text-[15px] font-medium leading-snug", label)}>{c.settlement.name}</p>
                        <p className={cn("text-[13px]", secondary)}>Approved{c.approved_at ? <> <span className="whitespace-nowrap">{shortDay(c.approved_at)}</span></> : ""}. Nickel files within a few minutes.</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </Section>
          )}

          {filed.length > 0 && (
            <Section title="Filed, waiting for money">
              {filed.map((c) => (
                <section key={c.id} className={card}>
                  <Title s={c.settlement} />
                  <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                    <div><dt className={tertiary}>Filed</dt><dd className={cn("whitespace-nowrap", label)}>{c.filed_at ? shortDay(c.filed_at) : "Date unknown"}</dd></div>
                    <div><dt className={tertiary}>Confirmation</dt><dd className={cn("break-all", label)}>{c.confirmation || "None yet"}</dd></div>
                    {c.payout_method && <div className="col-span-2"><dt className={tertiary}>Payout method</dt><dd className={label}>{c.payout_method}</dd></div>}
                    {c.settlement.est_payout && <div className="col-span-2"><dt className={tertiary}>Estimated payout</dt><dd className={label}><Nb text={c.settlement.est_payout} /></dd></div>}
                  </dl>
                  <p className={cn("mt-2 text-[13px]", secondary)}>Nickel is watching your mail scans and inbox for the payment.</p>
                  <div className="mt-3">
                    <button type="button" className={btnTinted} onClick={() => openPaid(c)}><BadgeDollarSign className="h-4 w-4" aria-hidden /> Got paid</button>
                  </div>
                </section>
              ))}
            </Section>
          )}

          {facts && facts.length > 0 && <FactsSection facts={facts} onSet={(k, a) => void setFact(k, a)} />}

          {board.unmatched.length > 0 && (
            <Section title="Mail and emails to sort" footer="These look like settlement money but Nickel could not tell which claim they belong to. Assigning one checks that claim off as paid.">
              {board.unmatched.map((u) => <UnmatchedCard key={u.id} u={u} filed={filed} onResolve={resolve} />)}
            </Section>
          )}
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
        <p className={cn("mt-2 text-[13px] leading-snug", secondary)}>Leave it blank if you do not know yet. You can add it later.</p>
      </Sheet>
    </div>
  );
}

const cardCenter = cn(card, "py-8 text-center");

function NeedsYouCard({ c, onFiled }: { c: Claim; onFiled: (c: Claim, conf: string) => void }) {
  const [conf, setConf] = useState("");
  return (
    <section className={cn(card, "ring-1 ring-[#FF9F0A66] bento:ring-[#FF950066]")}>
      <Title s={c.settlement} />
      <p className={cn("mt-2 flex items-start gap-1.5 text-[15px] leading-snug", label)}>
        <CircleAlert className={cn("mt-0.5 h-4 w-4 shrink-0", tint.orange)} aria-hidden />
        <span>{c.needs_you_why || "Nickel could not finish this one and needs you to submit it."}</span>
      </p>
      <p className="mt-1.5"><DeadlineChip ymd={c.settlement.deadline} /></p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {c.needs_you_url && (
          <a href={c.needs_you_url} target="_blank" rel="noreferrer" className={btnPrimary}>Open the filled-in form <ExternalLink className="h-4 w-4" aria-hidden /></a>
        )}
      </div>
      <div className="mt-4 border-t border-[#38383A] pt-3 bento:border-[#C6C6C8]">
        <label className="block">
          <span className={cn("text-[13px]", secondary)}>Confirmation number (optional)</span>
          <input value={conf} onChange={(e) => setConf(e.target.value)} className={cn(field, "mt-1")} aria-label="Confirmation number" autoCapitalize="characters" />
        </label>
        <button type="button" className={cn(btnTinted, "mt-2")} onClick={() => onFiled(c, conf.trim())}><Check className="h-4 w-4" aria-hidden /> I submitted it</button>
      </div>
    </section>
  );
}

function UnmatchedCard({ u, filed, onResolve }: { u: Unmatched; filed: Claim[]; onResolve: (u: Unmatched, claim: Claim | null) => void }) {
  const [pick, setPick] = useState("");
  const chosen = filed.find((c) => c.id === pick) ?? null;
  return (
    <section className={card}>
      <p className={cn("text-[13px]", secondary)}>
        {u.via === "mail" ? "USPS mail" : "Email"} · <span className="whitespace-nowrap">{shortDay(u.at)}, {shortTime(u.at)}</span>
        {u.amount_cents != null && <> · <span className="whitespace-nowrap">{usd(u.amount_cents)}</span></>}
      </p>
      <p className={cn("mt-1 text-[15px] leading-snug", label)}><Nb text={u.summary || "No description"} /></p>
      {filed.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={cn(field, "min-h-[44px] flex-1 basis-56 sm:min-h-0")} aria-label="Which filed claim is this for">
            <option value="">Which claim is this for?</option>
            {filed.map((c) => <option key={c.id} value={c.id}>{c.settlement.name}</option>)}
          </select>
          <button type="button" className={btnTinted} disabled={!chosen} onClick={() => onResolve(u, chosen)}>Assign and mark paid</button>
        </div>
      ) : <p className={cn("mt-2 text-[13px]", secondary)}>No filed claims to assign this to yet.</p>}
      <div className="mt-1">
        <button type="button" className={btnDestructivePlain} onClick={() => onResolve(u, null)}>Dismiss</button>
      </div>
    </section>
  );
}
