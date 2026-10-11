import { useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, CalendarDays, Check, ClipboardCheck, CreditCard, Headset, Languages, Mail, MessageCircle,
  MessageSquareText, MessagesSquare, Mic, Phone, PhoneIncoming, Plug, Plus, ShieldCheck, UserRoundCheck,
  Users, Wrench,
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
  { icon: PhoneIncoming, title: "Answers every call", body: "Day or night, weekends and holidays. Nobody waits on hold. Nobody gets voicemail." },
  { icon: ClipboardCheck, title: "Does the work, not just the talking", body: "She books, reschedules, looks up orders and sends a technician, right inside your own software." },
  { icon: MessageSquareText, title: "Texts and emails for you", body: "Confirmations, forms and payment links go out while she is still on the call." },
  { icon: UserRoundCheck, title: "Gets you when it matters", body: "If a caller needs a person, she transfers the call or sends you an alert with the details." },
];

/** The point of the page: she is connected to the customer's own tools. Names are examples, set up per customer. */
const apps: { icon: LucideIcon; title: string; names: string[]; body: string }[] = [
  { icon: CalendarDays, title: "Your calendar", names: ["Google Calendar", "Outlook", "Calendly"], body: "Books, moves and cancels appointments in open times only." },
  { icon: Users, title: "Your customer list", names: ["HubSpot", "Salesforce", "a spreadsheet"], body: "Adds new callers, finds returning ones, and writes a note about every call." },
  { icon: Headset, title: "Your help desk", names: ["Zendesk", "Intercom", "Freshdesk"], body: "Looks up the order or account and fixes the problem, or opens a ticket for your team." },
  { icon: CreditCard, title: "Payments", names: ["Stripe", "Square"], body: "Texts a secure payment link. Can give a refund, up to a limit you set." },
  { icon: Wrench, title: "Your crew schedule", names: ["Jobber", "Housecall Pro"], body: "Creates the job and sends the right person to the right address." },
  { icon: Plug, title: "Something else?", names: [], body: "If your software can connect to other apps, we can usually connect her to it too. Just ask." },
];

const channels: { icon: LucideIcon; label: string }[] = [
  { icon: Phone, label: "Phone calls" },
  { icon: MessageSquareText, label: "Text messages" },
  { icon: MessagesSquare, label: "Website chat" },
  { icon: Mail, label: "Email" },
  { icon: MessageCircle, label: "WhatsApp" },
];

const industries: { id: string; line: string }[] = [
  { id: "saas-support", line: "Fixes a double charge and adds a teammate to the account." },
  { id: "dental", line: "Books an after-hours emergency visit and texts the new-patient forms." },
  { id: "plumbing", line: "Calms a burst-pipe call and sends the on-call plumber." },
  { id: "real-estate", line: "Qualifies a buyer and books a Saturday showing." },
  { id: "restaurant", line: "Finds a table, flags an allergy for the kitchen, and texts a confirmation." },
];

const steps = [
  { n: "1", title: "Tell us how your business works", body: "Your hours, prices, rules and the questions people always ask. You decide what she can and can't do." },
  { n: "2", title: "We connect your phone and apps", body: "You keep your phone number. We hook up your calendar, customer list and anything else she needs." },
  { n: "3", title: "We test her before she goes live", body: "We run practice calls, tricky ones included, until she handles them the way you would." },
  { n: "4", title: "You see every call", body: "Each call comes with a short summary and the recording. See how many calls she took and what she booked." },
];

