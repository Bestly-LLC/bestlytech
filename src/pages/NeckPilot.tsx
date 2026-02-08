import { Layout } from "@/components/layout/Layout";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { WaitlistForm } from "@/components/WaitlistForm";
import { GlowCard } from "@/components/ui/GlowCard";
import { GradientText } from "@/components/ui/GradientText";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import neckpilotIcon from "@/assets/neckpilot-icon.png";
import {
  Navigation,
  Headphones,
  Activity,
  Bell,
  Timer,
  ShieldCheck,
  Smartphone,
  Monitor,
  Users,
  GraduationCap,
  Wifi,
} from "lucide-react";

const features = [
  {
    icon: Headphones,
    title: "AirPods-Based Tracking",
    description:
      "Uses AirPods motion data for higher-fidelity head and neck angle detection — tracking posture where it actually matters.",
  },
  {
    icon: Smartphone,
    title: "Phone-Based Fallback",
    description:
      "Works without AirPods using iPhone motion sensors. Lower precision, but always available for every session.",
  },
  {
    icon: Activity,
    title: "Live Activities",
    description:
      "View your current posture state at a glance. Persistent, real-time feedback without opening the app.",
  },
  {
    icon: Bell,
    title: '"Flying Too Long" Alerts',
    description:
      "Time-aware alerts when you've held a strained posture for too long. Gentle nudges, not constant interruptions.",
  },
  {
    icon: Timer,
    title: "Session Monitoring",
    description:
      'Start and stop posture "flights" during work, study, or focus time. Track your awareness over time.',
  },
  {
    icon: ShieldCheck,
    title: "Privacy-First Design",
    description:
      "No cameras. No recordings. No biometric identity storage. Your posture data stays on your device.",
  },
];

const steps = [
  {
    number: "01",
    label: "Connect",
    title: "Pair AirPods",
    description:
      "Connect your AirPods for high-fidelity tracking, or use iPhone sensors as a fallback.",
    icon: Headphones,
  },
  {
    number: "02",
    label: "Launch",
    title: "Start a Flight",
    description:
      'Begin a posture session. NeckPilot runs quietly, surfacing awareness through Live Activities.',
    icon: Navigation,
  },
  {
    number: "03",
    label: "Adjust",
    title: "Monitor & Correct",
    description:
      "Receive gentle alerts when you've been cruising in strain too long. Reset earlier, feel better.",
    icon: Activity,
  },
];

const audience = [
  { icon: Monitor, label: "Desk workers & remote professionals" },
  { icon: GraduationCap, label: "Students & creators" },
  { icon: Headphones, label: "AirPods users seeking passive awareness" },
  { icon: Users, label: "Anyone with screen-related neck fatigue" },
];

// Soft blue palette for NeckPilot
const nb = {
  bg: "hsl(210 40% 96%)",
  bgAlt: "hsl(210 35% 98%)",
  accent: "hsl(210 55% 50%)",
  accentSoft: "hsl(210 45% 92%)",
  accentDark: "hsl(210 55% 30%)",
  accentMid: "hsl(210 45% 60%)",
  ring: "hsl(210 40% 80%)",
};

