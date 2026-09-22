/**
 * /partner — the business partner's view of Bestly (Eli).
 *
 *   /partner          sign in (email + password), then Home
 *   /partner/welcome  the one-time link Jared texts: signs in, then "choose a password"
 *
 * Home shows only what the database lets a partner read (RLS):
 *   To-dos from calls  theirs (tick off) and Jared's (read-only, so they can see what's moving)
 *   Calls              the ones they were on: summary, decisions, transcript as chat bubbles + Copy
 *   Pipeline           Cloud leads and deals by name and stage, no money or contact details
 *   Shortcuts          Studio, the Bestly Ops board, Talk
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, Check, ChevronRight, ExternalLink, Eye, EyeOff, LayoutGrid, Loader2, LogOut, MessagesSquare, Mic, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { TranscriptBubbles, CopyTranscriptButton } from "@/components/admin/TranscriptBubbles";
import { cn } from "@/lib/utils";

interface Partner { id: string; name: string; email: string; roster_name: string }
interface Meeting {
  id: string; name: string; started_at: string | null; stopped_at: string | null; people: string[];
  summary: { summary?: string; decisions?: string[]; questions?: string[] } | null;
}
interface Todo { id: string; title: string; status: string; url: string | null; action: Record<string, any> }

const card = "rounded-[1.5rem] bg-white/[0.04] border border-white/[0.06] bento:bg-[#fff] bento:border-transparent";
const btnSolid = "inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-white px-5 text-[1rem] font-semibold text-black transition active:scale-[0.98] disabled:opacity-50 bento:bg-[#111114] bento:text-[#fff]";
const input = "h-[52px] w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-[16px] text-white outline-none placeholder:text-white/35 focus:border-white/30 bento:bg-[var(--bento-well)] bento:border-black/5";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function meetingDate(m: Meeting) {
  let d: Date | null = m.started_at ? new Date(m.started_at) : null;
  const k = m.name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (!d && k) d = new Date(`${k[1]}-${k[2]}-${k[3]}T${k[4]}:${k[5]}:00`);
  if (!d) return m.name;
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
}
function minutes(m: Meeting) {
  if (!m.started_at || !m.stopped_at) return null;
  return Math.max(1, Math.round((Date.parse(m.stopped_at) - Date.parse(m.started_at)) / 60000));
}

function Shell({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const { bento } = useAdminTheme();
  useEffect(() => { document.title = "Bestly · Partner"; }, []);
  return (
    <div className={cn("admin-shell min-h-dvh text-white", bento ? "admin-bento bg-[#F3F2EE]" : "bg-black")}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <header className="flex h-14 items-center justify-between">
          <span className="text-[0.95rem] font-semibold tracking-tight">Bestly <span className="text-white/45">· Partner</span></span>
          {right}
        </header>
        {children}
      </div>
    </div>
  );
}

/* ───────── sign in ───────── */

function SignIn() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
  };
  return (
    <Shell>
      <div className="mx-auto mt-10 max-w-sm">
        <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight">Sign in</h1>
        <p className="mt-2 text-[0.975rem] text-white/60">Calls, to-dos and the pipeline you share with Jared.</p>
        <form onSubmit={submit} className="mt-8 space-y-3">
          <input className={input} type="email" autoComplete="username" inputMode="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div className="relative">
            <input className={cn(input, "pr-12")} type={show ? "text" : "password"} autoComplete="current-password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-white/50">
              {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>
          {err && <p role="alert" className="text-sm text-red-400 bento:text-red-600">{err}</p>}
          <button className={btnSolid} disabled={busy}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}</button>
        </form>
        <p className="mt-6 text-center text-sm text-white/50">First time, or forgot your password? Ask Jared for a sign-in link.</p>
      </div>
    </Shell>
  );
}

/* ───────── /partner/welcome ───────── */

