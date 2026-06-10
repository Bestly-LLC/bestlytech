import {
  Folder, MessageSquare, Mail, ScrollText, CalendarDays, Brain,
  ShieldAlert, Globe, ServerCog, ListChecks, FormInput, KeyRound,
  FileSignature, type LucideIcon,
} from "lucide-react";
import { Reveal } from "@/components/motion/Reveal";
import { Stagger, StaggerItem } from "@/components/motion/Stagger";
import { GradientText } from "@/components/ui/GradientText";

/**
 * ThirteenServices — animated "Thirteen services. One server." section.
 *
 * A convergence hub (glowing on-prem server core with the 13 services wired
 * in by flowing light-beams) over a premium, staggered card grid with
 * gradient-border ignite + hover sheen. Content is unchanged from the prior
 * section; only the presentation is upgraded. Motion is CSS/transform-only
 * and disabled under prefers-reduced-motion (see index.css cloud-* guards).
 */

export type Service = { icon: LucideIcon; title: string; subtitle: string; outcome: string };

export const SERVICES: Service[] = [
  { icon: Folder, title: "Files", subtitle: "Google Drive · Dropbox", outcome: "All your files in one place, synced to every computer and easy to share with a link." },
  { icon: MessageSquare, title: "Video & Chat", subtitle: "Zoom · Slack · Teams", outcome: "Private video calls, screen sharing, and team messaging — built right in." },
  { icon: Mail, title: "Email", subtitle: "Gmail · Outlook", outcome: "Professional email at your own name, like you@yourpractice.com." },
  { icon: ScrollText, title: "Documents", subtitle: "Google Docs · Office 365", outcome: "Write and edit documents and spreadsheets together, at the same time." },
  { icon: CalendarDays, title: "Calendar", subtitle: "Google Cal · Outlook", outcome: "Shared calendars that stay in sync on everyone's phone and computer." },
  { icon: Brain, title: "AI Assistant", subtitle: "ChatGPT · Copilot", outcome: "Help with writing and answering questions — and your information never leaves the office." },
  { icon: ShieldAlert, title: "Security", subtitle: "DNS filtering", outcome: "Blocks scam and virus websites before they ever reach a device." },
  { icon: Globe, title: "Remote Access", subtitle: "Corporate VPN", outcome: "Safely reach your office files from home or anywhere you travel." },
  { icon: ServerCog, title: "Backup", subtitle: "Backblaze · Veeam", outcome: "Automatic daily backups, so you never lose an important file." },
  { icon: ListChecks, title: "Tasks", subtitle: "Asana · Trello · Monday", outcome: "Simple boards to track who's doing what, and by when." },
  { icon: FormInput, title: "Forms", subtitle: "Google Forms · Typeform", outcome: "Create patient or customer forms and surveys on your own website." },
  { icon: KeyRound, title: "Passwords", subtitle: "1Password · LastPass", outcome: "One secure place for your team's logins and passwords." },
  { icon: FileSignature, title: "E-Signatures", subtitle: "DocuSign · Adobe Sign", outcome: "Send documents for legal signature online — with no per-document fees." },
];

export function ThirteenServices() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
        <Reveal className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Thirteen services.{" "}
            <GradientText as="span" className="animate-gradient-flow">One small device.</GradientText>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Every tool your team uses — replaced by one private platform that lives in your office and wears your brand.
          </p>
        </Reveal>

        {/* Detailed card grid (the convergence hub was replaced by the
            CloudServicesReveal 3D scene that precedes this section) */}
        <Stagger className="grid gap-[18px] md:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((s) => (
            <StaggerItem key={s.title}>
              <div className="group relative h-full overflow-hidden rounded-[18px] border border-border bg-card p-6 transition-all duration-500 gradient-border shadow-[0_4px_20px_rgba(58,74,156,0.10)] hover:-translate-y-1.5 hover:scale-[1.015] hover:shadow-[0_20px_48px_rgba(58,74,156,0.22)]">
                {/* gradient top accent */}
                <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-[hsl(var(--gradient-start))] to-[hsl(var(--gradient-end))] opacity-50 transition-opacity duration-500 group-hover:opacity-100" />
                {/* hover sheen */}
                <span className="cloud-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-[hsl(var(--glow-color)/0.16)] to-transparent" />
                <div className="relative z-10">
                  <div className="relative flex h-[54px] w-[54px] items-center justify-center rounded-[15px] gradient-bg shadow-[0_6px_18px_rgba(58,74,156,0.28)] transition-all duration-300 group-hover:-translate-y-0.5 group-hover:scale-105 group-hover:shadow-[0_0_0_4px_rgba(122,139,224,0.16),0_10px_26px_rgba(58,74,156,0.36)]">
                    <s.icon className="h-[25px] w-[25px] text-white" strokeWidth={2} />
                  </div>
                  <h3 className="font-modern mt-[18px] text-xl font-bold tracking-tight text-foreground">{s.title}</h3>
                  <span className="mt-2.5 inline-flex items-center rounded-full bg-[hsl(var(--gradient-start)/0.08)] px-[11px] py-1 text-[11px] font-semibold tracking-wide text-[hsl(var(--gradient-start))]">
                    Replaces {s.subtitle}
                  </span>
                  <p className="mt-3.5 text-sm leading-relaxed text-muted-foreground">{s.outcome}</p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
