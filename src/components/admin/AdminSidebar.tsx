import { Brush,
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
  House, Boxes, KeyRound, BookMarked, ShoppingBag, ExternalLink, ShieldCheck, Siren,
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
import { BookOpen, GripVertical } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminTheme } from "@/hooks/useAdminTheme";
import { openHokuAdmin, HOKU_ADMIN_URL } from "@/lib/openHokuAdmin";

type CountKeys =
  | "leads"
  | "contacts"
  | "cySubscribers";

export const dashboardItem = { title: "Command Center", url: "/admin", icon: LayoutDashboard };

// Work: Leads is the CRM (every funnel in one pipeline); inbound messages, waitlist, meetings and settings sit beside it.
const workItems = [
  { title: "Leads", url: "/admin/leads", icon: Users, countKey: "leads" as CountKeys },
  { title: "Contacts", url: "/admin/contacts", icon: Mail, countKey: "contacts" as CountKeys },
  { title: "Waitlist", url: "/admin/waitlist", icon: ListChecks },
  { title: "Meetings", url: "/admin/meetings", icon: Mic },
  { title: "Partners", url: "/admin/partners", icon: Handshake },
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
  { title: "Pi-hole", url: "/admin/home-hub/pihole", icon: Shield },
  { title: "Home Assistant", url: "/admin/home-hub/home-assistant", icon: House },
  { title: "Homebridge", url: "/admin/home-hub/homebridge", icon: Boxes },
  { title: "Access backup", url: "/admin/home-hub/access", icon: KeyRound },
];

const turoItems = [
  { title: "Turo Watch", url: "/admin/turo", icon: Car },
  { title: "Street Sweeping", url: "/admin/street-sweeping", icon: Brush },
];

// Backup of the account's Claude skills. The copies a session sees on disk are a
// read-only cache; this is the copy we own.
const opsItems = [
  { title: "Security", url: "/admin/security", icon: ShieldCheck },
  { title: "Claude Skills", url: "/admin/skills", icon: BookMarked },
  { title: "Scout's playbook", url: "/admin/playbook", icon: BookOpen },
];


// Signs you straight into the HOKU store admin (see lib/openHokuAdmin).
const hokuItems = [
  { title: "HOKU admin", url: HOKU_ADMIN_URL, icon: ShoppingBag, sso: true },
];

export const ADMIN_NAV_SECTIONS = [
  { label: "Work", items: workItems },
  { label: "HOKU", items: hokuItems },
  { label: "Cookie Yeti", items: cookieYetiItems },
  { label: "Home Hub", items: homeHubItems },
  { label: "Turo", items: turoItems },
  { label: "Ops", items: opsItems },
];

const COUNT_MIN_INTERVAL_MS = 15_000;
const COUNT_POLL_MS = 60_000;

/* Section order: dragged by the grip next to each section label, remembered in this browser. */
const ORDER_KEY = "bestly-admin-nav-order";
function readOrder(): string[] {
  try { const v = JSON.parse(localStorage.getItem(ORDER_KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function orderedSections(order: string[]) {
  const rank = (l: string) => { const i = order.indexOf(l); return i < 0 ? 999 + ADMIN_NAV_SECTIONS.findIndex((s) => s.label === l) : i; };
  return [...ADMIN_NAV_SECTIONS].sort((a, b) => rank(a.label) - rank(b.label));
}

/* Attention dots: anything waiting (admin_today) or unread in the bell points at a page. */
type Level = "red" | "amber" | "blue";
const LEVEL_RANK: Record<Level, number> = { red: 3, amber: 2, blue: 1 };
function pathOf(url: string | null | undefined) {
  if (!url || !url.startsWith("/admin")) return null;
  return url.split(/[?#]/)[0].replace(/\/$/, "") || "/admin";
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
  const [order, setOrder] = useState<string[]>(() => (typeof window === "undefined" ? [] : readOrder()));
  const sections = orderedSections(order);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [dragging, setDragging] = useState<string | null>(null);
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
      setAttention(att);
      const keys: CountKeys[] = ["leads", "contacts", "cySubscribers"];
      setCounts((prev) => {
        const next = { ...prev };
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
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadCounts]);

  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const isActive = (path: string) => {
    if (path === "/admin") return currentPath === "/admin";
    if (path === "/admin/cookie-yeti") return currentPath === "/admin/cookie-yeti";
    if (path === "/admin/home-hub") return currentPath === "/admin/home-hub";
    // Lead detail pages (a cloud deal, a marketplace submission) belong to Leads.
    if (path === "/admin/leads") return ["/admin/leads", "/admin/cloud", "/admin/submissions", "/admin/hires"].some((p) => currentPath.startsWith(p));
    return currentPath.startsWith(path);
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
      setDragging(null);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const renderItem = (item: { title: string; url: string; icon: any; countKey?: CountKeys; sso?: boolean }) => {
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
    const count = item.countKey ? counts[item.countKey] ?? 0 : 0;
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
              active
                ? "bg-[hsl(var(--wow-indigo)/0.12)] text-white font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[0.1875rem] before:rounded-full before:bg-[hsl(var(--wow-indigo-light))] before:shadow-[0_0_8px_hsl(var(--wow-indigo-light)/0.6)] bento:bg-[#111114] bento:text-[#fff] bento:before:hidden bento:hover:bg-[#111114] bento:hover:text-[#fff]"
                : "text-white/55 hover:text-white hover:bg-white/[0.05] bento:text-white/70"
            )}
          >
            <span className="relative shrink-0">
              <item.icon className="h-[1.125rem] w-[1.125rem]" />
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
                <SidebarMenu>{section.items.map(renderItem)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </div>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
