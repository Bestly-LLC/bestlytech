import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Mail, MapPin, Loader2, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { OrbitsBackground } from "@/components/wow/backgrounds/OrbitsBackground";
import {
  SALES_WORDS, createFillGuard, describeForm, getMayaConversationId, noteManualEdit, registerForm, runSteps,
  type FillStep, type FormApi,
} from "@/components/maya/formBridge";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMPTY = { name: "", email: "", phone: "", category: "", subject: "", message: "" };
// ?topic= links (for example the /agent page's "Get your own agent") open the form already pointed at sales.
const TOPICS: Record<string, string> = { agent: "Bestly Agent", cloud: "Bestly Cloud" };
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default function Contact() {
  const { toast } = useToast();
  const [params] = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [sentSales, setSentSales] = useState(false);
  const [formData, setFormData] = useState(() => {
    const topic = TOPICS[(params.get("topic") ?? "").toLowerCase()];
    return topic ? { ...EMPTY, category: "sales", subject: topic } : EMPTY;
  });

  // ---- Maya (formBridge.ts): she fills this very form, then presses Send after a clear yes ----
  const formRef = useRef<HTMLFormElement>(null);
  const live = useRef({ formData, isSuccess });
  live.current = { formData, isSuccess };
  const guard = useRef(createFillGuard()).current;
  const mem = useRef({ company: "", team: "", details: "" });
  const viaMaya = useRef(false);
  const waiter = useRef<((r: { ok: boolean; say: string }) => void) | null>(null);
  const resetSuccess = useRef<() => void>(() => {});
  resetSuccess.current = () => setIsSuccess(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    const finish = (r: { ok: boolean; say: string }) => {
      const w = waiter.current;
      waiter.current = null;
      w?.(r);
    };

    try {
      const { error } = await supabase.functions.invoke("submit-contact", {
        body: {
          ...formData,
          phone: formData.phone.trim() || undefined,
          source: viaMaya.current ? "maya" : "web",
          conversation_id: viaMaya.current ? getMayaConversationId() ?? undefined : undefined,
        },
      });

      if (error) throw error;

      const sales = formData.category === "sales";
      setSentSales(sales);
      setIsSuccess(true);
      toast({
        title: "Message sent",
        description: sales
          ? "Thank you for contacting us. We'll respond within 1\u00a0business\u00a0day."
          : "Thank you for contacting us. We'll respond within 2-3\u00a0business\u00a0days.",
      });

      setFormData(EMPTY);
      guard.edited.clear();
      guard.mine.clear();
      mem.current = { company: "", team: "", details: "" };
      viaMaya.current = false;
      finish({
        ok: true,
        say: sales
          ? "Sent. The team has it now and replies within one business day."
          : "Sent. The team has it now and replies within two to three business days.",
      });
    } catch (error) {
      console.error("Contact form error:", error);
      toast({
        title: "Error",
        description: "There was a problem sending your message. Please try again.",
        variant: "destructive",
      });
      finish({
        ok: false,
        say: "The site couldn't send it just now. Offer to try once more, or they can call (213) 641-0074.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    noteManualEdit(guard, name, () => readNow().say);
  };

  // Always the live page (refs only), so Maya's tools never read a stale closure.
  const valueOf = (id: string) =>
    (document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
  function snapshot() {
    return {
      name: valueOf("name"),
      email: valueOf("email"),
      phone: valueOf("phone"),
      subject: valueOf("subject"),
      message: valueOf("message"),
      category: live.current.formData.category,
    };
  }
  function readNow(): { say: string; missing: string[] } {
    const f = snapshot();
    const missing: string[] = [];
    if (!f.name.trim()) missing.push("name");
    if (!f.email.trim()) missing.push("email");
    else if (!EMAIL_RE.test(f.email.trim())) missing.push("a valid email");
    if (!f.subject.trim()) missing.push("topic");
    if (!f.message.trim()) missing.push("details");
    const say = describeForm(
      [
        { label: "name", value: f.name },
        { label: "email", value: f.email },
        { label: "phone", value: f.phone },
        { label: "topic", value: f.subject },
        { label: "details", value: f.message },
      ],
      missing,
      ["phone"],
    );
    return { say: f.category === "sales" ? `${say} Filed as a sales question.` : say, missing };
  }

  useEffect(() => {
    const api: FormApi = {
      id: "contact",
      element: () => formRef.current,
      read: () => (live.current.isSuccess ? { say: "That message was already sent.", missing: [] } : readNow()),
      fill: async (v) => {
        // After a send the form is replaced by a thank-you card; a new fill means another message.
        if (live.current.isSuccess) {
          resetSuccess.current();
          for (let i = 0; i < 20 && !formRef.current; i++) await wait(50);
          if (!formRef.current) return { say: "The form isn't on screen right now.", missing: [] };
        }
        viaMaya.current = true;
        const text = (k: keyof typeof v, max: number) => (v[k] == null ? undefined : String(v[k]).replace(/\s+/g, " ").trim().slice(0, max));
        const name = text("name", 100);
        const email = text("email", 255)?.toLowerCase();
        const phone = text("phone", 40);
        const topic = text("topic", 200);
        const details = v.details == null ? undefined : String(v.details).trim().slice(0, 4000);
        const company = text("company", 120);
        const teamNum = Number(String(v.team_size ?? "").replace(/[^0-9.]/g, ""));

        const prevDetails = mem.current.details;
        if (company !== undefined) mem.current.company = company;
        if (v.team_size != null) mem.current.team = teamNum > 0 ? String(Math.round(teamNum)) : "";
        if (details !== undefined) mem.current.details = details;
        const extras = [mem.current.company && `Company: ${mem.current.company}`, mem.current.team && `Team size: ${mem.current.team}`]
          .filter(Boolean).join(" \u00b7 ");
        const composed = mem.current.details ? (extras ? `${mem.current.details}\n\n${extras}` : mem.current.details) : "";

        const steps: FillStep[] = [];
        const textStep = (id: string, label: string, next: string | undefined) => {
          if (next === undefined || next === "") return;
          steps.push({ id, label, el: () => document.getElementById(id), get: () => valueOf(id), next, text: true });
        };
        textStep("name", "name", name);
        textStep("email", "email", email);
        textStep("phone", "phone", phone);
        textStep("subject", "topic", topic);

        let keptMessage = false;
        if (composed) {
          const changed = details !== undefined && details !== prevDetails;
          if (guard.edited.has("message") && !changed) keptMessage = true;
          else steps.push({ id: "message", label: "details", el: () => document.getElementById("message"), get: () => valueOf("message"), next: composed, text: true });
        }

        // A business asking about a Bestly product (or naming Agent / Cloud / a demo) is a sales question.
        const cat = live.current.formData.category;
        const wantSales = !!(mem.current.company || mem.current.team || SALES_WORDS.test(`${topic ?? ""} ${details ?? ""}`));
        if (!guard.edited.has("category") && (cat === "" || (wantSales && cat !== "sales"))) {
          const next = wantSales ? "sales" : "general";
          if (cat !== next) {
            steps.push({
              id: "category", label: "category", el: () => document.getElementById("category"), get: () => live.current.formData.category,
              next, text: false, apply: (val) => setFormData((p) => ({ ...p, category: val })),
            });
          }
        }

        const out = await runSteps(guard, steps);
        if (keptMessage) out.kept.push("details");
        await wait(40);
        const r = readNow();
        const bits = [
          out.filled.length ? `Typed into the form: ${out.filled.filter((x) => x !== "category").join(", ") || "the category"}.` : "Nothing new to type.",
          out.replaced.length ? `That replaced what the visitor had typed in ${out.replaced.join(", ")}; say so.` : "",
          out.kept.length ? `Left ${out.kept.join(", ")} as the visitor typed it.` : "",
          r.say,
        ];
        return { say: bits.filter(Boolean).join(" "), missing: r.missing };
      },
      submit: async () => {
        if (live.current.isSuccess) return { ok: false, say: "That message was already sent." };
        const r = readNow();
        if (r.missing.length) return { ok: false, say: `Not sent yet. Still needed: ${r.missing.join(", ")}.` };
        const form = formRef.current;
        if (!form) return { ok: false, say: "The form isn't on screen right now." };
        if (!form.checkValidity()) return { ok: false, say: "Not sent yet. The form says something in it isn't valid; read it back and fix it." };
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
          form.requestSubmit();
        });
      },
    };
    return registerForm(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <SEOHead
        title="Contact Us"
        description="Have a question, partnership inquiry, or need support? Contact Bestly LLC and we'll get back to you within 2-3 business days."
        path="/contact"
      />

      <div className="relative overflow-hidden">
        {/* WOW v7 — slow orbiting rings, calm contact-page feel */}
        <div className="absolute inset-0 pointer-events-none opacity-70">
          <OrbitsBackground />
        </div>
        <div className="relative mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
        {/* Page Header */}
        <AnimatedSection className="mb-16 max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Contact Us
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            Drop us a line. We'll get back to you within <span className="whitespace-nowrap">2-3 business days</span>.
          </p>
        </AnimatedSection>

        <div className="grid gap-12 lg:grid-cols-3">
          {/* Contact Form */}
          <AnimatedSection className="lg:col-span-2" delay={100}>
            {isSuccess ? (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-8 text-center">
                <div className="flex justify-center mb-4">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                    <CheckCircle2 className="h-8 w-8 text-primary" />
                  </div>
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">Message Sent!</h3>
                <p className="text-muted-foreground mb-6">
                  {sentSales
                    ? "Thank you for reaching out. We'll get back to you within 1\u00a0business\u00a0day."
                    : "Thank you for reaching out. We'll get back to you within 2-3\u00a0business\u00a0days."}
                </p>
                <Button variant="outline" className="min-h-[44px]" onClick={() => setIsSuccess(false)}>
                  Send Another Message
                </Button>
              </div>
            ) : (
              <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
                      className="h-11"
                      id="name"
                      name="name"
                      type="text"
                      required
                      value={formData.name}
                      onChange={handleChange}
                      placeholder="Your name"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email *</Label>
                    <Input
                      className="h-11"
                      id="email"
                      name="email"
                      type="email"
                      required
                      value={formData.email}
                      onChange={handleChange}
                      placeholder="you@example.com"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone (optional)</Label>
                    <Input
                      className="h-11"
                      id="phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      maxLength={40}
                      value={formData.phone}
                      onChange={handleChange}
                      placeholder="+1 (555) 123-4567"
                      disabled={isSubmitting}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category">Category *</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) => {
                        setFormData((prev) => ({ ...prev, category: value }));
                        noteManualEdit(guard, "category", () => readNow().say);
                      }}
                      required
                      disabled={isSubmitting}
                    >
                      <SelectTrigger id="category" className="h-11">
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sales">Sales / Book a demo</SelectItem>
                        <SelectItem value="app-support">App Support</SelectItem>
                        <SelectItem value="platform-partners">Platform Partners</SelectItem>
                        <SelectItem value="retail-distribution">Retail / Distribution</SelectItem>
                        <SelectItem value="hardware-support">Hardware / Device Support</SelectItem>
                        <SelectItem value="privacy">Privacy Inquiry</SelectItem>
                        <SelectItem value="general">General Inquiry</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="subject">Subject *</Label>
                  <Input
                    className="h-11"
                    id="subject"
                    name="subject"
                    type="text"
                    required
                    value={formData.subject}
                    onChange={handleChange}
                    placeholder="Brief description of your inquiry"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="message">Message *</Label>
                  <Textarea
                    id="message"
                    name="message"
                    required
                    value={formData.message}
                    onChange={handleChange}
                    placeholder="Please provide details about your inquiry..."
                    className="min-h-[150px]"
                    disabled={isSubmitting}
                  />
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                  <Button type="submit" disabled={isSubmitting} className="min-h-[44px] w-full sm:w-auto">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Send Message"
                    )}
                  </Button>
                  {formData.category === "sales" && (
                    <p className="text-sm text-muted-foreground">
                      Sales questions get a reply within <span className="whitespace-nowrap">1 business day</span>.
                    </p>
                  )}
                </div>
              </form>
            )}
          </AnimatedSection>

          {/* Contact Information Sidebar */}
          <AnimatedSection className="lg:col-span-1" delay={200}>
            <div className="sticky top-24 space-y-8">
              {/* Company Info */}
              <div className="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md">
                <h3 className="text-lg font-semibold text-foreground mb-4">
                  Bestly LLC
                </h3>
                <div className="space-y-4 text-muted-foreground">
                  <div className="flex gap-3">
                    <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <span>5850 W 3rd St, Ste E PMB1012<br />Los Angeles, CA 90036</span>
                  </div>
                </div>
              </div>

              {/* Email Contacts */}
              <div className="rounded-xl border border-border bg-card p-6 transition-shadow hover:shadow-md">
                <h3 className="text-lg font-semibold text-foreground mb-4">
                  Email Contacts
                </h3>
                <div className="space-y-4">
                  <div className="flex gap-3">
                    <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">General Support</p>
                      <a
                        href="mailto:support@bestly.tech"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        support@bestly.tech
                      </a>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <Mail className="h-5 w-5 shrink-0 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Privacy Inquiries</p>
                      <a
                        href="mailto:privacy@bestly.tech"
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        privacy@bestly.tech
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Response Time */}
              <div className="rounded-xl border border-border bg-secondary/30 p-6">
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  Response Time
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We typically respond to inquiries within{" "}
                  <span className="whitespace-nowrap">2-3 business days</span>.
                  For urgent privacy-related matters, please email{" "}
                  <a
                    href="mailto:privacy@bestly.tech"
                    className="text-foreground underline underline-offset-4"
                  >
                    privacy@bestly.tech
                  </a>{" "}
                  directly.
                </p>
              </div>
            </div>
          </AnimatedSection>
        </div>
        </div>
      </div>
    </>
  );
}
