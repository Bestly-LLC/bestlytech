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
import {
  LayoutDashboard,
  FileText,
  BookOpen,
  Snowflake,
  Users,
  ShieldCheck,
  Brain,
  Moon,
  Sun,
  PanelLeft,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useSidebar } from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { label: "Amazon Dashboard", path: "/admin", icon: LayoutDashboard },
  { label: "Submissions", path: "/admin/submissions", icon: FileText },
  { label: "Setup Guide", path: "/admin/guide", icon: BookOpen },
  { label: "CY Dashboard", path: "/admin/cookie-yeti", icon: Snowflake },
  { label: "Subscribers", path: "/admin/cookie-yeti/subscribers", icon: Users },
  { label: "Granted Access", path: "/admin/cookie-yeti/granted", icon: ShieldCheck },
  { label: "Community Learning", path: "/admin/cookie-yeti/community", icon: Brain },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
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
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, [toggleSidebar]);

  const runCommand = useCallback((cmd: () => void) => {
    setOpen(false);
    cmd();
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, actions..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.path}
              onSelect={() => runCommand(() => navigate(item.path))}
            >
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => runCommand(() => setTheme(theme === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? <Sun className="mr-2 h-4 w-4" /> : <Moon className="mr-2 h-4 w-4" />}
            Toggle {theme === "dark" ? "Light" : "Dark"} Mode
          </CommandItem>
          <CommandItem onSelect={() => runCommand(toggleSidebar)}>
            <PanelLeft className="mr-2 h-4 w-4" />
            Toggle Sidebar
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
