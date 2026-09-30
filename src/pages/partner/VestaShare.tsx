/**
 * Share Vesta — the partner portal's invite desk (bestly.tech/partner).
 *
 * Three ways to share, one tap each:
 *   Invite a woman   one code, works once, opens Vesta with the code filled in
 *   Group code       one code for a group leader, works for N women
 *   Investor/partner the walkthrough link (Vesta is women-only, so no sign-in for them)
 * Plus "Your invites": every code this partner made, live (joined / waiting / off).
 *
 * Talks to edge fn vesta-admin v2, which lets a partner with partners.vesta_invites = true
 * make and see ONLY their own codes (stored as "<Partner> · <who it's for>").
 * Links are short: vesta-app.bestly.tech/?i=CODE. Failures go to Scout, never to the partner.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { reportToScout } from "@/lib/reportToScout";
import { cn } from "@/lib/utils";
import { Check, Copy, ExternalLink, Loader2, MessageCircle, Plus, Share2, Smartphone, Users, UserPlus, Briefcase } from "lucide-react";

type Code = { code: string; label: string | null; max_uses: number; uses: number; is_active: boolean;
  expires_at: string | null; created_at: string; joined: number };
type Stats = { members: number; pending: number };
type Mode = "woman" | "group" | "investor";

const APP = "https://vesta-app.bestly.tech";
const WALKTHROUGH = "https://vesta.bestly.tech";
const link = (code: string) => `${APP}/?i=${code}`;

const msgWoman = (code: string) =>
  `You're invited to Vesta, a private app just for women. Talk, ask anything anonymously, and find support.\n\n` +
  `Tap to join: ${link(code)}\nYour code is ${code} (it fills in by itself).\n\n` +
  `You'll sign in with Face ID or your fingerprint. No password.`;
const msgGroup = (code: string, n: number) =>
  `You're invited to Vesta, a private app just for women. Talk, ask anything anonymously, and find support.\n\n` +
  `Tap to join: ${link(code)}\nCode: ${code}. It works for up to ${n} women, so please share it with your group.\n\n` +
  `Everyone signs in with Face ID or a fingerprint. No password.`;
const msgInvestor =
  `Here's Vesta, the women-only social and well-being app we're building: private rooms, anonymous questions, ` +
  `1:1 support chat, journals and an SOS button.\n\nSee how it works: ${WALKTHROUGH}\n\n` +
  `The private beta is live with women in India, Pakistan and the US.`;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("vesta-admin", { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data as T;
}

function statusOf(c: Code): { label: string; tone: string; open: boolean } {
  if (!c.is_active) return { label: "Turned off", tone: "bg-white/[0.06] text-white/60", open: false };
  if (c.expires_at && new Date(c.expires_at) < new Date()) return { label: "Expired", tone: "bg-white/[0.06] text-white/60", open: false };
  if (c.max_uses > 1) {
    const full = c.uses >= c.max_uses;
    return { label: `${c.joined} of ${c.max_uses} joined`, tone: full ? "bg-emerald-500/15 text-emerald-300 bento:text-emerald-700" : "bg-[#0A84FF]/15 text-[#5AB0FF] bento:text-[#0A6FD8]", open: !full };
  }
  return c.uses >= 1
    ? { label: "Joined", tone: "bg-emerald-500/15 text-emerald-300 bento:text-emerald-700", open: false }
    : { label: "Not used yet", tone: "bg-amber-500/15 text-amber-200 bento:text-amber-700", open: true };
}
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Los_Angeles" });

/** Share row: the phone's share sheet when there is one, plus Text, WhatsApp and Copy. */
function ShareRow({ text, id, copied, onCopy }: { text: string; id: string; copied: string | null; onCopy: (k: string, t: string) => void }) {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const btn = "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-2xl px-3 text-[15px] font-semibold transition active:scale-[0.98]";
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {canShare && (
        <button type="button" onClick={() => navigator.share({ text }).catch(() => undefined)}
          className={cn(btn, "bg-[#0A84FF] text-[#fff] hover:bg-[#0A84FF]/90")}><Share2 className="h-4 w-4" /> Share</button>
      )}
      <a href={`sms:?&body=${encodeURIComponent(text)}`} className={cn(btn, "bg-white/[0.08] text-white hover:bg-white/[0.14] bento:bg-[#fff]")}>
        <Smartphone className="h-4 w-4" /> Text</a>
      <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
        className={cn(btn, "bg-white/[0.08] text-white hover:bg-white/[0.14] bento:bg-[#fff]")}><MessageCircle className="h-4 w-4" /> WhatsApp</a>
      <button type="button" onClick={() => onCopy(id, text)} className={cn(btn, "bg-white/[0.08] text-white hover:bg-white/[0.14] bento:bg-[#fff]")}>
        {copied === id ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}{copied === id ? "Copied" : "Copy"}</button>
    </div>
  );
}