export function PartnerWelcome() {
  const nav = useNavigate();
  const [stage, setStage] = useState<"checking" | "password" | "bad">("checking");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const h = new URLSearchParams(window.location.hash.slice(1));
    const t = h.get("t");
    history.replaceState(null, "", "/partner/welcome"); // the token is single-use; don't leave it in the address bar
    (async () => {
      if (t) {
        await supabase.auth.signOut({ scope: "local" });
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: t, type: "magiclink" });
        if (error || !data.session) { setStage("bad"); return; }
        setName(String(data.user?.user_metadata?.name ?? ""));
        setStage("password");
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (data.session) { setName(String(data.session.user.user_metadata?.name ?? "")); setStage("password"); }
      else setStage("bad");
    })();
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (pw.length < 10) { setErr("Use at least 10 characters."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.auth.updateUser({ password: pw, data: { password_set: true } });
    setBusy(false);
    if (error) setErr(error.message);
    else nav("/partner", { replace: true });
  };

  return (
    <Shell>
      <div className="mx-auto mt-10 max-w-sm">
        {stage === "checking" && <p className="flex items-center gap-2 text-white/60"><Loader2 className="h-5 w-5 animate-spin" /> Signing you in…</p>}
        {stage === "bad" && (
          <>
            <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight">This link has expired</h1>
            <p className="mt-2 text-[0.975rem] text-white/60">Sign-in links work once, for an hour. Ask Jared for a new one, or sign in with your password.</p>
            <button className={cn(btnSolid, "mt-8")} onClick={() => nav("/partner", { replace: true })}>Go to sign in</button>
          </>
        )}
        {stage === "password" && (
          <>
            <h1 className="text-[1.9rem] font-bold leading-tight tracking-tight">Welcome{name ? `, ${name}` : ""}</h1>
            <p className="mt-2 text-[0.975rem] text-white/60">Choose a password so you can sign in any time. Your phone's password manager can save it.</p>
            <form onSubmit={save} className="mt-8 space-y-3">
              <input className={input} type="password" autoComplete="new-password" placeholder="New password (10+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
              {err && <p role="alert" className="text-sm text-red-400 bento:text-red-600">{err}</p>}
              <button className={btnSolid} disabled={busy}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Save and continue"}</button>
            </form>
            <button className="mt-4 w-full text-center text-sm text-white/50" onClick={() => nav("/partner", { replace: true })}>Skip for now</button>
          </>
        )}
      </div>
    </Shell>
  );
}

/* ───────── home ───────── */

