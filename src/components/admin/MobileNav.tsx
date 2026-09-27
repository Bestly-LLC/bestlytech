/**
 * The admin's bottom bar on a phone.
 *
 * A hamburger that hides every destination behind one tap is a desktop pattern. On a
 * phone the places Jared actually goes live at the bottom where his thumb is, the way
 * they already do in Eli's portal, and everything else stays in the drawer behind More.
 *
 * The raised center button opens Quick tools: a Control Center style sheet with the six
 * things he reaches for most (Wall, Scout, Meetings, Street Sweeping, a one-tap projector
 * refocus and a one-tap wall restart).
 *
 * Hidden from md up - the sidebar is the right answer on a real screen.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Binoculars, Brush, Car, Focus, LayoutDashboard, Menu, Mic, Projector, RotateCw, Zap, X } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { openScout } from "@/components/admin/scoutBus";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

const TABS_LEFT = [
  { label: "Home", to: "/admin", icon: LayoutDashboard, exact: true },
  { label: "Turo", to: "/admin/turo", icon: Car },
];
const TABS_RIGHT = [{ label: "Wall", to: "/admin/wall", icon: Projector }];

type Tool = { label: string; sub: string; icon: typeof Zap; tint: string; to?: string; run?: () => Promise<string | void> | void };

const TOOLS: Tool[] = [
  { label: "Wall", sub: "Remote & layout", icon: Projector, tint: "#5E5CE6", to: "/admin/wall" },
  { label: "Ask Scout", sub: "Anything, anytime", icon: Binoculars, tint: "#30D158", run: () => openScout() },
  { label: "Meetings", sub: "Record & notes", icon: Mic, tint: "#FF453A", to: "/admin/meetings" },
  { label: "Street Sweeping", sub: "Where's the car", icon: Brush, tint: "#FF9F0A", to: "/admin/street-sweeping" },
  {
    label: "Restart wall", sub: "Stuck? Reopen it", icon: RotateCw, tint: "#64D2FF",
    run: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("wall_admin_command", { p_cmd: "relaunch" });
      return error ? `Didn't go through: ${error.message}` : "Restarting the wall… back in about 15 seconds.";
    },
  },
  {
    label: "Focus projector", sub: "Sharpen the wall", icon: Focus, tint: "#BF5AF2",
    run: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)("wall_admin_command", { p_cmd: "focus" });
      return error ? `Didn't go through: ${error.message}` : "Focusing… the wall blurs for a few seconds.";
    },
  },
];

function QuickTools({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [note, setNote] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setNote(null); return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    sheet.current?.querySelector<HTMLButtonElement>("button[data-tool]")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const tap = async (t: Tool) => {
    if (navigator.vibrate) navigator.vibrate(8);
    if (t.to) { onClose(); navigate(t.to); return; }
    const msg = await t.run?.();
    if (typeof msg === "string") setNote(msg); else onClose();
  };

  return (
    <div
      className={cn("fixed inset-0 z-50 md:hidden", open ? "pointer-events-auto" : "pointer-events-none")}
      aria-hidden={!open}
    >
      <button
        type="button"
        aria-label="Close quick tools"
        tabIndex={open ? 0 : -1}
        onClick={onClose}
        className={cn("absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-300", open ? "opacity-100" : "opacity-0")}
      />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label="Quick tools"
        className={cn(
          "absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+12px)] rounded-[28px] p-4",
          "bg-[#1c1c1e]/95 ring-1 ring-white/10 shadow-[0_20px_60px_rgba(0,0,0,.6)] backdrop-blur-2xl",
          "bento:bg-white/95 bento:ring-black/5",
          "transition-[transform,opacity] duration-[420ms] ease-[cubic-bezier(.2,.9,.25,1.15)]",
          open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-0",
        )}
      >
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-[17px] font-semibold text-white bento:text-[#111]">Quick tools</h2>
          <button type="button" onClick={onClose} tabIndex={open ? 0 : -1} aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70 bento:bg-black/5 bento:text-black/60">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2.5">
          {TOOLS.map((t, i) => {
            const Icon = t.icon;
            return (
              <button
                key={t.label}
                type="button"
                data-tool
                tabIndex={open ? 0 : -1}
                onClick={() => void tap(t)}
                style={{ transitionDelay: open ? `${60 + i * 35}ms` : "0ms" }}
                className={cn(
                  "flex min-h-[104px] flex-col items-center justify-center gap-2 rounded-[20px] px-2 py-3 text-center",
                  "bg-white/[0.06] active:scale-95 bento:bg-black/[0.04]",
                  "transition-[transform,opacity] duration-300",
                  open ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
                )}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: t.tint }}>
                  <Icon className="h-[22px] w-[22px] text-white" strokeWidth={2.2} />
                </span>
                <span className="text-[13px] font-semibold leading-tight text-white bento:text-[#111]">{t.label}</span>
                <span className="-mt-1 text-[11px] leading-tight text-white/45 bento:text-black/45">{t.sub}</span>
              </button>
            );
          })}
        </div>
        {note && <p role="status" className="mt-3 px-1 text-[13px] text-white/70 bento:text-black/60">{note}</p>}
      </div>
    </div>
  );
}

export function MobileNav() {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const [quick, setQuick] = useState(false);

  useEffect(() => { setQuick(false); }, [pathname]);

  const item = "flex flex-1 flex-col items-center justify-center gap-1 pt-2 text-[0.65rem] font-medium transition";
  const tab = ({ label, to, icon: Icon, exact }: { label: string; to: string; icon: typeof Zap; exact?: boolean }) => {
    const on = exact ? pathname === to : pathname.startsWith(to);
    return (
      <Link key={to} to={to} aria-current={on ? "page" : undefined}
        className={cn(item, "pb-2", on ? "text-[#0A84FF]" : "text-white/50 bento:text-[#55525c]")}>
        <Icon className="h-[22px] w-[22px]" strokeWidth={on ? 2.4 : 2} />
        {label}
      </Link>
    );
  };

  return (
    <>
      <QuickTools open={quick} onClose={() => setQuick(false)} />
      <nav
        aria-label="Sections"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex md:hidden",
          "border-t border-white/[0.08] bg-black/85 backdrop-blur-xl",
          "pb-[env(safe-area-inset-bottom)]",
          "bento:border-[#e6e4de] bento:bg-[#F3F2EE]/90",
        )}
      >
        {TABS_LEFT.map(tab)}

        <div className="flex flex-1 items-start justify-center">
          <button
            type="button"
            onClick={() => setQuick((v) => !v)}
            aria-label={quick ? "Close quick tools" : "Open quick tools"}
            aria-expanded={quick}
            className={cn(
              "-mt-4 flex h-14 w-14 items-center justify-center rounded-full text-white",
              "bg-gradient-to-b from-[#0A84FF] to-[#5E5CE6] shadow-[0_8px_24px_rgba(10,132,255,.45)] ring-4 ring-black",
              "bento:ring-[#F3F2EE] transition-transform duration-300 active:scale-90",
            )}
          >
            {quick ? <X className="h-6 w-6" strokeWidth={2.4} /> : <Zap className="h-6 w-6" strokeWidth={2.4} />}
          </button>
        </div>

        {TABS_RIGHT.map(tab)}

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
    </>
  );
}
