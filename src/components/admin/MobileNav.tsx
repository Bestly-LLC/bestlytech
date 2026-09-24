/**
 * The admin's bottom bar on a phone.
 *
 * A hamburger that hides every destination behind one tap is a desktop pattern. On a
 * phone the four places Jared actually goes live at the bottom where his thumb is,
 * the way they already do in Eli's portal, and everything else stays in the drawer
 * behind More.
 *
 * Hidden from md up - the sidebar is the right answer on a real screen.
 */
import { Link, useLocation } from "react-router-dom";
import { Binoculars, Car, LayoutDashboard, Menu, Mic } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { openScout } from "@/components/admin/scoutBus";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Home", to: "/admin", icon: LayoutDashboard, exact: true },
  { label: "Turo Watch", to: "/admin/turo", icon: Car },
  { label: "Meetings", to: "/admin/meetings", icon: Mic },
];

export function MobileNav() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();

  const item = "flex flex-1 flex-col items-center justify-center gap-1 pt-2 text-[0.65rem] font-medium transition";

  return (
    <nav
      aria-label="Sections"
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex md:hidden",
        "border-t border-white/[0.08] bg-black/85 backdrop-blur-xl",
        "pb-[env(safe-area-inset-bottom)]",
        "bento:border-[#e6e4de] bento:bg-[#F3F2EE]/90",
      )}
    >
      {TABS.map(({ label, to, icon: Icon, exact }) => {
        const on = exact ? pathname === to : pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            aria-current={on ? "page" : undefined}
            className={cn(item, "pb-2", on ? "text-[#0A84FF]" : "text-white/50 bento:text-[#55525c]")}
          >
            <Icon className="h-[22px] w-[22px]" strokeWidth={on ? 2.4 : 2} />
            {label}
          </Link>
        );
      })}

      <button type="button" onClick={openScout} className={cn(item, "pb-2 text-white/50 bento:text-[#55525c]")}>
        <Binoculars className="h-[22px] w-[22px]" strokeWidth={2} />
        Scout
      </button>

      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        aria-label="More sections"
        className={cn(item, "pb-2 text-white/50 bento:text-[#55525c]")}
      >
        <Menu className="h-[22px] w-[22px]" strokeWidth={2} />
        More
      </button>
    </nav>
  );
}
