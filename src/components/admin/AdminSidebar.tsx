import {
  LayoutDashboard,
  FileText,
  BookOpen,
  Snowflake,
  Users,
  ShieldCheck,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
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

const amazonItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Submissions", url: "/admin/submissions", icon: FileText },
  { title: "Setup Guide", url: "/admin/guide", icon: BookOpen },
];

const cookieYetiItems = [
  { title: "CY Dashboard", url: "/admin/cookie-yeti", icon: Snowflake },
  { title: "Subscribers", url: "/admin/cookie-yeti/subscribers", icon: Users },
  { title: "Granted Access", url: "/admin/cookie-yeti/granted", icon: ShieldCheck },
];

export function AdminSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const currentPath = location.pathname;

  const isActive = (path: string) => {
    if (path === "/admin") return currentPath === "/admin";
    return currentPath.startsWith(path);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup defaultOpen>
          <SidebarGroupLabel>Amazon</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {amazonItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end={item.url === "/admin"}>
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup defaultOpen>
          <SidebarGroupLabel>❄️ Cookie Yeti</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {cookieYetiItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)}>
                    <NavLink to={item.url} end={item.url === "/admin/cookie-yeti"}>
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
