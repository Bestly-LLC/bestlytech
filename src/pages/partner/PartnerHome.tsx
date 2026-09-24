/**
 * The partner's signed-in portal (Eli). Desktop: sidebar + wide dashboard grid. Mobile: bottom tab bar.
 *
 *   Home   greeting, join-the-call, stats, to-dos, recent calls, latest emails, files, pipeline, shortcuts
 *   Calls  every call they were on: summary, decisions, transcript as chat bubbles + Copy
 *   Scout  free AI assistant (local model on Jared's Mac mini), knows their calls, to-dos and pipeline.
 *          Keeps working while they browse; ScoutAlert pops up when an answer lands.
 *   Mail   every email Jared sent them, with attachments and doc links (synced from Jared's Sent folders)
 *   Files  every attachment and linked doc from those emails
 *
 * Only what RLS lets a partner read. To add a tab: add it to TABS and render it in the switch.
 * To add a shortcut: add it to SHORTCUTS (art lives in partnerArt.tsx).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, Eye, ExternalLink, FileArchive, FileImage, FileSpreadsheet, FileText,
  Files as FilesIcon, Home as HomeIcon, Inbox, LayoutGrid, Link2, Loader2, LogOut, Mail, Mic, Paperclip, Presentation,
  Bell, Binoculars, Fingerprint, Moon, Plug, Search, Sun, Users, Video,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { Switch } from "@/components/ui/switch";
import { TranscriptBubbles, CopyTranscriptButton } from "@/components/admin/TranscriptBubbles";
import { CopyButton } from "@/components/CopyText";
import { AdminMark } from "@/components/AdminMark";
import { PartnerMark } from "@/components/PartnerMark";
import { WeatherNow, type Place } from "@/components/admin/WeatherNow";
import { CheckButton, CheckResult, usePartnerCheck, type CheckRow } from "@/components/admin/todoCheck";
import { GreetingSwap } from "./GreetingSwap";
import { cn } from "@/lib/utils";
import { ART } from "./partnerArt";
import { DocPreview, type PreviewFile } from "@/components/DocPreview";
import { FileThumb } from "./FileThumb";
import { addPasskey, passkeyCount, passkeysSupported } from "@/lib/passkey";
import { BoardSheet, CalendarSheet, CloudSheet, TalkSheet, useTalkUnread } from "./PartnerCloud";
import { BellButton, BellSheet, ConnectClaude, useNextMeeting, usePartnerNotifs, whenLabel, type NextEvent } from "./PartnerExtras";
import { SCOUT_IDEAS, PartnerScout, ScoutAlert, usePartnerScout, type ScoutState } from "./PartnerScout";

/* ───────── types + helpers ───────── */

interface Partner { id: string; name: string; email: string; roster_name: string; call_url: string | null; company: string | null; mark: string; wx_lat?: number | null; wx_lon?: number | null; wx_label?: string | null; wx_at?: string | null; wx_precise?: boolean | null }
export interface Meeting {
  id: string; name: string; started_at: string | null; stopped_at: string | null; people: string[];
  summary: { summary?: string; decisions?: string[]; questions?: string[] } | null;
}
interface Todo { id: string; title: string; status: string; url: string | null; action: Record<string, any>; done_at?: string | null }
interface Att { name: string; size: number; type: string | null; path: string | null; skipped?: string }
interface DocLink { url: string; kind: string }
interface MailRow { id: string; subject: string | null; sent_at: string | null; to_addrs: string[]; cc_addrs: string[]; body_text: string | null; links: DocLink[]; attachments: Att[] }

type Tab = "home" | "calls" | "scout" | "mail" | "files";
const TABS: { id: Tab; label: string; icon: typeof HomeIcon }[] = [
  { id: "home", label: "Home", icon: HomeIcon },
  { id: "calls", label: "Calls", icon: Mic },
  { id: "scout", label: "Scout", icon: Binoculars },
  { id: "mail", label: "Mail", icon: Inbox },
  { id: "files", label: "Files", icon: FilesIcon },
];

// Studio signs him in with his own passkey; everything on cloud.bestly.tech opens inside the
// portal instead (partner-nc signs in as his seat), so he never needs a Nextcloud login.
const SHORTCUTS = [
  { id: "studio", href: "https://studio.bestly.tech", label: "Studio", sub: "Review queue", tone: "from-violet-500 to-fuchsia-500 text-violet-600" },
  { id: "talk", opens: "talk" as const, label: "Talk", sub: "Chat with Jared", tone: "from-sky-400 to-blue-600 text-blue-600" },
  { id: "ops", opens: "board" as const, label: "Ops board", sub: "What's moving", tone: "from-amber-400 to-orange-500 text-orange-600" },
  { id: "files", opens: "cloud" as const, label: "Cloud files", sub: "Your folders", tone: "from-emerald-400 to-teal-600 text-teal-600" },
  { id: "calendar", opens: "calendar" as const, label: "Calendar", sub: "What's booked", tone: "from-rose-400 to-pink-600 text-pink-600" },
];

// The three things Jared and Eli are building together. Live links, not screenshots -
// Eli sends these to Rohit and to investors, so they go straight to the real thing.
const PROJECTS = [
  { name: "Vesta", sub: "Women-only social + well-being", with: "with Eli and Rohit", links: [
    { label: "Framework", href: "https://vesta.bestly.tech" },
    { label: "Beta", href: "https://app.bestly.tech" },
  ], tone: "from-rose-400/20 to-fuchsia-500/10" },
  { name: "InventoryProof", sub: "Proof-of-inventory for resellers", with: "", links: [
    { label: "Open", href: "https://www.inventoryproof.com" },
  ], tone: "from-sky-400/20 to-indigo-500/10" },
  { name: "HOKU", sub: "Clean, refillable home care", with: "", links: [
    { label: "Open", href: "https://hoku-clean.com" },
  ], tone: "from-emerald-400/20 to-teal-500/10" },
];

export type CloudView = "talk" | "board" | "cloud" | "calendar" | null;

const STAGE: Record<number, string> = { 3: "Discovery", 4: "SOW + deposit", 5: "Tech intake", 6: "Provisioning", 7: "Install", 8: "Live" };
const card = "rounded-[1.5rem] border border-white/[0.07] bg-white/[0.035] bento:border-transparent bento:bg-[#fff] bento:shadow-[0_1px_2px_rgba(17,17,20,0.04)]";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const PT = { timeZone: "America/Los_Angeles" } as const;

export function meetingDate(m: Meeting) {
  const k = m.name.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  let d = m.started_at ? new Date(m.started_at) : null;
  if (!d && k) d = new Date(`${k[1]}-${k[2]}-${k[3]}T${k[4]}:${k[5]}:00`);
  if (!d) return m.name;
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...PT });
}
export function minutes(m: Meeting) {
  if (!m.started_at || !m.stopped_at) return null;
  return Math.max(1, Math.round((Date.parse(m.stopped_at) - Date.parse(m.started_at)) / 60000));
}
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric", ...PT }) : "");
const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const greeting = () => {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, ...PT }));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

function fileIcon(a: Att) {
  const n = a.name.toLowerCase(), t = a.type ?? "";
  if (t.startsWith("image/")) return FileImage;
  if (/\.(xlsx?|csv|numbers)$/.test(n) || t.includes("sheet")) return FileSpreadsheet;
  if (/\.(pptx?|key)$/.test(n) || t.includes("presentation")) return Presentation;
  if (/\.(zip|rar|7z)$/.test(n)) return FileArchive;
  return FileText;
}