export function VestaShareSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [mode, setMode] = useState<Mode>("woman");
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [who, setWho] = useState("");
  const [size, setSize] = useState(10);
  const [days, setDays] = useState<number | null>(30);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ code: string; n: number } | null>(null);
  const [makeErr, setMakeErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([call<{ codes: Code[] }>({ action: "list" }), call<Stats>({ action: "stats" }).catch(() => null)]);
      setCodes(l.codes ?? []); setStats(s); setLoadErr(false);
    } catch (e) { setLoadErr(true); reportToScout("vesta-share.list", e); }
  }, []);
  useEffect(() => { if (open) void load(); }, [open, load]);
  useEffect(() => { setMade(null); setMakeErr(null); }, [mode]);

  const copy = async (k: string, t: string) => {
    try { await navigator.clipboard.writeText(t); setCopied(k); setTimeout(() => setCopied((x) => (x === k ? null : x)), 1600); }
    catch { /* the Share / Text buttons still work */ }
  };

  const make = async () => {
    setBusy(true); setMakeErr(null); setMade(null);
    const n = mode === "group" ? size : 1;
    try {
      const r = await call<{ codes: string[] }>({ action: "create", count: 1, label: who.trim(), max_uses: n, expires_days: mode === "group" ? days : 30 });
      setMade({ code: r.codes[0], n }); setWho(""); void load();
    } catch (e) {
      setMakeErr("Couldn't make the invite just now. Try again in a minute — Scout has been told.");
      reportToScout("vesta-share.create", e);
    } finally { setBusy(false); }
  };

  const setActive = async (c: Code, active: boolean) => {
    try { await call({ action: "set_active", code: c.code, active }); void load(); }
    catch (e) { reportToScout("vesta-share.toggle", e); }
  };

  const joinedFromMine = useMemo(() => (codes ?? []).reduce((a, c) => a + (c.joined || 0), 0), [codes]);
  const list = useMemo(() => (codes ?? []).filter((c) => showAll || statusOf(c).open || Date.now() - Date.parse(c.created_at) < 7 * 864e5), [codes, showAll]);

  const field = "h-12 w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-[17px] text-white outline-none placeholder:text-white/40 focus:border-[#0A84FF] bento:bg-[#fff]";
  const chip = (on: boolean) => cn("min-h-11 rounded-full px-4 text-[15px] font-medium transition", on ? "bg-[#0A84FF] text-[#fff]" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12] bento:bg-[#fff]");
  const MODES: { id: Mode; label: string; icon: typeof Users }[] = [
    { id: "woman", label: "A woman", icon: UserPlus }, { id: "group", label: "A group", icon: Users }, { id: "investor", label: "Investor", icon: Briefcase },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-lg bento:bg-[#F3F2EE]">
        <div className="px-5 pb-2 pt-6">
          <SheetTitle className="text-[1.75rem] font-bold tracking-tight text-white">Share Vesta</SheetTitle>
          <SheetDescription className="mt-1 text-[15px] text-white/60">Invite women to the beta, or send investors and partners the walkthrough.</SheetDescription>
          {stats && (
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[["In the beta", stats.members], ["Waiting to be let in", stats.pending], ["Joined from yours", joinedFromMine]].map(([l, n]) => (
                <div key={String(l)} className="rounded-2xl bg-white/[0.05] px-3 py-2.5 bento:bg-[#fff]">
                  <p className="text-[1.4rem] font-bold leading-none tabular-nums">{n}</p>
                  <p className="mt-1 text-xs leading-tight text-white/60">{l}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* who is it for — segmented control */}
        <div className="px-5 pt-3">
          <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-white/50">Who are you sharing with?</p>
          <div role="tablist" className="grid grid-cols-3 gap-1 rounded-2xl bg-white/[0.06] p-1 bento:bg-black/[0.06]">
            {MODES.map(({ id, label, icon: Icon }) => (
              <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
                className={cn("flex min-h-11 items-center justify-center gap-1.5 rounded-xl text-[15px] font-semibold transition",
                  mode === id ? "bg-white/[0.14] text-white shadow-sm bento:bg-[#fff]" : "text-white/60 hover:text-white")}>
                <Icon className="h-4 w-4" />{label}</button>
            ))}
          </div>
        </div>

        <div className="px-5 pt-4">
          <div className="rounded-3xl bg-white/[0.04] p-4 bento:bg-[#fff]">
            {mode !== "investor" ? (
              <>
                <p className="text-[15px] text-white/70">{mode === "woman"
                  ? "One invite for one woman. She taps the link, picks a name, and signs in with Face ID. A person at Vesta lets her in."
                  : "One code a group leader can pass around. Every woman who uses it joins the same way."}</p>
                <label className="mt-4 block">
                  <span className="mb-1.5 block px-1 text-xs font-medium uppercase tracking-wide text-white/50">{mode === "woman" ? "Her name (only you see this)" : "Group or leader (only you see this)"}</span>
                  <input value={who} onChange={(e) => setWho(e.target.value)} maxLength={48} className={field}
                    placeholder={mode === "woman" ? "e.g. Priya, Rohit's sister" : "e.g. Lahore mothers group"} />
                </label>
                {mode === "group" && (
                  <>
                    <p className="mb-1.5 mt-4 px-1 text-xs font-medium uppercase tracking-wide text-white/50">How many women</p>
                    <div className="flex flex-wrap gap-2">{[5, 10, 25, 50].map((n) => <button key={n} type="button" onClick={() => setSize(n)} className={chip(size === n)}>{n}</button>)}</div>
                    <p className="mb-1.5 mt-4 px-1 text-xs font-medium uppercase tracking-wide text-white/50">Stops working after</p>
                    <div className="flex flex-wrap gap-2">{[[7, "1 week"], [30, "1 month"], [null, "Never"]].map(([d, l]) => (
                      <button key={String(l)} type="button" onClick={() => setDays(d as number | null)} className={chip(days === d)}>{l}</button>))}</div>
                  </>
                )}
                <button type="button" onClick={() => void make()} disabled={busy}
                  className="mt-5 inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[#0A84FF] text-[17px] font-semibold text-[#fff] transition hover:bg-[#0A84FF]/90 active:scale-[0.99] disabled:opacity-60">
                  {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                  {mode === "woman" ? "Make her invite" : `Make a code for ${size} women`}
                </button>
                {makeErr && <p className="mt-3 text-sm text-red-300 bento:text-red-600">{makeErr}</p>}
                {made && (
                  <div className="mt-4 rounded-2xl bg-emerald-500/[0.08] p-4 ring-1 ring-emerald-500/25">
                    <p className="text-xs font-medium uppercase tracking-wide text-emerald-300 bento:text-emerald-700">Ready to send</p>
                    <p className="mt-1 font-mono text-[1.6rem] font-bold tracking-wider">{made.code}</p>
                    <p className="mt-0.5 break-all text-sm text-white/60">{link(made.code)}</p>
                    <p className="mt-1 text-xs text-white/50">{made.n > 1 ? `Works for up to ${made.n} women.` : "Works once. Stops working after 1 month if unused."}</p>
                    <div className="mt-3"><ShareRow id="made" text={made.n > 1 ? msgGroup(made.code, made.n) : msgWoman(made.code)} copied={copied} onCopy={copy} /></div>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="text-[15px] text-white/70">Vesta is for women only, so investors and partners don't sign in. Send them the walkthrough instead — it shows every screen and how it works.</p>
                <a href={WALKTHROUGH} target="_blank" rel="noreferrer"
                  className="mt-4 flex min-h-12 items-center justify-between rounded-2xl bg-white/[0.06] px-4 text-[15px] font-semibold hover:bg-white/[0.1] bento:bg-[#F3F2EE]">
                  vesta.bestly.tech <ExternalLink className="h-4 w-4 opacity-70" /></a>
                <div className="mt-3"><ShareRow id="inv" text={msgInvestor} copied={copied} onCopy={copy} /></div>
                <p className="mt-3 text-xs text-white/50">For a woman investor who wants to try the app herself, switch to "A woman" and make her an invite.</p>
              </>
            )}
          </div>
        </div>

        {/* your invites, live */}
        <div className="px-5 pb-8 pt-6">
          <div className="mb-2 flex items-center px-1">
            <p className="text-xs font-medium uppercase tracking-wide text-white/50">Your invites</p>
            <button type="button" onClick={() => setShowAll((v) => !v)} className="ml-auto min-h-11 px-2 text-sm font-medium text-[#5AB0FF] bento:text-[#0A6FD8]">{showAll ? "Show recent" : "Show all"}</button>
          </div>
          {loadErr ? <p className="rounded-2xl bg-white/[0.04] px-4 py-4 text-sm text-white/60 bento:bg-[#fff]">Couldn't load your invites right now. Scout has been told.</p>
            : !codes ? <p className="flex items-center gap-2 px-1 text-sm text-white/60"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
            : list.length === 0 ? <p className="rounded-2xl bg-white/[0.04] px-4 py-4 text-sm text-white/60 bento:bg-[#fff]">No invites yet. Make one above.</p>
            : (
              <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl bg-white/[0.04] bento:divide-black/5 bento:bg-[#fff]">
                {list.map((c) => {
                  const st = statusOf(c);
                  const text = c.max_uses > 1 ? msgGroup(c.code, c.max_uses) : msgWoman(c.code);
                  return (
                    <li key={c.code} className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <p className="min-w-0 flex-1 truncate text-[16px] font-semibold">{c.label || "No name"}</p>
                        <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold", st.tone)}>{st.label}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-white/55"><span className="font-mono">{c.code}</span> · made {shortDate(c.created_at)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {st.open && <>
                          <button type="button" onClick={() => (typeof navigator.share === "function" ? navigator.share({ text }).catch(() => undefined) : void copy(`r-${c.code}`, text))}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#0A84FF]/15 px-3.5 text-sm font-semibold text-[#5AB0FF] bento:text-[#0A6FD8]">
                            {copied === `r-${c.code}` ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}{copied === `r-${c.code}` ? "Copied" : "Send again"}</button>
                          <button type="button" onClick={() => void copy(`l-${c.code}`, link(c.code))}
                            className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 text-sm font-medium text-white/80 bento:bg-[#F3F2EE]">
                            {copied === `l-${c.code}` ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied === `l-${c.code}` ? "Copied" : "Copy link"}</button>
                        </>}
                        {(st.open || !c.is_active) && (
                          <button type="button" onClick={() => void setActive(c, !c.is_active)}
                            className="ml-auto inline-flex min-h-9 items-center rounded-full px-3 text-sm font-medium text-white/50 hover:text-white">{c.is_active ? "Turn off" : "Turn back on"}</button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
