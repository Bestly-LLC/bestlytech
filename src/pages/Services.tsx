import { Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Button } from "@/components/ui/button";
import {
  Code,
  TrendingUp,
  Bot,
  Palette,
  Package,
  Shield,
  Rocket,
  Store,
  ShoppingCart,
  Cpu,
  ArrowRight,
  Handshake,
} from "lucide-react";

const services = [
  {
    icon: Code,
    title: "Web & App Development",
    description:
      "Custom websites, web applications, and mobile apps built with modern technology stacks. From landing pages to full-featured platforms.",
  },
  {
    icon: TrendingUp,
    title: "Business Consulting",
    description:
      "Strategic guidance on operations, growth, and scaling your business. I help you identify opportunities and navigate challenges.",
  },
  {
    icon: Bot,
    title: "AI & Automation",
    description:
      "Implementing intelligent tools and automating workflows to increase efficiency. Save time and reduce manual work.",
  },
  {
    icon: Palette,
    title: "Marketing & Branding",
    description:
      "Digital marketing strategy, brand identity, and design services. Build a brand that resonates with your audience.",
  },
  {
    icon: Package,
    title: "Productization",
    description:
      "Transforming services or ideas into scalable products. I help you package expertise into offerings that grow with you.",
  },
  {
    icon: Shield,
    title: "Compliance Engineering",
    description:
      "Privacy-first architecture, legal compliance (GDPR, CCPA), and platform requirements. Launch with confidence.",
  },
];

const audiences = [
  {
    icon: Rocket,
    title: "Startups & Small Businesses",
    description: "From idea to launch and beyond",
  },
  {
    icon: Store,
    title: "Local Service Businesses",
    description: "Establish and grow your online presence",
  },
  {
    icon: ShoppingCart,
    title: "E-commerce & Retail",
    description: "Sell more, operate smarter",
  },
  {
    icon: Cpu,
    title: "Tech Companies",
    description: "Scale with confidence",
  },
];

export default function Services() {
  return (
    <Layout>
      <SEOHead
        title="Services | Jared Best - Business Development & Technology"
        description="Web development, business consulting, AI automation, and venture studio services. I partner with startups and small businesses to build, grow, and scale."
        path="/services"
      />

      {/* Hero Section */}
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection animation="fade-in" className="text-center max-w-3xl mx-auto">
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
              I'm Jared, and I help businesses build, grow, and scale.
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              I work with businesses at every stage—from local shops looking to establish their 
              online presence to tech startups ready to scale. My approach is collaborative: 
              I partner with you to build something that works, not just deliver and disappear.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
              <Button asChild size="lg">
                <Link to="/hire">
                  Work With Me
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/about">Learn More About Me</Link>
              </Button>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* Services Grid */}
      <section className="py-16 bg-muted/30">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection animation="fade-in" className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              What I Can Help You With
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              With over 5 years of professional experience, I bring a range of skills 
              to help you tackle challenges and seize opportunities.
            </p>
          </AnimatedSection>

          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {services.map((service, index) => (
              <AnimatedSection
                key={service.title}
                animation="fade-in"
                delay={index * 50}
              >
                <div className="h-full rounded-2xl border border-border bg-card p-6 transition-colors hover:bg-accent/50">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4">
                    <service.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {service.title}
                  </h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">
                    {service.description}
                  </p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Venture Studio / Partnership Section */}
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <AnimatedSection animation="fade-in">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-6">
                <Handshake className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight text-foreground">
                More Than Just a Service Provider
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                I don't just build things and walk away. My best work happens when I partner 
                with clients on a deeper level—whether that's an ongoing advisory relationship 
                or a revenue share partnership where we both have skin in the game.
              </p>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                I'm connected to a collaborative network of specialists, which means I can 
                bring in the right expertise when your project needs it—without you having 
                to manage multiple vendors.
              </p>
            </AnimatedSection>

            <AnimatedSection animation="fade-in" delay={100}>
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-semibold text-foreground mb-2">
                    Consulting & Advisory
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Strategic guidance on an ongoing basis. I become an extension of your team, 
                    helping you navigate decisions and solve problems as they arise.
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-card p-5">
                  <h3 className="font-semibold text-foreground mb-2">
                    Revenue Share Partnerships
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    For the right projects, I'm open to co-creating products where we share 
                    in the success. This aligns our incentives and means I'm invested in 
                    your long-term growth.
                  </p>
                </div>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* Who I Work With */}
      <section className="py-16 bg-muted/30">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection animation="fade-in" className="text-center mb-12">
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Who I Work With
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Whether you're just starting out or ready to scale, I tailor my approach 
              to meet you where you are.
            </p>
          </AnimatedSection>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {audiences.map((audience, index) => (
              <AnimatedSection
                key={audience.title}
                animation="fade-in"
                delay={index * 50}
              >
                <div className="text-center p-6">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4">
                    <audience.icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-1">
                    {audience.title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {audience.description}
                  </p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <AnimatedSection animation="fade-in">
            <div className="rounded-2xl border border-border bg-card p-8 md:p-12 text-center">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Ready to Work Together?
              </h2>
              <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
                Tell me about your project, and let's explore how I can help. 
                No commitment—just a conversation to see if we're a good fit.
              </p>
              <div className="mt-8">
                <Button asChild size="lg">
                  <Link to="/hire">
                    Start the Conversation
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </Layout>
  );
}
