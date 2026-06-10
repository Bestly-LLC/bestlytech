import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { GlowCard } from "@/components/ui/GlowCard";
import { GradientText } from "@/components/ui/GradientText";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { InteractivePricingCalculator } from "@/components/InteractivePricingCalculator";
import { CloudScrollHero } from "@/components/cloud/CloudScrollHero";
import { ThirteenServices } from "@/components/cloud/ThirteenServices";
import { CloudServicesReveal } from "@/components/cloud/CloudServicesReveal";
import { CloudPrivacySeal } from "@/components/cloud/CloudPrivacySeal";
import { CloudDockCTA } from "@/components/cloud/CloudDockCTA";
import {
  Folder, MessageSquare, Mail, ScrollText, CalendarDays, Brain,
  ShieldAlert, Globe, ServerCog, ListChecks, FormInput, KeyRound,
  FileSignature, Server, Lock, Building2, Cpu, Wrench,
  Compass, Workflow, GraduationCap, ArrowRight,
} from "lucide-react";

const replaces = [
  {
    icon: Folder,
    title: "Drive",
    subtitle: "Google Drive · Dropbox",
    outcome: "Files sync across the team and share via your domain.",
  },
  {
    icon: MessageSquare,
    title: "Video & Chat",
    subtitle: "Zoom · Slack · Teams",
    outcome: "Encrypted calls, screen share, and persistent rooms — Nextcloud Talk on your TURN server.",
  },
  {
    icon: Mail,
    title: "Mail",
    subtitle: "Gmail · Outlook",
    outcome: "Branded mailboxes at your domain — IMAP/SMTP plus a full webmail client.",
  },
  {
    icon: ScrollText,
    title: "Docs",
    subtitle: "Google Docs · Office 365",
    outcome: "Real-time collaborative editing of documents, sheets, and slides via Collabora Online.",
  },
  {
    icon: CalendarDays,
    title: "Calendar",
    subtitle: "Google Cal · Outlook",
    outcome: "CalDAV-synced calendars across Mac, iPhone, and Android — with shared team availability.",
  },
  {
    icon: Brain,
    title: "Intelligence",
    subtitle: "ChatGPT · Copilot",
    outcome: "Privacy-aware AI routing: local models (1B–8B) handle anything containing secrets, code, or personal data automatically. Long, non-sensitive prompts route to hosted models for top quality. You pick the policy, your team gets the speed.",
  },
  {
    icon: ShieldAlert,
    title: "Shield",
    subtitle: "DNS Security · Filtering",
    outcome: "Network-wide threat blocking — 200K+ malicious domains stopped before they reach a device.",
  },
  {
    icon: Globe,
    title: "Access",
    subtitle: "Corporate VPN",
    outcome: "Encrypted remote access from any laptop or phone, anywhere in the world.",
  },
  {
    icon: ServerCog,
    title: "Backup",
    subtitle: "Backblaze · Veeam",
    outcome: "Automated daily encrypted backups plus a tested disaster-recovery procedure.",
  },
  {
    icon: ListChecks,
    title: "Projects",
    subtitle: "Asana · Trello · Monday",
    outcome: "Boards, tasks, and deadlines — owned, on premises, with full audit history.",
  },
  {
    icon: FormInput,
    title: "Forms",
    subtitle: "Google Forms · Typeform",
    outcome: "Internal surveys and public-facing intake forms hosted on your own domain.",
  },
  {
    icon: KeyRound,
    title: "Passwords",
    subtitle: "1Password · LastPass",
    outcome: "End-to-end encrypted vaults shared across your team — keys you control.",
  },
  {
    icon: FileSignature,
    title: "Sign",
    subtitle: "DocuSign · Adobe Sign",
    outcome: "Legally-binding e-signatures hosted on your server, no per-envelope fees.",
  },
];

const stats = [
  { value: 93, suffix: "%", label: "lower 3-year cost vs. cloud stack" },
  { value: 200, suffix: "K+", label: "malicious domains blocked at DNS" },
  { value: 99.9, suffix: "%", label: "average server uptime" },
  { value: 0, suffix: "", label: "per-seat licensing fees, ever" },
];

