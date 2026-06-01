import {
  Folder, MessageSquare, Mail, ScrollText, CalendarDays, Brain,
  ShieldAlert, Globe, ServerCog, ListChecks, FormInput, KeyRound,
  FileSignature, Server, type LucideIcon,
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

type Service = { icon: LucideIcon; title: string; subtitle: string; outcome: string };

const SERVICES: Service[] = [
  { icon: Folder, title: "Drive", subtitle: "Google Drive · Dropbox", outcome: "Files sync across the team and share via your domain." },
  { icon: MessageSquare, title: "Video & Chat", subtitle: "Zoom · Slack · Teams", outcome: "Encrypted calls, screen share, and persistent rooms — Nextcloud Talk on your TURN server." },
  { icon: Mail, title: "Mail", subtitle: "Gmail · Outlook", outcome: "Branded mailboxes at your domain — IMAP/SMTP plus a full webmail client." },
  { icon: ScrollText, title: "Docs", subtitle: "Google Docs · Office 365", outcome: "Real-time collaborative editing of documents, sheets, and slides via Collabora Online." },
  { icon: CalendarDays, title: "Calendar", subtitle: "Google Cal · Outlook", outcome: "CalDAV-synced calendars across Mac, iPhone, and Android — with shared team availability." },
  { icon: Brain, title: "Intelligence", subtitle: "ChatGPT · Copilot", outcome: "Privacy-aware AI routing: local models handle anything with secrets, code, or personal data automatically; long non-sensitive prompts route to hosted models for top quality." },
  { icon: ShieldAlert, title: "Shield", subtitle: "DNS Security · Filtering", outcome: "Network-wide threat blocking — 200K+ malicious domains stopped before they reach a device." },
  { icon: Globe, title: "Access", subtitle: "Corporate VPN", outcome: "Encrypted remote access from any laptop or phone, anywhere in the world." },
  { icon: ServerCog, title: "Backup", subtitle: "Backblaze · Veeam", outcome: "Automated daily encrypted backups plus a tested disaster-recovery procedure." },
  { icon: ListChecks, title: "Projects", subtitle: "Asana · Trello · Monday", outcome: "Boards, tasks, and deadlines — owned, on premises, with full audit history." },
  { icon: FormInput, title: "Forms", subtitle: "Google Forms · Typeform", outcome: "Internal surveys and public-facing intake forms hosted on your own domain." },
  { icon: KeyRound, title: "Passwords", subtitle: "1Password · LastPass", outcome: "End-to-end encrypted vaults shared across your team — keys you control." },
  { icon: FileSignature, title: "Sign", subtitle: "DocuSign · Adobe Sign", outcome: "Legally-binding e-signatures hosted on your server, no per-envelope fees." },
];

const STAGE = 560;
const HUB_C = STAGE / 2;
const HUB_R = 210;

export function ThirteenServices() {
  return (
    <section className="border-t border-border">
      <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
        <Reveal className="mx-auto mb-12 max-w-2xl text-center">
          <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Thirteen services.{" "}
            <GradientText as="span" className="animate-gradient-flow">One server.</GradientText>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            Every tool your team uses — replaced by one private platform that lives in your office and wears your brand.
          </p>
        </Reveal>

        {/* Convergence hub */}
        <Reveal className="relative mx-auto mb-20 aspect-square w-full max-w-[560px] scale-[0.82] sm:scale-100" amount={0.1}>
          <div className="relative h-full w-full">
            <svg viewBox={`0 0 ${STAGE} ${STAGE}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
              <defs>
                <linearGradient id="bestlyBeam" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0" stopColor="hsl(var(--gradient-end))" stopOpacity="0" />
                  <stop offset="1" stopColor="hsl(var(--gradient-start))" stopOpacity="0.9" />
                </linearGradient>
              </defs>
              {SERVICES.map((s, i) => {
                const ang = (2 * Math.PI / SERVICES.length) * i - Math.PI / 2;
                const x = HUB_C + HUB_R * Math.cos(ang);
                const y = HUB_C + HUB_R * Math.sin(ang);
                return (
                  <line
                    key={s.title}
                    x1={x} y1={y} x2={HUB_C} y2={HUB_C}
                    stroke="url(#bestlyBeam)" strokeWidth={1.4}
                    className="cloud-beam opacity-50"
                    style={{ animationDelay: `${i * 0.08}s` }}
                  />
                );
              })}
            </svg>

            {SERVICES.map((s, i) => {
              const ang = (2 * Math.PI / SERVICES.length) * i - Math.PI / 2;
              const x = HUB_C + HUB_R * Math.cos(ang);
              const y = HUB_C + HUB_R * Math.sin(ang);
              return (
                <div
                  key={s.title}
                  className="group absolute flex w-[78px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 text-center"
                  style={{ left: `${(x / STAGE) * 100}%`, top: `${(y / STAGE) * 100}%` }}
                >
                  <div className="flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-border bg-card shadow-premium transition-all duration-300 group-hover:-translate-y-1 group-hover:scale-110 group-hover:shadow-glow">
                    <s.icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="text-[10.5px] font-semibold leading-tight text-foreground">{s.title}</span>
                </div>
              );
            })}

            {/* Pulse rings + core */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
              <div className="absolute h-[150px] w-[150px] rounded-full border border-[hsl(var(--glow-color)/0.4)] cloud-ping-ring" />
              <div className="absolute h-[150px] w-[150px] rounded-full border border-[hsl(var(--glow-color)/0.4)] cloud-ping-ring" style={{ animationDelay: "1.3s" }} />
              <div className="absolute h-[150px] w-[150px] rounded-full border border-[hsl(var(--glow-color)/0.4)] cloud-ping-ring" style={{ animationDelay: "2.6s" }} />
            </div>

            <div className="absolute left-1/2 top-1/2 -ml-[60px] -mt-[60px] flex h-[120px] w-[120px] items-center justify-center rounded-[30px] gradient-bg cloud-core-glow">
              <div className="absolute inset-[3px] rounded-[27px] bg-card/90 backdrop-blur-sm" />
              <Server className="relative h-11 w-11 text-primary" strokeWidth={1.75} />
              <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 text-[10.5px] font-bold uppercase tracking-widest text-foreground shadow-sm">
                Your server
              </span>
            </div>
          </div>
        </Reveal>

        {/* Detailed card grid */}
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
