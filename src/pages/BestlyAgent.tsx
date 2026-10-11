import { useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Check, ClipboardCheck, MessageSquareText, Mic, Phone, PhoneIncoming,
  Plus, UserRoundCheck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Button } from "@/components/ui/button";
import { DemoStage, type DemoStageHandle } from "@/components/agentDemo/DemoStage";
import { SCENARIOS } from "@/components/agentDemo/scenarios";
import { BizLogo } from "@/components/agentDemo/appKit";
import { BRANDS } from "@/components/agentDemo/brand";
import { useReducedMotion } from "@/components/agentDemo/appKit";

/**
 * Bestly Agent product page (/agent). Plan: docs/bestly-agent-page-opusplan.md.
 * Copy rules: plain words for someone who has never heard of this, no jargon, no made-up stats or testimonials.
 * Every business and caller in the demo is fictional and the page says so once, quietly, under the demo.
 */
const PHONE_DISPLAY = "(213) 641-0074";
const PHONE_TEL = "tel:+12136410074";

/** Same hook the Talk to Maya button uses: MayaWidget listens for this and opens her. */
const openMaya = () => window.dispatchEvent(new Event("maya:open"));

const does: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: PhoneIncoming, title: "Answers every call", body: "Day or night. No hold music, no voicemail. Every caller talks to someone right away." },
  { icon: ClipboardCheck, title: "Does the work", body: "Books the appointment, issues the refund, sends the technician. She does it in the software you already use." },
  { icon: MessageSquareText, title: "Texts and emails for you", body: "Confirmations, forms and links go out while she is still on the phone with them." },
  { icon: UserRoundCheck, title: "Hands you the hot ones", body: "When a call needs a person, she alerts you or transfers it. Nothing important gets lost." },
];

const industries: { id: string; line: string }[] = [
  { id: "saas-support", line: "Fixes a double charge and adds a teammate to the account." },
  { id: "dental", line: "Books an after-hours emergency visit and texts the new-patient forms." },
  { id: "plumbing", line: "Calms a burst-pipe call and sends the on-call plumber." },
  { id: "real-estate", line: "Qualifies a buyer and books a Saturday showing." },
  { id: "restaurant", line: "Finds a table, flags an allergy for the kitchen, and texts a confirmation." },
];

const steps = [
  { n: "1", title: "We learn your business", body: "Your hours, prices, policies and the questions people always ask. She answers from that, in your voice." },
  { n: "2", title: "Connect your phone and tools", body: "You keep your phone number. We connect your calendar, customer list or help desk so she can do the work." },
  { n: "3", title: "Read every call", body: "Each call comes with a short summary of what happened, and you can listen back to the recording." },
];

