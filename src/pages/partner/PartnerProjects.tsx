/**
 * Projects — the partner's projects folder (bestly.tech/partner).
 *
 *   Sidebar (desktop): a "Projects" folder that expands to list each project.
 *   Header (mobile):   a folder button that opens the same list.
 *   Picking a project opens its sheet: live links, and for Vesta the invite desk.
 *
 * Vesta invites (simplified 2026-09-30): one field, one button. Optional "for a group" switch.
 * The result is a short link + Share (phone share sheet) or Copy. "Your invites" shows live status.
 * Talks to edge fn vesta-admin v2: a partner with partners.vesta_invites = true only sees and
 * makes their own codes. Links are short: vesta-app.bestly.tech/?i=CODE. Errors go to Scout.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { reportToScout } from "@/lib/reportToScout";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Folder, FolderOpen, Loader2, Share2 } from "lucide-react";

/* ───────── projects ───────── */

export type ProjectId = "vesta" | "inventoryproof" | "hoku";
type Proj = { id: ProjectId; name: string; sub: string; dot: string; links: { label: string; hint: string; href: string }[] };

export const PROJECTS: Proj[] = [
  { id: "vesta", name: "Vesta", sub: "Women-only social + well-being, with Eli and Rohit", dot: "bg-rose-400", links: [
    { label: "Walkthrough", hint: "For investors and partners", href: "https://vesta.bestly.tech" },
    { label: "The app", hint: "Women sign in here", href: "https://vesta-app.bestly.tech" },
  ] },
  { id: "inventoryproof", name: "InventoryProof", sub: "Proof-of-inventory for resellers", dot: "bg-sky-400", links: [
    { label: "Website", hint: "inventoryproof.com", href: "https://www.inventoryproof.com" },
  ] },
  { id: "hoku", name: "HOKU", sub: "Clean, refillable home care", dot: "bg-emerald-400", links: [
    { label: "Website", hint: "hoku-clean.com", href: "https://hoku-clean.com" },
  ] },
];

/** Open a project sheet from anywhere (sidebar, header). null = the list. */
export const openProject = (id: ProjectId | null) => window.dispatchEvent(new CustomEvent("partner-project", { detail: id }));

/** Sidebar folder: Projects ▸ expands to the project list. Remembers open/closed. */
export function ProjectsNav() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem("partner.projects.open") !== "0"; } catch { return true; } });
  const toggle = () => setOpen((o) => { try { localStorage.setItem("partner.projects.open", o ? "0" : "1"); } catch { /* fine */ } return !o; });
  const Icon = open ? FolderOpen : Folder;
  return (
    <div>
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls="nav-projects"
        className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium text-white/60 transition hover:bg-white/[0.05] hover:text-white">
        <Icon className="h-[18px] w-[18px]" /> Projects
        <ChevronRight className={cn("ml-auto h-4 w-4 transition-transform duration-200", open && "rotate-90")} />
      </button>
      {open && (
        <ul id="nav-projects" className="mt-0.5 space-y-0.5 pl-4">
          {PROJECTS.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => openProject(p.id)}
                className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[0.9rem] text-white/60 transition hover:bg-white/[0.05] hover:text-white">
                <span aria-hidden className={cn("h-2 w-2 rounded-full", p.dot)} />{p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Mobile header button that opens the project list. */
export function ProjectsButton() {
  return (
    <button type="button" onClick={() => openProject(null)} aria-label="Projects"
      className="grid h-10 w-10 place-items-center rounded-full text-white/60 hover:bg-white/[0.06]">
      <Folder className="h-[18px] w-[18px]" />
    </button>
  );
}

/* ───────── Vesta invites ───────── */

type Code = { code: string; label: string | null; max_uses: number; uses: number; is_active: boolean;
  expires_at: string | null; created_at: string; joined: number };

const APP = "https://vesta-app.bestly.tech";
const link = (code: string) => `${APP}/?i=${code}`;
const message = (code: string, n: number) =>
  `You're invited to Vesta, a private app just for women. Talk, ask anything anonymously, and find support.\n\n` +
  `Tap to join: ${link(code)}\n` +
  (n > 1 ? `This link works for up to ${n} women, so please share it with your group.\n\n` : `\n`) +
  `You'll sign in with Face ID or your fingerprint. No password.`;
const investorMessage =
  `Here's Vesta, the women-only social and well-being app we're building: private rooms, anonymous questions, ` +
  `1:1 support chat, journals and an SOS button.\n\nSee how it works: https://vesta.bestly.tech`;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("vesta-admin", { body });
  if (error) {
    let msg = error.message;
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data as T;
}

function status(c: Code): { text: string; done: boolean; open: boolean } {
  if (!c.is_active) return { text: "Off", done: false, open: false };
  if (c.expires_at && new Date(c.expires_at) < new Date()) return { text: "Expired", done: false, open: false };
  if (c.max_uses > 1) return { text: `${c.joined} of ${c.max_uses}\u00a0joined`, done: c.uses >= c.max_uses, open: c.uses < c.max_uses };
  return c.uses >= 1 ? { text: "Joined", done: true, open: false } : { text: "Waiting", done: false, open: true };
}

const canShare = () => typeof navigator !== "undefined" && typeof navigator.share === "function";

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied((k) => (k === key ? null : k)), 1600); }
    catch { /* nothing to do: the text is on screen */ }
  };
  return { copied, copy };
}

