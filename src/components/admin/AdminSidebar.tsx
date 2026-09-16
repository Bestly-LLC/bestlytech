import {
  LayoutDashboard,
  FileText,
  BookOpen,
  BarChart3,
  Snowflake,
  Users,
  ShieldCheck,
  Brain,
  Globe,
  Mail,
  Briefcase,
  ListChecks,
  Server,
  Shield,
  Cloud,
  Activity,
  Sparkles,
  Car,
  Mic,
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
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type CountKeys =
  | "submissions"
  | "contacts"
  | "hires"
  | "cySubscribers"
  | "cloudLeads"
  | "shieldReports";

export const dashboardItem = { title: "Command Center", url: "/admin", icon: LayoutDashboard };

// Work: everything that brings in or serves a customer (bids, deals, intake, inbound), in one place.
const workItems = [
  { title: "Cloud Deals", url: "/admin/cloud", icon: Cloud, countKey: "cloudLeads" as CountKeys },
  { title: "Shield Reports", url: "/admin/shield-reports", icon: ShieldCheck, countKey: "shieldReports" as CountKeys },
  { title: "Marketplace Intake", url: "/admin/submissions", icon: FileText, countKey: "submissions" as CountKeys },
  { title: "Setup Guide", url: "/admin/guide", icon: BookOpen },
  { title: "Hire Requests", url: "/admin/hires", icon: Briefcase, countKey: "hires" as CountKeys },
  { title: "Contacts", url: "/admin/contacts", icon: Mail, countKey: "contacts" as CountKeys },
  { title: "Waitlist", url: "/admin/waitlist", icon: ListChecks },
  { title: "Meetings", url: "/admin/meetings", icon: Mic },
];

const cookieYetiItems = [
  { title: "Command Center", url: "/admin/cookie-yeti", icon: Snowflake },
  { title: "All Domains", url: "/admin/cookie-yeti/domains", icon: Globe },
  { title: "Subscribers", url: "/admin/cookie-yeti/subscribers", icon: Users, countKey: "cySubscribers" as CountKeys },
  { title: "Granted Access", url: "/admin/cookie-yeti/granted", icon: ShieldCheck },
  { title: "Operations", url: "/admin/cookie-yeti/ops", icon: Activity },
  { title: "Auto-Fix", url: "/admin/cookie-yeti/autofix", icon: Sparkles },
  { title: "Product Analytics", url: "/admin/cookie-yeti/analytics", icon: BarChart3 },
  { title: "Community", url: "/admin/cookie-yeti/community", icon: Brain },
];

const homeHubItems = [
  { title: "Overview", url: "/admin/home-hub", icon: Server },
  { title: "Pi-hole", url: "/admin/home-hub/pihole", icon: Shield },
];

const turoItems = [
  { title: "Street Sweeping", url: "/admin/street-sweeping", icon: Car },
];


export const ADMIN_NAV_SECTIONS = [
  { label: "Work", items: workItems },
  { label: "Cookie Yeti", items: cookieYetiItems },
  { label: "Home Hub", items: homeHubItems },
  { label: "Turo", items: turoItems },
];

const COUNT_MIN_INTERVAL_MS = 15_000;
const COUNT_POLL_MS = 60_000;

export function AdminSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  // The mobile sheet always shows full labels, whatever the saved desktop collapsed state is.
  const collapsed = state === "collapsed" && !isMobile;
  const location = useLocation();
  const currentPath = location.pathname;
  // A key is missing until its count loads. A failed count keeps its last value instead of reading 0.
  const [counts, setCounts] = useState<Partial<Record<CountKeys, number>>>({});
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
        supabase.from("seller_intakes").select("id", head).in("status", ["Submitted", "In Review"]),
        supabase.from("contact_submissions").select("id", head).eq("status", "new"),
        supabase.from("hire_requests").select("id", head).eq("status", "new"),
        supabase.from("subscriptions").select("id", head).eq("status", "active"),
        // Leads with no deal yet, or whose furthest deal is still at stage 1-2.
        supabase.from("v_cloud_leads_needing_action" as any).select("id", head),
        supabase.from("shield_url_reports").select("id", head).eq("status", "new"),
      ]);
      const keys: CountKeys[] = ["submissions", "contacts", "hires", "cySubscribers", "cloudLeads", "shieldReports"];
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
    return currentPath.startsWith(path);
  };

  const renderItem = (item: { title: string; url: string; icon: any; countKey?: CountKeys }) => {
    const active = isActive(item.url);
    const count = item.countKey ? counts[item.countKey] ?? 0 : 0;
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
              active
                ? "bg-[hsl(var(--wow-indigo)/0.12)] text-white font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[0.1875rem] before:rounded-full before:bg-[hsl(var(--wow-indigo-light))] before:shadow-[0_0_8px_hsl(var(--wow-indigo-light)/0.6)]"
                : "text-white/55 hover:text-white hover:bg-white/[0.05]"
            )}
          >
            <item.icon className="h-[1.125rem] w-[1.125rem] shrink-0" />
            {!collapsed && (
              <span className="flex-1 flex items-center justify-between">
                {item.title}
                {count > 0 && (
                  <span className="h-5 min-w-5 px-1.5 text-[0.625rem] font-medium tabular-nums bg-white/10 text-white/60 rounded-full inline-flex items-center justify-center">
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
    <Sidebar collapsible="icon">
      <SidebarHeader className="bg-[#0a0a0a] border-r border-white/[0.06] px-2 pt-3 pb-1">
        <Link
          to="/admin"
          onClick={closeMobile}
          aria-label="Bestly Admin home"
          className={cn("flex items-center gap-2.5 rounded-lg py-1.5", collapsed ? "justify-center px-0" : "px-2")}
        >
          <AdminMark className={cn("shrink-0", collapsed ? "h-7 w-7" : "h-8 w-8")} />
          {!collapsed && <span className="text-[0.9375rem] font-semibold tracking-tight text-white">Bestly Admin</span>}
        </Link>
      </SidebarHeader>
      <SidebarContent className="pt-2 bg-[#0a0a0a] border-r border-white/[0.06]">

        <SidebarMenu className="px-2">
          {renderItem(dashboardItem)}
        </SidebarMenu>

        {ADMIN_NAV_SECTIONS.map((section) => (
          <div key={section.label}>
            <div className="mx-3 my-2 h-px bg-white/[0.06]" />
            <SidebarGroup>
              <SidebarGroupLabel className="text-[0.625rem] uppercase tracking-widest text-white/50 font-semibold px-3">
                {section.label}
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
