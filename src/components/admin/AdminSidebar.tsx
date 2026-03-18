import {
  LayoutDashboard,
  FileText,
  BookOpen,
  Snowflake,
  Users,
  ShieldCheck,
  Brain,
  Mail,
  Briefcase,
  ListChecks,
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
import { Badge } from "@/components/ui/badge";

type CountKeys = "submissions" | "contacts" | "hires" | "cySubscribers";

const dashboardItem = { title: "Dashboard", url: "/admin", icon: LayoutDashboard };

const amazonItems = [
  { title: "Submissions", url: "/admin/submissions", icon: FileText, countKey: "submissions" as CountKeys },
  { title: "Setup Guide", url: "/admin/guide", icon: BookOpen },
];

const generalItems = [
  { title: "Contacts", url: "/admin/contacts", icon: Mail, countKey: "contacts" as CountKeys },
  { title: "Hire Requests", url: "/admin/hires", icon: Briefcase, countKey: "hires" as CountKeys },
  { title: "Waitlist", url: "/admin/waitlist", icon: ListChecks },
];

const cookieYetiItems = [
  { title: "CY Dashboard", url: "/admin/cookie-yeti", icon: Snowflake },
  { title: "Subscribers", url: "/admin/cookie-yeti/subscribers", icon: Users, countKey: "cySubscribers" as CountKeys },
  { title: "Granted Access", url: "/admin/cookie-yeti/granted", icon: ShieldCheck },
  { title: "Community", url: "/admin/cookie-yeti/community", icon: Brain },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;
  const [counts, setCounts] = useState<Record<CountKeys, number>>({ submissions: 0, contacts: 0, hires: 0, cySubscribers: 0 });

  useEffect(() => {
    Promise.all([
      supabase.from("seller_intakes").select("id", { count: "exact", head: true }).in("status", ["Submitted", "In Review"]),
      supabase.from("contact_submissions").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("hire_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]).then(([subs, contacts, hires, cySubs]) => {
      setCounts({
        submissions: subs.count ?? 0,
        contacts: contacts.count ?? 0,
        hires: hires.count ?? 0,
        cySubscribers: cySubs.count ?? 0,
      });
    });
  }, []);

  const isActive = (path: string) => {
    if (path === "/admin") return currentPath === "/admin";
    if (path === "/admin/cookie-yeti") return currentPath === "/admin/cookie-yeti";
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
                ? "bg-sidebar-accent text-sidebar-primary font-medium before:absolute before:left-0 before:top-1/2 before:-translate-y-1/2 before:h-5 before:w-[3px] before:rounded-full before:bg-sidebar-primary"
                : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            )}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && (
              <span className="flex-1 flex items-center justify-between">
                {item.title}
                {count > 0 && (
                  <Badge variant="secondary" className="h-5 min-w-5 px-1.5 text-[10px] font-semibold tabular-nums">
                    {count}
                  </Badge>
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
      <SidebarContent className="pt-2">

        <SidebarMenu className="px-2">
          {renderItem(dashboardItem)}
        </SidebarMenu>

        <div className="mx-3 my-2 h-px bg-border/50" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold px-3">
            Amazon
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{amazonItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mx-3 my-2 h-px bg-border/50" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold px-3">
            General
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{generalItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mx-3 my-2 h-px bg-border/50" />

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-semibold px-3">
            ❄️ Cookie Yeti
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{cookieYetiItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
