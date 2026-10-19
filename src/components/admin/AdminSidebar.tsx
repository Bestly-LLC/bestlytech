import { BadgeDollarSign, Brush, FileWarning, Scissors,
  LayoutDashboard,
  Settings,
  BarChart3,
  Snowflake,
  Users,
  Mail,
  ListChecks,
  Server,
  Shield,
  Car,
  Mic,
  Handshake,
  House, Boxes, KeyRound, BookMarked, ShoppingBag, ExternalLink, ShieldCheck, ShieldAlert, Siren, Flower2, PhoneCall, Headset, Crosshair, Gauge, ConciergeBell,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { AdminMark } from "@/components/AdminMark";
import { BookOpen, ChefHat, GripVertical, Network, Plane, Plus, Projector } from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { openHokuAdmin, HOKU_ADMIN_URL } from "@/lib/openHokuAdmin";
import { AvaOrbIcon } from "@/components/admin/roofguard/AvaOrb";

type CountKeys =
  | "maya"
  | "leads"
  | "contacts"
  | "cySubscribers";

export const dashboardItem = { title: "Command Center", url: "/admin", icon: LayoutDashboard };

// Work: Pipeline is leads from found to called, with the CRM as its Inbound tab; inbound messages, waitlist, meetings and settings sit beside it.
const workItems = [
  { title: "Pipeline", url: "/admin/pipeline", icon: Users, countKey: "leads" as CountKeys },
  { title: "Contacts", url: "/admin/contacts", icon: Mail, countKey: "contacts" as CountKeys },
  { title: "Waitlist", url: "/admin/waitlist", icon: ListChecks },
  { title: "Meetings", url: "/admin/meetings", icon: Mic },
  { title: "Partners", url: "/admin/partners", icon: Handshake },
  { title: "Team", url: "/admin/team", icon: Network },
  { title: "Settings", url: "/admin/settings", icon: Settings },
];

// Three tabbed sections (tabs in ?tab=): Command Center = Overview/Auto-Fix/Domains,
// Subscribers = Subscribers/Granted Access, Analytics = Product/Operations/Community Learning.
const cookieYetiItems = [
  { title: "Command Center", url: "/admin/cookie-yeti", icon: Snowflake },
  { title: "Subscribers", url: "/admin/cookie-yeti/subscribers", icon: Users, countKey: "cySubscribers" as CountKeys },
  { title: "Analytics", url: "/admin/cookie-yeti/analytics", icon: BarChart3 },
];

const homeHubItems = [
  { title: "Emergency", url: "/admin/emergency", icon: Siren },
  { title: "Overview", url: "/admin/home-hub", icon: Server },
  { title: "Kitchen", url: "/admin/home-hub/kitchen", icon: ChefHat },
  { title: "Pi-hole", url: "/admin/home-hub/pihole", icon: Shield },
  { title: "Home Assistant", url: "/admin/home-hub/home-assistant", icon: House },
  { title: "Homebridge", url: "/admin/home-hub/homebridge", icon: Boxes },
  { title: "Access backup", url: "/admin/home-hub/access", icon: KeyRound },
  { title: "Wall", url: "/admin/wall", icon: Projector },
  { title: "Sky", url: "/admin/sky", icon: Plane },
];

const turoItems = [
  { title: "Turo Watch", url: "/admin/turo", icon: Car },
  { title: "Claims", url: "/admin/claims", icon: FileWarning },
  { title: "Street Sweeping", url: "/admin/street-sweeping", icon: Brush },
];

// Backup of the account's Claude skills. The copies a session sees on disk are a
// read-only cache; this is the copy we own.
const opsItems = [
  { title: "Security", url: "/admin/security", icon: ShieldCheck },
  { title: "Spam Desk", url: "/admin/spam", icon: ShieldAlert },
  { title: "Scout AI", url: "/admin/scout-ai", icon: KeyRound },
  { title: "Email templates", url: "/admin/templates", icon: Mail },
  { title: "Claude Skills", url: "/admin/skills", icon: BookMarked },
  { title: "Scout's playbook", url: "/admin/playbook", icon: BookOpen },
];


// Vesta (women-only support app with Eli and Rohit): health + every link.
const vestaItems = [
  { title: "Vesta", url: "/admin/vesta", icon: Flower2 },
];

// Agents (Jared, Oct 10 2026): the three phone agents in one group, each labeled with who she works for.
//   Ava   (Personal)  — Jared's personal assistant, her own line, messages, calls.
//   Maya  (Bestly)    — Bestly Sales & Service: support for every product, privacy requests, Bestly Agent demos.
//                       The badge is open tickets plus open leads waiting on Jared.
//   Reese (RoofGuard) — the RoofGuard caller: leads, phone finder. Its page stays separable so it can be split off.
const agentItems = [
  { title: "Ava (Personal)", url: "/admin/ava", icon: AvaOrbIcon },
  { title: "Maya (Bestly)", url: "/admin/maya", icon: Headset, countKey: "maya" as CountKeys },
  { title: "Reese (RoofGuard)", url: "/admin/roofguard", icon: PhoneCall },
  // SkyTouch Front Desk: the massage practice's text inbox, moved off Claude onto the Pi (paused until switched on there).
  { title: "SkyTouch (Front Desk)", url: "/admin/skytouch", icon: ConciergeBell },
];

// Money coming in to Jared personally (Oct 10 2026): Nickel's class action settlements. Its own section near the top
// so it isn't buried under Turo.
const moneyItems = [
  { title: "Settlements", url: "/admin/settlements", icon: BadgeDollarSign },
  { title: "Cost Cutter", url: "/admin/cost-cutter", icon: Scissors },
];

// Signs you straight into the HOKU store admin (see lib/openHokuAdmin).
const hokuItems = [
  { title: "HOKU admin", url: HOKU_ADMIN_URL, icon: ShoppingBag, sso: true },
];
const flatNav = (items: Array<{ url: string; nested?: any[] }>): string[] => items.flatMap((i) => [i.url, ...flatNav(i.nested ?? [])]);
const ALL_NAV_URLS = flatNav([...workItems, ...agentItems, ...moneyItems, ...vestaItems, ...cookieYetiItems, ...homeHubItems, ...turoItems, ...opsItems, ...hokuItems]);


// A saved order that still lists the old "Ava" / "Maya" / "RoofGuard" sections just drops them; "Agents" is new to it,
// so orderedSections() slots it right after Work.
export const ADMIN_NAV_SECTIONS = [
  { label: "Work", items: workItems },
  { label: "Agents", items: agentItems },
  { label: "Money", items: moneyItems },
  { label: "HOKU", items: hokuItems },
  { label: "Vesta", items: vestaItems },
  { label: "Cookie Yeti", items: cookieYetiItems },
  { label: "Home Hub", items: homeHubItems },
  { label: "Turo", items: turoItems },
  { label: "Ops", items: opsItems },
];

const COUNT_MIN_INTERVAL_MS = 15_000;
const COUNT_POLL_MS = 60_000;

/* Sync health (2026-10-13): a refused read/write used to be swallowed, so each browser quietly kept its own order and it
   looked like sync "got reverted". Now a refusal goes to Scout (admin.nav.sync, System Monitor) once per page load, and the
   next good round trip clears it. admin_nav_sync_watch (hourly) re-grants the table if its permission ever goes missing. */
let navSyncState: "ok" | "bad" | null = null;
function reportNavSync(error: { message?: string } | null | undefined) {
  const next = error ? "bad" : "ok";
  if (navSyncState === next) return;
  navSyncState = next;
  void (supabase.rpc as unknown as (fn: string, a: object) => Promise<unknown>)("admin_report", error
    ? { p_where: "nav.sync", p_detail: `The sidebar couldn't save or load its order from admin_nav_prefs (${error.message ?? "refused"}), so this browser is using its own order.` }
    : { p_where: "nav.sync", p_detail: "Sidebar order syncs between browsers again.", p_ok: true }).then(() => {}, () => {});
}

/* Section order: dragged by the grip next to each section label. Saved to Supabase (admin_nav_prefs) so every browser
   and device shows the same order; localStorage is only a fast first paint. */
const ORDER_KEY = "bestly-admin-nav-order";
function readOrder(): string[] {
  try { const v = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function orderedSections(order: string[]) {
  const byLabel = new Map(ADMIN_NAV_SECTIONS.map((s) => [s.label, s]));
  const out = order.filter((l, i) => byLabel.has(l) && order.indexOf(l) === i);
  // A section the saved order has never seen (a new one) lands right after the section that precedes it in the default
  // list, so Agents shows up under Work instead of at the very bottom.
  ADMIN_NAV_SECTIONS.forEach((s, i) => {
    if (out.includes(s.label)) return;
    const prev = ADMIN_NAV_SECTIONS.slice(0, i).reverse().find((p) => out.includes(p.label));
    out.splice(prev ? out.indexOf(prev.label) + 1 : out.length, 0, s.label);
  });
  return out.map((l) => byLabel.get(l)!);
}

/* Attention dots: anything waiting (admin_today) or unread in the bell points at a page. */
type Level = "red" | "amber" | "blue";
const LEVEL_RANK: Record<Level, number> = { red: 3, amber: 2, blue: 1 };
function pathOf(url: string | null | undefined) {
  if (!url || !url.startsWith("/admin")) return null;
  return url.split(/[?#]/)[0].replace(/\/$/, "") || "/admin";
}

type AgentNav = { slug: string; name: string; purpose: string; kind: "legacy" | "template"; page_url: string | null; status: string; orb_hue: number; unread: number };
type NavItem = { title: string; url: string; icon: any; countKey?: CountKeys; sso?: boolean; orbHue?: number; badge?: number; nested?: NavItem[] };

/** Sidebar items for the Agents group: "<name> (<purpose>)". Legacy agents keep their own icons; template agents get an orb tinted with their hue. */
function agentNavItems(rows: AgentNav[] | null): NavItem[] {
  if (!rows || rows.length === 0) return agentItems;
  return rows.map((a) => {
    const title = `${a.name} (${a.purpose})`;
    const url = a.page_url || `/admin/agents/${a.slug}`;
    if (a.kind === "legacy") return { title, url, icon: a.slug === "ava" ? AvaOrbIcon : PhoneCall };
    return { title, url, icon: AvaOrbIcon, orbHue: a.orb_hue, countKey: a.slug === "maya" ? ("maya" as CountKeys) : undefined, badge: a.slug === "maya" ? undefined : a.unread };
  });
}

export function AdminSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { bento } = useAdminTheme();
  // The mobile sheet always shows full labels, whatever the saved desktop collapsed state is.
  const collapsed = state === "collapsed" && !isMobile;
  const location = useLocation();
  const currentPath = location.pathname;
  // A key is missing until its count loads. A failed count keeps its last value instead of reading 0.
  const [counts, setCounts] = useState<Partial<Record<CountKeys, number>>>({});
  const [attention, setAttention] = useState<Record<string, { level: Level; n: number; why: string }>>({});
  // The Agents group comes from the agent registry (voice_agents); until it loads, or if it fails, the three static items show.
  const [agents, setAgents] = useState<AgentNav[] | null>(null);
  const [order, setOrder] = useState<string[]>(() => (typeof window === "undefined" ? [] : readOrder()));
  const sections = orderedSections(order);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const draggingRef = useRef(false);
  const orderRef = useRef<string[]>(order);
  const userIdRef = useRef<string | null>(null);
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastFetchRef = useRef(0);
  const inFlightRef = useRef(false);

  const loadCounts = useCallback(async (force = false) => {
    const now = Date.now();
    if (inFlightRef.current) return;
    if (!force && now - lastFetchRef.current < COUNT_MIN_INTERVAL_MS) return;
    inFlightRef.current = true;
    lastFetchRef.current = now;
    try {
      const head = { count: "exact" as const, head: true };
      const results = await Promise.all([
        // New leads across every funnel (cloud, marketplace intake, hire requests).
        supabase.from("v_crm_leads" as any).select("lead_key", head).eq("stage", "new"),
        supabase.from("contact_submissions").select("id", head).eq("status", "new"),
        supabase.from("subscriptions").select("id", head).eq("status", "active"),
      ]);
      const [{ data: queue }, { data: bell }] = await Promise.all([
        supabase.rpc("admin_today" as never),
        supabase.from("admin_notifications" as never).select("url, severity, title").is("read_at", null).limit(300),
      ]);
      const att: Record<string, { level: Level; n: number; why: string }> = {};
      const bump = (url: string | null | undefined, level: Level, why: string) => {
        const p = pathOf(url);
        if (!p) return;
        const cur = att[p];
        att[p] = { level: cur && LEVEL_RANK[cur.level] >= LEVEL_RANK[level] ? cur.level : level, n: (cur?.n ?? 0) + 1, why: cur?.why ?? why };
      };
      for (const q of ((queue ?? []) as unknown as { url: string; severity: string; rank: number; title: string }[])) {
        bump(q.url, q.rank <= 1 || q.severity === "blocked" ? "red" : q.severity === "warning" ? "amber" : "blue", q.title);
      }
      for (const b of ((bell ?? []) as unknown as { url: string | null; severity: string; title: string }[])) {
        if (b.severity === "warning" || b.severity === "critical" || b.severity === "error") bump(b.url, b.severity === "warning" ? "amber" : "red", b.title);
      }
      // Maya: open tickets plus open leads (she is the phone line; these are the people waiting on a follow-up).
      const { data: mayaC } = await supabase.rpc("admin_maya_counts" as never);
      const mc = mayaC as unknown as { open?: number; leads?: number } | null;
      const mayaN = mc && typeof mc.open === "number" ? mc.open + (mc.leads ?? 0) : null;
      // Agents group: every phone agent in the registry, legacy and template (Ava, Maya, Reese, and any added from the + button).
      const { data: agentRows } = await supabase.rpc("admin_agents" as never);
      if (Array.isArray(agentRows)) setAgents(agentRows as unknown as AgentNav[]);
      // Team: any bot gone quiet puts a red dot on the Team page.
      const { data: teamRed } = await supabase.rpc("admin_team_red_count" as never);
      if (typeof teamRed === "number" && teamRed > 0) {
        att["/admin/team"] = { level: "red", n: teamRed, why: `${teamRed} bot${teamRed === 1 ? " has" : "s have"} gone quiet` };
      }
      setAttention(att);
      const keys: CountKeys[] = ["leads", "contacts", "cySubscribers"];
      setCounts((prev) => {
        const next = { ...prev };
        if (mayaN !== null) next.maya = mayaN;
        results.forEach((r, i) => {
          if (!r.error && typeof r.count === "number") next[keys[i]] = r.count;
        });
        return next;
      });
    } catch {
      // Network failure: keep the last counts.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // Route changes (throttled), a steady poll, and coming back to the tab.
  useEffect(() => {
    loadCounts();
  }, [currentPath, loadCounts]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) loadCounts(true);
    }, COUNT_POLL_MS);
    const onFocus = () => loadCounts();
    // "+ New agent" finished: show it in the Agents group now instead of at the next poll.
    const onAgents = () => { void supabase.rpc("admin_agents" as never).then(({ data }) => { if (Array.isArray(data)) setAgents(data as unknown as AgentNav[]); }); };
    window.addEventListener("focus", onFocus);
    window.addEventListener("bestly:agents-changed", onAgents);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("bestly:agents-changed", onAgents);
    };
  }, [loadCounts]);

  // Keep the section order in sync across browsers: load it from Supabase, take live changes from other browsers,
  // and re-check when this tab comes back into focus (realtime can drop on sleeping laptops and phones).
  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  useEffect(() => {
    let alive = true;
    const applyRemote = (remote: unknown) => {
      if (!alive || !Array.isArray(remote)) return;
      if (draggingRef.current || pushTimerRef.current) return; // a local change is in flight: ours wins
      const next = remote.filter((x): x is string => typeof x === "string");
      if (JSON.stringify(next) === JSON.stringify(orderRef.current)) return;
      setOrder(next);
      try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    };
    const pull = async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        const uid = u?.user?.id;
        if (!uid || !alive) return;
        userIdRef.current = uid;
        const { data, error } = await supabase.from("admin_nav_prefs" as never).select("section_order").eq("user_id", uid).maybeSingle();
        reportNavSync(error);
        if (error || !alive) return;
        const row = data as { section_order?: unknown } | null;
        if (row) applyRemote(row.section_order);
        else {
          // First run: carry this browser's existing order up so it becomes everyone's.
          const local = readOrder();
          if (local.length) reportNavSync((await supabase.from("admin_nav_prefs" as never).upsert({ user_id: uid, section_order: local } as never)).error);
        }
      } catch { /* offline: keep what we have */ }
    };
    pull();
    const channel = supabase
      .channel("admin-nav-prefs")
      .on("postgres_changes", { event: "*", schema: "public", table: "admin_nav_prefs" }, (payload) => {
        applyRemote((payload.new as { section_order?: unknown } | null)?.section_order);
      })
      .subscribe();
    const onFocus = () => pull();
    const onVisible = () => { if (!document.hidden) pull(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, []);

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const isActive = (path: string) => {
    if (path === "/admin") return currentPath === "/admin";
    if (path === "/admin/cookie-yeti") return currentPath === "/admin/cookie-yeti";
    if (path === "/admin/home-hub") return currentPath === "/admin/home-hub";
    // Lead detail pages (a cloud deal, a marketplace submission) belong to Pipeline (its Inbound tab).
    if (path === "/admin/pipeline") return ["/admin/pipeline", "/admin/cloud", "/admin/submissions", "/admin/hires"].some((p) => currentPath.startsWith(p));
    // A deeper nav item wins: on /admin/turo/lax-pass only "Guest Trips" lights up, not "Turo Watch".
    const under = (p: string) => currentPath === p || currentPath.startsWith(p + "/");
    if (!under(path)) return false;
    return !ALL_NAV_URLS.some((u) => u.length > path.length && u.startsWith(path + "/") && under(u));
  };

  const [hokuBusy, setHokuBusy] = useState(false);
  // Open the tab synchronously (inside the click) so no popup blocker stops it,
  // then point it at the signed link once it arrives. If minting fails, the tab
  // still lands on the HOKU admin, where the passkey login works as before.
  const onHokuClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (hokuBusy) return;
    setHokuBusy(true);
    closeMobile();
    try { await openHokuAdmin(); } finally { setHokuBusy(false); }
  };

  const saveOrder = (next: string[]) => {
    setOrder(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    // Save to Supabase shortly after the last move (a drag swaps many times; one write when it settles).
    clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(async () => {
      pushTimerRef.current = undefined;
      try {
        const uid = userIdRef.current ?? (await supabase.auth.getUser()).data.user?.id;
        if (!uid) return;
        userIdRef.current = uid;
        reportNavSync((await supabase.from("admin_nav_prefs" as never).upsert({ user_id: uid, section_order: next, updated_at: new Date().toISOString() } as never)).error); } catch { /* retried on the next move */ }
    }, 500);
  };
  const move = (label: string, delta: number) => {
    const labels = sections.map((s) => s.label);
    const i = labels.indexOf(label), j = i + delta;
    if (i < 0 || j < 0 || j >= labels.length) return;
    [labels[i], labels[j]] = [labels[j], labels[i]];
    saveOrder(labels);
  };
  // Pointer drag (mouse, pen and touch): the section follows the pointer past its neighbours' midpoints.
  const startDrag = (label: string) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(label);
    draggingRef.current = true;
    const onMove = (ev: PointerEvent) => {
      const labels = orderedSections(readOrderFrom()).map((s) => s.label);
      const from = labels.indexOf(label);
      let to = from;
      labels.forEach((l, idx) => {
        const r = sectionRefs.current[l]?.getBoundingClientRect();
        if (!r || l === label) return;
        const mid = r.top + r.height / 2;
        if (idx < from && ev.clientY < mid) to = Math.min(to, idx);
        if (idx > from && ev.clientY > mid) to = Math.max(to, idx);
      });
      if (to !== from) {
        labels.splice(to, 0, labels.splice(from, 1)[0]);
        saveOrder(labels);
        latest = labels;
      }
    };
    let latest: string[] | null = null;
    const readOrderFrom = () => latest ?? readOrder();
    const onUp = () => {
      draggingRef.current = false;
      setDragging(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const renderOne = (item: NavItem, depth = 0) => {
    if (item.sso) {
      return (
        <SidebarMenuItem key={item.title}>
          <SidebarMenuButton asChild tooltip={item.title}>
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onHokuClick}
              aria-busy={hokuBusy}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all relative bento:rounded-full bento:py-2.5 text-white/55 hover:text-white hover:bg-white/[0.05] bento:text-white/70"
            >
              <item.icon className="h-[1.125rem] w-[1.125rem] shrink-0" />
              {!collapsed && (
                <span className="flex-1 flex items-center justify-between">
                  {hokuBusy ? "Opening\u2026" : item.title}
                  <ExternalLink className="h-3.5 w-3.5 text-white/35" aria-hidden />
                </span>
              )}
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      );
    }
    const active = isActive(item.url);
    const count = item.countKey ? counts[item.countKey] ?? 0 : item.badge ?? 0;
    // A page gets a dot when something waiting points at it (the home page only for its own items).
    const hits = Object.entries(attention).filter(([p]) => (item.url === "/admin" ? p === "/admin" : p === item.url || p.startsWith(item.url + "/")));
    const dot = hits.length
      ? { level: hits.reduce<Level>((l, [, v]) => (LEVEL_RANK[v.level] > LEVEL_RANK[l] ? v.level : l), "blue"), n: hits.reduce((n, [, v]) => n + v.n, 0), why: hits[0][1].why }
      : null;
    const dotClass = dot ? (dot.level === "red" ? "bg-red-500" : dot.level === "amber" ? "bg-amber-400" : "bg-sky-400") : "";
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
          <Link
            to={item.url}
            onClick={closeMobile}
            aria-label={count > 0 ? `${item.title} (${count})` : item.title}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all relative",
              "bento:rounded-full bento:py-2.5",
              depth > 0 && !collapsed && "min-h-[2.25rem] py-1.5 text-[0.8125rem]",
              active
                ? "bg-[hsl(var(--wow-indigo)/0.12)] text-white font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[0.1875rem] before:rounded-full before:bg-[hsl(var(--wow-indigo-light))] before:shadow-[0_0_8px_hsl(var(--wow-indigo-light)/0.6)] bento:bg-[#111114] bento:text-[#fff] bento:before:hidden bento:hover:bg-[#111114] bento:hover:text-[#fff]"
                : "text-white/55 hover:text-white hover:bg-white/[0.05] bento:text-white/70"
            )}
          >
            <span className="relative shrink-0">
              {item.orbHue != null ? <AvaOrbIcon hue={item.orbHue} className="h-[1.125rem] w-[1.125rem]" /> : <item.icon className="h-[1.125rem] w-[1.125rem]" />}
              {dot && collapsed && <span className={cn("absolute -right-1 -top-1 h-2 w-2 rounded-full ring-2 ring-[#0a0a0a] bento:ring-[#fff]", dotClass)} aria-hidden />}
            </span>
            {!collapsed && (
              <span className="flex-1 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  {item.title}
                  {dot && (
                    <span title={`${dot.n} need${dot.n === 1 ? "s" : ""} attention: ${dot.why}`} className={cn("relative inline-flex h-2 w-2 rounded-full", dotClass)}>
                      {dot.level === "red" && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden", dotClass)} />}
                      <span className="sr-only">{dot.n} need attention</span>
                    </span>
                  )}
                </span>
                {count > 0 && (
                  <span className={cn("h-5 min-w-5 px-1.5 text-[0.625rem] font-medium tabular-nums bg-white/10 text-white/60 rounded-full inline-flex items-center justify-center", active && "bento:bg-[rgba(255,255,255,0.18)] bento:text-[#fff]")}>
                    {count}
                  </span>
                )}
              </span>
            )}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  // An item with nested children (Leads > Hunter > Jev scores) draws them under it, indented behind a hairline.
  // In the icon rail they sit flat, so every page stays one tap away.
  const renderItem = (item: NavItem, depth = 0): React.ReactNode => (
    <Fragment key={item.title}>
      {renderOne(item, depth)}
      {item.nested?.length
        ? collapsed
          ? item.nested.map((n) => renderItem(n, depth + 1))
          : (
            <li className="list-none">
              <ul className="ml-[1.5rem] space-y-0.5 border-l border-white/10 pl-1.5" aria-label={`${item.title} pages`}>
                {item.nested.map((n) => renderItem(n, depth + 1))}
              </ul>
            </li>
          )
        : null}
    </Fragment>
  );

  return (
    <Sidebar collapsible="icon" variant={bento ? "floating" : "sidebar"} className="bento:p-3">
      <SidebarHeader className="bg-[#0a0a0a] border-r border-white/[0.06] px-2 pt-3 pb-1 bento:border-0 bento:pt-4">
        <Link
          to="/admin"
          onClick={closeMobile}
          aria-label="Bestly Admin home"
          className={cn("flex items-center gap-2.5 rounded-lg py-1.5", collapsed ? "justify-center px-0" : "px-2")}
        >
          <AdminMark watchCursor className={cn("shrink-0", collapsed ? "h-7 w-7" : "h-8 w-8")} />
          {!collapsed && <span className="text-[0.9375rem] font-semibold tracking-tight text-white">Bestly Admin</span>}
        </Link>
      </SidebarHeader>
      <SidebarContent className="pt-2 bg-[#0a0a0a] border-r border-white/[0.06] bento:border-0">

        <SidebarMenu className="px-2">
          {renderItem(dashboardItem)}
        </SidebarMenu>

        {sections.map((section) => (
          <div
            key={section.label}
            ref={(el) => { sectionRefs.current[section.label] = el; }}
            className={cn("transition-[opacity,transform] duration-150", dragging === section.label && "scale-[0.98] opacity-60")}
          >
            <div className="mx-3 my-2 h-px bg-white/[0.06] bento:bg-transparent bento:my-1" />
            <SidebarGroup>
              <SidebarGroupLabel className="group/label flex items-center justify-between text-[0.625rem] uppercase tracking-widest text-white/50 font-semibold px-3">
                <span>{section.label}</span>
                {!collapsed && section.label === "Agents" && (
                  <Link
                    to="/admin/agents/new"
                    onClick={closeMobile}
                    aria-label="New agent"
                    title="New agent"
                    className="-my-2.5 ml-auto grid h-11 w-11 place-items-center rounded-md text-white/60 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                  >
                    <Plus className="h-4 w-4" />
                  </Link>
                )}
                {!collapsed && (
                  <button
                    type="button"
                    onPointerDown={startDrag(section.label)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") { e.preventDefault(); move(section.label, -1); }
                      if (e.key === "ArrowDown") { e.preventDefault(); move(section.label, 1); }
                    }}
                    aria-label={`Move ${section.label} section (drag, or use the arrow keys)`}
                    title="Drag to move"
                    className="-mr-1 grid h-7 w-7 cursor-grab touch-none place-items-center rounded-md text-white/50 transition hover:bg-white/[0.08] hover:text-white active:cursor-grabbing"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                )}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>{(section.label === "Agents" ? agentNavItems(agents) : (section.items as NavItem[])).map((it) => renderItem(it))}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
