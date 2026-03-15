import { Outlet, Link, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "./AdminSidebar";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { LogOut, Shield, Home, Command } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CommandPalette } from "./CommandPalette";

const BREADCRUMB_MAP: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/submissions": "Submissions",
  "/admin/guide": "Setup Guide",
  "/admin/cookie-yeti": "CY Dashboard",
  "/admin/cookie-yeti/subscribers": "Subscribers",
  "/admin/cookie-yeti/granted": "Granted Access",
  "/admin/cookie-yeti/community": "Community Learning",
};

export function AdminLayout() {
  const { user, signOut } = useAdminAuth();
  const location = useLocation();

  // Derive breadcrumb — match exact or longest prefix
  const currentLabel = BREADCRUMB_MAP[location.pathname] ??
    (location.pathname.startsWith("/admin/submissions/") ? "Submission Detail" : "Admin");

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="min-h-screen flex w-full bg-background">
          <AdminSidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <header className="sticky top-0 z-30 h-14 flex items-center justify-between border-b bg-card/80 backdrop-blur-md px-4 shadow-[0_1px_3px_0_hsl(var(--border)/0.4)]">
              <div className="flex items-center gap-3">
                <SidebarTrigger />
                <Separator orientation="vertical" className="h-5" />
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-foreground text-sm tracking-tight">Bestly Admin</span>
                </div>
                <Separator orientation="vertical" className="h-4 hidden sm:block" />
                <span className="text-xs text-muted-foreground hidden sm:inline">{currentLabel}</span>
              </div>
              <div className="flex items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" asChild className="text-muted-foreground hover:text-foreground h-8 w-8">
                      <Link to="/"><Home className="h-4 w-4" /></Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Home</TooltipContent>
                </Tooltip>
                <div className="hidden sm:flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <span className="text-xs text-muted-foreground">{user?.email}</span>
                </div>
                <ChangePasswordDialog />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={signOut} className="text-muted-foreground hover:text-foreground h-8 w-8">
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Logout</TooltipContent>
                </Tooltip>
              </div>
            </header>
            <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-auto">
              <Outlet />
            </main>
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