const NeckPilot = () => {
  return (
    <Layout>
      <SEOHead
        title="NeckPilot — Posture Awareness Powered by AirPods | Bestly LLC"
        description="NeckPilot uses AirPods motion sensors for real-time head and neck posture tracking. Live Activities, gentle alerts, and privacy-first design. Coming soon from Bestly."
      />

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${nb.bg}, ${nb.bgAlt}, hsl(210 30% 97%))` }} />
        <div className="absolute inset-0 bg-grid opacity-20" />

        <div className="relative mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-36">
          <AnimatedSection animation="fade-in-up" className="mx-auto max-w-3xl text-center">
            <img
              src={neckpilotIcon}
              alt="NeckPilot app icon"
              className="mx-auto mb-8 h-24 w-24 rounded-[22px] shadow-lg"
            />
            <div
              className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium ring-1"
              style={{ color: nb.accent, borderColor: nb.ring, backgroundColor: nb.accentSoft }}
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: nb.accent }} />
                <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: nb.accent }} />
              </span>
              Coming Soon
            </div>

            <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl" style={{ color: nb.accentDark }}>
              Fly Aware.{" "}
              <GradientText>Adjust Early.</GradientText>
            </h1>

            <p className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-xl mx-auto">
              Posture awareness powered by AirPods. Real-time feedback, Live Activities, and gentle alerts when you've been flying too long.
            </p>

            <div className="mt-8 flex items-center justify-center gap-2">
              <Navigation className="h-5 w-5" style={{ color: nb.accent }} />
              <span className="text-sm font-medium" style={{ color: nb.accent }}>
                iOS App
              </span>
            </div>

            <WaitlistForm
              productId="neckpilot"
              productName="NeckPilot"
              className="mt-10 max-w-md mx-auto"
              buttonText="Join the Waitlist"
            />
          </AnimatedSection>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              How It Works
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Three steps to your first flight.
            </p>
          </AnimatedSection>

          <div className="grid gap-8 sm:grid-cols-3 max-w-4xl mx-auto">
            {steps.map((step, i) => (
              <AnimatedSection key={step.number} delay={i * 100}>
                <div className="relative text-center p-8 rounded-2xl border border-border bg-card transition-all hover:shadow-lg">
                  <span
                    className="block text-4xl font-bold mb-4 tracking-tighter"
                    style={{ color: nb.accentMid }}
                  >
                    {step.number}
                  </span>
                  <div
                    className="inline-flex items-center justify-center w-12 h-12 rounded-xl mb-4"
                    style={{ backgroundColor: nb.accentSoft }}
                  >
                    <step.icon className="h-6 w-6" style={{ color: nb.accent }} />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">{step.title}</h3>
                  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Key Features ── */}
      <section className="border-t border-border" style={{ backgroundColor: nb.bg }}>
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Key Features
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Sensor-driven awareness, designed for your daily cruising altitude.
            </p>
          </AnimatedSection>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <AnimatedSection key={f.title} delay={i * 80}>
                <GlowCard className="h-full">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-xl mb-5"
                    style={{ backgroundColor: nb.accentSoft }}
                  >
                    <f.icon className="h-5 w-5" style={{ color: nb.accent }} />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {f.description}
                  </p>
                </GlowCard>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Who It's For ── */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="text-center mb-16">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Who It's For
            </h2>
          </AnimatedSection>

          <div className="grid gap-4 sm:grid-cols-2 max-w-3xl mx-auto">
            {audience.map((a, i) => (
              <AnimatedSection key={a.label} delay={i * 80}>
                <div className="flex items-center gap-4 p-5 rounded-xl bg-card border border-border transition-all hover:shadow-md">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: nb.accentSoft }}
                  >
                    <a.icon className="h-5 w-5" style={{ color: nb.accent }} />
                  </div>
                  <span className="text-foreground font-medium">{a.label}</span>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Privacy Callout ── */}
      <section className="border-t border-border" style={{ backgroundColor: nb.bg }}>
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-3xl text-center">
            <div
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-6"
              style={{ backgroundColor: nb.accentSoft }}
            >
              <ShieldCheck className="h-7 w-7" style={{ color: nb.accent }} />
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Your Posture, Your Data
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
              NeckPilot uses only motion sensor data from AirPods or your iPhone.
              No cameras. No recordings. No biometric identity storage.
              Everything stays on your device.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {["No Cameras", "No Recordings", "No Biometric Storage"].map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                  className="text-sm px-4 py-1.5"
                  style={{ borderColor: nb.ring, color: nb.accent }}
                >
                  {t}
                </Badge>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── CTA Footer ── */}
      <section className="border-t border-border">
        <div className="mx-auto max-w-7xl px-6 py-24 lg:px-8 lg:py-32">
          <AnimatedSection className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Start your first flight.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Be the first to know when NeckPilot is ready for takeoff.
            </p>

            <WaitlistForm
              productId="neckpilot"
              productName="NeckPilot"
              className="mt-10 max-w-md mx-auto"
              buttonText="Join the Waitlist"
            />

            <div className="mt-8">
              <Button variant="outline" size="lg" asChild>
                <Link to="/products">View All Products</Link>
              </Button>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Legal Notice ── */}
      <section className="py-12 border-t border-border">
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm text-muted-foreground">
              NeckPilot is a product of Bestly LLC. This product is not a
              medical device and is not intended to diagnose, treat, cure, or
              prevent any condition. All products are subject to our{" "}
              <Link
                to="/terms-of-service"
                className="underline hover:text-foreground"
              >
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link
                to="/privacy-policy"
                className="underline hover:text-foreground"
              >
                Privacy Policy
              </Link>
              .
            </p>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default NeckPilot;