/** One button: the phone's share sheet when there is one, otherwise Copy. */
function SendButton({ text, id, primary, copied, copy, label = "Share" }:
  { text: string; id: string; primary?: boolean; copied: string | null; copy: (k: string, t: string) => void; label?: string }) {
  const share = canShare();
  const done = copied === id;
  return (
    <button type="button" onClick={() => (share ? navigator.share({ text }).catch(() => undefined) : copy(id, text))}
      className={cn("inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-[15px] font-semibold transition active:scale-[0.98]",
        primary ? "flex-1 bg-[#0A84FF] text-[#fff] hover:bg-[#0A84FF]/90" : "bg-white/[0.08] text-white hover:bg-white/[0.13] bento:bg-[#F3F2EE]")}>
      {done ? <Check className="h-4 w-4" /> : share ? <Share2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      {done ? "Copied" : share ? label : label === "Share" ? "Copy invite" : label}
    </button>
  );
}

function VestaInvites() {
  const [codes, setCodes] = useState<Code[] | null>(null);
  const [members, setMembers] = useState<number | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [who, setWho] = useState("");
  const [group, setGroup] = useState(false);
  const [size, setSize] = useState(10);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ code: string; n: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { copied, copy } = useCopy();

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([call<{ codes: Code[] }>({ action: "list" }), call<{ members: number }>({ action: "stats" }).catch(() => null)]);
      setCodes(l.codes ?? []); setMembers(s?.members ?? null); setLoadErr(false);
    } catch (e) { setLoadErr(true); reportToScout("vesta-share.list", e); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const make = async () => {
    const n = group ? size : 1;
    setBusy(true); setErr(null); setMade(null);
    try {
      const r = await call<{ codes: string[] }>({ action: "create", count: 1, label: who.trim(), max_uses: n, expires_days: 30 });
      setMade({ code: r.codes[0], n }); setWho(""); void load();
    } catch (e) {
      setErr("That didn't work. Try again in a minute."); reportToScout("vesta-share.create", e);
    } finally { setBusy(false); }
  };

  const turnOff = async (c: Code) => {
    try { await call({ action: "set_active", code: c.code, active: false }); void load(); }
    catch (e) { reportToScout("vesta-share.toggle", e); }
  };

  const joined = useMemo(() => (codes ?? []).reduce((a, c) => a + (c.joined || 0), 0), [codes]);
  const recent = useMemo(() => (codes ?? []).filter((c) => status(c).open || status(c).done).slice(0, 12), [codes]);

  return (
    <>
      {/* Invite */}
      <section className="rounded-3xl bg-white/[0.04] p-4 bento:bg-[#fff]">
        <h3 className="text-[1.05rem] font-semibold">Invite a woman</h3>
        <p className="mt-0.5 text-[15px] text-white/60">She gets a link, taps it, and joins with Face ID.</p>

        {made ? (
          <div className="mt-4">
            <div className="rounded-2xl bg-emerald-500/[0.08] px-4 py-3 ring-1 ring-emerald-500/25">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-emerald-300 bento:text-emerald-700"><Check className="h-4 w-4" /> Invite ready</p>
              <p className="mt-1 break-all text-[15px] font-medium">{link(made.code).replace("https://", "")}</p>
              <p className="mt-0.5 text-xs text-white/55">{made.n > 1 ? `Works for up to ${made.n}\u00a0women` : "Works once"} · expires in 30&nbsp;days</p>
            </div>
            <div className="mt-3 flex gap-2">
              <SendButton primary id="made" text={message(made.code, made.n)} copied={copied} copy={copy} />
              <button type="button" onClick={() => setMade(null)}
                className="min-h-11 rounded-2xl px-4 text-[15px] font-medium text-white/70 hover:bg-white/[0.06]">Another</button>
            </div>
          </div>
        ) : (
          <>
            <label htmlFor="v-who" className="mb-1.5 mt-4 block px-1 text-sm text-white/60">{group ? "Group name" : "Her name"} <span className="text-white/40">(only you see this)</span></label>
            <input id="v-who" value={who} onChange={(e) => setWho(e.target.value)} maxLength={48} autoComplete="off"
              placeholder={group ? "Lahore mothers group" : "Priya"}
              className="h-12 w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-[17px] text-white outline-none placeholder:text-white/35 focus:border-[#0A84FF] bento:bg-[#F3F2EE]" />

            <div className="mt-3 flex min-h-11 items-center justify-between gap-3 px-1 text-[15px]">
              <label htmlFor="v-group" className="cursor-pointer">For a group <span className="text-white/50">— one link for several women</span></label>
              <Switch id="v-group" checked={group} onCheckedChange={setGroup} className="data-[state=checked]:bg-[#30D158]" />
            </div>
            {group && (
              <div role="radiogroup" aria-label="How many women" className="mt-1 grid grid-cols-3 gap-1 rounded-2xl bg-white/[0.06] p-1 bento:bg-black/[0.05]">
                {[10, 25, 50].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={size === n} onClick={() => setSize(n)}
                    className={cn("min-h-10 rounded-xl text-[15px] font-semibold transition", size === n ? "bg-white/[0.14] text-white bento:bg-[#fff]" : "text-white/60")}>
                    {n} women</button>
                ))}
              </div>
            )}

            <button type="button" onClick={() => void make()} disabled={busy}
              className="mt-4 inline-flex min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl bg-[#0A84FF] text-[17px] font-semibold text-[#fff] transition hover:bg-[#0A84FF]/90 active:scale-[0.99] disabled:opacity-50">
              {busy && <Loader2 className="h-5 w-5 animate-spin" />}{busy ? "Making…" : "Create invite link"}
            </button>
            {err && <p role="alert" className="mt-2 px-1 text-sm text-red-300 bento:text-red-600">{err}</p>}
          </>
        )}
      </section>

      {/* Invites so far */}
      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between px-1">
          <h3 className="text-sm font-medium text-white/60">Your invites</h3>
          {codes && <p className="text-sm text-white/50">{joined} joined{members != null ? ` · ${members} in the beta` : ""}</p>}
        </div>
        {loadErr ? <p className="rounded-2xl bg-white/[0.04] px-4 py-4 text-[15px] text-white/60 bento:bg-[#fff]">Couldn't load them right now.</p>
          : !codes ? <div className="h-16 animate-pulse rounded-2xl bg-white/[0.04] bento:bg-[#fff]" />
          : recent.length === 0 ? <p className="rounded-2xl bg-white/[0.04] px-4 py-4 text-[15px] text-white/60 bento:bg-[#fff]">None yet.</p>
          : (
            <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl bg-white/[0.04] bento:divide-black/5 bento:bg-[#fff]">
              {recent.map((c) => {
                const st = status(c);
                return (
                  <li key={c.code} className="flex min-h-14 items-center gap-3 px-4 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">{c.label || "Invite"}</p>
                      <p className={cn("text-sm", st.done ? "text-emerald-300 bento:text-emerald-700" : "text-white/50")}>{st.done && <Check className="-mt-0.5 mr-1 inline h-3.5 w-3.5" />}{st.text}</p>
                    </div>
                    {st.open && <>
                      <SendButton id={`r-${c.code}`} label="Send" text={message(c.code, c.max_uses)} copied={copied} copy={copy} />
                      <button type="button" onClick={() => void turnOff(c)} aria-label={`Turn off invite for ${c.label || "this invite"}`}
                        className="min-h-11 rounded-xl px-2 text-sm text-white/45 hover:text-white">Turn off</button>
                    </>}
                  </li>
                );
              })}
            </ul>
          )}
      </section>

      {/* Investors */}
      <section className="mt-6">
        <h3 className="mb-2 px-1 text-sm font-medium text-white/60">For investors and partners</h3>
        <div className="flex items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 bento:bg-[#fff]">
          <p className="min-w-0 flex-1 text-[15px]">Vesta is women-only, so send them the walkthrough.</p>
          <SendButton id="inv" label="Send" text={investorMessage} copied={copied} copy={copy} />
        </div>
      </section>
    </>
  );
}

