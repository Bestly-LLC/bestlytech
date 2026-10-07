/**
 * Spam Desk: what the Spam button and the hourly check did, who is blocked, and the damages files.
 *   Reports   every email reported (you tapped Spam, caught automatically, or a blocked sender wrote again): who got the report
 *   Blocked   senders that never get drafts again, one tap to unblock
 *   Claims    commercial spam from a business: count, amount, a drafted letter, and a Send that needs your confirm
 * Reads the spam_* tables (admins only); every change goes through the spam-desk function.
 * Scout is not a lawyer: the claims section says so and nothing is mailed without the confirm dialog.
 */
import { useCallback, useEffect, useState } from "react";
import { Ban, Check, ExternalLink, FileText, Loader2, RefreshCw, RotateCcw, Send, ShieldAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pill, SectionHeader, btnPrimary, btnTinted, cardCls, divider, focusRing, inset, rowCls, text, tint } from "@/components/admin/ui";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface Report {
  id: string; from_addr: string | null; from_name: string | null; subject: string | null; mailbox: string;
  verdict: "phishing" | "commercial" | "spam"; how: "tap" | "auto" | "blocked";
  status: "queued" | "fetching" | "ready" | "sent" | "failed" | "undone" | "junk_only";
  sent_to: string[]; error: string | null; created_at: string; sent_at_report: string | null; junked_at: string | null;
}
interface Block { id: string; pattern: string; kind: "address" | "domain"; reason: string | null; created_at: string }
interface Claim {
  id: string; advertiser_domain: string; business_name: string | null; contact_email: string | null; contact_address: string | null;
  email_count: number; amount_claimed: number; statute_note: string | null; demand_letter: string | null;
  status: "open" | "drafted" | "approved" | "sent" | "paid" | "closed"; sent_at: string | null; sent_to: string | null; first_at: string | null; last_at: string | null;
}
interface Target { id: string; email: string; applies: string; mailbox: string | null; brand_keywords: string[]; source_url: string; verified_on: string }

const LA = "America/Los_Angeles";
const when = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-US", { timeZone: LA, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)) : "";
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
/** A number and its unit never split across lines. */
const Nb = ({ children }: { children: React.ReactNode }) => <span className="whitespace-nowrap">{children}</span>;

const VERDICT = { phishing: { label: "Phishing", tone: "red" }, commercial: { label: "Advertising", tone: "orange" }, spam: { label: "Spam", tone: "orange" } } as const;
const HOW = { tap: "You tapped Spam", auto: "Caught automatically", blocked: "Blocked sender" } as const;
const field = cn("min-h-[44px] w-full rounded-xl border border-white/10 bg-black/20 px-3 text-[16px] text-white outline-none focus:border-white/25 sm:text-[15px]", focusRing);
const smallBtn = cn("inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 text-[15px] font-medium transition active:scale-[0.97] disabled:opacity-50 sm:min-h-9", focusRing);

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("spam-desk", { body });
  const r = data as { ok?: boolean; error?: string; [k: string]: unknown } | null;
  if (error || !r?.ok) throw new Error(r?.error ?? error?.message ?? "That did not work");
  return r;
}

function statusLine(r: Report): { tone: "neutral" | "green" | "orange" | "red"; label: string; detail: string } {
  switch (r.status) {
    case "sent":
      return { tone: "green", label: "Reported", detail: `Sent ${when(r.sent_at_report)} to ${r.sent_to.join(", ")}.` };
    case "queued": case "fetching":
      return { tone: "neutral", label: "Waiting", detail: "The Mac mini is moving it to Junk and fetching the original." };
    case "ready":
      return { tone: "neutral", label: "Sending", detail: r.error ?? "Original saved, report emails going out." };
    case "junk_only":
      return { tone: "neutral", label: r.junked_at ? "In Junk" : "Moving to Junk", detail: r.error ?? "Blocked sender: moved to Junk, no new report sent." };
    case "failed":
      return { tone: "red", label: "Failed", detail: r.error ?? "Something went wrong." };
    default:
      return { tone: "neutral", label: "Undone", detail: "You undid this. The sender is unblocked." };
  }
}

