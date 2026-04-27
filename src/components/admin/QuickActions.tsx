import { Link } from "react-router-dom";
import {
  Cookie,
  Briefcase,
  Mail,
  FileText,
  Cloud,
  Shield,
  Server,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickAction {
  label: string;
  description: string;
  href: string;
  icon: typeof Cookie;
  iconBg: string;
  iconColor: string;
  external?: boolean;
}

const actions: QuickAction[] = [
  {
    label: "Cookie Yeti",
    description: "Patterns, AI pipeline, dismissals",
    href: "/admin/cookie-yeti",
    icon: Cookie,
    iconBg: "bg-violet-500/10",
    iconColor: "text-violet-400",
  },
  {
    label: "Hire Requests",
    description: "Review incoming work",
    href: "/admin/hires",
    icon: Briefcase,
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
  },
  {
    label: "Contacts",
    description: "Form submissions inbox",
    href: "/admin/contacts",
    icon: Mail,
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
  },
  {
    label: "Intake Submissions",
    description: "Marketplace seller intake",
    href: "/admin/submissions",
    icon: FileText,
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-400",
  },
  {
    label: "Cloud Landing",
    description: "/cloud — In-House Cloud page",
    href: "/cloud",
    icon: Cloud,
    iconBg: "bg-cyan-500/10",
    iconColor: "text-cyan-400",
    external: true,
  },
  {
    label: "Pi-hole",
    description: "DNS blocking + clients",
    href: "/admin/home-hub/pihole",
    icon: Shield,
    iconBg: "bg-red-500/10",
    iconColor: "text-red-400",
  },
  {
    label: "Home Hub",
    description: "Home Assistant, Homebridge, infra",
    href: "/admin/home-hub",
    icon: Server,
    iconBg: "bg-white/[0.05]",
    iconColor: "text-white/60",
  },
  {
    label: "Waitlist",
    description: "Pre-launch subscribers",
    href: "/admin/waitlist",
    icon: Users,
    iconBg: "bg-fuchsia-500/10",
    iconColor: "text-fuchsia-400",
  },
];

export function QuickActions() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-xs font-semibold text-white/40 uppercase tracking-widest">
          Quick Jump
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {actions.map((a) => {
          const Icon = a.icon;
          const inner = (
            <>
              <div
                className={cn(
                  "h-9 w-9 rounded-xl flex items-center justify-center shrink-0",
                  a.iconBg,
                )}
              >
                <Icon className={cn("h-[18px] w-[18px]", a.iconColor)} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{a.label}</p>
                <p className="text-[11px] text-white/40 truncate mt-0.5">
                  {a.description}
                </p>
              </div>
            </>
          );

          const className =
            "flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-2xl p-3 hover:bg-white/[0.05] hover:border-white/[0.1] transition-all duration-200";

          return a.external ? (
            <a
              key={a.label}
              href={a.href}
              target="_blank"
              rel="noreferrer"
              className={className}
            >
              {inner}
            </a>
          ) : (
            <Link key={a.label} to={a.href} className={className}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
