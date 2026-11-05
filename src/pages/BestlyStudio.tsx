import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { useStudioFavicon } from "@/hooks/useStudioFavicon";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Lines } from "@/components/Lines";
import { STUDIO_USE_CASES } from "@/config/studioUseCases";
import { STUDIO_ICONS } from "@/config/studioIcons";
import { BOOKING, EMAIL, StudioChips, StudioCtas, StudioFooterCta } from "@/components/studio/StudioShared";
import {
  Mail, Clapperboard, Smartphone, CalendarDays, Lightbulb, History, UserCheck, Send,
  ArrowRight, Video, FileText, GalleryHorizontal, Image as ImageIcon, Scissors, Sparkles,
} from "lucide-react";

/**
 * Bestly Studio public page (/studio). Promo claims follow docs/studio-promo/claims.md: no prices, no results,
 * no client names, no mocked screens. Screenshots are the real Studio on the sample "bestly-test" demo account.
 * A number never wraps away from its unit: use a no-break space.
 */
const steps = [
  { icon: Mail, title: "Send us the raw material", body: `Email photos, clips and notes to ${EMAIL}. Or book a call and we plan the posts with you.` },
  { icon: Clapperboard, title: "We make the posts", body: "We turn it into image posts, swipe posts and short videos. A person at Bestly checks every one before it reaches you." },
  { icon: Smartphone, title: "You approve from your phone. We post.", body: "Open your own board, look at each post the way it will appear, and tap Approve. Once you approve, we post it." },
];

const makes = [
  { icon: Video, title: "Short vertical videos", body: "Cut from clips you film on your phone, with captions, music, graphics and a cover image." },
  { icon: FileText, title: "Scripts for you to film", body: "Not sure what to say on camera? We write it. You say it your way." },
  { icon: GalleryHorizontal, title: "Swipe posts", body: "A few slides that explain one idea, show one product or share one piece of news." },
  { icon: ImageIcon, title: "Image posts", body: "One clean picture with a short caption." },
  { icon: Scissors, title: "Recuts of videos you already have", body: "A long video becomes shorter ones for social." },
  { icon: CalendarDays, title: "A posting calendar", body: "Planned around holidays and the dates that matter to your customers." },
];

const gets = [
  { icon: UserCheck, text: "A person at Bestly checks every post before you see it." },
  { icon: Smartphone, text: "A board of your own on your phone. See each post the way it will look in Instagram or TikTok." },
  { icon: Send, text: "Tap Approve, or tap Changes and say what to fix in your own words." },
  { icon: History, text: "Earlier versions of a post are kept, so you can go back." },
  { icon: CalendarDays, text: "A calendar of what is coming up." },
  { icon: Lightbulb, text: "Send us an idea, or a clip you filmed, any time." },
];

const platforms = ["Instagram", "Facebook", "Threads", "Bluesky", "LinkedIn", "Pinterest", "TikTok"];

const faqs = [
  { q: "Is it all done by a computer?", a: "No. We use software, including AI tools, to draft, design and edit. A person at Bestly checks every post before it reaches you, and nothing goes out until you approve it." },
  { q: "Where do you post?", a: "To your own accounts, which you connect yourself on each platform's own login page: Instagram, Facebook, Threads, Bluesky, LinkedIn, Pinterest and TikTok. TikTok works differently: you review each video and tap Post yourself, and TikTok is still reviewing Bestly Studio, so for now it is open to approved test accounts only." },
  { q: "What kinds of businesses is this for?", a: "Anyone who runs something and has no time to post about it: coaches, real estate agents, shops, app makers, local businesses, creators and nonprofits. If yours is not on the list, book a call and tell us about it." },
  { q: "Do I have to be on camera?", a: "No. Swipe posts and image posts need no filming. Short videos are optional, and we write the script if you want one." },
  { q: "Do you work outside the US?", a: "Yes. We work with businesses outside the US. Everything happens online: sign up on the site or start with a video call, your board on any phone or computer, and your material sent by email." },
  { q: "Does Bestly post on my TikTok without asking?", a: "No. You connect your own TikTok account and review every video and caption. Studio sends a video to TikTok only after you approve it and tap Post, and you choose who can see it. You can disconnect any time from your board." },
  { q: "What does Studio see on my TikTok?", a: "Your basic profile (name and picture), so you can see which account is connected, and the permission to post the videos you approve. Nothing else. The Privacy Policy has the details and how to delete your data." },
  { q: "How do I start?", a: "Tap Start free for 7 days. You answer a few short questions about your business and connect your accounts. Some platforms open to new sign-ups as each one finishes its review, and the sign-up shows which are open today. If you would rather talk first, book a free call." },
  { q: "What does it cost?", a: "The first 7 days are free. You see the plans and prices in the sign-up before you enter a card, and you are not asked for a card until your first account is connected." },
  { q: "What if I do not like a post?", a: "Tap Changes and tell us what to fix, the way you would say it out loud." },
];

