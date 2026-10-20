/**
 * Admin inside Bestly Cloud: the admin's own top bar is hidden (Cloud's header is the one header),
 * so the things that lived there move into the sidebar header row, next to the "Admin" mark:
 * search (Cmd-K), the bell, and one overflow menu (sound, text size, collapse, sign out).
 * On a phone the sidebar is the More sheet, so these are one tap from the bottom bar. 44 px targets there.
 */
import { useState } from "react";
import { Command, LogOut, Minus, MoreHorizontal, PanelLeft, Plus, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useSidebar } from "@/components/ui/sidebar";
import { NotificationBell } from "./NotificationBell";
import { OPEN_ADMIN_PALETTE_EVENT } from "./CommandPalette";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { useAdminTextSize } from "@/hooks/useAdminTextSize";
import { notifySoundMuted, setNotifySoundMuted, playNotifySound } from "@/lib/notifySound";
import { cn } from "@/lib/utils";

const btn = "h-11 w-11 md:h-8 md:w-8 shrink-0 border-0 text-white/60 hover:text-white hover:bg-white/5 bento:rounded-full";

export function EmbedSidebarTools({ collapsed }: { collapsed: boolean }) {
  const { isMobile, setOpenMobile, toggleSidebar } = useSidebar();
  const { signOut } = useAdminAuth();
  const textSize = useAdminTextSize();
  const [muted, setMuted] = useState(notifySoundMuted());

  const openSearch = () => {
    if (isMobile) setOpenMobile(false); // the palette is a dialog; the More sheet must not sit under it
    window.dispatchEvent(new Event(OPEN_ADMIN_PALETTE_EVENT));
  };

  return (
    <div className={cn("flex items-center", collapsed ? "flex-col gap-1" : "gap-0.5")}>
      <Button variant="ghost" size="icon" onClick={openSearch} aria-label="Search everything" className={btn}>
        <Command className="h-4 w-4" />
      </Button>
      <NotificationBell triggerClassName={cn(btn, "h-11 w-11 md:h-8 md:w-8 rounded-md")} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="More admin options" className={btn}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* No theme item on purpose: Cloud's light/dark control in its header is the only one, and the admin follows it. */}
          <DropdownMenuItem
            className="min-h-11 md:min-h-0"
            onSelect={(e) => {
              e.preventDefault();
              const next = !muted;
              setNotifySoundMuted(next);
              setMuted(next);
              if (!next) playNotifySound();
            }}
          >
            {muted ? <VolumeX className="mr-2 h-4 w-4" /> : <Volume2 className="mr-2 h-4 w-4" />}
            {muted ? "Sound off" : "Sound on"}
          </DropdownMenuItem>
          {!isMobile && (
            <DropdownMenuItem onSelect={toggleSidebar}>
              <PanelLeft className="mr-2 h-4 w-4" /> {collapsed ? "Expand sidebar" : "Collapse sidebar"}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs text-muted-foreground">Text size</span>
            <span className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-11 w-11 md:h-7 md:w-7" onClick={textSize.smaller} disabled={!textSize.canShrink} aria-label="Smaller text"><Minus className="h-3.5 w-3.5" /></Button>
              <button type="button" onClick={textSize.reset} className="min-h-11 min-w-[2.5rem] whitespace-nowrap text-xs tabular-nums md:min-h-0">{textSize.label}</button>
              <Button variant="ghost" size="icon" className="h-11 w-11 md:h-7 md:w-7" onClick={textSize.larger} disabled={!textSize.canGrow} aria-label="Larger text"><Plus className="h-3.5 w-3.5" /></Button>
            </span>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11 md:min-h-0" onSelect={signOut}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