export default function SpamDesk() {
  const [reports, setReports] = useState<Report[] | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [r, b, c, t] = await Promise.all([
      supabase.from("spam_reports" as never).select("id, from_addr, from_name, subject, mailbox, verdict, how, status, sent_to, error, created_at, sent_at_report, junked_at")
        .order("created_at", { ascending: false }).limit(100),
      supabase.from("mail_blocklist" as never).select("id, pattern, kind, reason, created_at").eq("active", true).order("created_at", { ascending: false }).limit(300),
      supabase.from("spam_claims" as never).select("*").gt("email_count", 0).order("updated_at", { ascending: false }).limit(50),
      supabase.from("spam_report_targets" as never).select("id, email, applies, mailbox, brand_keywords, source_url, verified_on").eq("active", true).order("email"),
    ]);
    setReports(((r.data ?? []) as unknown) as Report[]);
    setBlocks(((b.data ?? []) as unknown) as Block[]);
    setClaims(((c.data ?? []) as unknown) as Claim[]);
    setTargets(((t.data ?? []) as unknown) as Target[]);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try { await call(body); toast.success(ok); } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
    load();
  };

  const sentCount = reports?.filter((r) => r.status === "sent").length ?? 0;
  const autoCount = reports?.filter((r) => r.how === "auto" && r.status !== "undone").length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 pb-16 sm:px-0">
      <PageHeader
        title="Spam Desk"
        description="Spam and phishing in your two mailboxes: reported to the people who take reports, moved to Junk, sender blocked."
        actions={<button className={cn(smallBtn, "text-white/75 hover:bg-white/[0.06]")} onClick={load}><RefreshCw className="h-4 w-4" aria-hidden /> Refresh</button>}
      />

      {reports === null ? <Loader2 className="h-5 w-5 animate-spin text-white/50" aria-label="Loading" /> : (
        <>
          <section aria-labelledby="sd-reports">
            <SectionHeader id="sd-reports" title="Reports" aside={reports.length ? <><Nb>{sentCount} sent</Nb> · <Nb>{autoCount} automatic</Nb></> : undefined} />
            {reports.length === 0 ? (
              <div className={cn(cardCls, rowCls)}>
                <ShieldAlert className="h-5 w-5 shrink-0 text-white/50" aria-hidden />
                <p className={text.title}>Nothing reported yet. Tap the Spam shield on a Replies ready card.</p>
              </div>
            ) : (
              <ul className={cn(cardCls, divider, "overflow-hidden")}>
                {reports.map((r) => {
                  const s = statusLine(r);
                  const v = VERDICT[r.verdict];
                  const canUndo = ["queued", "fetching", "ready", "failed"].includes(r.status);
                  return (
                    <li key={r.id} className={cn("space-y-1.5 py-3", inset)}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pill tone={v.tone}>{v.label}</Pill>
                        <Pill tone="neutral">{HOW[r.how]}</Pill>
                        <Pill tone={s.tone}>{s.label}</Pill>
                        <span className={cn(text.meta, "ml-auto")}>{when(r.created_at)}</span>
                      </div>
                      <p className={cn(text.title, "break-words")}>{r.subject || "(no subject)"}</p>
                      <p className={cn(text.detail, "break-words")}>From {r.from_name ? `${r.from_name} <${r.from_addr}>` : r.from_addr} · to {r.mailbox}</p>
                      <p className={cn(text.detail, "break-words")}>{s.detail}</p>
                      {(canUndo || r.status === "failed") && (
                        <div className="-mx-1 flex flex-wrap gap-1">
                          {r.status === "failed" && (
                            <button className={cn(smallBtn, tint.blue)} disabled={busy === r.id} onClick={() => act(r.id, { op: "retry", id: r.id }, "Trying again")}>
                              <RotateCcw className="h-4 w-4" aria-hidden /> Try again
                            </button>
                          )}
                          {canUndo && (
                            <button className={cn(smallBtn, "text-white/75 hover:bg-white/[0.06]")} disabled={busy === r.id} onClick={() => act(r.id, { op: "undo", id: r.id }, "Report undone")}>
                              <Undo2 className="h-4 w-4" aria-hidden /> Undo
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="sd-blocked">
            <SectionHeader id="sd-blocked" title="Blocked senders" aside={blocks.length || undefined} />
            {blocks.length === 0 ? (
              <div className={cn(cardCls, rowCls)}>
                <Ban className="h-5 w-5 shrink-0 text-white/50" aria-hidden />
                <p className={text.title}>No blocked senders.</p>
              </div>
            ) : (
              <ul className={cn(cardCls, divider, "overflow-hidden")}>
                {blocks.map((b) => (
                  <li key={b.id} className={cn(rowCls, "flex-wrap sm:flex-nowrap")}>
                    <div className="min-w-0 flex-1">
                      <p className={cn(text.title, "break-all")}>{b.kind === "domain" ? `Everyone at ${b.pattern}` : b.pattern}</p>
                      <p className={cn(text.detail, "break-words")}>{b.reason ?? ""} · {when(b.created_at)}</p>
                    </div>
                    <button className={cn(smallBtn, tint.blue)} disabled={busy === b.id} onClick={() => act(b.id, { op: "unblock", id: b.id }, "Unblocked")}>Unblock</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="sd-claims">
            <SectionHeader id="sd-claims" title="Claims" aside={claims.length || undefined} />
            <p className={cn(text.detail, "mb-3", inset)}>
              Commercial spam you tapped from a business. California law can pay up to <Nb>$1,000</Nb> per email, but only when the email has a forged
              sender, someone else's domain or a misleading subject line, and the claim has a <Nb>1-year</Nb> deadline. Scout is not a lawyer. It drafts, you decide, and nothing is sent until you confirm.
            </p>
            {claims.length === 0 ? (
              <div className={cn(cardCls, rowCls)}>
                <FileText className="h-5 w-5 shrink-0 text-white/50" aria-hidden />
                <p className={text.title}>No damages files yet. One opens when you tap Spam on advertising from a business.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {claims.map((c) => <ClaimCard key={c.id} c={c} onChange={load} />)}
              </div>
            )}
          </section>

          <section aria-labelledby="sd-targets">
            <SectionHeader id="sd-targets" title="Who gets reports" aside={targets.length || undefined} />
            <ul className={cn(cardCls, divider, "overflow-hidden")}>
              {targets.map((t) => (
                <li key={t.id} className={cn("space-y-0.5 py-3", inset)}>
                  <p className={cn(text.title, "break-all")}>{t.email}</p>
                  <p className={cn(text.detail, "break-words")}>
                    {t.applies === "all" ? "Any report" : t.applies === "phishing" ? "Phishing" : "Spam"}
                    {t.mailbox ? ` · ${t.mailbox} only` : ""}
                    {t.brand_keywords.length ? ` · when it mentions ${t.brand_keywords.join(", ")}` : ""}
                  </p>
                  <a href={t.source_url} target="_blank" rel="noreferrer" className={cn(text.detail, "inline-flex min-h-[44px] items-center gap-1 sm:min-h-0", tint.blue)}>
                    Checked {t.verified_on} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </li>
              ))}
            </ul>
            <p className={cn(text.detail, "mt-2", inset)}>Also each email's sending network and the sender domain's registrar, found when the report goes out. At most 8 emails per report, 60 a day.</p>
          </section>
        </>
      )}
    </div>
  );
}

function ClaimCard({ c, onChange }: { c: Claim; onChange: () => void }) {
  const [letter, setLetter] = useState(c.demand_letter ?? "");
  const [to, setTo] = useState(c.contact_email ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setLetter(c.demand_letter ?? ""); }, [c.demand_letter]);
  const locked = c.status === "sent" || c.status === "paid" || c.status === "closed";
  const dirty = letter !== (c.demand_letter ?? "");
  const validTo = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(to.trim());
  const unfilled = /\[Jared:/i.test(letter);

  const run = async (key: string, body: Record<string, unknown>, ok: string) => {
    setBusy(key);
    try { await call(body); toast.success(ok); onChange(); } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };
  const draft = async () => {
    setBusy("draft");
    try {
      const r = await call({ op: "draft_letter", claim_id: c.id });
      setLetter(String(r.letter ?? ""));
      toast.success("Letter drafted. Read it before you send.");
      onChange();
    } catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };
  const send = async () => {
    setConfirm(false);
    setBusy("send");
    try { await call({ op: "approve_send", claim_id: c.id, to: to.trim(), confirm: true }); toast.success(`Sent to ${to.trim()}`); onChange(); }
    catch (e) { toast.error((e as Error).message); }
    setBusy(null);
  };

  return (
    <div className={cn(cardCls, "space-y-3 py-4", inset)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={c.status === "sent" || c.status === "paid" ? "green" : c.status === "closed" ? "neutral" : "orange"}>{c.status[0].toUpperCase() + c.status.slice(1)}</Pill>
        <span className={cn(text.meta, "ml-auto")}>{c.first_at ? `${when(c.first_at)} to ${when(c.last_at)}` : ""}</span>
      </div>
      <div>
        <p className={cn(text.title, "break-words")}>{c.business_name || c.advertiser_domain}</p>
        <p className={cn(text.detail, "break-all")}>{c.advertiser_domain}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><p className={text.detail}>Emails</p><p className={text.stat}><Nb>{c.email_count}</Nb></p></div>
        <div><p className={text.detail}>Up to</p><p className={text.stat}><Nb>{usd(c.amount_claimed)}</Nb></p></div>
      </div>
      {c.statute_note && <p className={cn(text.detail, "break-words")}>{c.statute_note}</p>}

      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button className={btnTinted} disabled={busy !== null} onClick={draft}>
            {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
            {c.demand_letter ? "Redraft letter" : "Draft letter"}
          </button>
        </div>
      )}

      {(c.demand_letter || letter) && (
        <div className="space-y-3">
          <label className="block">
            <span className={text.detail}>Demand letter {locked ? "(sent)" : "(edit before sending)"}</span>
            <textarea
              value={letter} onChange={(e) => setLetter(e.target.value)} readOnly={locked} rows={Math.min(22, Math.max(8, letter.split("\n").length + 1))}
              className={cn(field, "mt-1 block py-3 leading-relaxed")}
            />
          </label>
          {!locked && dirty && (
            <button className={btnTinted} disabled={busy !== null} onClick={() => run("save", { op: "claim_edit", claim_id: c.id, demand_letter: letter }, "Letter saved")}>
              <Check className="h-4 w-4" aria-hidden /> Save changes
            </button>
          )}
          {unfilled && !locked && <p className={cn(text.detail, tint.orange)}>The letter still has a line that starts with "[Jared:". Fill it in or delete it, and save, before you can send.</p>}
          {!locked && (
            <div className="space-y-2">
              <label className="block">
                <span className={text.detail}>Send to (the business's legal or contact email; Scout does not guess it)</span>
                <input type="email" inputMode="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="legal@company.com" className={cn(field, "mt-1")} />
              </label>
              <button className={btnPrimary} disabled={busy !== null || dirty || unfilled || !validTo || letter.length < 100} onClick={() => setConfirm(true)}>
                {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Review and send
              </button>
              {dirty && <p className={text.detail}>Save your changes first.</p>}
            </div>
          )}
          {c.status === "sent" && <p className={text.detail}>Sent {when(c.sent_at)} to {c.sent_to}.</p>}
        </div>
      )}

      <div className="-mx-1 flex flex-wrap gap-1">
        {c.status === "sent" && <button className={cn(smallBtn, tint.green)} disabled={busy !== null} onClick={() => run("paid", { op: "set_status", claim_id: c.id, status: "paid" }, "Marked paid")}>Mark paid</button>}
        {c.status !== "closed" && c.status !== "paid" && (
          <button className={cn(smallBtn, "text-white/75 hover:bg-white/[0.06]")} disabled={busy !== null} onClick={() => run("closed", { op: "set_status", claim_id: c.id, status: "closed" }, "Claim closed")}>Close claim</button>
        )}
        {c.status === "closed" && <button className={cn(smallBtn, tint.blue)} disabled={busy !== null} onClick={() => run("open", { op: "set_status", claim_id: c.id, status: "open" }, "Claim reopened")}>Reopen</button>}
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send this demand letter to {to.trim()}?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes to <strong className="break-all">{to.trim()}</strong> from jared@bestly.tech with your signature, about <Nb>{c.email_count}</Nb> email{c.email_count === 1 ? "" : "s"} from {c.business_name || c.advertiser_domain}.
              Check that you never signed up with them. Scout is not a lawyer and this is not legal advice. It cannot be unsent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction onClick={send}>Send it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
