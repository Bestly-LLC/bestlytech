import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Button } from "@/components/ui/button";
import { CallConsentNote } from "@/components/CallConsentNote";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { GradientText } from "@/components/ui/GradientText";
import { GlowCard } from "@/components/ui/GlowCard";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  createFillGuard, describeForm, noteManualEdit, registerForm, runSteps,
  type FillStep, type FormApi,
} from "@/components/maya/formBridge";
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Server,
  ShieldCheck,
} from "lucide-react";

const userBands = [
  { value: "5", label: "5-15" },
  { value: "25", label: "16-30" },
  { value: "50", label: "31-75" },
  { value: "100", label: "76-150" },
  { value: "200+", label: "150+" },
];

const pains = [
  { value: "cost", label: "Per-seat costs are getting absurd" },
  { value: "sovereignty", label: "Our data shouldn't live on someone else's servers" },
  { value: "ai-privacy", label: "We're nervous about feeding AI our proprietary info" },
  { value: "brand", label: "We want our cloud to wear our brand, not theirs" },
  { value: "lock-in", label: "We're locked into vendors that keep raising prices" },
  { value: "other", label: "Something else (tell us below)" },
];

const urgencies = [
  { value: "renewal-30", label: "Our renewal hits in the next 30 days" },
  { value: "renewal-90", label: "Renewal in the next 90 days" },
  { value: "renewal-180", label: "Renewal in the next 6 months" },
  { value: "exploring", label: "Exploring — no immediate deadline" },
];

/** The band for a head count Maya heard ("about 20 people" -> 16-30). */
function bandFor(n: number): string {
  if (n <= 15) return "5";
  if (n <= 30) return "25";
  if (n <= 75) return "50";
  if (n <= 150) return "100";
  return "200+";
}

