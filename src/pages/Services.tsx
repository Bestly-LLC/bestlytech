import { Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { GlowCard } from "@/components/ui/GlowCard";
import { Button } from "@/components/ui/button";
import {
  Code, TrendingUp, Bot, Palette, Package, Shield,
  Rocket, Store, ShoppingCart, Cpu, ArrowRight, Handshake,
  ClipboardCheck, PhoneCall, FileText, Zap,
} from "lucide-react";

const services = [
  {
    icon: Code,
    title: "Web & App Development",
    description: "Custom websites, web apps, and mobile apps. From landing pages to full platforms.",
  },
  {
    icon: TrendingUp,
    title: "Business Consulting",
    description: "Strategic guidance on operations, growth, and scaling.",
  },
  {
    icon: Bot,
    title: "AI & Automation",
    description: "Intelligent tools and workflow automation to save time and cut manual work.",
  },
  {
    icon: Palette,
    title: "Marketing & Branding",
    description: "Digital marketing strategy, brand identity, and design that resonates.",
  },
  {
    icon: Package,
    title: "Productization",
    description: "Turn services or ideas into scalable products that grow.",
  },
  {
    icon: Shield,
    title: "Compliance Engineering",
    description: "Privacy-first architecture, GDPR/CCPA compliance. Launch with confidence.",
  },
];

const processSteps = [
  { icon: ClipboardCheck, step: "01", title: "Review", desc: "I review your project details and goals." },
  { icon: PhoneCall, step: "02", title: "Conversation", desc: "A quick call to align on scope and fit." },
  { icon: FileText, step: "03", title: "Proposal", desc: "A clear plan with timeline and investment." },
  { icon: Zap, step: "04", title: "Build", desc: "Execution with regular check-ins and transparency." },
];

const audiences = [
  { icon: Rocket, title: "Startups", description: "From idea to launch and beyond" },
  { icon: Store, title: "Local Businesses", description: "Establish and grow online" },
  { icon: ShoppingCart, title: "E-commerce", description: "Sell more, operate smarter" },
  { icon: Cpu, title: "Tech Companies", description: "Scale with confidence" },
];

export default function Services() {
  return (
    <Layout>
      <SEOHead
        title="Services | Jared Best - Business Development & Technology"
        description="Web development, business consulting, AI automation, and venture studio services."
        path="/services"
      />

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh opacity-50" />
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              How I Can Help
            </h1>
            <p className="mt-6 text-xl text-muted-foreground leading-relaxed">
              From local shops to tech startups — I partner with you to build something that works.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/hire"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift"
              >
                Work With Me
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to="/about"
                className="inline-flex items-center justify-center rounded-xl border border-border bg-background/80 backdrop-blur-sm px-8 py-4 text-base font-medium text-foreground shadow-sm transition-all hover:bg-accent"
              >
                Learn More About Me
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Services Grid */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Services
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              5+ years of experience across development, strategy, and growth.
            </p>
          </AnimatedSection>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {services.map((service, index) => (
              <AnimatedSection key={service.title} animation="fade-in" delay={index * 60}>
                <GlowCard className="h-full">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)]">
                    <service.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-foreground">{service.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{service.description}</p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              The Process
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Simple, transparent, no surprises.
            </p>
          </AnimatedSection>

          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4 max-w-5xl mx-auto">
            {processSteps.map((s, i) => (
              <AnimatedSection key={s.step} delay={i * 100}>
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)] mb-4">
                    <s.icon className="h-7 w-7 text-primary" />
                  </div>
                  <div className="text-xs font-semibold text-primary mb-2">{s.step}</div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">{s.title}</h3>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Partnership */}
      <section className="border-t border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <AnimatedSection animation="fade-in">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)] mb-6">
                <Handshake className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground">
                More Than a Service Provider
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                My best work happens when I partner with clients on a deeper level — ongoing advisory or revenue share where we both have skin in the game.
              </p>
            </AnimatedSection>

            <AnimatedSection animation="fade-in" delay={100}>
              <div className="space-y-4">
                <GlowCard>
                  <h3 className="font-semibold text-foreground mb-2">Consulting & Advisory</h3>
                  <p className="text-sm text-muted-foreground">
                    Strategic guidance on an ongoing basis. I become an extension of your team.
                  </p>
                </GlowCard>
                <GlowCard>
                  <h3 className="font-semibold text-foreground mb-2">Revenue Share Partnerships</h3>
                  <p className="text-sm text-muted-foreground">
                    For the right projects, I co-create products where we share in the success.
                  </p>
                </GlowCard>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Who I Work With */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection animation="fade-in" className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Who I Work With
            </h2>
          </AnimatedSection>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 max-w-4xl mx-auto">
            {audiences.map((audience, index) => (
              <AnimatedSection key={audience.title} animation="fade-in" delay={index * 60}>
                <div className="text-center p-6 rounded-2xl border border-border bg-card transition-all hover:shadow-premium hover:-translate-y-1">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(var(--gradient-start)/0.1)] to-[hsl(var(--gradient-end)/0.1)] mb-4">
                    <audience.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">{audience.title}</h3>
                  <p className="text-sm text-muted-foreground">{audience.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-secondary/20">
        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <div className="absolute inset-0 bg-mesh opacity-30" />
          <AnimatedSection animation="fade-in" className="relative text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Ready to Work Together?
            </h2>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              No commitment — just a conversation to see if we're a good fit.
            </p>
            <div className="mt-10">
              <Link
                to="/hire"
                className="group inline-flex items-center justify-center rounded-xl gradient-bg px-8 py-4 text-base font-medium text-white shadow-lg shadow-primary/20 btn-lift"
              >
                Start the Conversation
                <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </Layout>
  );
}