function Home({ session }: { session: Session }) {
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined);
  const [admin, setAdmin] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [pipe, setPipe] = useState<{ deals: any[]; leads: any[] } | null>(null);
  const [open, setOpen] = useState<Meeting | null>(null);

  const load = useCallback(async () => {
    const uid = session.user.id;
    const [{ data: p }, { data: isAdmin }] = await Promise.all([
      supabase.from("partners" as never).select("id, name, email, roster_name").eq("user_id", uid).maybeSingle(),
      supabase.rpc("has_role" as never, { _user_id: uid, _role: "admin" } as never),
    ]);
    setPartner((p as unknown as Partner) ?? null);
    setAdmin(!!isAdmin);
    const [{ data: m }, { data: t }, { data: pl }] = await Promise.all([
      supabase.from("meeting_recordings" as never).select("id, name, started_at, stopped_at, people, summary")
        .order("started_at", { ascending: false, nullsFirst: false }).limit(60),
      supabase.from("scout_daily" as never).select("id, title, status, url, action").eq("kind", "call")
        .order("created_at", { ascending: false }).limit(100),
      supabase.rpc("partner_pipeline" as never),
    ]);
    setMeetings(((m ?? []) as unknown as Meeting[]).filter((x) => x.people?.length || x.summary));
    setTodos((t ?? []) as unknown as Todo[]);
    setPipe((pl as any) ?? null);
  }, [session.user.id]);

  useEffect(() => { load(); }, [load]);

  const me = partner?.roster_name ?? (admin ? "jared" : "");
  const mine = todos.filter((t) => String(t.action?.owner ?? "").toLowerCase() === me && t.status === "open");
  const jareds = todos.filter((t) => String(t.action?.owner ?? "").toLowerCase() === "jared" && t.status === "open" && me !== "jared");
  const doneRecently = todos.filter((t) => t.status === "done").slice(0, 5);

  const tick = async (t: Todo, status: "done" | "open") => {
    setTodos((all) => all.map((x) => (x.id === t.id ? { ...x, status } : x)));
    const { error } = await supabase.rpc("partner_task_set" as never, { p_id: t.id, p_status: status } as never);
    if (error) load();
  };

  const signOut = () => supabase.auth.signOut();
  const right = (
    <button onClick={signOut} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-sm text-white/60 hover:bg-white/[0.06]">
      <LogOut className="h-4 w-4" /> Sign out
    </button>
  );

  if (partner === undefined) {
    return <Shell right={right}><p className="mt-10 flex items-center gap-2 text-white/60"><Loader2 className="h-5 w-5 animate-spin" /> Loading…</p></Shell>;
  }
  if (!partner && !admin) {
    return (
      <Shell right={right}>
        <div className="mx-auto mt-10 max-w-sm">
          <h1 className="text-[1.6rem] font-bold tracking-tight">No partner access</h1>
          <p className="mt-2 text-white/60">You're signed in as {session.user.email}, but this account isn't set up as a partner. Ask Jared.</p>
        </div>
      </Shell>
    );
  }

  if (open) return <Shell right={right}><CallView m={open} onBack={() => setOpen(null)} /></Shell>;

  const first = (partner?.name ?? "Jared").split(" ")[0];
  return (
    <Shell right={right}>
      {admin && !partner && (
        <p className="mb-4 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200 bento:text-amber-800">Preview: you're signed in as the admin, so you see every call. Eli sees only the calls he was on.</p>
      )}
      <h1 className="mt-2 text-[2rem] font-bold leading-tight tracking-tight">Hi {first}</h1>
      <p className="mt-1 text-[0.975rem] text-white/55">
        {mine.length ? `${mine.length} to-do${mine.length === 1 ? "" : "s"} on you` : "Nothing on you right now"}
        {meetings?.length ? ` · ${meetings.length} call${meetings.length === 1 ? "" : "s"}` : ""}
      </p>

      {/* To-dos */}
      <Section title="Your to-dos from calls" icon={<Check className="h-4 w-4" />}>
        {mine.length === 0 ? <Empty>All clear.</Empty> : (
          <ul className={cn(card, "divide-y divide-white/[0.06] overflow-hidden")}>
            {mine.map((t) => <TodoRow key={t.id} t={t} onTick={() => tick(t, "done")} />)}
          </ul>
        )}
        {doneRecently.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer select-none px-1 text-sm text-white/45">Recently done</summary>
            <ul className="mt-2 space-y-1 px-1">
              {doneRecently.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm text-white/45">
                  <Check className="h-4 w-4 text-emerald-400" /> <span className="line-through">{t.title}</span>
                  {String(t.action?.owner ?? "").toLowerCase() === me && <button className="ml-auto text-xs underline" onClick={() => tick(t, "open")}>Undo</button>}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      {jareds.length > 0 && (
        <Section title="Jared is on" icon={<Users className="h-4 w-4" />}>
          <ul className={cn(card, "divide-y divide-white/[0.06] overflow-hidden")}>
            {jareds.slice(0, 12).map((t) => (
              <li key={t.id} className="px-4 py-3 sm:px-5">
                <p className="text-[0.95rem] text-white/85">{t.title}</p>
                <p className="mt-0.5 text-xs text-white/45">{t.action?.due ? `Due ${t.action.due} · ` : ""}{String(t.action?.meeting ?? "")}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Calls */}
      <Section title="Calls" icon={<Mic className="h-4 w-4" />}>
        {meetings === null ? <div className={cn(card, "h-24 animate-pulse")} /> : meetings.length === 0 ? <Empty>No calls yet.</Empty> : (
          <ul className={cn(card, "divide-y divide-white/[0.06] overflow-hidden")}>
            {meetings.map((m) => (
              <li key={m.id}>
                <button onClick={() => setOpen(m)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-white/[0.04] sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.975rem] font-semibold text-white">{meetingDate(m)}</p>
                    <p className="mt-0.5 truncate text-sm text-white/55">
                      {["Jared", ...m.people.map(cap)].join(", ")}{minutes(m) ? ` · ${minutes(m)} min` : ""}
                    </p>
                    {m.summary?.summary && <p className="mt-1 line-clamp-2 text-sm text-white/70">{m.summary.summary}</p>}
                  </div>
                  <ChevronRight className="h-5 w-5 shrink-0 text-white/30" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Pipeline */}
      {pipe && (pipe.deals.length > 0 || pipe.leads.length > 0) && (
        <Section title="Cloud pipeline" icon={<LayoutGrid className="h-4 w-4" />}>
          <ul className={cn(card, "divide-y divide-white/[0.06] overflow-hidden")}>
            {pipe.deals.map((d, i) => (
              <li key={`d${i}`} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <span className="text-[0.95rem] text-white">{d.company}</span>
                <span className="text-xs text-white/55">{STAGE[d.stage] ?? `Stage ${d.stage}`}</span>
              </li>
            ))}
            {pipe.leads.map((l, i) => (
              <li key={`l${i}`} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                <span className="text-[0.95rem] text-white">{l.company}</span>
                <span className="text-xs text-white/55">Lead · {l.size ?? ""}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Shortcuts */}
      <Section title="Shortcuts" icon={<ExternalLink className="h-4 w-4" />}>
        <div className="grid grid-cols-3 gap-2">
          <Shortcut href="https://studio.bestly.tech" label="Studio" />
          <Shortcut href="https://cloud.bestly.tech/apps/deck/board/2" label="Ops board" />
          <Shortcut href="https://cloud.bestly.tech/apps/spreed" label="Talk" icon={<MessagesSquare className="h-5 w-5" />} />
        </div>
      </Section>
    </Shell>
  );
}

const STAGE: Record<number, string> = { 3: "Discovery", 4: "SOW + deposit", 5: "Tech intake", 6: "Provisioning", 7: "Install", 8: "Live" };

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-2.5 flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-widest text-white/50">{icon}{title}</h2>
      {children}
    </section>
  );
}
const Empty = ({ children }: { children: ReactNode }) => <p className={cn(card, "px-5 py-4 text-[0.95rem] text-white/55")}>{children}</p>;

function TodoRow({ t, onTick }: { t: Todo; onTick: () => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <button aria-label="Mark done" onClick={onTick} className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-white/25 text-transparent transition hover:border-emerald-400 hover:text-emerald-400 active:scale-90">
        <Check className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[0.975rem] text-white">{t.title}</p>
        <p className="mt-0.5 text-xs text-white/45">{t.action?.due ? `Due ${t.action.due} · ` : ""}{String(t.action?.meeting ?? "")}</p>
      </div>
    </li>
  );
}

function Shortcut({ href, label, icon }: { href: string; label: string; icon?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn(card, "flex min-h-[72px] flex-col items-center justify-center gap-1.5 text-sm font-medium text-white/85 transition active:scale-[0.97]")}>
      {icon ?? <ExternalLink className="h-5 w-5 text-white/50" />}{label}
    </a>
  );
}

function CallView({ m, onBack }: { m: Meeting; onBack: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("meeting_recordings" as never).select("transcript").eq("id", m.id).maybeSingle()
      .then(({ data }) => setText(String((data as any)?.transcript ?? "")));
    window.scrollTo(0, 0);
  }, [m.id]);
  const s = m.summary;
  return (
    <div>
      <button onClick={onBack} className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-[0.95rem] text-[#0A84FF]">
        <ArrowLeft className="h-5 w-5" /> Calls
      </button>
      <h1 className="mt-1 text-[1.6rem] font-bold leading-tight tracking-tight">{meetingDate(m)}</h1>
      <p className="mt-1 text-sm text-white/55">{["Jared", ...m.people.map(cap)].join(", ")}{minutes(m) ? ` · ${minutes(m)} min` : ""}</p>

      {s?.summary && (
        <div className={cn(card, "mt-5 space-y-3 px-5 py-4")}>
          <p className="text-[0.975rem] leading-relaxed text-white/85">{s.summary}</p>
          {!!s.decisions?.length && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/45">Decided</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[0.95rem] text-white/80">{s.decisions.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </div>
          )}
          {!!s.questions?.length && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/45">Still open</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[0.95rem] text-white/80">{s.questions.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div className="sticky top-0 z-10 mt-6 flex items-center justify-between bg-inherit py-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-white/50">Transcript</h2>
        <CopyTranscriptButton text={text ?? ""} />
      </div>
      {text === null ? <div className={cn(card, "h-40 animate-pulse")} /> : <TranscriptBubbles text={text} />}
    </div>
  );
}

/* ───────── entry ───────── */

export default function PartnerPortal() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const loc = useLocation();
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  const key = useMemo(() => loc.pathname, [loc.pathname]);
  if (session === undefined) return <Shell><p className="mt-10 flex items-center gap-2 text-white/60" key={key}><Loader2 className="h-5 w-5 animate-spin" /> Loading…</p></Shell>;
  return session ? <Home session={session} /> : <SignIn />;
}