/** The "what's pulling you toward this" option a few spoken words point to, or "" when none fits. */
function painFor(topic: string): string {
  const t = topic.toLowerCase();
  if (/\b(ai|llm|chatgpt|copilot|gemini|claude)\b/.test(t)) return "ai-privacy";
  if (/brand|white.?label|logo/.test(t)) return "brand";
  if (/lock.?in|vendor|raising|price hike/.test(t)) return "lock-in";
  if (/cost|price|pricing|expens|sav(e|ing)|seat|subscription|bill/.test(t)) return "cost";
  if (/data|sovereign|privacy|private|server|control|\bown\b/.test(t)) return "sovereignty";
  return "";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Nextcloud Appointments on cloud.bestly.tech.
// Replaces Cal.com — every prospect who books a discovery call is using
// the actual Bestly Cloud product before they buy it.
const DISCOVERY_CAL_URL = "https://cloud.bestly.tech/apps/calendar/appointment/BtktQYtGFocY";

export default function GetStarted() {
  const { toast } = useToast();
  const [params] = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ briefToken: string | null } | null>(null);

  const [form, setForm] = useState({
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    company_name: "",
    company_website: "",
    user_count_band: "",
    primary_pain: "",
    primary_pain_detail: "",
    urgency: "",
    honeypot: "",
  });

  // ---- Maya (formBridge.ts): she fills this very form, then presses Send after a clear yes ----
  const formRef = useRef<HTMLFormElement>(null);
  const live = useRef({ form, success });
  live.current = { form, success };
  const guard = useRef(createFillGuard()).current;
  const mem = useRef({ details: "", topicNote: "" });
  const waiter = useRef<((r: { ok: boolean; say: string }) => void) | null>(null);

  function handleInput(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target;
    setForm((p) => ({ ...p, [name]: value }));
    if (name !== "honeypot") noteManualEdit(guard, name, () => readNow().say);
  }

  function handleSelect(name: string, value: string) {
    setForm((p) => ({ ...p, [name]: value }));
    noteManualEdit(guard, name, () => readNow().say);
  }

  const valueOf = (id: string) =>
    (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";

  function readNow(): { say: string; missing: string[] } {
    const f = live.current.form;
    const v = {
      name: valueOf("contact_name"), email: valueOf("contact_email"), phone: valueOf("contact_phone"),
      company: valueOf("company_name"), detail: valueOf("primary_pain_detail"),
    };
    const band = userBands.find((b) => b.value === f.user_count_band);
    const missing: string[] = [];
    if (!v.name.trim()) missing.push("name");
    if (!v.email.trim()) missing.push("email");
    else if (!EMAIL_RE.test(v.email.trim())) missing.push("a valid email");
    if (!v.company.trim()) missing.push("company");
    if (!band) missing.push("team size");
    const pain = pains.find((p) => p.value === f.primary_pain);
    const say = describeForm(
      [
        { label: "name", value: v.name },
        { label: "email", value: v.email },
        { label: "phone", value: v.phone },
        { label: "company", value: v.company },
        { label: "team size", value: band ? `${band.label} people` : "" },
        { label: "topic", value: pain?.label ?? "" },
        { label: "details", value: v.detail },
      ],
      missing,
      ["phone", "details"],
    );
    return { say, missing };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const finish = (r: { ok: boolean; say: string }) => {
      const w = waiter.current;
      waiter.current = null;
      w?.(r);
    };

    if (form.honeypot) {
      finish({ ok: false, say: "The site couldn't send it just now. Offer to try again, or they can call (213) 641-0074." });
      return; // bot
    }

    if (
      !form.contact_name.trim() ||
      !form.contact_email.trim() ||
      !form.company_name.trim() ||
      !form.user_count_band
    ) {
      toast({
        title: "A few fields are missing",
        description: "Name, email, company, and team size are required.",
        variant: "destructive",
      });
      finish({ ok: false, say: `Not sent yet. Still needed: ${readNow().missing.join(", ")}.` });
      return;
    }

    if (!EMAIL_RE.test(form.contact_email)) {
      toast({
        title: "That email doesn't look right",
        description: "Please double-check the email address.",
        variant: "destructive",
      });
      finish({ ok: false, say: "Not sent yet. That email doesn't look right; ask them to spell it again." });
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        contact_name: form.contact_name,
        contact_email: form.contact_email,
        contact_phone: form.contact_phone || undefined,
        company_name: form.company_name,
        company_website: form.company_website || undefined,
        user_count_band: form.user_count_band,
        primary_pain: form.primary_pain || undefined,
        primary_pain_detail: form.primary_pain_detail || undefined,
        urgency: form.urgency || undefined,
        utm_source: params.get("utm_source") || undefined,
        utm_medium: params.get("utm_medium") || undefined,
        utm_campaign: params.get("utm_campaign") || undefined,
        referrer: typeof document !== "undefined" ? document.referrer || undefined : undefined,
      };

      const { data, error } = await supabase.functions.invoke("submit-cloud-lead", {
        body: payload,
      });

      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error || "submission failed");

      setSuccess({ briefToken: data?.brief_token ?? null });
      // The thank-you replaces the form; bring it into view instead of leaving them wherever the form ended.
      window.scrollTo({ top: 0, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      toast({
        title: "We've got your details.",
        description: "Pick your discovery slot below — Jared will be in touch.",
      });
      finish({
        ok: true,
        say: "Sent. Their details are with the team, and the page now offers a time for a 30 minute discovery call. Point them to Book the call.",
      });
    } catch (err) {
      console.error("submit error", err);
      toast({
        title: "Couldn't submit",
        description: (err instanceof Error && err.message) || "Please try again, or email jared@bestly.tech.",
        variant: "destructive",
      });
      finish({ ok: false, say: "The site couldn't send it just now. Offer to try once more, or they can call (213) 641-0074." });
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    const api: FormApi = {
      id: "cloud-lead",
      element: () => formRef.current,
      read: () => (live.current.success ? { say: "Their details were already sent.", missing: [] } : readNow()),
      fill: async (v) => {
        if (live.current.success || !formRef.current) {
          return { say: live.current.success ? "Their details were already sent; the page moved on to booking the call." : "The form isn't on screen right now.", missing: [] };
        }
        const text = (k: keyof typeof v, max: number) => (v[k] == null ? undefined : String(v[k]).replace(/\s+/g, " ").trim().slice(0, max));
        const name = text("name", 100);
        const email = text("email", 255)?.toLowerCase();
        const phone = text("phone", 40);
        const company = text("company", 120);
        const topic = text("topic", 200);
        const details = v.details == null ? undefined : String(v.details).trim().slice(0, 4000);
        const teamNum = Number(String(v.team_size ?? "").replace(/[^0-9.]/g, ""));

        const steps: FillStep[] = [];
        const textStep = (id: string, label: string, next: string | undefined) => {
          if (!next) return;
          steps.push({ id, label, el: () => document.getElementById(id), get: () => valueOf(id), next, text: true });
        };
        textStep("contact_name", "name", name);
        textStep("contact_email", "email", email);
        textStep("contact_phone", "phone", phone);
        textStep("company_name", "company", company);

        const selectStep = (id: string, label: string, next: string) =>
          steps.push({
            id, label, el: () => document.getElementById(id), get: () => (live.current.form as Record<string, string>)[id] ?? "",
            next, text: false, apply: (val) => setForm((p) => ({ ...p, [id]: val })),
          });
        if (teamNum > 0) selectStep("user_count_band", "team size", bandFor(teamNum));
        const pain = topic ? painFor(topic) : "";
        if (pain) selectStep("primary_pain", "topic", pain);

        // A topic that is not one of the options is kept as a line in the details, so nothing she heard is lost.
        const prev = `${mem.current.topicNote}|${mem.current.details}`;
        if (topic !== undefined) mem.current.topicNote = topic && !pain && !/^(bestly\s+)?(in-house\s+)?cloud( demo)?$/i.test(topic) ? `Interested in: ${topic}` : "";
        if (details !== undefined) mem.current.details = details;
        const composed = [mem.current.topicNote, mem.current.details].filter(Boolean).join("\n\n");
        let keptDetails = false;
        if (composed) {
          const changed = `${mem.current.topicNote}|${mem.current.details}` !== prev;
          if (guard.edited.has("primary_pain_detail") && !changed) keptDetails = true;
          else steps.push({ id: "primary_pain_detail", label: "details", el: () => document.getElementById("primary_pain_detail"), get: () => valueOf("primary_pain_detail"), next: composed, text: true });
        }

        const out = await runSteps(guard, steps);
        if (keptDetails) out.kept.push("details");
        await wait(40);
        const r = readNow();
        const bits = [
          out.filled.length ? `Typed into the form: ${out.filled.join(", ")}.` : "Nothing new to type.",
          out.replaced.length ? `That replaced what the visitor had typed in ${out.replaced.join(", ")}; say so.` : "",
          out.kept.length ? `Left ${out.kept.join(", ")} as the visitor typed it.` : "",
          r.say,
        ];
        return { say: bits.filter(Boolean).join(" "), missing: r.missing };
      },
      submit: async () => {
        if (live.current.success) return { ok: false, say: "Their details were already sent." };
        const r = readNow();
        if (r.missing.length) return { ok: false, say: `Not sent yet. Still needed: ${r.missing.join(", ")}.` };
        const formEl = formRef.current;
        if (!formEl) return { ok: false, say: "The form isn't on screen right now." };
        if (!formEl.checkValidity()) return { ok: false, say: "Not sent yet. The form says something in it isn't valid; read it back and fix it." };
        if (waiter.current) return { ok: false, say: "It is already sending." };
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (waiter.current === done) {
              waiter.current = null;
              resolve({ ok: false, say: "It didn't confirm in time. Ask the visitor to check the page, or try once more." });
            }
          }, 12000);
          const done = (res: { ok: boolean; say: string }) => { clearTimeout(timer); resolve(res); };
          waiter.current = done;
          formEl.requestSubmit();
        });
      },
    };
    return registerForm(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stripe payment links redirect here with ?paid=<deal id> after the deposit.
  // Show a plain thank-you. The id is never looked up, so the URL reveals nothing;
  // the intake link arrives by email (sent by the Stripe webhook).
  if (params.has("paid")) {
    return (
      <>
        <SEOHead
          title="Payment received — thank you"
          description="Your Bestly In-House Cloud deposit is in."
        />
        <div className="relative overflow-hidden">
          <div className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
            <AnimatedSection>
              <div className="text-center mb-10">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 mb-5">
                  <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                </div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl mb-3">
                  Payment received. Thank you.
                </h1>
                <p className="text-lg text-muted-foreground">
                  Your deposit is in and your deployment is officially on the schedule.
                </p>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={80}>
              <GlowCard className="mb-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Server className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-1">Next — the technical intake</h3>
                    <p className="text-sm text-muted-foreground">
                      We've emailed you a private link to the technical intake: five short sections on
                      network, branding, users, migration, and policy. Forward it to whoever runs IT for you.
                    </p>
                  </div>
                </div>
              </GlowCard>
            </AnimatedSection>

            <AnimatedSection delay={140}>
              <p className="text-sm text-muted-foreground text-center mt-8">
                Didn't get the email within a few minutes? Write to{" "}
                <a
                  href="mailto:jared@bestly.tech"
                  className="text-foreground underline underline-offset-4 hover:text-primary transition-colors"
                >
                  jared@bestly.tech
                </a>
                .
              </p>
            </AnimatedSection>
          </div>
        </div>
      </>
    );
  }

  if (success) {
    return (
      <>
        <SEOHead
          title="Thanks — let's pick a discovery slot"
          description="Your In-House Cloud discovery call is one click away."
        />
        <div className="relative overflow-hidden">
          <div className="mx-auto max-w-3xl px-6 py-16 lg:py-24">
            <AnimatedSection>
              <div className="text-center mb-10">
                <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 mb-5">
                  <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                </div>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl mb-3">
                  We've got your details.
                </h1>
                <p className="text-lg text-muted-foreground">
                  Two more steps and we'll walk into your call already prepped.
                </p>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={80}>
              <GlowCard className="mb-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    <Calendar className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold">Step 1 — Pick your discovery slot</h3>
                      <Badge variant="outline" className="text-xs">
                        30 min
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      No obligation. We'll do a line-by-line map of your current IT spend vs. what
                      a Bestly Cloud deployment would cost — whether you move forward or not.
                    </p>
                    <Button asChild className="gap-2">
                      <a href={DISCOVERY_CAL_URL} target="_blank" rel="noopener noreferrer">
                        Book the call
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </div>
              </GlowCard>
            </AnimatedSection>

            {success.briefToken && (
              <AnimatedSection delay={140}>
                <GlowCard className="mb-5">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-semibold">Step 2 — Five-minute brief</h3>
                        <Badge variant="outline" className="text-xs">
                          Optional
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mb-4">
                        A few quick questions about your current stack so we walk in with context,
                        not cold. Saves real time on the call.
                      </p>
                      <Button asChild variant="outline" className="gap-2">
                        <Link to={`/brief/${success.briefToken}`}>
                          Fill the brief
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                </GlowCard>
              </AnimatedSection>
            )}

            <AnimatedSection delay={200}>
              <p className="text-sm text-muted-foreground text-center mt-8">
                Questions before the call?{" "}
                <a
                  href="mailto:jared@bestly.tech"
                  className="text-foreground underline underline-offset-4 hover:text-primary transition-colors"
                >
                  jared@bestly.tech
                </a>
              </p>
            </AnimatedSection>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <SEOHead
        title="Get started — your private cloud, line-by-line"
        description="Book a 30-minute discovery call for the Bestly In-House Cloud. We'll map your current IT spend vs. deployment cost — whether you move forward or not."
      />

      <div className="relative overflow-hidden">
        <div className="mx-auto max-w-3xl px-6 py-12 lg:py-20">
          <AnimatedSection>
            <div className="mb-10 text-center">
              <Badge variant="outline" className="mb-4 border-primary/30 text-primary">
                In-House Cloud — Discovery
              </Badge>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                Your data. Your brand.
                <br />
                <GradientText>Your cloud.</GradientText>
              </h1>
              <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Tell us about your team. We'll come back with a line-by-line map of your current IT
                spend vs. what a Bestly Cloud deployment would cost — whether you move forward or
                not.
              </p>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={60}>
            <div className="grid grid-cols-3 gap-3 mb-10 text-sm">
              <div className="rounded-xl border border-border bg-secondary/30 p-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary shrink-0" />
                <span className="text-muted-foreground">30 min, no obligation</span>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 p-3 flex items-center gap-2">
                <Server className="h-4 w-4 text-primary shrink-0" />
                <span className="text-muted-foreground">For 5–200+ users</span>
              </div>
              <div className="rounded-xl border border-border bg-secondary/30 p-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary shrink-0" />
                <span className="text-muted-foreground">Confidential</span>
              </div>
            </div>
          </AnimatedSection>

          <AnimatedSection delay={100}>
            <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
              {/* Honeypot — hidden from real users */}
              <div className="absolute -left-[9999px]" aria-hidden>
                <Label htmlFor="honeypot">Leave this empty</Label>
                <Input
                  className="h-11"
                  id="honeypot"
                  name="honeypot"
                  value={form.honeypot}
                  onChange={handleInput}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="contact_name">Your name *</Label>
                  <Input
                    className="h-11"
                    id="contact_name"
                    name="contact_name"
                    value={form.contact_name}
                    onChange={handleInput}
                    placeholder="Jane Cooper"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="contact_email">Email *</Label>
                  <Input
                    className="h-11"
                    id="contact_email"
                    name="contact_email"
                    type="email"
                    value={form.contact_email}
                    onChange={handleInput}
                    placeholder="jane@yourcompany.com"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="company_name">Company *</Label>
                  <Input
                    className="h-11"
                    id="company_name"
                    name="company_name"
                    value={form.company_name}
                    onChange={handleInput}
                    placeholder="Acme Co"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="company_website">Company website</Label>
                  <Input
                    className="h-11"
                    id="company_website"
                    name="company_website"
                    value={form.company_website}
                    onChange={handleInput}
                    placeholder="acme.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="contact_phone">Phone (optional)</Label>
                  <Input
                    className="h-11"
                    id="contact_phone"
                    name="contact_phone"
                    type="tel"
                    value={form.contact_phone}
                    onChange={handleInput}
                    placeholder="+1 (555) 123-4567"
                  />
                </div>
                <div>
                  <Label htmlFor="user_count_band">Team size *</Label>
                  <Select
                    value={form.user_count_band}
                    onValueChange={(v) => handleSelect("user_count_band", v)}
                  >
                    <SelectTrigger id="user_count_band" className="h-11">
                      <SelectValue placeholder="How many people?" />
                    </SelectTrigger>
                    <SelectContent>
                      {userBands.map((b) => (
                        <SelectItem key={b.value} value={b.value}>
                          {b.label} people
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="primary_pain">What's pulling you toward this?</Label>
                <Select
                  value={form.primary_pain}
                  onValueChange={(v) => handleSelect("primary_pain", v)}
                >
                  <SelectTrigger id="primary_pain" className="h-11">
                    <SelectValue placeholder="Pick the closest fit" />
                  </SelectTrigger>
                  <SelectContent>
                    {pains.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="urgency">Timing</Label>
                <Select
                  value={form.urgency}
                  onValueChange={(v) => handleSelect("urgency", v)}
                >
                  <SelectTrigger id="urgency" className="h-11">
                    <SelectValue placeholder="When do you need this?" />
                  </SelectTrigger>
                  <SelectContent>
                    {urgencies.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="primary_pain_detail">Anything else we should know?</Label>
                <Textarea
                  id="primary_pain_detail"
                  name="primary_pain_detail"
                  value={form.primary_pain_detail}
                  onChange={handleInput}
                  placeholder="Optional. Even one sentence helps us prep."
                  rows={3}
                />
              </div>

              <div className="pt-2">
                <CallConsentNote className="mb-3" />
                <Button
                  type="submit"
                  size="lg"
                  className="w-full sm:w-auto gap-2"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      Continue to scheduling
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
                <p className="mt-3 text-xs text-muted-foreground">
                  We'll email you a calendar link and a short brief to fill out before the call.
                  No spam, no sharing — just the call. See our{" "}
                  <Link to="/privacy-policy" className="underline underline-offset-2">
                    privacy policy
                  </Link>
                  .
                </p>
              </div>
            </form>
          </AnimatedSection>
        </div>
      </div>
    </>
  );
}
