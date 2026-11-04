import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { useStudioFavicon } from "@/hooks/useStudioFavicon";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Lines } from "@/components/Lines";
import { getStudioUseCase } from "@/config/studioUseCases";
import { STUDIO_ICONS } from "@/config/studioIcons";
import { StudioCtas, StudioFooterCta } from "@/components/studio/StudioShared";

/** /studio/for/:slug, one template fed by src/config/studioUseCases.ts. Claims: docs/studio-promo/claims.md. */
export default function StudioUseCase() {
  const { slug } = useParams();
  useStudioFavicon();
  const u = getStudioUseCase(slug);
  if (!u) return <Navigate to="/studio" replace />;
  const Icon = STUDIO_ICONS[u.icon];

  return (
    <>
      <SEOHead title={u.seoTitle} description={u.seoDescription} path={`/studio/for/${u.slug}`} image="/studio/og-studio.jpg" />

      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-4xl px-6 py-16 lg:py-24">
          <AnimatedSection animation="fade-in" immediate>
            <Link
              to="/studio"
              className="mb-6 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All uses
            </Link>
            <p className="mb-4 flex items-center gap-3 text-sm font-semibold uppercase tracking-widest text-primary">
              {Icon && <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />}
              <span>Bestly Studio for {u.audience}</span>
            </p>
            <h1 className="font-modern text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{u.h1}</h1>
            <p className="mt-6 max-w-2xl text-lg text-muted-foreground"><Lines>{u.sub}</Lines></p>
            <div className="mt-8"><StudioCtas /></div>
          </AnimatedSection>
        </div>
      </section>

      <section className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">What we make for you</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Posts and videos, made for {u.audience}.
            </h2>
          </AnimatedSection>
          <div className="grid gap-6 sm:grid-cols-2">
            {u.whatWeMake.map((w, i) => (
              <AnimatedSection key={w.title} animation="fade-in-up" delay={i * 60}>
                <div className="h-full rounded-2xl border border-border bg-card p-7">
                  <h3 className="font-modern text-xl font-semibold tracking-tight text-foreground">{w.title}</h3>
                  <p className="mt-3 text-muted-foreground"><Lines>{w.body}</Lines></p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">How it works for you</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Three steps. The hard part is ours.
            </h2>
          </AnimatedSection>
          <div className="grid gap-6 md:grid-cols-3">
            {u.steps.map((s, i) => (
              <AnimatedSection key={s.title} animation="fade-in-up" delay={i * 80}>
                <div className="h-full rounded-2xl border border-border bg-card p-7">
                  <span className="mb-5 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {i + 1}
                  </span>
                  <h3 className="font-modern text-xl font-semibold tracking-tight text-foreground">{s.title}</h3>
                  <p className="mt-3 text-muted-foreground"><Lines>{s.body}</Lines></p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-3xl px-6 py-20 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-8">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Ideas we might make</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              A few examples of what could go in your feed.
            </h2>
          </AnimatedSection>
          <ul className="space-y-3">
            {u.ideas.map((idea) => (
              <li key={idea} className="rounded-xl border border-border bg-card px-5 py-4 text-foreground">{idea}</li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">These are ideas, not samples. We shape them around your business.</p>
        </div>
      </section>

      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-3xl px-6 py-20 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-10">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Plain answers</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Questions people ask first.
            </h2>
          </AnimatedSection>
          <dl className="space-y-8">
            {u.faqs.map((f) => (
              <div key={f.q}>
                <dt className="font-modern text-lg font-semibold text-foreground">{f.q}</dt>
                <dd className="mt-2 text-muted-foreground"><Lines>{f.a}</Lines></dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <StudioFooterCta otherUses exclude={u.slug} />
    </>
  );
}
