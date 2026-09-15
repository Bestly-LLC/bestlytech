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
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
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

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;
  const [counts, setCounts] = useState<Record<CountKeys, number>>({ submissions: 0, contacts: 0, hires: 0, cySubscribers: 0, cloudLeads: 0, shieldReports: 0 });

  useEffect(() => {
    Promise.all([
      supabase.from("seller_intakes").select("id", { count: "exact", head: true }).in("status", ["Submitted", "In Review"]),
      supabase.from("contact_submissions").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("hire_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
      supabase.from("cloud_leads").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("shield_url_reports").select("id", { count: "exact", head: true }).eq("status", "new"),
    ]).then(([subs, contacts, hires, cySubs, cloudLeads, shieldReports]) => {
      setCounts({
        submissions: subs.count ?? 0,
        contacts: contacts.count ?? 0,
        hires: hires.count ?? 0,
        cySubscribers: cySubs.count ?? 0,
        cloudLeads: cloudLeads.count ?? 0,
        shieldReports: shieldReports.count ?? 0,
      });
    });
  }, []);

  const isActive = (path: string) => {
    if (path === "/admin") return currentPath === "/admin";
    if (path === "/admin/cookie-yeti") return currentPath === "/admin/cookie-yeti";
    if (path === "/admin/home-hub") return currentPath === "/admin/home-hub";
    return currentPath.startsWith(path);
  };

  const renderItem = (item: { title: string; url: string; icon: any; countKey?: CountKeys }) => {
    const active = isActive(item.url);
    const count = item.countKey ? counts[item.countKey] : 0;
    return (
      <SidebarMenuItem key={item.title}>
        <SidebarMenuButton asChild isActive={active}>
          <Link
            to={item.url}
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