export default function BestlyStudio() {
  useStudioFavicon();
  return (
    <>
      <SEOHead
        title="Bestly Studio: social posts and short videos, made for your business | Bestly"
        description="Bestly Studio makes social media posts and short videos for your business. A person at Bestly checks every one, you approve from your phone, and we post."
        path="/studio"
        image="/studio/og-studio.jpg"
      />

      {/* Hero */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-16 lg:grid-cols-2 lg:px-8 lg:py-28">
          <AnimatedSection animation="fade-in" immediate>
            <p className="mb-4 flex items-center gap-3 text-sm font-semibold uppercase tracking-widest text-primary">
              <img src="/studio-favicon-512.png" width={40} height={40} alt="" className="h-10 w-10 shrink-0 rounded-[22%]" />
              <span className="whitespace-nowrap">Bestly Studio</span>
            </p>
            <h1 className="font-modern text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Social posts and short videos, made for your business.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              <Lines>We make them. A person at Bestly checks each one. You approve on your phone, and we post.</Lines>
            </p>
            <div className="mt-8"><StudioCtas /></div>
            <div className="mt-10">
              <p className="mb-3 text-sm font-semibold text-foreground">See how it works for</p>
              <StudioChips />
            </div>
          </AnimatedSection>

          <AnimatedSection animation="fade-in" immediate delay={120} className="flex justify-center gap-5">
            <img
              src="/studio/board-review-phone.webp"
              width={780}
              height={1688}
              alt="A post waiting for approval on a phone, with Approve and Changes buttons"
              className="w-[46%] max-w-[260px] rounded-3xl border border-border shadow-xl"
              {...{ fetchpriority: "high" }}
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

      {/* Whatever you do */}
      <section className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Whatever you do</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Pick the one that sounds like you.
            </h2>
          </AnimatedSection>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STUDIO_USE_CASES.map((u, i) => {
              const Icon = STUDIO_ICONS[u.icon];
              return (
                <AnimatedSection key={u.slug} animation="fade-in-up" delay={(i % 4) * 60}>
                  <Link
                    to={`/studio/for/${u.slug}`}
                    className="group flex h-full min-h-[44px] flex-col rounded-2xl border border-border bg-card p-6 transition-shadow duration-200 hover:shadow-lg active:scale-[0.99] motion-reduce:transition-none"
                  >
                    {Icon && <Icon className="mb-4 h-6 w-6 text-primary" aria-hidden="true" />}
                    <h3 className="font-modern text-lg font-semibold tracking-tight text-foreground">{u.title}</h3>
                    <p className="mt-2 flex-1 text-sm text-muted-foreground">{u.line}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                      See how it works <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </Link>
                </AnimatedSection>
              );
            })}
            <AnimatedSection animation="fade-in-up" delay={120}>
              <a
                href={BOOKING}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-full min-h-[44px] flex-col rounded-2xl border border-dashed border-border bg-card p-6 transition-shadow duration-200 hover:shadow-lg active:scale-[0.99] motion-reduce:transition-none"
              >
                <Sparkles className="mb-4 h-6 w-6 text-primary" aria-hidden="true" />
                <h3 className="font-modern text-lg font-semibold tracking-tight text-foreground">Something else?</h3>
                <p className="mt-2 flex-1 text-sm text-muted-foreground">Tell us what you do on a free call. We will say what we would make.</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  Book a free call <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </a>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* What we can make */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">What we can make</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Posts, videos and a plan for what goes out.
            </h2>
          </AnimatedSection>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {makes.map((m, i) => (
              <AnimatedSection key={m.title} animation="fade-in-up" delay={(i % 3) * 60}>
                <div className="h-full rounded-2xl border border-border bg-card p-7">
                  <m.icon className="mb-4 h-6 w-6 text-primary" aria-hidden="true" />
                  <h3 className="font-modern text-xl font-semibold tracking-tight text-foreground">{m.title}</h3>
                  <p className="mt-3 text-muted-foreground"><Lines>{m.body}</Lines></p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
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
              <AnimatedSection key={s.title} animation="fade-in-up" delay={i * 80}>
                <div className="h-full rounded-2xl border border-border bg-card p-7">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                      {i + 1}
                    </span>
                    <s.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  </div>
                  <h3 className="font-modern text-xl font-semibold tracking-tight text-foreground">{s.title}</h3>
                  <p className="mt-3 text-muted-foreground"><Lines>{s.body}</Lines></p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Your board */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-20 lg:grid-cols-2 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Your board</p>
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

      {/* Where we post */}
      <section className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-3xl px-6 py-20 lg:py-24">
          <AnimatedSection animation="fade-in">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Where we post</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              To your own accounts.
            </h2>
            <ul className="mt-8 flex flex-wrap gap-2" aria-label="Platforms we post to">
              {platforms.map((p) => (
                <li key={p} className="inline-flex items-center rounded-lg bg-secondary px-3 py-1.5 text-sm font-medium text-foreground">
                  {p}{p === "TikTok" ? "*" : ""}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted-foreground">
              * On TikTok, you review each video and tap Post yourself. TikTok is still reviewing Bestly Studio, so for now it is open to approved test accounts only.
            </p>
            <p className="mt-6 text-foreground">
              <Lines>You connect your own accounts, each on that platform's own login page. You can disconnect any of them from your board.</Lines>
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              <Link to="/studio/terms" className="underline underline-offset-4 hover:text-foreground">Terms of Service</Link>{" "}
              and{" "}
              <Link to="/studio/privacy" className="underline underline-offset-4 hover:text-foreground">Privacy Policy</Link>.
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Wherever you are */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-3xl px-6 py-20 lg:py-24">
          <AnimatedSection animation="fade-in">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Wherever you are</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              We work with businesses outside the US.
            </h2>
            <p className="mt-6 text-lg text-muted-foreground">
              <Lines>Everything happens online. You sign up online, or start with a video call. You see your board on any phone or computer. You send your material by email.</Lines>
            </p>
          </AnimatedSection>
        </div>
      </section>

      {/* Questions */}
      <section className="border-b border-border bg-secondary/20">
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
                <dd className="mt-2 text-muted-foreground"><Lines>{f.a}</Lines></dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <StudioFooterCta />
    </>
  );
}