/* ───────── the sheet ───────── */

export function ProjectSheet() {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState<ProjectId | null>(null);
  useEffect(() => {
    const on = (e: Event) => { setId((e as CustomEvent<ProjectId | null>).detail ?? null); setOpen(true); };
    window.addEventListener("partner-project", on);
    return () => window.removeEventListener("partner-project", on);
  }, []);
  const p = PROJECTS.find((x) => x.id === id) ?? null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto border-white/10 bg-[#0b0d12] p-0 text-white sm:max-w-md bento:bg-[#F3F2EE]">
        <div className="px-5 pb-8 pt-5">
          {!p ? (
            <>
              <SheetTitle className="text-[1.75rem] font-bold tracking-tight text-white">Projects</SheetTitle>
              <SheetDescription className="mt-0.5 text-[15px] text-white/60">What we're building together.</SheetDescription>
              <ul className="mt-5 divide-y divide-white/[0.06] overflow-hidden rounded-2xl bg-white/[0.04] bento:divide-black/5 bento:bg-[#fff]">
                {PROJECTS.map((x) => (
                  <li key={x.id}>
                    <button type="button" onClick={() => setId(x.id)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-white/[0.04]">
                      <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", x.dot)} />
                      <span className="min-w-0 flex-1"><span className="block text-[16px] font-semibold">{x.name}</span>
                        <span className="block truncate text-sm text-white/55">{x.sub}</span></span>
                      <ChevronRight className="h-4 w-4 text-white/40" />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setId(null)} className="-ml-2 inline-flex min-h-11 items-center gap-0.5 rounded-xl px-2 text-[15px] font-medium text-[#5AB0FF] bento:text-[#0A6FD8]">
                <ChevronLeft className="h-5 w-5" /> Projects</button>
              <SheetTitle className="mt-1 text-[1.75rem] font-bold tracking-tight text-white">{p.name}</SheetTitle>
              <SheetDescription className="mt-0.5 text-[15px] text-white/60">{p.sub}</SheetDescription>

              <ul className="mt-5 divide-y divide-white/[0.06] overflow-hidden rounded-2xl bg-white/[0.04] bento:divide-black/5 bento:bg-[#fff]">
                {p.links.map((l) => (
                  <li key={l.href}>
                    <a href={l.href} target="_blank" rel="noreferrer" className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04]">
                      <span className="min-w-0 flex-1"><span className="block text-[16px] font-medium">{l.label}</span>
                        <span className="block text-sm text-white/55">{l.hint}</span></span>
                      <ExternalLink className="h-4 w-4 text-white/40" />
                    </a>
                  </li>
                ))}
              </ul>

              {p.id === "vesta" && <div className="mt-6"><VestaInvites /></div>}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
