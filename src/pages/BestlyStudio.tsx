import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Button } from "@/components/ui/button";
import {
  Mail, Clapperboard, Smartphone, CalendarDays, Lightbulb, History,
  UserCheck, Send, Store, Briefcase, Home, ArrowRight,
} from "lucide-react";

/**
 * Bestly Studio public page (/studio). Promo claims on this page follow docs/studio-promo/claims.md:
 * no prices, no results, no client names, no mocked screens. The screenshots are the real Studio on the
 * sample "bestly-test" demo account. A number never wraps away from its unit: use a no-break space.
 */
const BOOKING = "https://cloud.bestly.tech/apps/calendar/appointment/BtktQYtGFocY";
const EMAIL = "studio@bestly.tech";

const steps = [
  {
    n: "1",
    icon: Mail,
    title: "Send us the raw material",
    body: `Email photos and notes to ${EMAIL}. Or book a call and we plan the posts with you.`,
  },
  {
    n: "2",
    icon: Clapperboard,
    title: "We make the posts",
    body: "We turn it into image posts, swipe posts and short videos. A person at Bestly checks every one before it reaches you.",
  },
  {
    n: "3",
    icon: Smartphone,
    title: "You approve from your phone. We post.",
    body: "Open your own board, look at each post the way it will appear, and tap Approve. Once you approve, we post it to your Instagram.",
  },
];

const gets = [
  { icon: Clapperboard, text: "Image posts, swipe posts and short vertical videos, made for your business." },
  { icon: UserCheck, text: "A person at Bestly checks every post before you see it." },
  { icon: Smartphone, text: "A board of your own on your phone. See each post the way it will look in Instagram or TikTok." },
  { icon: Send, text: "Tap Approve, or tap Changes and say what to fix in your own words." },
  { icon: History, text: "Earlier versions of a post are kept, so you can go back." },
  { icon: CalendarDays, text: "A calendar of what is coming up." },
  { icon: Lightbulb, text: "Send us an idea, or a clip you filmed, any time." },
];

const who = [
  {
    icon: Store,
    title: "Small businesses",
    body: "Shops, restaurants, studios and trades that need to show up online and do not have the evenings to do it.",
  },
  {
    icon: Briefcase,
    title: "Solo professionals",
    body: "Coaches, consultants and trainers who are the whole business and would rather work than write captions.",
  },
  {
    icon: Home,
    title: "Real estate agents",
    body: "Agents who want to stay visible between closings without making posts themselves.",
  },
];

const faqs = [
  {
    q: "Is it all done by a computer?",
    a: "No. We use software, including AI tools, to draft, design and edit. A person at Bestly checks every post before it reaches you, and nothing goes out until you approve it.",
  },
  {
    q: "Where do you post?",
    a: "We post to your Instagram account, which you connect once. We also make videos in the vertical shape that TikTok and Reels use.",
  },
  {
    q: "What does it cost?",
    a: "We go through that on the free call, once we know what you need.",
  },
  {
    q: "What if I do not like a post?",
    a: "Tap Changes and tell us what to fix, the way you would say it out loud.",
  },
];

