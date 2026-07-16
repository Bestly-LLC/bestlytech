import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { useState, useEffect, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import cyPanelInsights from "@/assets/cy-panel-insights-real.png";
import cyPanelControl from "@/assets/cy-panel-control-real.png";
import {
  Download,
  Settings,
  Globe,
  Shield,
  Zap,
  BarChart3,
  Eye,
  EyeOff,
  Chrome,
  CheckCircle2,
  Clock,
  Infinity,
  Headphones,
  Mail,
  AlertTriangle,
  Activity,
  TrendingUp,
  Database,
  Wifi,
  WifiOff,
  X,
  ArrowRight,
  Sparkles,
  Lock,
  RefreshCw,
  ShieldCheck,
  Apple,
  Ban,
  Star,
  Cookie,
  MousePointerClick,
} from "lucide-react";

// ============================================
// EDITABLE CONFIGURATION
// ============================================
const CONFIG = {
  version: "1.0.9",
  pricing: {
    free: "Free",
    monthly: "$0.99",
    yearly: "$7.99",
  },
  platforms: [
    { name: "Chrome", available: true, icon: Chrome },
    { name: "iPhone & iPad", available: true, icon: Globe },
    { name: "Mac", available: false, icon: Globe },
  ],
  links: {
    chrome: "https://chromewebstore.google.com/detail/cookie-yeti/gjlefkpmampiooonpcfeibchdhemddfc",
    safari: "https://apps.apple.com/us/app/cookie-yeti/id6759732250",
  },
  features: [
    {
      icon: Shield,
      title: "It actually says no",
      description: "Most cookie blockers just hide the pop-up — some even click 'Accept all' to make it vanish, which is the opposite of privacy. Cookie Yeti clicks 'Reject' for real, so websites can't follow you around.",
    },
    {
      icon: Zap,
      title: "It never goes stale",
      description: "Other cookie blockers slowly stop working — the maker moves on and the tool quietly rots. Cookie Yeti keeps learning. When a pop-up is tricky, our AI figures out how to close it, and that fix instantly reaches everyone using Cookie Yeti. It keeps getting smarter on its own, with nothing for you to update.",
    },
    {
      icon: CheckCircle2,
      title: "It won't break your sites",
      description: "Broken pages are the number-one gripe about every cookie blocker — dead scrollbars, endless login loops. Cookie Yeti has a built-in safety brake: if a site starts acting up, it backs off before anything breaks. Your favorite sites keep working like normal.",
    },
    {
      icon: Eye,
      title: "Pop-ups vanish automatically",
      description: "Cookie Yeti spots the 'We use cookies' box the moment a page loads and closes it for you. You don't click a thing.",
    },
    {
      icon: EyeOff,
      title: "It runs in the background",
      description: "No pop-ups from us, either. Cookie Yeti works quietly while you browse and won't slow you down.",
    },
    {
      icon: BarChart3,
      title: "See what it's done",
      description: "Watch how many cookie pop-ups Cookie Yeti has handled for you.",
    },
  ],
  faqs: [
    {
      question: "Does Cookie Yeti collect my data?",
      answer: "We never sell your data, show you ads, or build a profile about you, and we never share your browsing history or the pages you visit. The only things that ever leave your device are anonymous, non-personal usage stats tied to a random ID, and — when a cookie wall is especially tricky — just that site's domain (like example.com) so our AI can learn to handle it for everyone. Never the full URL, never your personal data, never the raw content of the pages you visit. Your settings stay on your device.",
    },
    {
      question: "Will this break websites?",
      answer: "Cookie Yeti is designed to handle cookie consent banners without affecting website functionality. In rare cases where a site behaves unexpectedly, you can whitelist it or report the issue to our team.",
    },
    {
      question: "Can I whitelist specific sites?",
      answer: "Yes. Cookie Yeti allows you to exclude specific websites from automatic handling, giving you full control over where it operates.",
    },
    {
      question: "Does it work on mobile?",
      answer: "Yes! Cookie Yeti is available on Safari for iPhone and iPad. Download it from the App Store and enable it in Settings → Safari → Extensions.",
    },
    {
      question: "How much does Cookie Yeti cost?",
      answer: "Cookie Yeti offers a free tier (5 banner handles/day), Monthly at $0.99/mo, and Yearly at $7.99/yr (save 33%). Prices may vary by platform and region.",
    },
    {
      question: "What cookie preferences can I set?",
      answer: "You can configure Cookie Yeti to accept only essential cookies, reject all optional cookies, or accept all cookies. Your preference is applied automatically to every site you visit.",
    },
  ],
  stats: {
    today: 12,
    week: 87,
    allTime: 1234,
  },
};

type CheckoutPlan = "monthly" | "yearly";

// Shared store CTA cluster — reused in the hero, the "get it" band, and the
// closing CTA. Keeps every link/target identical across the page.
function StoreCTAs({ center = false }: { center?: boolean }) {
  return (
    <div
      className={`flex flex-col sm:flex-row gap-3 ${
        center ? "items-stretch sm:items-center sm:justify-center" : "items-stretch sm:items-center"
      }`}
    >
      <a
        href={CONFIG.links.chrome}
        target="_blank"
        rel="noopener noreferrer"
        className="group inline-flex items-center justify-center gap-2 rounded-full px-7 py-4 text-base font-bold text-white cy-glow-teal transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[hsl(var(--cy-teal)/0.4)]"
        style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--cy-teal)), hsl(var(--cy-teal-deep)))" }}
      >
        <Chrome className="h-5 w-5" />
        Add to Chrome
        <ArrowRight className="h-4 w-4 -ml-2 opacity-0 transition-all duration-200 group-hover:ml-0 group-hover:opacity-100" />
      </a>
      <a
        href={CONFIG.links.safari}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2 rounded-full border-2 border-[hsl(var(--cy-ink)/0.12)] bg-white px-7 py-4 text-base font-bold text-[hsl(var(--cy-ink))] transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] hover:border-[hsl(var(--cy-teal)/0.5)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[hsl(var(--cy-teal)/0.3)]"
      >
        <Apple className="h-5 w-5" />
        Get it on iPhone &amp; iPad
      </a>
      <div className="inline-flex items-center justify-center gap-2 rounded-full border border-dashed border-[hsl(var(--cy-ink)/0.2)] px-5 py-3 text-sm font-semibold text-[hsl(var(--cy-ink)/0.55)]">
        <Globe className="h-4 w-4" />
        Mac
        <span className="text-[hsl(var(--cy-ink)/0.4)]">· Coming soon</span>
      </div>
    </div>
  );
}

