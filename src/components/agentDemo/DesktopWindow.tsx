import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BizLogo, Toasts, type ToastItem } from "./appKit";

export type SidebarItem = { id: string; label: string; icon: LucideIcon; badge?: string };

/**
 * A believable, fictional macOS-style app window: traffic lights, a title bar, a slim menu strip with the scenario
 * clock and the "Bestly Agent connected" dot, a sidebar, and the app itself. It is a picture of software, not
 * software: nothing in it is focusable, and the transcript says everything it shows.
 */
export function DesktopWindow({
  appName,
  logo,
  brand,
  windowTitle,
  clock,
  accent,
  sidebar,
  current,
  toasts,
  t,
  bodyHeight,
  bodyHeightNarrow,
  children,
}: {
  appName: string;
  /** Logo slug and short name of the business, for the title bar and the sidebar. */
  logo: string;
  brand: string;
  windowTitle: string;
  clock: string;
  accent: string;
  sidebar: SidebarItem[];
  current: string;
  toasts: ToastItem[];
  t: number;
  bodyHeight: number;
  bodyHeightNarrow: number;
  children: ReactNode;
}) {
  const style = {
    "--app-accent": accent,
    "--adw-body-h": `${bodyHeight}px`,
    "--adw-body-h-narrow": `${bodyHeightNarrow}px`,
  } as CSSProperties;
  return (
    <div className="ad-win-wrap">
      <p className="sr-only">
        A sample {appName} window, with made-up data. It updates as the call goes on. The transcript lists everything Maya does.
      </p>
      <div className="adw" style={style} aria-hidden="true">
        <div className="adw-bar">
          <div className="adw-lights">
            <span style={{ background: "#FF5F57" }} />
            <span style={{ background: "#FEBC2E" }} />
            <span style={{ background: "#28C840" }} />
          </div>
          <div className="adw-title">
            <BizLogo slug={logo} size={16} />
            <span>{windowTitle}</span>
          </div>
          <div />
        </div>
        <div className="adw-menu">
          <span className="adw-menu-app">{appName}</span>
          <span className="adw-menu-items">
            <span>File</span>
            <span>Edit</span>
            <span>View</span>
            <span>Window</span>
          </span>
          <span className="adw-menu-right">
            <span className="adw-conn">
              <i />
              Bestly Agent connected
            </span>
            <span className="adw-clock">{clock}</span>
          </span>
        </div>
        <div className="adw-body">
          <nav className="adw-side">
            <div className="adw-brand">
              <BizLogo slug={logo} size={22} />
              <span className="adw-brand-n">{brand}</span>
            </div>
            {sidebar.map((s) => (
              <div key={s.id} className={cn("adw-side-i", s.id === current && "is-on")}>
                <s.icon size={16} strokeWidth={1.9} />
                <span className="adw-side-l">{s.label}</span>
                {s.badge ? <span className="adw-side-b">{s.badge}</span> : null}
              </div>
            ))}
          </nav>
          <div className="adw-main">{children}</div>
          <Toasts toasts={toasts} t={t} />
        </div>
      </div>
    </div>
  );
}