export default function BestlyAgent() {
  const stage = useRef<DemoStageHandle>(null);
  const reduce = useReducedMotion();

  // Land with the scene line (the chips, on a phone) just under the sticky site header, so the call, the window and the
  // transport are all in view together.
  const toStage = () => {
    const narrow = window.matchMedia("(max-width: 767px)").matches;
    const el = document.getElementById(narrow ? "demo-chips" : "demo-scene") ?? document.getElementById("demo");
    if (!el) return;
    const bar = document.querySelector("header");
    const barH = bar && getComputedStyle(bar).position !== "static" ? bar.getBoundingClientRect().height : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - barH - 14;
    window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
  };
  const watch = (id: string, play: boolean) => {
    stage.current?.select(id, play); // inside the click, so the browser allows sound
    toStage();
  };

  const first = SCENARIOS[0];

  return (
    <>
      <SEOHead
        title="Bestly Agent: an AI that answers your business phone"
        description="Bestly Agent picks up every call, day or night, talks like a real person, and does the work while it talks: books the appointment, updates your software, and texts the confirmation."
        path="/agent"
        image="/og-agent.png"
      />

      {/* 1. Hero */}
      <section className="relative overflow-hidden border-b border-border bg-background">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(60% 70% at 85% 20%, hsl(var(--primary) / 0.10), transparent 70%)" }}
        />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" immediate>
            <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-primary">Bestly Agent</p>
            <h1 className="font-modern text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              An AI that answers your business phone.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              It picks up every call, day or night, talks like a real person, and does the work while it talks: books the
              appointment, updates your software, and texts the confirmation.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" className="min-h-[44px]" onClick={() => watch("saas-support", true)}>
                Watch a call <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
              <Button size="lg" variant="outline" className="min-h-[44px]" onClick={openMaya}>
                <Mic className="mr-2 h-4 w-4" aria-hidden="true" /> Talk to Maya live
              </Button>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              Or call Maya:{" "}
              <a href={PHONE_TEL} className="whitespace-nowrap font-semibold text-foreground underline underline-offset-4 hover:text-primary">
                {PHONE_DISPLAY}
              </a>
            </p>
          </AnimatedSection>

          {/* A still from a sample call, not a screenshot of anyone's customer. */}
          <AnimatedSection animation="fade-in" immediate delay={120} className="relative mx-auto w-full max-w-md">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -inset-10"
              style={{ background: "radial-gradient(closest-side, rgba(142,155,255,.45), rgba(229,156,255,.18) 55%, transparent)" }}
            />
            <figure className="relative m-0 overflow-hidden rounded-3xl border border-white/10 p-5 text-white shadow-2xl"
              style={{ background: "linear-gradient(180deg,#0E1030,#161A45)" }}>
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="block h-11 w-11 shrink-0 rounded-full"
                  style={{
                    background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,.85), rgba(255,255,255,0) 45%), conic-gradient(from 210deg, #8E9BFF, #E59CFF, #8E9BFF, #6CD3FF, #8E9BFF)",
                    boxShadow: "0 0 26px -2px #8E9BFFAA",
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[17px] font-semibold leading-tight">Maya</p>
                  <p className="flex items-center gap-1.5 text-[13px] text-[#C7CBEA]">
                    <BizLogo slug={BRANDS[first.id].logo} size={16} />
                    <span>{first.business} · AI agent</span>
                  </p>
                </div>
                <span className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-semibold">
                  <i aria-hidden="true" className="h-2 w-2 rounded-full bg-[#4ade80]" style={{ boxShadow: "0 0 10px 2px rgba(74,222,128,.5)" }} />
                  On a call
                </span>
              </div>
              <div className="mt-5 flex flex-col gap-3">
                <div className="max-w-[90%] self-start rounded-[18px] rounded-tl-md border border-[#8E9BFF]/30 bg-[#8E9BFF]/[0.17] px-4 py-2.5 text-[15px] leading-snug text-[#F1F2FF]">
                  {first.lines[0].text}
                </div>
                <div className="max-w-[90%] self-end rounded-[18px] rounded-tr-md border border-white/10 bg-white/[0.09] px-4 py-2.5 text-[15px] leading-snug text-[#E4E6F7]">
                  {first.lines[1].text}
                </div>
                <div className="inline-flex max-w-[92%] items-start gap-2 self-start rounded-xl border border-[#4ade80]/30 bg-[#4ade80]/[0.12] px-3 py-1.5 text-[13px] font-semibold leading-snug text-[#c4f5d6]">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>{first.lines[2].tool}</span>
                </div>
              </div>
              <figcaption className="mt-5 text-xs text-[#B4B9DE]">A sample call with a made-up business.</figcaption>
            </figure>
          </AnimatedSection>
        </div>
      </section>

      {/* 2. Demo stage */}
      <DemoStage ref={stage} onTalk={openMaya} />

      {/* 3. What it does */}
      <section className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">What it does</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Like a great receptionist who also knows your software.
            </h2>
          </AnimatedSection>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {does.map((d, i) => (
              <AnimatedSection key={d.title} animation="fade-in-up" delay={i * 70}>
                <div className="h-full rounded-2xl border border-border bg-card p-7">
                  <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <d.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-modern text-xl font-semibold text-foreground">{d.title}</h3>
                  <p className="mt-3 text-muted-foreground">{d.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Works for any business */}
      <section id="industries" className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Any industry</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Works for any business that gets phone calls.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">Pick one to watch that call play out above.</p>
          </AnimatedSection>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {industries.map((x, i) => {
              const sc = SCENARIOS.find((s) => s.id === x.id)!;
              return (
                <AnimatedSection key={x.id} animation="fade-in-up" delay={i * 60}>
                  <button
                    type="button"
                    onClick={() => watch(x.id, false)}
                    className="group flex h-full min-h-[44px] w-full flex-col rounded-2xl border border-border bg-card p-6 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    <BizLogo slug={BRANDS[x.id].logo} size={44} className="mb-4 rounded-xl shadow-sm" />
                    <span className="font-modern text-xl font-semibold text-foreground">{sc.chip}</span>
                    <span className="mt-2 block text-muted-foreground">{x.line}</span>
                    <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                      Watch this call <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
                    </span>
                  </button>
                </AnimatedSection>
              );
            })}
            <AnimatedSection animation="fade-in-up" delay={300}>
              <button
                type="button"
                onClick={openMaya}
                className="group flex h-full min-h-[44px] w-full flex-col rounded-2xl border border-dashed border-primary/40 bg-primary/[0.04] p-6 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Plus className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-modern text-xl font-semibold text-foreground">Yours</span>
                <span className="mt-2 block text-muted-foreground">Tell Maya what you do and she&rsquo;ll show you how it would work.</span>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  Talk to Maya <Mic className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* 5. How it works */}
      <section id="how-it-works" className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Three steps</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">How it works</h2>
          </AnimatedSection>
          <div className="grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <AnimatedSection key={s.n} animation="fade-in-up" delay={i * 80}>
                <div className="h-full rounded-2xl border border-border bg-card p-7">
                  <span className="mb-5 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {s.n}
                  </span>
                  <h3 className="font-modern text-xl font-semibold text-foreground">{s.title}</h3>
                  <p className="mt-3 text-muted-foreground">{s.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Try her right now */}
      <section id="try-maya" className="border-b border-border bg-secondary/20">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[auto_1fr] lg:gap-14 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="flex justify-center">
            <span
              aria-hidden="true"
              className="block h-36 w-36 rounded-full sm:h-44 sm:w-44"
              style={{
                background: "radial-gradient(circle at 32% 28%, rgba(255,255,255,.85), rgba(255,255,255,0) 45%), conic-gradient(from 210deg, #8E9BFF, #E59CFF, #8E9BFF, #6CD3FF, #8E9BFF)",
                boxShadow: "0 0 60px 8px rgba(142,155,255,.45), 0 0 140px 40px rgba(229,156,255,.18)",
              }}
            />
          </AnimatedSection>
          <AnimatedSection animation="fade-in" delay={80}>
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Live</p>
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Try her right now.</h2>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              Maya is a Bestly Agent. Talk to her the way your customers would.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button size="lg" className="min-h-[44px]" onClick={openMaya}>
                <Mic className="mr-2 h-4 w-4" aria-hidden="true" /> Talk to Maya
              </Button>
              <Button size="lg" variant="outline" className="min-h-[44px]" asChild>
                <a href={PHONE_TEL}>
                  <Phone className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span className="whitespace-nowrap">Call {PHONE_DISPLAY}</span>
                </a>
              </Button>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* 7. CTA */}
      <section className="bg-background">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:py-24">
          <AnimatedSection animation="fade-in">
            <h2 className="font-modern text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Get your own agent.</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Tell us about your business and your phone line. We will show you what she would do on your calls.
            </p>
            <div className="mt-8 flex justify-center">
              <Button size="lg" className="min-h-[44px]" asChild>
                <Link to="/contact?topic=agent">
                  Get your own agent <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </AnimatedSection>
        </div>
      </section>
    </>
  );
}