const process = [
  {
    step: "01",
    icon: Compass,
    title: "Discovery Call",
    description: "30 minutes. We map your stack, user count, storage, compliance, and pain points. You leave with a side-by-side cost comparison.",
  },
  {
    step: "02",
    icon: Workflow,
    title: "Architecture",
    description: "If it's a fit, we design the hardware tier, software config, branding, AI model selection, and integration points.",
  },
  {
    step: "03",
    icon: Wrench,
    title: "Build & Deploy",
    description: "We configure and harden the server, apply your branding, install on-site, and verify every service end-to-end.",
  },
  {
    step: "04",
    icon: GraduationCap,
    title: "Onboard",
    description: "Hands-on team training and admin handoff. Ongoing support from $500/mo, or self-manage with full docs.",
  },
];

const objections = [
  {
    q: "What if the server breaks?",
    a: "Automated daily backups, documented DR, and redundant access paths. A full Enterprise replacement is $6,500–$10,000 — less than one month of cloud subs at scale.",
  },
  {
    q: "What about remote work?",
    a: "Encrypted remote access is included. Reach the office server from home, an airport, a client site — same branded interface, same domain.",
  },
  {
    q: "Isn't local AI worse than ChatGPT?",
    a: "For summaries, drafting, translation, transcription, and smart search, local 1B–8B models handle the work. You trade a sliver of nuance for $0 per query and zero data exposure.",
  },
  {
    q: "Who maintains it?",
    a: "Your choice. Full docs and DR guide included — self-manage from day one, or Bestly handles monitoring, updates, and model upgrades from $500/mo. No long-term contracts.",
  },
];
const pillars = [
  {
    icon: Server,
    title: "On premises, on brand",
    body: "Employees log in at cloud.yourcompany.com with your logo and colors. File-share links carry your domain. Mobile apps sync your branding automatically. No mention of Bestly anywhere.",
  },
  {
    icon: Lock,
    title: "Your data stops leaving the building",
    body: "Files, email, chat, video, and AI prompts process on hardware inside your office. No third-party data center, no cross-border transfers, no foreign-jurisdiction subpoena risk. GDPR, HIPAA, SOC 2, CCPA — built in.",
  },
  {
    icon: Cpu,
    title: "Runs itself 85%+ of the time",
    body: "A self-healing IT manager checks every critical service every 5 minutes, auto-repairs common failures in under 30 seconds, and hands prepared diagnostics to your IT lead when humans are needed.",
  },
  {
    icon: Building2,
    title: "Federation across organizations",
    body: "Share files and rooms with users on other servers. White-label cloud.<client>.com per partner. SSO and branded login flows for any enterprise customer.",
  },
];

