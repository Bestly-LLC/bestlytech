import { Outlet, Link, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "./AdminSidebar";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { LogOut, Home, Command } from "lucide-react";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

  const currentLabel = BREADCRUMB_MAP[location.pathname] ??
    (location.pathname.startsWith("/admin/submissions/") ? "Submission Detail" : "Admin");

  return (
    <TooltipProvider>
      <SidebarProvider>
        <div className="admin-shell min-h-screen flex w-full bg-black">
          {/* Subtle radial glow */}
          <div className="fixed inset-0 pointer-events-none z-0">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-white/[0.02] rounded-full blur-[120px]" />
          </div>

          <AdminSidebar />

          <div className="flex-1 flex flex-col min-w-0 relative z-10">
            {/* Frosted glass header */}
            <header className="sticky top-0 z-30 h-12 sm:h-14 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.03] backdrop-blur-xl px-3 sm:px-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <SidebarTrigger className="text-white/50 hover:text-white hover:bg-white/5" />
                <span className="text-[13px] text-white/30 hidden sm:inline truncate">{currentLabel}</span>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-white/30 hover:text-white hover:bg-white/5 h-8 gap-1.5 text-xs hidden sm:flex border-0">
                      <Command className="h-3 w-3" />K
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Command palette (⌘K)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" asChild className="text-white/30 hover:text-white hover:bg-white/5 h-8 w-8 border-0">
                      <Link to="/"><Home className="h-4 w-4" /></Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Home</TooltipContent>
                </Tooltip>
                <div className="hidden sm:flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                  </span>
                  <span className="text-xs text-white/30">{user?.email}</span>
                </div>
                <ChangePasswordDialog />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={signOut} className="text-white/30 hover:text-white hover:bg-white/5 h-8 w-8 border-0">
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
            <CommandPalette />
          </div>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}