/** The questions people actually ask before they buy, answered in one or two plain sentences. */
const faqs = [
  { q: "Is she just a chatbot?", a: "No. A chatbot only talks. Maya talks and does the work: she books, looks things up, updates records and sends messages in your own apps." },
  { q: "I already have a receptionist.", a: "Keep them. Maya covers nights, weekends, lunch breaks and busy times, so no call ever goes to voicemail." },
  { q: "We're small. Is this for us?", a: "Yes. Small businesses miss the most calls, because nobody is free to pick up. A missed call is often a customer who calls someone else." },
  { q: "Do I have to change my phone number?", a: "No. You keep your number. Send her every call, or only the ones you can't pick up. You choose." },
  { q: "Will callers know she's AI?", a: "She sounds like a real person, and she's honest about what she is. If someone asks, she tells them. Anyone who wants a person can reach one." },
  { q: "What if she gets something wrong?", a: "She follows the rules you set and only uses the apps her job needs. Every call is summarized, so you can check her work in seconds." },
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
        title="Bestly Agent: an AI receptionist that answers your phone and does the work"
        description="Bestly Agent answers every call, day or night, and does the work inside the apps you already use: books the appointment in your calendar, updates your customer list, and texts the confirmation."
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
            <h1 className="font-modern [text-wrap:balance] text-4xl font-semibold tracking-[-0.03em] [word-spacing:0.03em] text-foreground sm:text-5xl lg:text-6xl">
              An AI receptionist that answers your phone and does the work.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              She picks up every call, day or night, and sounds like a real person. Then she does the job. She books the
              appointment in your calendar, adds the caller to your customer list, and texts them a confirmation before they
              hang up.
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
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">What she does</p>
            <h2 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] [word-spacing:0.04em] text-foreground sm:text-4xl">
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
                  <h3 className="font-modern text-xl font-semibold tracking-[-0.012em] [word-spacing:0.05em] text-foreground">{d.title}</h3>
                  <p className="mt-3 text-muted-foreground">{d.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* 4. Works inside your apps: the thing that makes her more than a voice bot */}
      <section id="apps" className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-3xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Not just a chatbot</p>
            <h2 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] [word-spacing:0.04em] text-foreground sm:text-4xl">
              She works inside the apps you already use.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Most answering services take a message and leave the rest to you. We connect Maya to your tools, so she finishes
              the job while the caller is still on the phone.
            </p>
          </AnimatedSection>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((a, i) => (
              <AnimatedSection key={a.title} animation="fade-in-up" delay={i * 60}>
                <div className={`h-full rounded-2xl border p-6 ${a.names.length ? "border-border bg-card" : "border-dashed border-primary/40 bg-primary/[0.04]"}`}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <a.icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h3 className="font-modern text-lg font-semibold text-foreground">{a.title}</h3>
                  </div>
                  <p className="mt-4 text-muted-foreground">{a.body}</p>
                  {a.names.length > 0 && (
                    <ul className="mt-4 flex flex-wrap gap-2" aria-label={`${a.title} examples`}>
                      {a.names.map((n) => (
                        <li key={n} className="whitespace-nowrap rounded-full border border-border bg-background px-3 py-1 text-sm text-foreground">
                          {n}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </AnimatedSection>
            ))}
          </div>
          <AnimatedSection animation="fade-in" className="mt-8 flex max-w-2xl items-start gap-3 text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <p>We set up every connection for you. She only gets access to what her job needs, and nothing else.</p>
          </AnimatedSection>
        </div>
      </section>

      {/* 5. Every channel, every language */}
      <section id="channels" className="border-b border-border bg-background">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Everywhere your customers are</p>
            <h2 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] [word-spacing:0.04em] text-foreground sm:text-4xl">
              One agent for calls, texts, chat and email.
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Customers reach you in different ways. The same agent, with the same know-how, answers all of them.
            </p>
            <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {channels.map((c) => (
                <li key={c.label} className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3 text-foreground">
                  <c.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="whitespace-nowrap font-medium">{c.label}</span>
                </li>
              ))}
            </ul>
          </AnimatedSection>
          <AnimatedSection animation="fade-in" delay={80} className="self-center">
            <div className="rounded-2xl border border-border bg-card p-8">
              <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Languages className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="font-modern text-2xl font-semibold text-foreground">
                Speaks <span className="whitespace-nowrap">90+ languages.</span>
              </h3>
              <p className="mt-3 text-lg text-muted-foreground">
                A caller can start in Spanish, Korean, Chinese or Tagalog. She answers in their language, and you still get the
                summary in English.
              </p>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* 6. Works for any business */}
      <section id="industries" className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Any industry</p>
            <h2 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] [word-spacing:0.04em] text-foreground sm:text-4xl">
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
                    className="group flex h-full min-h-[44px] w-full flex-col rounded-2xl border border-border bg-card p-6 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0 active:translate-y-0 active:scale-[0.985] active:shadow-none active:duration-75"
                  >
                    <BizLogo slug={BRANDS[x.id].logo} size={44} className="mb-4 rounded-xl shadow-sm" />
                    <span className="font-modern text-xl font-semibold tracking-[-0.012em] [word-spacing:0.05em] text-foreground">{sc.chip}</span>
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
                className="group flex h-full min-h-[44px] w-full flex-col rounded-2xl border border-dashed border-primary/40 bg-primary/[0.04] p-6 text-left transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0 active:translate-y-0 active:scale-[0.985] active:shadow-none active:duration-75"
              >
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Plus className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="font-modern text-xl font-semibold tracking-[-0.012em] [word-spacing:0.05em] text-foreground">Yours</span>
                <span className="mt-2 block text-muted-foreground">Tell Maya what you do and she&rsquo;ll show you how it would work.</span>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
                  Talk to Maya <Mic className="h-4 w-4" aria-hidden="true" />
                </span>
              </button>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* 7. How it works */}
      <section id="how-it-works" className="border-b border-border bg-background">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">How it works</p>
            <h2 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] [word-spacing:0.04em] text-foreground sm:text-4xl">We set it all up for you.</h2>
          </AnimatedSection>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((s, i) => (
              <AnimatedSection key={s.n} animation="fade-in-up" delay={i * 80}>
                <div className="h-full rounded-2xl border border-border bg-card p-7">
                  <span className="mb-5 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                    {s.n}
                  </span>
                  <h3 className="font-modern text-xl font-semibold tracking-[-0.012em] [word-spacing:0.05em] text-foreground">{s.title}</h3>
                  <p className="mt-3 text-muted-foreground">{s.body}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* 8. Questions people ask before they buy */}
      <section id="questions" className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <AnimatedSection animation="fade-in" className="mb-12 max-w-2xl">
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-primary">Questions</p>
            <h2 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] [word-spacing:0.04em] text-foreground sm:text-4xl">What people ask us first.</h2>
          </AnimatedSection>
          <dl className="grid gap-5 md:grid-cols-2">
            {faqs.map((f, i) => (
              <AnimatedSection key={f.q} animation="fade-in-up" delay={i * 50}>
                <div className="h-full rounded-2xl border border-border bg-card p-6">
                  <dt className="font-modern text-lg font-semibold text-foreground">{f.q}</dt>
                  <dd className="mt-2 text-muted-foreground">{f.a}</dd>
                </div>
              </AnimatedSection>
            ))}
          </dl>
        </div>
      </section>

      {/* 9. Try her right now */}
      <section id="try-maya" className="border-b border-border bg-background">
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
            <h2 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] [word-spacing:0.04em] text-foreground sm:text-4xl">Try her right now.</h2>
            <p className="mt-4 max-w-xl text-lg text-muted-foreground">
              Maya is a Bestly Agent. Ask her anything, or pretend you are one of your own customers.
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

      {/* 10. CTA */}
      <section className="bg-secondary/20">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:py-24">
          <AnimatedSection animation="fade-in">
            <h2 className="font-modern [text-wrap:balance] text-3xl font-semibold tracking-[-0.025em] [word-spacing:0.04em] text-foreground sm:text-4xl">Get your own agent.</h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Tell us about your business. We set up your agent, connect your apps and test her, and you keep your phone
              number. If it is not a fit, we will tell you.
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
