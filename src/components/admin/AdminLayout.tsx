import { useEffect } from "react";
import { Outlet, Link, useLocation } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AdminSidebar } from "./AdminSidebar";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { LogOut, Home, Command, Minus, Plus } from "lucide-react";
import { useAdminTextSize } from "@/hooks/useAdminTextSize";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CommandPalette, OPEN_ADMIN_PALETTE_EVENT } from "./CommandPalette";

const BREADCRUMB_MAP: Record<string, string> = {
  "/admin": "Dashboard",
  "/admin/submissions": "Marketplace Intake",
  "/admin/settings": "Settings",
  "/admin/cookie-yeti": "CY Command Center",
  "/admin/cookie-yeti/subscribers": "CY Subscribers",
  "/admin/cookie-yeti/analytics": "CY Analytics",
  "/admin/home-hub": "Home Hub",
  "/admin/home-hub/pihole": "Pi-hole",
  "/admin/street-sweeping": "Street Sweeping",
  "/admin/contacts": "Contacts",
  "/admin/hires": "Hire Requests",
  "/admin/waitlist": "Waitlist",
  "/admin/cloud": "Cloud Deals",
};

/** ui/sidebar.tsx saves the desktop open/collapsed state in this cookie; read it back on load. */
function sidebarDefaultOpen(): boolean {
  if (typeof document === "undefined") return true;
  const match = document.cookie.split("; ").find((c) => c.startsWith("sidebar:state="));
  return match ? match.slice("sidebar:state=".length) !== "false" : true;
}

export function AdminLayout() {
  const { user, signOut } = useAdminAuth();
  const textSize = useAdminTextSize();

  // Menus, dialogs and toasts render in portals on <body>, outside the admin wrapper. Put the
  // admin theme tokens on <body> too so they come up dark instead of in the public site's light theme.
  useEffect(() => {
    document.body.classList.add("admin-shell");
    return () => document.body.classList.remove("admin-shell");
  }, []);
  const location = useLocation();

  const currentLabel = BREADCRUMB_MAP[location.pathname] ??
    (location.pathname.startsWith("/admin/submissions/") ? "Submission Detail"
      : location.pathname.startsWith("/admin/cloud/") ? "Cloud Deal"
      : "Admin");

  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarDefaultOpen()}>
        <div className="admin-shell min-h-screen flex w-full bg-black">
          {/* Indigo radial glow — matches the marketing site's v7/v8 theming */}
          <div className="fixed inset-0 pointer-events-none z-0">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[50rem] h-[37.5rem] bg-[hsl(var(--wow-indigo)/0.12)] rounded-full blur-[7.5rem]" />
            <div className="absolute bottom-0 right-0 w-[25rem] h-[25rem] bg-[hsl(var(--wow-indigo-deep)/0.08)] rounded-full blur-[6.25rem]" />
          </div>

          <AdminSidebar />

          <div className="flex-1 flex flex-col min-w-0 relative z-10">
            {/* Frosted glass header */}
            <header className="sticky top-0 z-30 h-12 sm:h-14 flex items-center justify-between border-b border-white/[0.06] bg-white/[0.03] backdrop-blur-xl px-3 sm:px-4">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <SidebarTrigger className="text-white/50 hover:text-white hover:bg-white/5" />
                <span className="text-[0.8125rem] text-white/50 hidden sm:inline truncate">{currentLabel}</span>
              </div>
              <div className="flex items-center gap-1 sm:gap-2">
                <div role="group" aria-label="Text size" className="flex items-center rounded-lg border border-white/[0.08] bg-white/[0.02]">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={textSize.smaller} disabled={!textSize.canShrink}
                        aria-label="Smaller text" className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/5 border-0 rounded-r-none">
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Smaller text</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" onClick={textSize.reset} aria-label={`Text size ${textSize.percent}%. Reset to default`}
                        className="h-8 min-w-[2.75rem] px-1 text-xs tabular-nums text-white/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded-sm">
                        {textSize.percent}%
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{textSize.isDefault ? "Text size" : "Reset text size"}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={textSize.larger} disabled={!textSize.canGrow}
                        aria-label="Larger text" className="h-8 w-8 text-white/60 hover:text-white hover:bg-white/5 border-0 rounded-l-none">
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Larger text</TooltipContent>
                  </Tooltip>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button onClick={() => window.dispatchEvent(new Event(OPEN_ADMIN_PALETTE_EVENT))} aria-label="Open command palette" variant="ghost" size="sm" className="text-white/50 hover:text-white hover:bg-white/5 h-8 gap-1.5 text-xs hidden sm:flex border-0">
                      <Command className="h-3 w-3" />K
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Command palette (⌘K)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" asChild className="text-white/50 hover:text-white hover:bg-white/5 h-8 w-8 border-0">
                      <Link to="/" aria-label="Go to home page"><Home className="h-4 w-4" /></Link>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Home</TooltipContent>
                </Tooltip>
                <div className="hidden sm:flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500"></span>
                  </span>
                  <span className="text-xs text-white/50">{user?.email}</span>
                </div>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out" className="text-white/50 hover:text-white hover:bg-white/5 h-8 w-8 border-0">
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
