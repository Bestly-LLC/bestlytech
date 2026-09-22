import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { PanelLeft, Binoculars } from "lucide-react";
import { askScout, openScout } from "./scoutBus";
import { useSidebar } from "@/components/ui/sidebar";
import { ADMIN_NAV_SECTIONS, dashboardItem } from "./AdminSidebar";
import { openHokuAdmin } from "@/lib/openHokuAdmin";

/** Fired by the ⌘K button in the admin header. */
export const OPEN_ADMIN_PALETTE_EVENT = "bestly:open-admin-palette";

/** ⌘K palette. Navigation comes straight from the sidebar sections so the two never drift apart. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { toggleSidebar } = useSidebar();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "/" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    const openFromButton = () => setOpen(true);
    document.addEventListener("keydown", down);
    window.addEventListener(OPEN_ADMIN_PALETTE_EVENT, openFromButton);
    return () => {
      document.removeEventListener("keydown", down);
      window.removeEventListener(OPEN_ADMIN_PALETTE_EVENT, openFromButton);
    };
  }, [toggleSidebar]);

  const runCommand = useCallback((cmd: () => void) => {
    setOpen(false);
    setQuery("");
    cmd();
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Go to a page, or ask Scout…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No matching page. Press Enter on "Ask Scout" below.</CommandEmpty>
        <CommandGroup heading="Scout" forceMount>
          <CommandItem
            forceMount
            value={`ask scout ${query}`}
            onSelect={() => runCommand(() => (query.trim() ? askScout(query.trim()) : openScout()))}
          >
            <Binoculars className="mr-2 h-4 w-4" />
            {query.trim() ? `Ask Scout: "${query.trim()}"` : "Open Scout"}
            <span className="ml-auto text-xs text-muted-foreground">⌘J</span>
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Admin">
          <CommandItem onSelect={() => runCommand(() => navigate(dashboardItem.url))}>
            <dashboardItem.icon className="mr-2 h-4 w-4" />
            {dashboardItem.title}
          </CommandItem>
        </CommandGroup>
        {ADMIN_NAV_SECTIONS.map((section) => (
          <CommandGroup key={section.label} heading={section.label}>
            {section.items.map((item) => (
              <CommandItem
                key={item.url}
                value={`${section.label} ${item.title}`}
                onSelect={() => runCommand(() => ("sso" in item && item.sso ? void openHokuAdmin() : navigate(item.url)))}
              >
                <item.icon className="mr-2 h-4 w-4" />
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading="View">
          <CommandItem onSelect={() => runCommand(toggleSidebar)}>
            <PanelLeft className="mr-2 h-4 w-4" />
            Toggle sidebar
            <span className="ml-auto text-xs text-muted-foreground">⌘/</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