/** Open an attachment in the in-site previewer (PartnerHome listens for this). */
function openFile(a: Att) {
  window.dispatchEvent(new CustomEvent<Att>("partner-preview", { detail: a }));
}

/** Plain text with clickable links. */
function Linked({ text }: { text: string }) {
  const bits = text.split(/(https?:\/\/[^\s<>()"']+)/g);
  return <>{bits.map((b, i) => (/^https?:\/\//.test(b)
    ? <a key={i} href={b.replace(/[.,;:!?]+$/, "")} target="_blank" rel="noreferrer" className="break-all text-[#0A84FF] underline-offset-2 hover:underline">{b}</a>
    : <span key={i}>{b}</span>))}</>;
}

/* ───────── shell ───────── */

export function PartnerHome({ session }: { session: Session }) {
  const { bento, toggle: toggleTheme } = useAdminTheme();
  // Theme on <body> too: menus, sheets and toasts render there, and the page scrollbar follows it.
  useEffect(() => {
    document.body.classList.add("admin-shell");
    return () => document.body.classList.remove("admin-shell");
  }, []);
  useEffect(() => {
    document.body.classList.toggle("admin-bento", bento);
    return () => document.body.classList.remove("admin-bento");
  }, [bento]);
  const [partner, setPartner] = useState<Partner | null | undefined>(undefined);
  const [admin, setAdmin] = useState(false);
  const [viewAs, setViewAs] = useState(false);
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [pipe, setPipe] = useState<{ deals: any[]; leads: any[] } | null>(null);
  const [mail, setMail] = useState<MailRow[] | null>(null);
  const hashTab = () => { const h = window.location.hash.slice(1); return (h === "ask" ? "scout" : TABS.some((t) => t.id === h) ? h : null) as Tab | null; };
  const [tab, setTabState] = useState<Tab>(() => hashTab() ?? "home");
  const [openCall, setOpenCall] = useState<Meeting | null>(null);
  const [openMail, setOpenMail] = useState<MailRow | null>(null);
  const [askDraft, setAskDraft] = useState<string | undefined>();
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [cloud, setCloud] = useState<CloudView>(null);
  const talkUnread = useTalkUnread(!!partner);
  const [bellOpen, setBellOpen] = useState(false);
  // Read once: switching tabs rewrites the address, and "view as" must survive that.
  const [asParam] = useState(() => new URLSearchParams(window.location.search).get("as")?.toLowerCase() || null);
  const notifs = usePartnerNotifs(asParam);
  const { next: nextMtg, events: upcoming } = useNextMeeting();
  useEffect(() => {
    const on = async (e: Event) => {
      const a = (e as CustomEvent<Att>).detail;
      if (!a.path) { setPreview({ name: a.name, type: a.type, url: null }); return; }
      const { data } = await supabase.storage.from("partner-files").createSignedUrl(a.path, 1800);
      setPreview({ name: a.name, type: a.type, url: data?.signedUrl ?? null });
    };
    window.addEventListener("partner-preview", on);
    return () => window.removeEventListener("partner-preview", on);
  }, []);

  const setTab = useCallback((t: Tab) => {
    setTabState(t); setOpenCall(null); setOpenMail(null);
    window.history.replaceState(null, "", window.location.pathname + window.location.search + (t === "home" ? "" : `#${t}`));
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const onHash = () => { const h = hashTab(); if (h) setTabState(h); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Scout lives up here so answers keep arriving (and alert) wherever Eli is in the portal.
  const scout = usePartnerScout(session.user.id, tab === "scout");

  const load = useCallback(async () => {
    const uid = session.user.id;
    const [{ data: p }, { data: isAdmin }] = await Promise.all([
      supabase.from("partners" as never).select("id, name, email, roster_name, call_url, company, mark, wx_lat, wx_lon, wx_label, wx_at, wx_precise").eq("user_id", uid).maybeSingle(),
      supabase.rpc("has_role" as never, { _user_id: uid, _role: "admin" } as never),
    ]);
    // Admin "view as": /partner?as=eli shows exactly that partner's screen, using the same
    // filters his row rules apply (his calls, his to-dos, the mail sent to him).
    let asPartner: Partner | null = null;
    const asRoster = isAdmin ? asParam : null;
    if (asRoster && !p) {
      const { data: ap } = await supabase.from("partners" as never).select("id, name, email, roster_name, call_url, company, mark, wx_lat, wx_lon, wx_label, wx_at, wx_precise").eq("roster_name", asRoster).maybeSingle();
      asPartner = (ap as unknown as Partner) ?? null;
    }
    setViewAs(!!asPartner);
    setPartner(((p as unknown as Partner) ?? asPartner) ?? null);
    setAdmin(!!isAdmin);
    const [{ data: m }, { data: t }, { data: pl }, { data: ml }] = await Promise.all([
      supabase.from("meeting_recordings" as never).select("id, name, started_at, stopped_at, people, summary")
        .order("started_at", { ascending: false, nullsFirst: false }).limit(60),
      supabase.from("scout_daily" as never).select("id, title, status, url, action, done_at").eq("kind", "call")
        .order("created_at", { ascending: false }).limit(100),
      supabase.rpc("partner_pipeline" as never),
      (() => {
        let q = supabase.from("partner_mail" as never).select("id, subject, sent_at, to_addrs, cc_addrs, body_text, links, attachments");
        if (asPartner) q = q.eq("roster" as never, asPartner.roster_name as never);
        return q.order("sent_at", { ascending: false, nullsFirst: false }).limit(300);
      })(),
    ]);
    let meets = ((m ?? []) as unknown as Meeting[]).filter((x) => x.people?.length || x.summary);
    let items = (t ?? []) as unknown as Todo[];
    if (asPartner) {
      const r = asPartner.roster_name;
      meets = meets.filter((x) => x.people?.includes(r));
      const seen = new Set(meets.map((x) => String(x.id)));
      items = items.filter((x) => String(x.action?.owner ?? "").toLowerCase() === r || seen.has(String((x.action as any)?.meeting_id ?? "")));
    }
    setMeetings(meets);
    setTodos(items);
    setPipe((pl as any) ?? null);
    setMail((ml ?? []) as unknown as MailRow[]);
  }, [session.user.id, asParam]);
  useEffect(() => { load(); }, [load]);

  const me = partner?.roster_name ?? (admin ? "jared" : "");
  const mine = todos.filter((t) => String(t.action?.owner ?? "").toLowerCase() === me && t.status === "open");
  const jareds = todos.filter((t) => String(t.action?.owner ?? "").toLowerCase() === "jared" && t.status === "open" && me !== "jared");
  // Completed to-dos stay recoverable: newest first under "Done", and every tick offers Undo.
  const done = todos.filter((t) => String(t.action?.owner ?? "").toLowerCase() === me && t.status === "done")
    .sort((a, b) => String(b.done_at ?? "").localeCompare(String(a.done_at ?? "")));
  const tick = async (t: Todo, status: "done" | "open", quiet = false) => {
    const at = status === "done" ? new Date().toISOString() : null;
    setTodos((all) => all.map((x) => (x.id === t.id ? { ...x, status, done_at: at } : x)));
    const { error } = await supabase.rpc("partner_task_set" as never, { p_id: t.id, p_status: status } as never);
    if (error) { toast.error("Couldn't save that", { description: error.message }); load(); return; }
    if (!quiet) {
      toast(status === "done" ? "Marked done" : "Back on your list", {
        description: t.title,
        action: { label: "Undo", onClick: () => tick(t, status === "done" ? "open" : "done", true) },
      });
    }
  };
  const signOut = () => supabase.auth.signOut();
  const callUrl = partner?.call_url ?? "https://cloud.bestly.tech/call/sm33w3fu";
  // The next meeting on the calendar with Eli, if there is one; else his standing room.
  const joinUrl = nextMtg?.join_url ?? callUrl;
  const savePlace = useCallback((p: Place) => {
    supabase.rpc("partner_set_place" as never, { p_lat: p.lat, p_lon: p.lon, p_label: p.label, p_precise: !p.approx } as never).then(() => {});
  }, []);
  const first = (partner?.name ?? "Jared").split(" ")[0];
  // Weather: the partner's own browser finds where they are and saves it (city level) on their row;
  // Jared's "view as" then shows the partner's weather, not his own.
  const wxFixed: Place | null = viewAs && partner?.wx_lat != null && partner?.wx_lon != null
    ? { lat: Number(partner.wx_lat), lon: Number(partner.wx_lon), label: partner.wx_label ?? "Their area", approx: partner.wx_precise === false }
    : null;
  const wxNote = viewAs && partner ? `${first}'s last location${partner.wx_at ? `, ${new Date(partner.wx_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}` : ""}` : undefined;
  const files = useMemo(() => (mail ?? []).flatMap((m) => m.attachments.map((a) => ({ ...a, mail: m }))), [mail]);
  const docs = useMemo(() => {
    const seen = new Set<string>();
    return (mail ?? []).flatMap((m) => m.links.map((l) => ({ ...l, mail: m }))).filter((l) => (seen.has(l.url) ? false : (seen.add(l.url), true)));
  }, [mail]);

  const askScout = (q?: string) => { setAskDraft(q); setTab("scout"); };
  const shell = cn("admin-shell min-h-dvh text-white", bento ? "admin-bento bg-[#F3F2EE]" : "bg-black");

  if (partner === undefined) {
    // The binoculars, glancing - the same mark (and the same point in its cycle) the boot splash
    // and BrandLoader show, so one load is one mark rather than logo -> binoculars -> globe.
    return <div className={cn(shell, "grid place-items-center")}><AdminMark className="h-24 w-24" label="Loading" /></div>;
  }
  if (!partner && !admin) {
    return (
      <div className={cn(shell, "grid place-items-center px-6")}>
        <div className="max-w-sm text-center">
          <PartnerMark className="mx-auto h-16 w-16" />
          <h1 className="mt-4 text-[1.6rem] font-bold tracking-tight">No partner access</h1>
          <p className="mt-2 text-white/60">You're signed in as {session.user.email}, but this account isn't set up as a partner. Ask Jared.</p>
          <button onClick={signOut} className="mt-6 text-sm text-white/60 underline">Sign out</button>
        </div>
      </div>
    );
  }

  const badge: Partial<Record<Tab, number>> = { home: mine.length || undefined, scout: scout.unread || undefined };
  const busy: Partial<Record<Tab, boolean>> = { scout: scout.thinking && tab !== "scout" };

  return (
    <div className={shell}>
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-white/[0.06] bg-black/40 px-4 py-6 backdrop-blur lg:flex bento:border-black/5 bento:bg-[#fff]/70">
        <div className="flex items-center gap-2.5 px-2">
          <AdminMark className="h-8 w-8" />
          <span className="text-[1rem] font-semibold tracking-tight">Bestly <span className="text-white/45">· Partner</span></span>
        </div>
        <nav className="mt-8 space-y-1" aria-label="Portal">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}
              className={cn("flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium transition",
                tab === id ? "bg-white/[0.09] text-white bento:bg-[#111114] bento:text-[#fff]" : "text-white/60 hover:bg-white/[0.05] hover:text-white")}>
              <Icon className="h-[18px] w-[18px]" />{label}
              {badge[id] ? <span className="ml-auto rounded-full bg-[#0A84FF] px-2 text-xs font-semibold text-[#fff]">{badge[id]}</span>
                : busy[id] ? <Loader2 className="ml-auto h-4 w-4 animate-spin text-white/45" aria-label="Scout is thinking" /> : null}
            </button>
          ))}
        </nav>
        <div className="mt-6 space-y-1 border-t border-white/[0.06] pt-4 bento:border-black/5">
          <button onClick={() => setBellOpen(true)} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium text-white/60 hover:bg-white/[0.05] hover:text-white">
            <Bell className="h-[18px] w-[18px]" /> Studio
            {notifs.unread > 0 && <span className="ml-auto rounded-full bg-red-500 px-2 text-xs font-semibold text-[#fff]">{notifs.unread}</span>}
          </button>
          <button onClick={() => setConnectOpen(true)} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium text-white/60 hover:bg-white/[0.05] hover:text-white">
            <Plug className="h-[18px] w-[18px]" /> Connect my Claude
          </button>
        </div>
        <div className="mt-auto space-y-2">
          <a href={joinUrl} target="_blank" rel="noreferrer"
            className="flex min-h-11 flex-col items-center justify-center rounded-xl bg-emerald-500 px-3 py-2 text-center text-[0.95rem] font-semibold text-[#fff] transition hover:bg-emerald-400 active:scale-[0.98]">
            <span className="flex items-center gap-2"><Video className="h-[18px] w-[18px]" /> {nextMtg ? "Join next meeting" : "Join our call"}</span>
            {nextMtg && <span className="text-xs font-medium opacity-85">{whenLabel(nextMtg.start)}</span>}
          </a>
          <label className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-[0.95rem] font-medium text-white/60 hover:bg-white/[0.05] hover:text-white">
            <Moon className="h-[18px] w-[18px]" /> Dark mode
            <Switch className="ml-auto data-[state=checked]:bg-[#30D158]" checked={!bento} onCheckedChange={toggleTheme} aria-label="Dark mode" />
          </label>
          <PasskeyRow userId={session.user.id} />
          <button onClick={signOut} className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-sm text-white/50 hover:bg-white/[0.05] hover:text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </aside>

      <main className="lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/[0.06] bg-black/70 px-4 pb-2 pt-[max(0.6rem,env(safe-area-inset-top))] backdrop-blur-xl lg:hidden bento:border-black/5 bento:bg-[#F3F2EE]/80">
          <span className="flex items-center gap-2 text-[0.95rem] font-semibold tracking-tight">
            <AdminMark className="h-7 w-7" /> Bestly <span className="text-white/45">· Partner</span>
          </span>
          <div className="flex items-center gap-1">
            <BellButton notifs={notifs} onClick={() => setBellOpen(true)} />
            <a href={joinUrl} target="_blank" rel="noreferrer" aria-label={nextMtg ? `Join next meeting, ${whenLabel(nextMtg.start)}` : "Join our call"}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-emerald-500 px-3.5 text-sm font-semibold text-[#fff] active:scale-95">
              <Video className="h-4 w-4" /> Call
            </a>
            <button onClick={toggleTheme} aria-label={bento ? "Switch to dark mode" : "Switch to light mode"} className="grid h-10 w-10 place-items-center rounded-full text-white/55 hover:bg-white/[0.06]">
              {bento ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
            </button>
            <button onClick={signOut} aria-label="Sign out" className="grid h-10 w-10 place-items-center rounded-full text-white/55 hover:bg-white/[0.06]">
              <LogOut className="h-[18px] w-[18px]" />
            </button>
          </div>
        </header>

        <div className="fixed right-6 top-5 z-20 hidden rounded-full bg-black/40 backdrop-blur lg:block bento:bg-[#fff]/80">
          <BellButton notifs={notifs} onClick={() => setBellOpen(true)} />
        </div>
        <div className="mx-auto w-full max-w-6xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
          {viewAs && partner && (
            <p className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-sky-500/10 px-4 py-3 text-sm text-sky-200 bento:text-sky-800">
              <span>Viewing as {partner.name.split(" ")[0]}: this is his screen. (Scout chats shown are yours.)</span>
              <a href="/partner" className="font-semibold underline-offset-2 hover:underline">Exit</a>
            </p>
          )}
          {admin && !partner && (
            <p className="mb-5 rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200 bento:text-amber-800">
              Preview: you're signed in as the admin, so you see everything. <a href="/partner?as=eli" className="font-semibold underline">See exactly what Eli sees</a>
            </p>
          )}

          {tab === "home" && (
            <HomeTab reload={load} canCheck={!!partner && !viewAs} first={first} company={partner?.company ?? null} wxFixed={wxFixed} wxNote={wxNote} onWxPlace={viewAs || !partner ? undefined : savePlace} callUrl={callUrl} joinUrl={joinUrl} nextMtg={nextMtg ?? null} studioUnread={notifs.unread} onConnect={() => setConnectOpen(true)} openCloud={setCloud} talkUnread={talkUnread} mine={mine} done={done} jareds={jareds} me={me} tick={tick} meetings={meetings} mail={mail}
              files={files} pipe={pipe} go={setTab} openCall={(m) => { setTab("calls"); setOpenCall(m); }}
              openMail={(m) => { setTab("mail"); setOpenMail(m); }} ask={askScout} scout={scout} />
          )}
          {tab === "calls" && (openCall ? <CallView m={openCall} onBack={() => setOpenCall(null)} onAsk={askScout} /> : <CallsTab meetings={meetings} open={setOpenCall} upcoming={upcoming} />)}
          {tab === "scout" && <PartnerScout scout={scout} name={first} draft={askDraft} onDraftUsed={() => setAskDraft(undefined)} />}
          {tab === "mail" && <MailTab mail={mail} open={openMail} setOpen={setOpenMail} onAsk={askScout} />}
          {tab === "files" && <FilesTab files={files} docs={docs} openMail={(m) => { setTab("mail"); setOpenMail(m); }} />}
        </div>
      </main>

      <DocPreview file={preview} onClose={() => setPreview(null)} />
      <TalkSheet open={cloud === "talk"} onOpenChange={(o) => !o && setCloud(null)} />
      <BoardSheet open={cloud === "board"} onOpenChange={(o) => !o && setCloud(null)} />
      <CloudSheet open={cloud === "cloud"} onOpenChange={(o) => !o && setCloud(null)} />
      <CalendarSheet open={cloud === "calendar"} onOpenChange={(o) => !o && setCloud(null)} />
      <ConnectClaude open={connectOpen} onOpenChange={setConnectOpen} />
      <BellSheet notifs={notifs} open={bellOpen} onOpenChange={setBellOpen} />
      {tab !== "scout" && <ScoutAlert scout={scout} open={() => setTab("scout")} />}

      {/* Mobile tab bar */}
      <nav aria-label="Portal" className="fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-black/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden bento:border-black/5 bento:bg-[#fff]/95">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}
              className={cn("relative flex h-[3.6rem] flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition active:scale-95",
                tab === id ? "text-[#0A84FF]" : "text-white/50")}>
              <Icon className="h-[22px] w-[22px]" strokeWidth={tab === id ? 2.4 : 2} />{label}
              {badge[id] ? <span className="absolute right-[22%] top-1.5 min-w-[18px] rounded-full bg-[#0A84FF] px-1 text-[10px] font-bold leading-[18px] text-[#fff]">{badge[id]}</span>
                : busy[id] ? <span className="absolute right-[27%] top-2 h-2.5 w-2.5 animate-pulse rounded-full bg-[#0A84FF]" aria-label="Scout is thinking" /> : null}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

/* ───────── Home ───────── */

function HomeTab(props: {
  reload: () => void | Promise<void>; canCheck: boolean;
  wxFixed: Place | null; wxNote?: string; onWxPlace?: (p: Place) => void;
  first: string; company: string | null; callUrl: string; joinUrl: string; nextMtg: NextEvent | null; studioUnread: number; onConnect: () => void; openCloud: (v: CloudView) => void; talkUnread: number; mine: Todo[]; done: Todo[]; jareds: Todo[]; me: string; tick: (t: Todo, s: "done" | "open") => void;
  meetings: Meeting[] | null; mail: MailRow[] | null; files: (Att & { mail: MailRow })[]; pipe: { deals: any[]; leads: any[] } | null;
  go: (t: Tab) => void; openCall: (m: Meeting) => void; openMail: (m: MailRow) => void; ask: (q?: string) => void; scout: ScoutState;
}) {
  const { reload, canCheck, wxFixed, wxNote, onWxPlace, first, company, callUrl, joinUrl, nextMtg, studioUnread, onConnect, openCloud, talkUnread, mine, done, jareds, tick, meetings, mail, files, pipe, go, openCall, openMail, ask, scout } = props;
  // "Check if it's done" for his own to-dos: check only, never closes anything for him
  const pc = usePartnerCheck(reload, mine as CheckRow[]);
  const [q, setQ] = useState("");
  const [excited, setExcited] = useState(false); // hovering the greeting: the mark reacts
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...PT });
  const deals = pipe?.deals.length ?? 0;
  const stats = [
    { label: "On you", value: mine.length, icon: Check, tab: "home" as Tab },
    { label: "Calls", value: meetings?.length ?? 0, icon: Mic, tab: "calls" as Tab },
    { label: "Emails from Jared", value: mail?.length ?? 0, icon: Mail, tab: "mail" as Tab },
    { label: "Files", value: files.length, icon: Paperclip, tab: "files" as Tab },
  ];

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className={cn(card, "relative overflow-hidden p-5 sm:p-7")}>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#0A84FF]/20 blur-3xl bento:bg-[#0A84FF]/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-28 left-1/3 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <PartnerMark className="h-16 w-16 shrink-0 sm:h-20 sm:w-20" label="Globe" excited={excited} />
            {/* never narrower than the greeting: the hover target must cover the whole name, or the
                swap can't start. The weather / call button wrap below instead. */}
            <div className="shrink-0">
              <p className="text-sm text-white/50">{today}</p>
              <GreetingSwap greeting={greeting()} name={first} company={company} onExcite={setExcited}
                className="whitespace-nowrap text-[clamp(1.3rem,6vw,2.3rem)] font-bold leading-tight tracking-tight" />
              <p className="mt-0.5 text-[0.95rem] text-white/60">
                {mine.length ? `${mine.length} to-do${mine.length === 1 ? "" : "s"} on you` : "Nothing on you right now"}
                {deals ? ` · ${deals} deal${deals === 1 ? "" : "s"} in motion` : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row">
            <WeatherNow useDeviceLocation fixedPlace={wxFixed} fixedNote={wxNote} onPlace={onWxPlace} className="self-start" />
            <a href={joinUrl} target="_blank" rel="noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2.5 rounded-2xl bg-emerald-500 px-5 py-2 text-[#fff] shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)] transition hover:bg-emerald-400 active:scale-[0.98]">
              <Video className="h-5 w-5 shrink-0" />
              <span className="text-left leading-tight">
                <span className="block text-[1rem] font-semibold">{nextMtg ? "Join next meeting" : "Join our call"}</span>
                {nextMtg && <span className="block text-xs font-medium opacity-90">{whenLabel(nextMtg.start)} · {nextMtg.title}</span>}
              </span>
            </a>
            <button onClick={() => ask()}
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-white/[0.09] px-5 text-[1rem] font-semibold text-white transition hover:bg-white/[0.14] active:scale-[0.98] bento:bg-[#111114] bento:text-[#fff]">
              <Binoculars className="h-5 w-5" /> Ask Scout
            </button>
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stats.map(({ label, value, icon: Icon, tab }) => (
            <button key={label} onClick={() => tab !== "home" && go(tab)}
              className="rounded-2xl bg-white/[0.05] px-4 py-3 text-left transition hover:bg-white/[0.08] bento:bg-[#F3F2EE]">
              <Icon className="h-4 w-4 text-white/45" />
              <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
              <p className="text-xs text-white/50">{label}</p>
            </button>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* To-dos */}
        <Panel title="Your to-dos" icon={Check} className="lg:col-span-2">
          {mine.length === 0 ? <Muted>All clear. Nothing from your calls is waiting on you.</Muted> : (
            <ul className="divide-y divide-white/[0.06]">
              {mine.map((t) => {
                const checking = t.id in pc.pending;
                return (
                <li key={t.id} className="flex items-start gap-3 py-3">
                  <button aria-label="Mark done" onClick={() => tick(t, "done")}
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-white/25 text-transparent transition hover:border-emerald-400 hover:text-emerald-400 active:scale-90">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-[0.975rem]">{t.title}</p>
                    <p className="mt-0.5 text-xs text-white/45">{t.action?.due ? `Due ${t.action.due} · ` : ""}{String(t.action?.meeting ?? "")}</p>
                    {t.action?.check && !checking && (
                      <CheckResult r={t as CheckRow} tc={{ feedback: pc.feedback }} onDone={() => tick(t, "done")} onNext={(q) => ask(q)} />
                    )}
                  </div>
                  {canCheck && <CheckButton busy={checking} onClick={() => pc.checkOne(t as CheckRow)} />}
                </li>
                );
              })}
            </ul>
          )}
          {done.length > 0 && <DoneList done={done} tick={tick} />}
          {jareds.length > 0 && (
            <div className="mt-4 rounded-2xl bg-white/[0.035] p-4 bento:bg-[#F3F2EE]">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-white/45"><Users className="h-3.5 w-3.5" /> Jared is on</p>
              <ul className="mt-2 space-y-1.5">
                {jareds.slice(0, 6).map((t) => <li key={t.id} className="text-sm text-white/75">{t.title}</li>)}
              </ul>
            </div>
          )}
        </Panel>

        {/* Scout */}
        <Panel title="Ask Scout" icon={Binoculars} tone="bg-gradient-to-br from-[#0A84FF]/15 to-transparent">
          {(scout.thinking || scout.unread > 0) && (
            <button onClick={() => go("scout")} className="mb-3 flex w-full items-center gap-2 rounded-xl bg-[#0A84FF]/15 px-3 py-2.5 text-left text-sm font-medium">
              {scout.unread > 0 ? <><span className="h-2 w-2 rounded-full bg-[#0A84FF]" /> Scout answered. Tap to read.</>
                : <><Loader2 className="h-4 w-4 animate-spin text-white/60" /> Scout is working on your question…</>}
            </button>
          )}
          <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What did we decide about…"
              className="h-11 min-w-0 flex-1 rounded-full border border-white/10 bg-black/30 px-4 text-[16px] text-white outline-none placeholder:text-white/35 focus:border-white/30 bento:border-black/10 bento:bg-[#fff]" />
            <button aria-label="Ask" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#0A84FF] text-[#fff] active:scale-95"><ArrowRight className="h-5 w-5" /></button>
          </form>
          <div className="mt-3 flex flex-col gap-1.5">
            {SCOUT_IDEAS.slice(0, 3).map((s) => (
              <button key={s} onClick={() => ask(s)} className="rounded-xl px-3 py-2 text-left text-sm text-white/70 transition hover:bg-white/[0.06] hover:text-white">{s}</button>
            ))}
          </div>
          <p className="mt-2 px-3 text-xs text-white/40">Free. Scout runs on Bestly's own computer, so give it a minute.</p>
        </Panel>

        {/* Recent calls */}
        <Panel title="Recent calls" icon={Mic} className="lg:col-span-2" more={() => go("calls")}>
          {meetings === null ? <Skeleton /> : meetings.length === 0 ? <Muted>No calls yet.</Muted> : (
            <div className="grid gap-2 sm:grid-cols-3">
              {meetings.slice(0, 3).map((m) => (
                <button key={m.id} onClick={() => openCall(m)}
                  className="flex h-full flex-col rounded-2xl bg-white/[0.04] p-4 text-left transition hover:bg-white/[0.08] active:scale-[0.99] bento:bg-[#F3F2EE]">
                  <p className="text-sm font-semibold">{meetingDate(m)}</p>
                  <p className="mt-0.5 text-xs text-white/45">{minutes(m) ? `${minutes(m)} min` : ""}</p>
                  {m.summary?.summary && <p className="mt-2 line-clamp-4 text-sm text-white/70">{m.summary.summary}</p>}
                </button>
              ))}
            </div>
          )}
        </Panel>

        {/* Latest emails */}
        <Panel title="From Jared" icon={Mail} more={() => go("mail")}>
          {mail === null ? <Skeleton /> : mail.length === 0 ? <Muted>No emails yet. They show up here within 10 minutes of Jared sending one.</Muted> : (
            <ul className="-mx-2 space-y-0.5">
              {mail.slice(0, 4).map((m) => (
                <li key={m.id}>
                  <button onClick={() => openMail(m)} className="w-full rounded-xl px-2 py-2.5 text-left transition hover:bg-white/[0.05]">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">{m.subject || "(no subject)"}</p>
                      <span className="shrink-0 text-xs text-white/40">{day(m.sent_at)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-white/50">{m.body_text}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Pipeline */}
        {pipe && (pipe.deals.length > 0 || pipe.leads.length > 0) && (
          <Panel title="Cloud pipeline" icon={LayoutGrid} className="lg:col-span-2">
            <ul className="space-y-3">
              {pipe.deals.map((d, i) => (
                <li key={`d${i}`}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium">{d.company}</span>
                    <span className="text-white/55">{STAGE[d.stage] ?? `Stage ${d.stage}`}</span>
                  </div>
                  <div className="mt-1.5 flex gap-1" aria-hidden>
                    {[3, 4, 5, 6, 7, 8].map((s) => <span key={s} className={cn("h-1.5 flex-1 rounded-full", s <= d.stage ? "bg-emerald-400" : "bg-white/10")} />)}
                  </div>
                </li>
              ))}
              {pipe.leads.map((l, i) => (
                <li key={`l${i}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{l.company}</span>
                  <span className="rounded-full bg-white/[0.06] px-2.5 py-0.5 text-xs text-white/60">New lead{l.size ? ` · ${l.size}` : ""}</span>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {/* Files */}
        <Panel title="Latest files" icon={Paperclip} more={() => go("files")}>
          {files.length === 0 ? <Muted>Attachments Jared sends you land here.</Muted> : (
            <ul className="-mx-2 space-y-0.5">
              {files.slice(0, 4).map((a, i) => <FileRow key={i} a={a} />)}
            </ul>
          )}
        </Panel>
      </div>

      {/* Projects */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-white/45">Our projects</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {PROJECTS.map((p) => (
            <div key={p.name} className={cn(card, "relative overflow-hidden p-4")}>
              <span aria-hidden className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br", p.tone)} />
              <div className="relative">
                <p className="text-[1.05rem] font-semibold leading-tight">{p.name}</p>
                <p className="mt-0.5 text-xs text-white/55 bento:text-[#55525c]">{p.sub}{p.with ? ` \u00b7 ${p.with}` : ""}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {p.links.map((l) => (
                    <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-white/[0.09] px-3 text-sm font-medium text-white transition hover:bg-white/[0.16] active:scale-[0.98] bento:bg-[#111114] bento:text-[#fff]">
                      {l.label} <ExternalLink className="h-3.5 w-3.5 opacity-70" />
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Shortcuts */}
      <section>
        <h2 className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-white/45">Shortcuts</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile href={callUrl} art="call" label="Our call" sub="Jump into the room" tone="from-emerald-400 to-green-600 text-green-700" />
          {SHORTCUTS.map((s) => (
            <Tile key={s.id} art={s.id} label={s.label} sub={s.sub} tone={s.tone}
              href={"href" in s ? (s as { href: string }).href : undefined}
              onClick={"opens" in s ? () => openCloud((s as { opens: CloudView }).opens) : undefined}
              badge={s.id === "studio" ? studioUnread : s.id === "talk" ? talkUnread : 0} />
          ))}
          <button onClick={onConnect}
            className="group relative flex aspect-[5/4] flex-col justify-between overflow-hidden rounded-[1.4rem] bg-gradient-to-br from-orange-400 to-amber-600 p-4 text-left text-orange-700 shadow-[0_10px_30px_-14px_rgba(0,0,0,0.6)] transition hover:-translate-y-0.5 active:scale-[0.98]">
            <span aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15" />
            <span className="relative transition group-hover:scale-105">{ART.claude}</span>
            <span className="relative">
              <span className="block text-[0.975rem] font-semibold leading-tight text-[#fff]">Connect my Claude</span>
              <span className="block text-xs text-[#fff] opacity-80">Use this portal from Claude</span>
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}

function Tile({ href, onClick, art, label, sub, tone, badge = 0 }: { href?: string; onClick?: () => void; art: string; label: string; sub: string; tone: string; badge?: number }) {
  const Box = (onClick ? "button" : "a") as any;
  const props = onClick ? { type: "button", onClick } : { href, target: "_blank", rel: "noreferrer" };
  return (
    <Box {...props}
      className={cn("group relative flex aspect-[5/4] w-full flex-col justify-between overflow-hidden rounded-[1.4rem] bg-gradient-to-br p-4 text-left shadow-[0_10px_30px_-14px_rgba(0,0,0,0.6)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_36px_-14px_rgba(0,0,0,0.7)] active:scale-[0.98]", tone)}>
      <span aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15" />
      {badge > 0 && <span className="absolute right-3 top-3 min-w-[22px] rounded-full bg-red-500 px-1.5 text-center text-xs font-bold leading-[22px] text-[#fff] shadow">{badge}</span>}
      <span className="relative transition group-hover:scale-105">{ART[art]}</span>
      <span className="relative">
        <span className="block text-[0.975rem] font-semibold leading-tight text-[#fff]">{label}</span>
        <span className="block text-xs text-[#fff] opacity-80">{sub}</span>
      </span>
    </Box>
  );
}

function Panel({ title, icon: Icon, children, className, more, tone }: { title: string; icon: typeof Check; children: ReactNode; className?: string; more?: () => void; tone?: string }) {
  return (
    <section className={cn(card, "p-5", tone, className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-white/50" />{title}</h2>
        {more && <button onClick={more} className="inline-flex items-center gap-0.5 text-xs font-medium text-white/50 hover:text-white">See all <ChevronRight className="h-3.5 w-3.5" /></button>}
      </div>
      {children}
    </section>
  );
}
const Muted = ({ children }: { children: ReactNode }) => <p className="text-sm text-white/50">{children}</p>;
const Skeleton = () => <div className="h-20 animate-pulse rounded-2xl bg-white/[0.04]" />;

function FileRow({ a }: { a: Att & { mail?: MailRow } }) {
  const Icon = fileIcon(a);
  return (
    <li>
      <button onClick={() => openFile(a)}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-white/[0.05]">
        <FileThumb name={a.name} type={a.type} path={a.path} Icon={Icon} className="h-14 w-14 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{a.name}</span>
          <span className="block text-xs text-white/45">{a.skipped ? "Too large to copy here, see the email" : size(a.size)}{a.mail ? ` · ${day(a.mail.sent_at)}` : ""}</span>
        </span>
        {a.path && <Eye className="h-4 w-4 shrink-0 text-white/35" />}
      </button>
    </li>
  );
}

/** Finished to-dos: collapsed by default, tap the green check to put one back on the list. */
function DoneList({ done, tick }: { done: Todo[]; tick: (t: Todo, s: "done" | "open") => void }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const shown = all ? done : done.slice(0, 8);
  return (
    <div className="mt-3 border-t border-white/[0.06] pt-3 bento:border-black/5">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex min-h-[40px] w-full items-center gap-1.5 text-left text-sm font-medium text-white/55 hover:text-white">
        <ChevronDown className={cn("h-4 w-4 transition-transform", !open && "-rotate-90")} />
        Done ({done.length})
      </button>
      {open && (
        <ul className="divide-y divide-white/[0.05]">
          {shown.map((t) => (
            <li key={t.id} className="flex items-start gap-3 py-2.5">
              <button aria-label="Not done, put it back" title="Put it back on my list" onClick={() => tick(t, "open")}
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-500 text-[#fff] transition hover:bg-white/20 active:scale-90">
                <Check className="h-3.5 w-3.5" />
              </button>
              <div className="min-w-0">
                <p className="text-[0.95rem] text-white/50 line-through decoration-white/30">{t.title}</p>
                <p className="mt-0.5 text-xs text-white/35">
                  {t.done_at ? `Done ${new Date(t.done_at).toLocaleDateString("en-US", { month: "short", day: "numeric", ...PT })}` : "Done"}
                  {t.action?.meeting ? ` · ${String(t.action.meeting)}` : ""}
                </p>
              </div>
            </li>
          ))}
          {done.length > shown.length && (
            <li className="pt-2"><button onClick={() => setAll(true)} className="text-sm font-medium text-[#0A84FF]">Show all {done.length}</button></li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Face ID / fingerprint for next time. Shown until this account has one. */
function PasskeyRow({ userId }: { userId: string }) {
  const [has, setHas] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { passkeyCount(userId).then(setHas).catch(() => setHas(0)); }, [userId]);
  if (!passkeysSupported() || has === null) return null;
  const add = async () => {
    setBusy(true);
    const problem = await addPasskey();
    setBusy(false);
    if (!problem) { setHas((n) => (n ?? 0) + 1); toast.success("Face ID is set up. Next time, no password."); }
    else if (problem !== "cancelled") toast.error(problem);
  };
  if (has > 0) {
    return <p className="flex h-10 items-center gap-2 px-3 text-sm text-white/40"><Fingerprint className="h-4 w-4" /> Face ID is on</p>;
  }
  return (
    <button onClick={add} disabled={busy}
      className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-sm font-medium text-white/80 hover:bg-white/[0.05] hover:text-white disabled:opacity-50">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />} Set up Face ID
    </button>
  );
}

/* ───────── Calls ───────── */


/**
 * Search that behaves the way people expect: type any words, in any order, in any case, with or
 * without accents and punctuation ("O'Brien" finds obrien, "sep 17" finds Sep 17). Every word has
 * to appear somewhere in the thing, not all in one field.
 */
const norm = (v: unknown) => String(v ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function hit(q: string, ...fields: unknown[]) {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = " " + fields.map(norm).join(" ") + " ";
  return words.every((w) => hay.includes(w));
}
/** Everything worth searching about a call: when it was, who was on it, and what came out of it. */
/** "Tue, Sep 29 at 11:00 AM" - whenLabel is for things happening imminently. */
const longWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", ...PT });

const callText = (m: Meeting) => [meetingDate(m), new Date(m.started_at ?? 0).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", ...PT }),
  (m.people ?? []).join(" "), m.name, m.summary ? JSON.stringify(m.summary) : ""].join(" ");

function CallsTab({ meetings, open, upcoming = [] }: { meetings: Meeting[] | null; open: (m: Meeting) => void; upcoming?: NextEvent[] }) {
  const [q, setQ] = useState("");
  const shown = (meetings ?? []).filter((m) => hit(q, callText(m)));
  // Anything booked on Jared's calendar that you are on, so a call is here before it happens.
  const booked = upcoming.filter((e) => hit(q, e.title, e.start));
  return (
    <div>
      <TabHead title="Calls" sub="What's booked, and every call you were on." q={q} setQ={setQ} placeholder="Search calls" />

      {!!booked.length && (
        <div className="mb-7">
          <h3 className="mb-3 px-1 text-xs font-semibold uppercase tracking-widest text-white/45">Coming up</h3>
          <ul className="space-y-2">
            {booked.map((e, i) => (
              <li key={i} className={cn(card, "flex flex-wrap items-center justify-between gap-3 px-4 py-3")}>
                <div className="min-w-0">
                  <p className="truncate font-medium">{e.title}</p>
                  <p className="mt-0.5 text-xs text-white/50">{longWhen(e.start)}</p>
                </div>
                {e.join_url && (
                  <a href={e.join_url} target="_blank" rel="noreferrer"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 text-sm font-semibold text-[#fff] transition hover:bg-emerald-400">
                    <Video className="h-4 w-4" /> Join
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {meetings === null ? <Skeleton /> : shown.length === 0 ? <Muted>{meetings.length ? "No calls match." : "No calls yet."}</Muted> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((m) => (
            <button key={m.id} onClick={() => open(m)} className={cn(card, "flex flex-col p-5 text-left transition hover:bg-white/[0.06] active:scale-[0.99]")}>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#0A84FF]/15 text-[#5AB0FF]"><Mic className="h-5 w-5" /></span>
              <p className="mt-3 font-semibold">{meetingDate(m)}</p>
              <p className="mt-0.5 text-xs text-white/45">{["Jared", ...m.people.map(cap)].join(", ")}{minutes(m) ? ` · ${minutes(m)} min` : ""}</p>
              {m.summary?.summary && <p className="mt-2 line-clamp-3 text-sm text-white/70">{m.summary.summary}</p>}
              {!!m.summary?.decisions?.length && <p className="mt-3 text-xs font-medium text-emerald-300 bento:text-emerald-700">{m.summary.decisions.length} decided</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TabHead({ title, sub, q, setQ, placeholder }: { title: string; sub: string; q: string; setQ: (v: string) => void; placeholder: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[1.75rem] font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-sm text-white/55">{sub}</p>
      </div>
      <label className="relative sm:w-72">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          className="h-11 w-full rounded-full border border-white/10 bg-white/[0.04] pl-10 pr-4 text-[16px] text-white outline-none placeholder:text-white/35 focus:border-white/30 bento:border-black/5 bento:bg-[#fff]" />
      </label>
    </div>
  );
}

export function CallView({ m, onBack, onAsk }: { m: Meeting; onBack: () => void; onAsk?: (q: string) => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("meeting_recordings" as never).select("transcript").eq("id", m.id).maybeSingle()
      .then(({ data }) => setText(String((data as any)?.transcript ?? "")));
    window.scrollTo(0, 0);
  }, [m.id]);
  const s = m.summary;
  return (
    <div className="mx-auto max-w-3xl">
      <button onClick={onBack} className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-[0.95rem] text-[#0A84FF]">
        <ArrowLeft className="h-5 w-5" /> Calls
      </button>
      <h1 className="mt-1 text-[1.6rem] font-bold leading-tight tracking-tight">{meetingDate(m)}</h1>
      <p className="mt-1 text-sm text-white/55">{["Jared", ...m.people.map(cap)].join(", ")}{minutes(m) ? ` · ${minutes(m)} min` : ""}</p>
      {onAsk && <AskAbout onClick={() => onAsk(`About our call on ${meetingDate(m)}: `)} label="Ask Scout about this call" />}
      {s?.summary && (
        <div className={cn(card, "mt-5 space-y-4 p-5")}>
          <p className="text-[0.975rem] leading-relaxed text-white/85">{s.summary}</p>
          {!!s.decisions?.length && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-300/80 bento:text-emerald-700">Decided</p>
              <ul className="mt-1.5 space-y-1.5 text-[0.95rem] text-white/80">{s.decisions.map((d, i) => <li key={i} className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-emerald-400" />{d}</li>)}</ul>
            </div>
          )}
          {!!s.questions?.length && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-300/80 bento:text-amber-700">Still open</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[0.95rem] text-white/80">{s.questions.map((d, i) => <li key={i}>{d}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      <div className="sticky top-14 z-10 mt-6 flex items-center justify-between bg-inherit py-2 lg:top-0">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-widest text-white/50">Transcript</h2>
        <CopyTranscriptButton text={text ?? ""} />
      </div>
      {text === null ? <div className={cn(card, "h-40 animate-pulse")} /> : <TranscriptBubbles text={text} />}
    </div>
  );
}

function AskAbout({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/[0.07] px-3.5 text-sm font-medium text-white/85 transition hover:bg-white/[0.12] bento:bg-[#F3F2EE]">
      <Binoculars className="h-4 w-4" /> {label}
    </button>
  );
}

/* ───────── Mail ───────── */

function MailTab({ mail, open, setOpen, onAsk }: { mail: MailRow[] | null; open: MailRow | null; setOpen: (m: MailRow | null) => void; onAsk: (q: string) => void }) {
  const [q, setQ] = useState("");
  const shown = (mail ?? []).filter((m) => hit(q, m.subject, m.body_text, m.attachments.map((a) => a.name).join(" "),
    m.links.map((l) => `${l.kind} ${l.url}`).join(" "), m.to_addrs.join(" "), m.cc_addrs.join(" "),
    m.sent_at ? new Date(m.sent_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", ...PT }) : ""));
  useEffect(() => { if (!open && shown.length && window.matchMedia("(min-width: 1024px)").matches) setOpen(shown[0]); }, [open, shown, setOpen]);

  const list = (
    <div className={cn(card, "overflow-hidden")}>
      {mail === null ? <div className="p-5"><Skeleton /></div> : shown.length === 0 ? (
        <div className="flex flex-col items-center p-10 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-sky-400 to-blue-600 text-blue-600">{ART.mail}</span>
          <p className="mt-4 font-semibold">{mail.length ? "No emails match." : "No emails yet"}</p>
          <p className="mt-1 text-sm text-white/50">Emails Jared sends you show up here within 10 minutes.</p>
        </div>
      ) : (
        <ul className="max-h-[calc(100dvh-14rem)] divide-y divide-white/[0.06] overflow-y-auto">
          {shown.map((m) => (
            <li key={m.id}>
              <button onClick={() => setOpen(m)} className={cn("w-full px-4 py-3.5 text-left transition hover:bg-white/[0.04]", open?.id === m.id && "bg-white/[0.07] bento:bg-[#F3F2EE]")}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-[0.95rem] font-semibold">{m.subject || "(no subject)"}</p>
                  <span className="shrink-0 text-xs text-white/40">{day(m.sent_at)}</span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-white/55">{m.body_text}</p>
                {(m.attachments.length > 0 || m.links.length > 0) && (
                  <p className="mt-1.5 flex items-center gap-3 text-xs text-white/45">
                    {m.attachments.length > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" />{m.attachments.length}</span>}
                    {m.links.length > 0 && <span className="inline-flex items-center gap-1"><Link2 className="h-3.5 w-3.5" />{m.links.length}</span>}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div>
      <div className={cn(open && "hidden lg:block")}>
        <TabHead title="Mail" sub="Every email Jared sent you, newest first." q={q} setQ={setQ} placeholder="Search emails" />
      </div>
      <div className="lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:gap-5">
        <div className={cn(open && "hidden lg:block")}>{list}</div>
        {open ? <MailView m={open} onBack={() => setOpen(null)} onAsk={onAsk} /> : <div className="hidden lg:block" />}
      </div>
    </div>
  );
}

function MailView({ m, onBack, onAsk }: { m: MailRow; onBack: () => void; onAsk: (q: string) => void }) {
  useEffect(() => { if (!window.matchMedia("(min-width: 1024px)").matches) window.scrollTo(0, 0); }, [m.id]);
  return (
    <article className={cn(card, "p-5 sm:p-7 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto")}>
      <button onClick={onBack} className="-ml-2 mb-2 inline-flex min-h-[44px] items-center gap-1 rounded-full px-2 text-[0.95rem] text-[#0A84FF] lg:hidden">
        <ArrowLeft className="h-5 w-5" /> Mail
      </button>
      <div className="flex items-start justify-between gap-3">
        <h1 className="text-[1.35rem] font-bold leading-snug tracking-tight">{m.subject || "(no subject)"}</h1>
        <CopyButton text={`${m.subject ?? ""}\n\n${m.body_text ?? ""}`} />
      </div>
      <p className="mt-1 text-sm text-white/50">
        From Jared · {m.sent_at ? new Date(m.sent_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", ...PT }) : ""}
        {m.cc_addrs.length ? ` · cc ${m.cc_addrs.join(", ")}` : ""}
      </p>
      <AskAbout onClick={() => onAsk(`About Jared's email "${m.subject || "(no subject)"}" (${day(m.sent_at)}): `)} label="Ask Scout about this email" />
      {m.attachments.length > 0 && (
        <ul className="mt-4 grid gap-1 sm:grid-cols-2">{m.attachments.map((a, i) => <FileRow key={i} a={a} />)}</ul>
      )}
      {m.links.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {m.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full bg-[#0A84FF]/12 px-3 py-1.5 text-sm font-medium text-[#5AB0FF] hover:bg-[#0A84FF]/20 bento:text-[#0A6FD8]">
              <ExternalLink className="h-3.5 w-3.5" /> {l.kind}
            </a>
          ))}
        </div>
      )}
      <div className="mt-5 whitespace-pre-wrap break-words text-[0.975rem] leading-relaxed text-white/85"><Linked text={m.body_text ?? ""} /></div>
    </article>
  );
}

/* ───────── Files ───────── */

function FilesTab({ files, docs, openMail }: { files: (Att & { mail: MailRow })[]; docs: (DocLink & { mail: MailRow })[]; openMail: (m: MailRow) => void }) {
  const [q, setQ] = useState("");
  const f = files.filter((a) => hit(q, a.name, a.type, a.mail.subject, a.mail.body_text,
    a.mail.sent_at ? new Date(a.mail.sent_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", ...PT }) : ""));
  const d = docs.filter((l) => hit(q, l.kind, l.url, l.mail.subject, l.mail.body_text));
  return (
    <div>
      <TabHead title="Files" sub="Everything Jared has sent you: attachments and linked docs." q={q} setQ={setQ} placeholder="Search files" />
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-widest text-white/45">Attachments</h2>
      {f.length === 0 ? <p className={cn(card, "p-5 text-sm text-white/50")}>{files.length ? "No files match." : "No attachments yet."}</p> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {f.map((a, i) => {
            const Icon = fileIcon(a);
            return (
              <div key={i} className={cn(card, "flex flex-col p-4")}>
                <button onClick={() => openFile(a)} className="flex flex-col gap-3 text-left">
                  <FileThumb name={a.name} type={a.type} path={a.path} Icon={Icon} className="aspect-[4/3] w-full rounded-xl" />
                  <span className="min-w-0">
                    <span className="line-clamp-2 break-words text-[0.95rem] font-medium">{a.name}</span>
                    <span className="mt-0.5 block text-xs text-white/45">{a.skipped ? "Too large to copy here" : size(a.size)}</span>
                  </span>
                </button>
                <button onClick={() => openMail(a.mail)} className="mt-3 truncate text-left text-xs text-white/45 hover:text-white">
                  From “{a.mail.subject || "(no subject)"}” · {day(a.mail.sent_at)}
                </button>
              </div>
            );
          })}
        </div>
      )}
      <h2 className="mb-2 mt-8 px-1 text-xs font-semibold uppercase tracking-widest text-white/45">Linked docs</h2>
      {d.length === 0 ? <p className={cn(card, "p-5 text-sm text-white/50")}>{docs.length ? "No docs match." : "No doc links yet."}</p> : (
        <ul className={cn(card, "divide-y divide-white/[0.06] overflow-hidden")}>
          {d.map((l) => (
            <li key={l.url} className="flex items-center gap-3 px-4 py-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0A84FF]/12 text-[#5AB0FF]"><Link2 className="h-4 w-4" /></span>
              <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{l.kind}</span>
                <span className="block truncate text-xs text-white/45">{l.url.replace(/^https?:\/\//, "")}</span>
              </a>
              <button onClick={() => openMail(l.mail)} className="hidden shrink-0 text-xs text-white/40 hover:text-white sm:block">{day(l.mail.sent_at)}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