export default function InHouseCloud() {
  return (
    <>
      <SEOHead
        title="In-House Cloud — Stop overpaying for enterprise tools | Bestly"
        description="Built for small and medium businesses. One server in your office replaces Google Workspace, Zoom, Slack, Dropbox, DocuSign, 1Password, and your AI tool. No per-seat fees, no IT department. See what your business would save."
        path="/cloud"
      />

      {/* Hero — scroll-scrubbed 3D device */}
      <CloudScrollHero />

      {/* Scene: the lid seals shut — privacy promise */}
      <CloudPrivacySeal />

      {/* Problem · Agitate · Solve */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-8 md:grid-cols-3">
            <AnimatedSection animation="fade-in">
              <div className="h-full">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">Problem</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                  You pay thousands a month for software you don't own.
                </h3>
                <p className="mt-3 text-muted-foreground leading-relaxed">
                  Files, email, client conversations, and strategy docs all live on servers somewhere else — on terms someone else sets.
                </p>
              </div>
            </AnimatedSection>
            <AnimatedSection animation="fade-in" delay={80}>
              <div className="h-full">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">Agitate</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                  And every renewal, the price goes up.
                </h3>
                <p className="mt-3 text-muted-foreground leading-relaxed">
                  Google Workspace raised prices 20% in 2024. Microsoft 365 is up 15 to 25% since 2022. A 15-person business can spend $20,000 a year on subscriptions; a 30-person business, well over $40,000. You never stop paying, and you never own a thing.
                </p>
              </div>
            </AnimatedSection>
            <AnimatedSection animation="fade-in" delay={160}>
              <div className="h-full">
                <p className="text-xs font-semibold uppercase tracking-widest text-primary">Solve</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
                  One server in your office, branded to your company.
                </h3>
                <p className="mt-3 text-muted-foreground leading-relaxed">
                  File storage, email, video, chat, docs, calendar, e-sign, passwords, projects, and local AI on a device that draws as little as 10 watts and fits on a shelf. Buy it once, run it for years.
                </p>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Headline metrics */}
      <section className="relative border-t border-border bg-secondary/30">
        <div className="mx-auto max-w-7xl px-6 py-16 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {stats.map((s, index) => (
              <AnimatedSection key={s.label} delay={index * 80} className="text-center">
                <div className="text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">
                  <AnimatedCounter end={s.value} suffix={s.suffix} />
                </div>
                <div className="mt-2 text-xs sm:text-sm text-muted-foreground font-medium">
                  {s.label}
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Scene 2: the thirteen services launch out of the open device */}
      <CloudServicesReveal />

      {/* What it replaces — card grid */}
      <ThirteenServices />

      {/* Pillars */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">
              Why this works
            </p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Four things <GradientText as="span">make this different</GradientText>.
            </h2>
          </AnimatedSection>
          <div className="grid gap-6 md:grid-cols-2">
            {pillars.map((p, index) => (
              <AnimatedSection key={p.title} animation="fade-in" delay={index * 80}>
                <GlowCard className="h-full">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                    <p.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold text-foreground">{p.title}</h3>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{p.body}</p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Savings — interactive */}
      <InteractivePricingCalculator />

      {/* Proof: deployment #001 is Bestly itself */}
      <section className="border-t border-border bg-secondary/10">
        <div className="mx-auto max-w-5xl px-6 py-24 lg:px-8 lg:py-28">
          <AnimatedSection animation="fade-in" className="text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">
              Real deployment
            </p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Deployment #001: <GradientText as="span">us.</GradientText>
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Bestly runs on Bestly. The files, documents, calendars, and team
              calls behind this company live on the exact device on this page —
              sitting on a shelf in our office, not in anyone else's data
              center. We don't sell anything we don't run our own business on.
            </p>
            <div className="mx-auto mt-8 flex max-w-2xl flex-wrap items-center justify-center gap-2.5">
              {["Files & backups", "Documents", "Calendars", "Team calls & chat", "Local AI"].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-border bg-background/80 px-4 py-1.5 text-sm font-medium text-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-8 text-sm text-muted-foreground">
              Your business could be deployment #002.{" "}
              <Link to="/get-started" className="font-semibold text-primary underline-offset-4 hover:underline">
                Start the conversation
              </Link>
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Process */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">
              How we get there
            </p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Four steps. <GradientText as="span">No long contracts.</GradientText>
            </h2>
          </AnimatedSection>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {process.map((step, index) => (
              <AnimatedSection key={step.step} animation="fade-in" delay={index * 80}>
                <GlowCard className="h-full">
                  <div className="flex items-center justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                      <step.icon className="h-6 w-6 text-primary" />
                    </div>
                    <span className="text-xs font-mono font-semibold text-muted-foreground/60">{step.step}</span>
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{step.description}</p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Objections / FAQ */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center mb-16">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary mb-3">
              Reasonable concerns
            </p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              The four questions <GradientText as="span">everybody asks</GradientText>.
            </h2>
          </AnimatedSection>
          <div className="grid gap-6 md:grid-cols-2 max-w-5xl mx-auto">
            {objections.map((o, index) => (
              <AnimatedSection key={o.q} animation="fade-in" delay={index * 80}>
                <GlowCard className="h-full">
                  <h3 className="text-lg font-semibold text-foreground">{o.q}</h3>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{o.a}</p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Final scene: the device docks on your shelf + CTA */}
      <CloudDockCTA />
    </>
  );
}