// Section eyebrow label — small caps kicker used above section headings.
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--cy-teal)/0.25)] bg-[hsl(var(--cy-mint))] px-3.5 py-1.5 text-xs font-extrabold uppercase tracking-[0.12em] text-[hsl(var(--cy-teal-deep))]">
      {children}
    </span>
  );
}

export default function CookieYeti() {
  const { toast } = useToast();
  const [serviceStatus, setServiceStatus] = useState<'operational' | 'degraded' | 'down' | 'checking'>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [liveStats, setLiveStats] = useState<{
    total_patterns: number;
    total_domains: number;
    high_confidence: number;
    avg_confidence: number;
    overall_success_rate: number;
    patterns_last_24h: number;
    new_domains_last_7d: number;
  } | null>(null);

  // CY-01: checkout dialog state. Click a pricing button -> opens dialog ->
  // user enters email -> POST to create-checkout edge function -> redirect
  // to Stripe's hosted checkout URL.
  const [checkoutPlan, setCheckoutPlan] = useState<CheckoutPlan | null>(null);
  const [checkoutEmail, setCheckoutEmail] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const planLabels: Record<CheckoutPlan, { title: string; price: string; cadence: string }> = {
    monthly: { title: "Monthly", price: CONFIG.pricing.monthly, cadence: "/month" },
    yearly: { title: "Yearly", price: CONFIG.pricing.yearly, cadence: "/year" },
  };

  const openCheckout = (plan: CheckoutPlan) => {
    setCheckoutPlan(plan);
    setCheckoutEmail("");
  };

  const submitCheckout = async () => {
    if (!checkoutPlan) return;
    const email = checkoutEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      toast({ title: "Enter a valid email", variant: "destructive" });
      return;
    }
    setCheckoutLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-checkout", {
        body: { email, plan: checkoutPlan },
      });
      if (error) throw error;
      const url = (data as { url?: string } | null)?.url;
      if (!url) throw new Error("No checkout URL returned");
      // Hand off to Stripe's hosted checkout.
      window.location.href = url;
    } catch (err) {
      console.error("create-checkout failed:", err);
      const msg = err instanceof Error ? err.message : "Checkout failed. Please try again.";
      toast({
        title: "Couldn't start checkout",
        description: msg.includes("Forbidden")
          ? "Request blocked. Please refresh and try again."
          : msg,
        variant: "destructive",
      });
      setCheckoutLoading(false);
    }
  };

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const start = Date.now();
        const { data, error } = await supabase
          .from('cookie_patterns')
          .select('id', { count: 'exact', head: true });
        const latency = Date.now() - start;
        setServiceStatus(error ? 'degraded' : latency > 5000 ? 'degraded' : 'operational');
        setLastChecked(new Date());
      } catch {
        setServiceStatus('down');
        setLastChecked(new Date());
      }
    };

    const fetchStats = async () => {
      const { data } = await supabase.rpc('get_community_overview');
      if (data) setLiveStats(data as any);
    };

    checkStatus();
    fetchStats();
    const interval = setInterval(() => { checkStatus(); fetchStats(); }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="cy-page">
      <SEOHead
        title="Cookie Yeti – Automatic Cookie Consent Handler | Bestly LLC"
        description="Cookie Yeti closes annoying cookie pop-ups for you — automatically — and always picks the private choice. Now on Chrome, iPhone & iPad. No ads, no profiles, and we never share the pages you visit."
      />

      {/* ── Hero ── signature animated demo, not centered-text-on-gradient */}
      <section className="relative overflow-hidden cy-mesh">
        {/* soft top hairline of teal */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--cy-teal)/0.4)] to-transparent" />
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-8 lg:py-24">
          {/* Left — copy */}
          <div className="max-w-xl">
            <AnimatedSection>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--cy-teal)/0.3)] bg-white/70 px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.12em] text-[hsl(var(--cy-teal-deep))] backdrop-blur">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Privacy-first · v{CONFIG.version}
                </span>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={60}>
              <h1 className="mt-6 text-[clamp(2.75rem,6vw,4.5rem)] font-semibold leading-[0.98] tracking-tight text-[hsl(var(--cy-ink))]">
                Cookie pop-ups?{" "}
                <span className="relative whitespace-nowrap text-[hsl(var(--cy-teal-deep))]">
                  Gone.
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 200 20"
                    className="absolute -bottom-2 left-0 h-3 w-full text-[hsl(var(--cy-green))]"
                    preserveAspectRatio="none"
                  >
                    <path d="M2 12 C 50 4, 150 4, 198 10" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                </span>
              </h1>
              <p className="mt-5 text-xl font-bold text-[hsl(var(--cy-teal-deep))]">
                Now on Chrome, iPhone &amp; iPad
              </p>
            </AnimatedSection>

            <AnimatedSection delay={140}>
              <p className="mt-5 text-lg leading-relaxed text-[hsl(var(--cy-ink-2))]">
                Every website hits you with an annoying &ldquo;We use cookies&rdquo; box. Cookie Yeti closes them for you &mdash; automatically &mdash; and always picks the private choice. You just browse.
              </p>
            </AnimatedSection>

            <AnimatedSection delay={220}>
              <div className="mt-9">
                <StoreCTAs />
              </div>
              <p className="mt-5 text-sm font-semibold text-[hsl(var(--cy-ink-2))]">
                Free on Chrome, iPhone &amp; iPad · Mac coming soon
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[hsl(var(--cy-ink-2))]">
                <span className="inline-flex items-center gap-1.5">
                  <Shield className="h-4 w-4 text-[hsl(var(--cy-teal))]" />
                  No ads
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Lock className="h-4 w-4 text-[hsl(var(--cy-teal))]" />
                  Never sold or shared
                </span>
                <Link
                  to="/privacy"
                  className="inline-flex items-center gap-1 font-semibold text-[hsl(var(--cy-teal-deep))] underline underline-offset-4 hover:text-[hsl(var(--cy-ink))] transition-colors"
                >
                  Privacy Policy
                </Link>
              </div>
            </AnimatedSection>
          </div>

          {/* Right — the live demo: a cookie banner getting rejected + swept away */}
          <AnimatedSection delay={120} animation="scale-in">
            <div className="relative mx-auto w-full max-w-[520px]">
              {/* glow puddle */}
              <div className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-[hsl(var(--cy-teal)/0.12)] blur-2xl" />

              {/* mock browser */}
              <div className="relative overflow-hidden rounded-2xl border border-[hsl(var(--cy-line))] bg-white cy-card-shadow-lg">
                {/* chrome bar */}
                <div className="flex items-center gap-2 border-b border-[hsl(var(--cy-line))] bg-[hsl(var(--cy-mint))] px-4 py-3">
                  <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                  <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                  <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                  <div className="ml-3 flex flex-1 items-center gap-2 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-[hsl(var(--cy-ink-2))] shadow-inner">
                    <Lock className="h-3 w-3 text-[hsl(var(--cy-teal))]" />
                    example.com
                  </div>
                </div>

                {/* faux page + banner stage */}
                <div className="relative h-[320px] overflow-hidden bg-white p-5">
                  {/* skeleton content */}
                  <div className="space-y-3" aria-hidden="true">
                    <div className="h-6 w-2/3 rounded-md bg-[hsl(var(--cy-ink)/0.08)]" />
                    <div className="h-3 w-full rounded bg-[hsl(var(--cy-ink)/0.06)]" />
                    <div className="h-3 w-11/12 rounded bg-[hsl(var(--cy-ink)/0.06)]" />
                    <div className="h-3 w-4/5 rounded bg-[hsl(var(--cy-ink)/0.06)]" />
                    <div className="mt-5 grid grid-cols-3 gap-3">
                      <div className="h-16 rounded-xl bg-[hsl(var(--cy-ink)/0.05)]" />
                      <div className="h-16 rounded-xl bg-[hsl(var(--cy-ink)/0.05)]" />
                      <div className="h-16 rounded-xl bg-[hsl(var(--cy-ink)/0.05)]" />
                    </div>
                  </div>

                  {/* cyan zap flash */}
                  <div className="cy-zap-anim pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_80%,hsl(var(--cy-cyan)/0.35),transparent_60%)]" />

                  {/* the cookie consent banner */}
                  <div className="cy-banner-anim absolute inset-x-4 bottom-4">
                    <div className="relative rounded-xl border border-[hsl(var(--cy-line))] bg-white p-4 shadow-[0_10px_30px_-10px_rgba(11,21,38,0.35)]">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--cy-cream))] text-[#b8862f]">
                          <Cookie className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-[hsl(var(--cy-ink))]">We value your privacy</p>
                          <p className="mt-0.5 text-xs leading-snug text-[hsl(var(--cy-ink-2))]">
                            We use cookies to personalize content and analyze traffic.
                          </p>
                          <div className="mt-3 flex gap-2">
                            <span className="rounded-md bg-[hsl(var(--cy-ink)/0.06)] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--cy-ink-2))]">
                              Accept all
                            </span>
                            <span className="rounded-md border border-[hsl(var(--cy-green)/0.5)] bg-[hsl(var(--cy-green)/0.1)] px-3 py-1.5 text-xs font-bold text-[hsl(var(--cy-green))]">
                              Reject
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* the green REJECTED stamp */}
                    <div className="cy-stamp-anim pointer-events-none absolute -right-2 top-1/2 -translate-y-1/2">
                      <div className="flex items-center gap-1.5 rounded-lg border-[3px] border-[hsl(var(--cy-green))] bg-white/85 px-3 py-1.5 text-sm font-black uppercase tracking-wider text-[hsl(var(--cy-green))] shadow-lg backdrop-blur">
                        <Ban className="h-4 w-4" strokeWidth={3} />
                        Rejected
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* the Yeti, doing the swatting */}
              <div className="cy-float absolute -bottom-6 -left-8 z-10 hidden sm:block">
                <div className="relative">
                  <img
                    src={cookieYetiIcon}
                    alt="The Cookie Yeti mascot"
                    className="h-24 w-24 rounded-2xl border border-[hsl(var(--cy-line))] shadow-xl"
                  />
                  <div className="cy-eye-glow pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_0_0_20px_hsl(var(--cy-cyan)/0.5)]" />
                </div>
              </div>

              {/* floating live stat chip */}
              <div className="cy-float-soft absolute -right-3 -top-4 z-10 hidden rounded-2xl border border-[hsl(var(--cy-line))] bg-white px-4 py-3 cy-card-shadow sm:block">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--cy-green)/0.14)] text-[hsl(var(--cy-green))]">
                    <CheckCircle2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-lg font-black leading-none text-[hsl(var(--cy-ink))]">1,284</p>
                    <p className="text-[11px] font-semibold text-[hsl(var(--cy-ink-2))]">banners zapped</p>
                  </div>
                </div>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Trust / social-proof band ── */}
      <section className="cy-ink-mesh text-white">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 py-7 lg:flex-row lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {CONFIG.platforms.map((platform) => (
              <div
                key={platform.name}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-sm font-semibold text-white/90 backdrop-blur"
              >
                <platform.icon className="h-4 w-4 text-[hsl(var(--cy-cyan))]" />
                {platform.name}
                {platform.available ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--cy-green)/0.2)] px-2 py-0.5 text-[11px] font-bold text-[hsl(var(--cy-green))]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--cy-green))]" />
                    Live
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-bold text-amber-300">
                    Soon
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-white/85">
            <span className="inline-flex items-center gap-1.5">
              <Star className="h-4 w-4 text-[hsl(var(--cy-cyan))]" fill="currentColor" />
              The most private choice
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Lock className="h-4 w-4 text-[hsl(var(--cy-cyan))]" />
              Never sold or shared
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-[hsl(var(--cy-cyan))]" />
              Community-powered
            </span>
          </div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <AnimatedSection>
            <div className="max-w-2xl">
              <Eyebrow>
                <MousePointerClick className="h-3.5 w-3.5" />
                Three steps, zero clicks
              </Eyebrow>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-[hsl(var(--cy-ink))]">
                How It Works
              </h2>
              <p className="mt-4 text-lg text-[hsl(var(--cy-ink-2))]">
                You don&apos;t have to click &ldquo;Accept&rdquo; anymore. Cookie Yeti makes the pop-up disappear the second it shows up &mdash; and tells the website &ldquo;no thanks&rdquo; to tracking you.
              </p>
            </div>
          </AnimatedSection>

          <div className="relative mt-14 grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* connecting rail (desktop) */}
            <div className="pointer-events-none absolute left-0 right-0 top-[38px] hidden h-px bg-gradient-to-r from-[hsl(var(--cy-teal)/0.4)] via-[hsl(var(--cy-teal)/0.4)] to-transparent md:block" />
            {[
              {
                step: 1,
                icon: Download,
                title: "Add Cookie Yeti",
                description: "Get it on Chrome, or on your iPhone and iPad. Takes about ten seconds.",
              },
              {
                step: 2,
                icon: Settings,
                title: "Browse like you always do",
                description: "Keep doing your thing. Cookie Yeti runs quietly in the background.",
              },
              {
                step: 3,
                icon: Globe,
                title: "Pop-ups quietly disappear",
                description: "Rejected, not accepted. That's it. No setup, no accounts to figure out, nothing to babysit.",
              },
            ].map((item, index) => (
              <AnimatedSection key={item.step} delay={index * 90}>
                <div className="relative h-full rounded-2xl border border-[hsl(var(--cy-line))] bg-[hsl(var(--cy-cream))] p-6 transition-all duration-300 hover:-translate-y-1 hover:cy-card-shadow">
                  <div className="flex items-center gap-4">
                    <div className="relative flex h-[76px] w-[76px] shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-[hsl(var(--cy-line))]">
                      <item.icon className="h-8 w-8 text-[hsl(var(--cy-teal-deep))]" />
                      <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-[hsl(var(--cy-teal-deep))] text-sm font-black text-white shadow">
                        {item.step}
                      </span>
                    </div>
                  </div>
                  <h3 className="mt-5 text-xl font-semibold text-[hsl(var(--cy-ink))]">{item.title}</h3>
                  <p className="mt-2 leading-relaxed text-[hsl(var(--cy-ink-2))]">{item.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why Cookie Yeti — bento feature grid ── */}
      <section className="bg-[hsl(var(--cy-mint))]">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <AnimatedSection>
            <div className="max-w-2xl">
              <Eyebrow>
                <Sparkles className="h-3.5 w-3.5" />
                Simple on the surface, smart underneath
              </Eyebrow>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-[hsl(var(--cy-ink))]">
                Why Cookie Yeti?
              </h2>
            </div>
          </AnimatedSection>

          <div className="mt-12 grid auto-rows-fr grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {CONFIG.features.map((feature, index) => {
              const isHero = index === 0;
              const isWide = index === 5;
              return (
                <AnimatedSection
                  key={feature.title}
                  delay={index * 70}
                  className={`${isHero ? "md:col-span-2 lg:col-span-2" : ""} ${isWide ? "md:col-span-2 lg:col-span-1" : ""}`}
                >
                  {isHero ? (
                    <div className="relative h-full overflow-hidden rounded-3xl cy-ink-mesh p-8 text-white cy-card-shadow-lg">
                      <div className="relative z-10 flex h-full flex-col">
                        <div className="flex items-center gap-3">
                          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-[hsl(var(--cy-cyan))] ring-1 ring-white/15">
                            <feature.icon className="h-6 w-6" />
                          </span>
                          <span className="rounded-full bg-[hsl(var(--cy-green)/0.2)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[hsl(var(--cy-green))]">
                            The big one
                          </span>
                        </div>
                        <h3 className="mt-6 text-2xl font-semibold text-white sm:text-3xl">{feature.title}</h3>
                        <p className="mt-3 max-w-xl leading-relaxed text-white/80">{feature.description}</p>
                      </div>
                      <img
                        src={cookieYetiIcon}
                        alt=""
                        aria-hidden="true"
                        className="cy-float pointer-events-none absolute -bottom-6 -right-6 h-40 w-40 rounded-3xl opacity-90"
                      />
                    </div>
                  ) : (
                    <div className="group h-full rounded-3xl border border-[hsl(var(--cy-line))] bg-white p-7 transition-all duration-300 hover:-translate-y-1 hover:cy-card-shadow">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--cy-mint))] text-[hsl(var(--cy-teal-deep))] ring-1 ring-[hsl(var(--cy-teal)/0.2)] transition-transform duration-300 group-hover:scale-110">
                        <feature.icon className="h-6 w-6" />
                      </span>
                      <h3 className="mt-5 text-lg font-semibold text-[hsl(var(--cy-ink))]">{feature.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-[hsl(var(--cy-ink-2))]">{feature.description}</p>
                    </div>
                  )}
                </AnimatedSection>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Them vs Us — the contrast moment ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-5xl px-6 py-20 lg:px-8 lg:py-28">
          <AnimatedSection>
            <div className="mx-auto max-w-2xl text-center">
              <Eyebrow>
                <Ban className="h-3.5 w-3.5" />
                Same pop-ups, different playbook
              </Eyebrow>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-[hsl(var(--cy-ink))]">
                Why Cookie Yeti vs. other cookie blockers
              </h2>
              <p className="mt-4 text-lg text-[hsl(var(--cy-ink-2))]">
                Same annoying pop-ups. A very different way of dealing with them.
              </p>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={100}>
            <div className="mt-12 overflow-hidden rounded-3xl border border-[hsl(var(--cy-line))] bg-white cy-card-shadow">
              {/* column headers */}
              <div className="grid grid-cols-1 md:grid-cols-2">
                <div className="flex items-center gap-2 border-b border-[hsl(var(--cy-line))] px-6 py-4 text-sm font-bold uppercase tracking-wider text-[hsl(var(--cy-ink-2))]">
                  <X className="h-4 w-4 text-red-400" strokeWidth={3} />
                  Other cookie blockers
                </div>
                <div className="flex items-center gap-2 border-b border-[hsl(var(--cy-teal)/0.25)] bg-[hsl(var(--cy-mint))] px-6 py-4 text-sm font-bold uppercase tracking-wider text-[hsl(var(--cy-teal-deep))]">
                  <img src={cookieYetiIcon} alt="" aria-hidden="true" className="h-5 w-5 rounded" />
                  Cookie Yeti
                </div>
              </div>

              {[
                {
                  them: "Other blockers just hide the banner — some even click “Accept all.”",
                  us: "Cookie Yeti actually rejects the tracking.",
                },
                {
                  them: "Other blockers go stale and quietly stop working.",
                  us: "Cookie Yeti keeps learning, so it never goes stale.",
                },
                {
                  them: "Other blockers are famous for breaking sites.",
                  us: "Cookie Yeti backs off before it breaks anything.",
                },
                {
                  them: "Most work in just one browser.",
                  us: "Cookie Yeti works on Chrome, iPhone & iPad — Mac soon.",
                },
                {
                  them: "Some got bought by ad and antivirus companies.",
                  us: "We never sell your data or hand you to advertisers.",
                },
              ].map((row) => (
                <div
                  key={row.us}
                  className="grid grid-cols-1 border-t border-[hsl(var(--cy-line))] md:grid-cols-2"
                >
                  <div className="flex items-start gap-3 px-6 py-5">
                    <X className="mt-0.5 h-5 w-5 shrink-0 text-red-300" strokeWidth={2.5} />
                    <span className="text-[15px] text-[hsl(var(--cy-ink-2))]">{row.them}</span>
                  </div>
                  <div className="flex items-start gap-3 bg-[hsl(var(--cy-mint)/0.6)] px-6 py-5">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--cy-green))]" />
                    <span className="text-[15px] font-semibold text-[hsl(var(--cy-ink))]">{row.us}</span>
                  </div>
                </div>
              ))}
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Product showcase — real app panels (offset editorial layout) ── */}
      <section className="bg-[hsl(var(--cy-cream))]">
        <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 py-20 lg:grid-cols-2 lg:px-8 lg:py-28">
          <AnimatedSection>
            <div className="max-w-xl">
              <Eyebrow>
                <BarChart3 className="h-3.5 w-3.5" />
                Right in the popup
              </Eyebrow>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-[hsl(var(--cy-ink))]">
                See it working, and stay in control
              </h2>
              <p className="mt-4 text-lg text-[hsl(var(--cy-ink-2))]">
                Open Cookie Yeti and you get two simple tabs. <strong className="font-bold text-[hsl(var(--cy-ink))]">Insights</strong> shows the banners it&apos;s handled and the sites it&apos;s worked on. <strong className="font-bold text-[hsl(var(--cy-ink))]">Control</strong> lets you decide how strict it is.
              </p>
              <ul className="mt-7 space-y-3">
                {[
                  { icon: ShieldCheck, text: "Strict, Balanced, or Permissive — your policy, applied everywhere" },
                  { icon: RefreshCw, text: "Report a missed banner and our AI learns to close it" },
                  { icon: Eye, text: "Optional privacy alerts when a site tries to watch you" },
                ].map((row) => (
                  <li key={row.text} className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-[hsl(var(--cy-teal-deep))] ring-1 ring-[hsl(var(--cy-line))]">
                      <row.icon className="h-4 w-4" />
                    </span>
                    <span className="text-[15px] font-medium text-[hsl(var(--cy-ink-2))]">{row.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={120} animation="scale-in">
            <div className="relative mx-auto max-w-md">
              <div className="pointer-events-none absolute -inset-6 rounded-[2.5rem] bg-[hsl(var(--cy-teal)/0.12)] blur-2xl" />
              <div className="relative grid grid-cols-2 gap-4 sm:gap-6">
                <img
                  src={cyPanelInsights}
                  alt="Cookie Yeti Insights tab showing banners handled, time saved, trackers cleaned, and recent sites"
                  loading="lazy"
                  className="w-full rounded-[1.75rem] border border-[hsl(var(--cy-line))] cy-card-shadow-lg sm:-translate-y-4"
                />
                <img
                  src={cyPanelControl}
                  alt="Cookie Yeti Control tab showing Strict, Balanced, and Permissive cookie policies"
                  loading="lazy"
                  className="w-full rounded-[1.75rem] border border-[hsl(var(--cy-line))] cy-card-shadow sm:translate-y-8"
                />
              </div>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Privacy & Trust ── */}
      <section className="cy-ink-mesh text-white">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:px-8 lg:py-28">
          <AnimatedSection>
            <div className="flex justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 text-[hsl(var(--cy-cyan))] ring-1 ring-white/15">
                <Shield className="h-8 w-8" />
              </span>
            </div>
            <h2 className="mt-6 text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-white">
              Your business stays your business
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg leading-relaxed text-white/80">
              We never sell your data, show you ads, or build a profile about you. We never share your browsing history or the pages you visit. The only thing we ever share is the name of a website when its cookie pop-up is tricky &mdash; like example.com &mdash; so our AI can learn to handle it for everyone. Never you. Never what you were looking at.
            </p>
          </AnimatedSection>

          <AnimatedSection delay={100}>
            <div className="mx-auto mt-10 grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              {[
                "No profile-building",
                "Anonymous stats only",
                "No selling or sharing",
                "No ads",
                "Free tier available",
                "Settings stay on your device",
              ].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-white/90 backdrop-blur"
                >
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-[hsl(var(--cy-green))]" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </AnimatedSection>

          <AnimatedSection delay={200}>
            <div className="mt-10">
              <Link
                to="/privacy"
                className="inline-flex items-center gap-2 rounded-full border-2 border-white/25 bg-white/5 px-6 py-3 text-sm font-bold text-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--cy-cyan)/0.6)] hover:bg-white/10"
              >
                View Full Privacy Policy
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-28">
          <AnimatedSection>
            <div className="mx-auto max-w-2xl text-center">
              <Eyebrow>
                <Star className="h-3.5 w-3.5" />
                Fair, honest pricing
              </Eyebrow>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-[hsl(var(--cy-ink))]">
                Simple, Fair Pricing
              </h2>
              <p className="mt-4 text-lg text-[hsl(var(--cy-ink-2))]">
                Choose the plan that works for you
              </p>
            </div>
          </AnimatedSection>

          <div className="mx-auto mt-14 grid max-w-5xl grid-cols-1 items-stretch gap-6 md:grid-cols-3">
            {/* Free */}
            <AnimatedSection delay={0}>
              <div className="flex h-full flex-col rounded-3xl border border-[hsl(var(--cy-line))] bg-[hsl(var(--cy-cream))] p-8">
                <h3 className="text-lg font-bold text-[hsl(var(--cy-ink))]">Free</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-5xl font-black text-[hsl(var(--cy-ink))]">{CONFIG.pricing.free}</span>
                </div>
                <p className="mt-2 text-sm text-[hsl(var(--cy-ink-2))]">5 banner handles per day</p>
                <ul className="mt-7 flex-1 space-y-3.5">
                  {[
                    { icon: Clock, text: "5 banner handles per day" },
                    { icon: Settings, text: "Basic preferences" },
                    { icon: Globe, text: "Works on popular sites" },
                  ].map((item) => (
                    <li key={item.text} className="flex items-center gap-3 text-sm text-[hsl(var(--cy-ink-2))]">
                      <item.icon className="h-5 w-5 shrink-0 text-[hsl(var(--cy-ink)/0.35)]" />
                      {item.text}
                    </li>
                  ))}
                </ul>
                <a
                  href={CONFIG.links.chrome}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-[hsl(var(--cy-ink)/0.12)] bg-white px-6 py-3.5 text-sm font-bold text-[hsl(var(--cy-ink))] transition-all duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--cy-teal)/0.5)]"
                >
                  Get Started Free
                </a>
              </div>
            </AnimatedSection>

            {/* Monthly */}
            <AnimatedSection delay={100}>
              <div className="flex h-full flex-col rounded-3xl border border-[hsl(var(--cy-line))] bg-white p-8 cy-card-shadow">
                <h3 className="text-lg font-bold text-[hsl(var(--cy-ink))]">Monthly</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-5xl font-black text-[hsl(var(--cy-ink))]">{CONFIG.pricing.monthly}</span>
                  <span className="text-[hsl(var(--cy-ink-2))]">/mo</span>
                </div>
                <p className="mt-2 text-sm text-[hsl(var(--cy-ink-2))]">Billed monthly</p>
                <ul className="mt-7 flex-1 space-y-3.5">
                  {[
                    { icon: Infinity, text: "Unlimited sites" },
                    { icon: Shield, text: "Tracking cookie cleaning" },
                    { icon: Settings, text: "Saved preferences" },
                    { icon: CheckCircle2, text: "Cancel anytime" },
                  ].map((item) => (
                    <li key={item.text} className="flex items-center gap-3 text-sm font-medium text-[hsl(var(--cy-ink))]">
                      <item.icon className="h-5 w-5 shrink-0 text-[hsl(var(--cy-teal-deep))]" />
                      {item.text}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => openCheckout("monthly")}
                  className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-[hsl(var(--cy-teal)/0.4)] bg-white px-6 py-3.5 text-sm font-bold text-[hsl(var(--cy-teal-deep))] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[hsl(var(--cy-mint))] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[hsl(var(--cy-teal)/0.3)]"
                >
                  Subscribe Monthly
                </button>
              </div>
            </AnimatedSection>

            {/* Yearly — recommended */}
            <AnimatedSection delay={200}>
              <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border-2 border-[hsl(var(--cy-teal))] bg-white p-8 cy-card-shadow-lg">
                <div className="absolute right-5 top-5">
                  <span className="rounded-full bg-[hsl(var(--cy-teal-deep))] px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white shadow">
                    Recommended
                  </span>
                </div>
                <h3 className="text-lg font-bold text-[hsl(var(--cy-ink))]">Yearly</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-5xl font-black text-[hsl(var(--cy-ink))]">{CONFIG.pricing.yearly}</span>
                  <span className="text-[hsl(var(--cy-ink-2))]">/yr</span>
                </div>
                <p className="mt-2 text-sm font-bold text-[hsl(var(--cy-green))]">Save 33%</p>
                <ul className="mt-7 flex-1 space-y-3.5">
                  {[
                    { icon: Infinity, text: "Unlimited sites" },
                    { icon: Shield, text: "Tracking cookie cleaning" },
                    { icon: Settings, text: "Saved preferences" },
                    { icon: Headphones, text: "Priority support" },
                  ].map((item) => (
                    <li key={item.text} className="flex items-center gap-3 text-sm font-medium text-[hsl(var(--cy-ink))]">
                      <item.icon className="h-5 w-5 shrink-0 text-[hsl(var(--cy-teal-deep))]" />
                      {item.text}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => openCheckout("yearly")}
                  className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3.5 text-sm font-bold text-white cy-glow-teal transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[hsl(var(--cy-teal)/0.4)]"
                  style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--cy-teal)), hsl(var(--cy-teal-deep)))" }}
                >
                  Subscribe Yearly
                </button>
              </div>
            </AnimatedSection>
          </div>

          <AnimatedSection delay={400}>
            <p className="mt-8 text-center text-sm text-[hsl(var(--cy-ink-2))]">
              * Prices may vary by platform and region.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="bg-[hsl(var(--cy-mint))]">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection>
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-[hsl(var(--cy-ink))]">
                Your Browsing, Your Control
              </h2>
              <p className="mt-4 text-lg text-[hsl(var(--cy-ink-2))]">
                Cookie Yeti shows you exactly how much time you&apos;re saving
              </p>
            </div>
          </AnimatedSection>

          <div className="mx-auto mt-12 grid max-w-3xl grid-cols-3 gap-4 sm:gap-6">
            {[
              { label: "Today", value: CONFIG.stats.today },
              { label: "This Week", value: CONFIG.stats.week },
              { label: "All Time", value: CONFIG.stats.allTime.toLocaleString() },
            ].map((stat, index) => (
              <AnimatedSection key={stat.label} delay={index * 100}>
                <div className="rounded-2xl border border-[hsl(var(--cy-line))] bg-white p-6 text-center cy-card-shadow">
                  <div className="text-4xl font-black text-[hsl(var(--cy-teal-deep))] sm:text-5xl">{stat.value}</div>
                  <div className="mt-2 text-sm font-semibold text-[hsl(var(--cy-ink-2))]">{stat.label}</div>
                </div>
              </AnimatedSection>
            ))}
          </div>

          <AnimatedSection delay={300}>
            <p className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-[hsl(var(--cy-ink-2))]">
              <Shield className="h-4 w-4 text-[hsl(var(--cy-teal))]" />
              Anonymous, non-personal stats — never tied to you or the pages you visit
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Service Status & Live Analytics ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection>
            <div className="mx-auto max-w-2xl text-center">
              <Eyebrow>
                <Activity className="h-3.5 w-3.5" />
                Live system health
              </Eyebrow>
              <h2 className="mt-5 text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-[hsl(var(--cy-ink))]">
                Service Status
              </h2>
              <p className="mt-4 text-lg text-[hsl(var(--cy-ink-2))]">
                Real-time system health and community statistics
              </p>
            </div>
          </AnimatedSection>

          {/* Uptime Heartbeat */}
          <AnimatedSection delay={80}>
            <div className="mx-auto mb-12 mt-12 max-w-md">
              <div className="rounded-2xl border border-[hsl(var(--cy-line))] bg-[hsl(var(--cy-cream))] p-6 text-center cy-card-shadow">
                <div className="mb-4 flex items-center justify-center gap-3">
                  {serviceStatus === 'operational' ? (
                    <Wifi className="h-6 w-6 text-[hsl(var(--cy-green))]" />
                  ) : serviceStatus === 'degraded' ? (
                    <Activity className="h-6 w-6 text-amber-500" />
                  ) : serviceStatus === 'down' ? (
                    <WifiOff className="h-6 w-6 text-red-500" />
                  ) : (
                    <Activity className="h-6 w-6 animate-pulse text-[hsl(var(--cy-ink)/0.4)]" />
                  )}
                  <span className="text-xl font-bold text-[hsl(var(--cy-ink))]">
                    {serviceStatus === 'operational' ? 'All Systems Operational' :
                     serviceStatus === 'degraded' ? 'Degraded Performance' :
                     serviceStatus === 'down' ? 'Service Disruption' : 'Checking...'}
                  </span>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className={`inline-block h-3 w-3 rounded-full ${
                    serviceStatus === 'operational' ? 'bg-[hsl(var(--cy-green))] animate-pulse' :
                    serviceStatus === 'degraded' ? 'bg-amber-500 animate-pulse' :
                    serviceStatus === 'down' ? 'bg-red-500' :
                    'bg-[hsl(var(--cy-ink)/0.4)] animate-pulse'
                  }`} />
                  <span className="text-sm text-[hsl(var(--cy-ink-2))]">
                    {lastChecked ? `Last checked ${lastChecked.toLocaleTimeString()}` : 'Checking...'}
                  </span>
                </div>
              </div>
            </div>
          </AnimatedSection>

          {/* Live Analytics Grid */}
          {liveStats && (
            <AnimatedSection delay={160}>
              <div className="mx-auto grid max-w-4xl grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  { icon: Database, value: liveStats.total_patterns.toLocaleString(), label: "Total Patterns" },
                  { icon: Globe, value: liveStats.total_domains.toLocaleString(), label: "Domains Covered" },
                  { icon: TrendingUp, value: `${liveStats.overall_success_rate}%`, label: "Success Rate" },
                  { icon: Zap, value: liveStats.patterns_last_24h, label: "Active Today" },
                ].map((s) => (
                  <div key={s.label} className="rounded-2xl border border-[hsl(var(--cy-line))] bg-white p-5 text-center cy-card-shadow">
                    <s.icon className="mx-auto mb-2 h-5 w-5 text-[hsl(var(--cy-teal-deep))]" />
                    <div className="text-2xl font-black text-[hsl(var(--cy-ink))]">{s.value}</div>
                    <div className="mt-1 text-xs font-semibold text-[hsl(var(--cy-ink-2))]">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="mx-auto mt-4 grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  { value: liveStats.high_confidence, label: "High Confidence Patterns" },
                  { value: `${liveStats.avg_confidence}/10`, label: "Avg. Confidence Score" },
                  { value: `+${liveStats.new_domains_last_7d}`, label: "New Domains (7 days)" },
                ].map((s) => (
                  <div key={s.label} className="rounded-2xl border border-[hsl(var(--cy-line))] bg-[hsl(var(--cy-mint))] p-4 text-center">
                    <div className="text-lg font-bold text-[hsl(var(--cy-ink))]">{s.value}</div>
                    <div className="text-xs text-[hsl(var(--cy-ink-2))]">{s.label}</div>
                  </div>
                ))}
              </div>

              <p className="mt-4 flex items-center justify-center gap-1 text-center text-xs text-[hsl(var(--cy-ink-2))]">
                <Activity className="h-3 w-3" />
                Updates every 60 seconds • Community-driven data
              </p>
            </AnimatedSection>
          )}
        </div>
      </section>

      {/* ── Support ── */}
      <section className="bg-[hsl(var(--cy-cream))]">
        <div className="mx-auto max-w-3xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection>
            <h2 className="text-center text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-[hsl(var(--cy-ink))]">
              Need Help?
            </h2>
          </AnimatedSection>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
            <AnimatedSection delay={80}>
              <div className="h-full rounded-2xl border border-[hsl(var(--cy-line))] bg-white p-7 text-center transition-all duration-300 hover:-translate-y-1 hover:cy-card-shadow">
                <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--cy-mint))] text-[hsl(var(--cy-teal-deep))]">
                  <AlertTriangle className="h-6 w-6" />
                </span>
                <h3 className="mb-2 text-lg font-semibold text-[hsl(var(--cy-ink))]">Report a Site</h3>
                <p className="mb-5 text-sm text-[hsl(var(--cy-ink-2))]">
                  Found a website where Cookie Yeti doesn&apos;t work correctly?
                </p>
                <Link
                  to="/report-site"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-[hsl(var(--cy-ink)/0.12)] bg-white px-5 py-3 text-sm font-bold text-[hsl(var(--cy-ink))] transition-all duration-200 hover:border-[hsl(var(--cy-teal)/0.5)]"
                >
                  Report Issue
                </Link>
              </div>
            </AnimatedSection>
            <AnimatedSection delay={160}>
              <div className="h-full rounded-2xl border border-[hsl(var(--cy-line))] bg-white p-7 text-center transition-all duration-300 hover:-translate-y-1 hover:cy-card-shadow">
                <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[hsl(var(--cy-mint))] text-[hsl(var(--cy-teal-deep))]">
                  <Mail className="h-6 w-6" />
                </span>
                <h3 className="mb-2 text-lg font-semibold text-[hsl(var(--cy-ink))]">Contact Support</h3>
                <p className="mb-5 text-sm text-[hsl(var(--cy-ink-2))]">
                  Questions, feedback, or need assistance?
                </p>
                <a
                  href="mailto:support@bestly.tech"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border-2 border-[hsl(var(--cy-ink)/0.12)] bg-white px-5 py-3 text-sm font-bold text-[hsl(var(--cy-ink))] transition-all duration-200 hover:border-[hsl(var(--cy-teal)/0.5)]"
                >
                  Email Support
                </a>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-3xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection>
            <div className="mb-10 text-center">
              <h2 className="text-[clamp(2rem,4vw,3rem)] font-semibold leading-tight text-[hsl(var(--cy-ink))]">
                Frequently Asked Questions
              </h2>
              <p className="mt-4 text-lg text-[hsl(var(--cy-ink-2))]">
                Short answers, no jargon.
              </p>
            </div>
          </AnimatedSection>
          <AnimatedSection delay={100}>
            <div className="overflow-hidden rounded-2xl border border-[hsl(var(--cy-line))] bg-[hsl(var(--cy-cream))] px-5 cy-card-shadow">
              <Accordion type="single" collapsible className="w-full">
                {CONFIG.faqs.map((faq, index) => (
                  <AccordionItem
                    key={index}
                    value={`item-${index}`}
                    className="border-b border-[hsl(var(--cy-line))] last:border-0"
                  >
                    <AccordionTrigger className="text-left text-base font-bold text-[hsl(var(--cy-ink))] hover:text-[hsl(var(--cy-teal-deep))] hover:no-underline">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-[15px] leading-relaxed text-[hsl(var(--cy-ink-2))]">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="cy-ink-mesh text-white">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center lg:px-8 lg:py-28">
          <AnimatedSection>
            <div className="flex justify-center">
              <div className="cy-float relative">
                <img
                  src={cookieYetiIcon}
                  alt="Cookie Yeti"
                  className="h-20 w-20 rounded-2xl border border-white/15 shadow-xl"
                />
                <div className="cy-eye-glow pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_0_0_20px_hsl(var(--cy-cyan)/0.6)]" />
              </div>
            </div>
            <h2 className="mt-7 text-[clamp(2.25rem,5vw,3.5rem)] font-semibold leading-tight text-white">
              Cookie Yeti Is Here
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-white/80">
              Now on Chrome, iPhone &amp; iPad. Add it free &mdash; Mac coming soon.
            </p>
          </AnimatedSection>
          <AnimatedSection delay={100}>
            <div className="mt-10 flex justify-center">
              <StoreCTAs center />
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* CY-01: Checkout email capture dialog */}
      <Dialog
        open={checkoutPlan !== null}
        onOpenChange={(open) => {
          if (!open && !checkoutLoading) setCheckoutPlan(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {checkoutPlan ? `Subscribe - ${planLabels[checkoutPlan].title}` : "Subscribe"}
            </DialogTitle>
            <DialogDescription>
              {checkoutPlan && (
                <>
                  <span className="font-semibold text-foreground">
                    {planLabels[checkoutPlan].price}
                  </span>
                  <span className="text-muted-foreground">{planLabels[checkoutPlan].cadence}</span>
                  {" - you'll be redirected to Stripe to complete payment."}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              submitCheckout();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="cy-checkout-email">Email</Label>
              <Input
                id="cy-checkout-email"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                required
                value={checkoutEmail}
                onChange={(e) => setCheckoutEmail(e.target.value)}
                disabled={checkoutLoading}
              />
              <p className="text-xs text-muted-foreground">
                We'll send your receipt and activation details here.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <button
                type="button"
                onClick={() => setCheckoutPlan(null)}
                disabled={checkoutLoading}
                className="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={checkoutLoading}
                className="inline-flex items-center justify-center rounded-md px-5 py-2 text-sm font-bold text-white transition-all duration-200 hover:brightness-110 disabled:opacity-60"
                style={{ backgroundImage: "linear-gradient(135deg, #15a086, #0c7a6e)" }}
              >
                {checkoutLoading ? "Redirecting..." : "Continue to payment"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