export default function BestlyStudio() {
  return (
    <>
      <SEOHead
        title="Bestly Studio: we make your social posts, you approve them from your phone | Bestly"
        description="Bestly Studio makes your social media posts and short videos. A person at Bestly checks every one, you approve from your phone, and we post to your Instagram."
        path="/studio"
        image="/studio/og-studio.jpg"
      />

      {/* Hero */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:px-8 lg:py-28">
          <AnimatedSection animation="fade-in" immediate>
            <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-primary">Bestly Studio</p>
            <h1 className="font-modern text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              We make your social posts. You approve them from your phone. We post them.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Bestly Studio is a done-for-you service for small businesses. We make the pictures, swipe posts and short
              videos for your social media. A person at Bestly checks every post. You say yes, or tell us what to change.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button asChild size="lg">
                <a href={BOOKING} target="_blank" rel="noopener noreferrer">
                  Book a free call <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
              <a
                href={`mailto:${EMAIL}`}
                className="text-sm font-semibold text-foreground underline underline-offset-4 hover:text-primary"
              >
                Or email {EMAIL}
              </a>
            </div>
          </AnimatedSection>

          <AnimatedSection animation="fade-in" immediate delay={120} className="flex justify-center gap-5">
            <img
              src="/studio/board-review-phone.webp"
              width={780}
              height={1688}
              alt="A post waiting for approval on a phone, with Approve and Changes buttons"
              className="w-[46%] max-w-[260px] rounded-3xl border border-border shadow-xl"
              fetchPriority="high"
            />
            <img
              src="/studio/board-changes-phone.webp"
              width={780}
              height={1688}
              alt="The Changes sheet on a phone: a note typed in your own words"
              className="mt-10 w-[46%] max-w-[260px] rounded-3xl border border-border shadow-xl"
              loading="lazy"
            />
          </AnimatedSection>
        </div>
        <p className="mx-auto max-w-7xl px-6 pb-6 text-xs text-muted-foreground lg:px-8">
          Screenshots of the real Bestly Studio on a demo account, with a sample post.
        </p>
      </section>

      {/* How it works */}
      <section className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">How it works</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Three steps. The hard part is ours.
            </h2>
          </AnimatedSection>
          <div className="grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <AnimatedSection key={s.n} animation="fade-in-up" delay={i * 80}>
                <div className="h-full rounded-2xl border border-border bg-card p-7">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {s.n}
                    </span>
                    <s.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </div>
                  <h3 className="font-modern text-xl font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-3 text-muted-foreground">{s.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">What you get</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Posts you can read and approve on your phone.
            </h2>
            <ul className="mt-8 space-y-4">
              {gets.map((g) => (
                <li key={g.text} className="flex gap-4">
                  <g.icon className="mt-1 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                  <span className="text-foreground">{g.text}</span>
                </li>
              ))}
            </ul>
          </AnimatedSection>
          <AnimatedSection animation="fade-in" delay={100}>
            <img
              src="/studio/board-review-desktop.webp"
              width={1600}
              height={1000}
              alt="The Bestly Studio board on a computer: a sample post in an Instagram frame with Approve and Changes buttons"
              className="w-full rounded-2xl border border-border shadow-xl"
              loading="lazy"
            />
            <p className="mt-3 text-xs text-muted-foreground">
              The same board on a computer. Real screenshot of a demo account with a sample post.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Who it is for */}
      <section className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Who it is for</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              People who run something and have no time to post about it.
            </h2>
          </AnimatedSection>
          <div className="grid gap-6 md:grid-cols-3">
            {who.map((w, i) => (
              <AnimatedSection key={w.title} animation="fade-in-up" delay={i * 80}>
                <div className="h-full rounded-2xl border border-border bg-card p-7">
                  <w.icon className="mb-5 h-6 w-6 text-primary" aria-hidden="true" />
                  <h3 className="font-modern text-xl font-semibold text-foreground">{w.title}</h3>
                  <p className="mt-3 text-muted-foreground">{w.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Questions */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-3xl px-6 py-20 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-10">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Plain answers</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Questions people ask first.
            </h2>
          </AnimatedSection>
          <dl className="space-y-8">
            {faqs.map((f) => (
              <div key={f.q}>
                <dt className="font-modern text-lg font-semibold text-foreground">{f.q}</dt>
                <dd className="mt-2 text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Book a call */}
      <section className="bg-background">
        <div className="mx-auto max-w-3xl px-6 py-20 text-center lg:py-24">
          <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Talk to us first. It is free.
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Tell us about your business. We will tell you what we would post and how it would work.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Button asChild size="lg">
              <a href={BOOKING} target="_blank" rel="noopener noreferrer">
                Book a free call <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
            <a
              href={`mailto:${EMAIL}`}
              className="text-sm font-semibold text-foreground underline underline-offset-4 hover:text-primary"
            >
              Or email {EMAIL}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
