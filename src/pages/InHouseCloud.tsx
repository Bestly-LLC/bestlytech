import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { GlowCard } from "@/components/ui/GlowCard";
import { GradientText } from "@/components/ui/GradientText";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { InteractivePricingCalculator } from "@/components/InteractivePricingCalculator";
import { CloudHeroSpectacle } from "@/components/cloud/CloudHeroSpectacle";
import { ScrollProgress } from "@/components/motion/ScrollProgress";
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
      <ScrollProgress />
      <SEOHead
        title="In-House Cloud — Stop overpaying for enterprise tools | Bestly"
        description="Built for small and medium businesses. One server in your office replaces Google Workspace, Zoom, Slack, Dropbox, DocuSign, 1Password, and your AI tool. No per-seat fees, no IT department. See what your business would save."
        path="/cloud"
      />

      {/* Hero — animated spectacle */}
      <CloudHeroSpectacle />

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

      {/* What it replaces */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center mb-16">
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Thirteen services. <GradientText as="span">One server.</GradientText>
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              Every tool your team uses — replaced by one private platform, branded to your company.
            </p>
          </AnimatedSection>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {replaces.map((r, index) => (
              <AnimatedSection key={r.title} animation="fade-in" delay={index * 40}>
                <GlowCard className="h-full">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                    <r.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-foreground">{r.title}</h3>
                  <p className="mt-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">{r.subtitle}</p>
                  <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{r.outcome}</p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

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

      {/* Final CTA */}
      <section className="relative border-t border-border overflow-hidden">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute inset-0 bg-mesh opacity-50" />
          <div className="absolute -left-20 top-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(var(--gradient-start)/0.22),transparent_70%)] blur-2xl cloud-aurora-a" />
          <div className="absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-[radial-gradient(circle,hsl(var(--gradient-end)/0.22),transparent_70%)] blur-2xl cloud-aurora-b" />
          <div className="absolute inset-x-0 top-0 h-px overflow-hidden">
            <div className="cloud-beam h-px w-1/3 bg-gradient-to-r from-transparent via-[hsl(var(--glow-color))] to-transparent" />
          </div>
        </div>
        <div className="relative mx-auto max-w-4xl px-6 py-24 lg:px-8 lg:py-32 text-center">
          <AnimatedSection animation="fade-in">
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Stop renting.{" "}
              <GradientText as="span">Start owning.</GradientText>
            </h2>
            <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
              Thirty minutes on a call, a side-by-side cost comparison, and zero pressure. Find out what your stack actually looks like when you bring it home.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/get-started"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift"
              >
                Get Started
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="mailto:jared@bestly.tech?subject=In-House%20Cloud%20Discovery%20Call"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-background/80 backdrop-blur-sm px-8 py-4 text-base font-medium text-foreground shadow-sm transition-all hover:bg-accent"
              >
                Email jared@bestly.tech
              </a>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}