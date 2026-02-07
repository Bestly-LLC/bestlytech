import { useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { SEOHead } from "@/components/SEOHead";
import { AnimatedSection } from "@/components/AnimatedSection";
import { Button } from "@/components/ui/button";
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
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, Briefcase, MessageSquare, Handshake, ArrowRight } from "lucide-react";

const projectTypes = [
  { value: "web-app", label: "Web Application" },
  { value: "mobile-app", label: "Mobile App" },
  { value: "browser-extension", label: "Browser Extension" },
  { value: "ai-automation", label: "AI / Automation" },
  { value: "consulting", label: "Consulting" },
  { value: "other", label: "Other" },
];

const budgetRanges = [
  { value: "under-5k", label: "Under $5K" },
  { value: "5k-15k", label: "$5K - $15K" },
  { value: "15k-50k", label: "$15K - $50K" },
  { value: "50k-plus", label: "$50K+" },
  { value: "not-sure", label: "Not Sure" },
];

const timelines = [
  { value: "asap", label: "ASAP" },
  { value: "1-2-months", label: "1-2 Months" },
  { value: "3-6-months", label: "3-6 Months" },
  { value: "flexible", label: "Flexible" },
];

export default function Hire() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    projectType: "",
    budgetRange: "",
    timeline: "",
    description: "",
    referralSource: "",
    honeypot: "", // Hidden field for bot detection
  });

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate required fields
    if (!formData.name.trim() || !formData.email.trim() || !formData.projectType || !formData.description.trim()) {
      toast({
        title: "Missing required fields",
        description: "Please fill in all required fields.",
        variant: "destructive",
      });
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      toast({
        title: "Invalid email",
        description: "Please enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const { data, error } = await supabase.functions.invoke("submit-hire-request", {
        body: formData,
      });

      if (error) throw error;

      if (data?.error) {
        throw new Error(data.error);
      }

      setIsSuccess(true);
      toast({
        title: "Request submitted!",
        description: "We'll be in touch within 2-3 business days.",
      });
    } catch (error: any) {
      console.error("Submission error:", error);
      toast({
        title: "Submission failed",
        description: error.message || "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Layout>
      <SEOHead
        title="Hire Jared Best | Business Development & Technology"
        description="Partner with me on your next project. From web development to AI automation, I offer consulting, advisory, and revenue-share partnerships for startups and small businesses."
        path="/hire"
      />

      {/* Personal Introduction Section */}
      <section className="relative overflow-hidden py-16 md:py-20 border-b border-border">
        <div className="absolute inset-0 bg-mesh opacity-50" />
        <div className="relative mx-auto max-w-4xl px-6 lg:px-8">
          <AnimatedSection animation="fade-in">
            <div className="text-center">
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                Let's Build Something Together
              </h1>
              <p className="mt-6 text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto">
                5+ years helping businesses navigate technology, strategy, and growth. My best work comes from true partnerships.
              </p>
            </div>
          </AnimatedSection>

          {/* What to Expect */}
          <AnimatedSection animation="fade-in" delay={100}>
            <div className="mt-12 grid gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-4">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">How It Works</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Fill out the form below with your project details. I'll review everything 
                  and reach out within 2-3 business days to schedule a conversation—no 
                  commitment, just a chat to see if we're a good fit.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card p-6">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10 mb-4">
                  <Handshake className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">How I Work</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  I typically engage through consulting/advisory relationships or revenue-share 
                  partnerships. This means we're aligned on outcomes, and I'm invested in your 
                  long-term success—not just the project deliverable.
                </p>
              </div>
            </div>
          </AnimatedSection>

          {/* Quick Services Link */}
          <AnimatedSection animation="fade-in" delay={150}>
            <div className="mt-8 text-center">
              <p className="text-sm text-muted-foreground">
                Want to know more about what I offer?{" "}
                <Link 
                  to="/services" 
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  View my services
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </p>
            </div>
          </AnimatedSection>
        </div>
      </section>

      {/* What Happens Next */}
      <section className="border-b border-border bg-secondary/20">
        <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8">
          <AnimatedSection animation="fade-in" className="text-center mb-10">
            <h2 className="text-2xl font-semibold text-foreground">What Happens Next</h2>
          </AnimatedSection>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { step: "1", title: "Review", desc: "I review your project details within 24 hours." },
              { step: "2", title: "Quick Call", desc: "A 15-minute conversation to align on goals and fit." },
              { step: "3", title: "Proposal", desc: "A clear plan with scope, timeline, and investment." },
            ].map((s, i) => (
              <AnimatedSection key={s.step} delay={i * 100}>
                <div className="text-center p-6 rounded-2xl border border-border bg-card">
                  <div className="inline-flex items-center justify-center w-10 h-10 rounded-full gradient-bg text-white text-sm font-semibold mb-4">
                    {s.step}
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{s.title}</h3>
                  <p className="text-sm text-muted-foreground">{s.desc}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>
        </div>
      </section>

      {/* Form Section */}
      <div className="py-16 md:py-20">
        <div className="mx-auto max-w-3xl px-6 lg:px-8">
          <AnimatedSection animation="fade-in">
            <div className="text-center mb-10">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 mb-5">
                <Briefcase className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Tell Me About Your Project
              </h2>
              <p className="mt-3 text-muted-foreground">
                The more detail you provide, the better I can understand how to help.
              </p>
            </div>
          </AnimatedSection>

          {isSuccess ? (
            <AnimatedSection animation="scale-in">
              <div className="rounded-2xl border border-border bg-card p-8 md:p-12 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-6">
                  <CheckCircle2 className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <h2 className="text-2xl font-semibold text-foreground mb-4">
                  Request Submitted!
                </h2>
                <p className="text-muted-foreground mb-6">
                  Thank you for reaching out. I've received your project details and will be in touch within 2-3 business days.
                </p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsSuccess(false);
                    setFormData({
                      name: "",
                      email: "",
                      company: "",
                      projectType: "",
                      budgetRange: "",
                      timeline: "",
                      description: "",
                      referralSource: "",
                      honeypot: "",
                    });
                  }}
                >
                  Submit Another Request
                </Button>
              </div>
            </AnimatedSection>
          ) : (
            <AnimatedSection animation="fade-in" delay={100}>
              <form
                onSubmit={handleSubmit}
                className="rounded-2xl border border-border bg-card p-6 md:p-8 space-y-6"
              >
                {/* Honeypot field - hidden from users */}
                <input
                  type="text"
                  name="honeypot"
                  value={formData.honeypot}
                  onChange={handleInputChange}
                  className="absolute -left-[9999px] opacity-0 pointer-events-none"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                />

                <div className="grid gap-6 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">
                      Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="name"
                      name="name"
                      type="text"
                      placeholder="Your name"
                      value={formData.name}
                      onChange={handleInputChange}
                      required
                      maxLength={100}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">
                      Email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="you@example.com"
                      value={formData.email}
                      onChange={handleInputChange}
                      required
                      maxLength={255}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="company">Company / Organization</Label>
                  <Input
                    id="company"
                    name="company"
                    type="text"
                    placeholder="Your company name (optional)"
                    value={formData.company}
                    onChange={handleInputChange}
                    maxLength={200}
                  />
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="projectType">
                      Project Type <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={formData.projectType}
                      onValueChange={(value) => handleSelectChange("projectType", value)}
                      required
                    >
                      <SelectTrigger id="projectType" className="bg-background">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent className="bg-background border border-border">
                        {projectTypes.map((type) => (
                          <SelectItem key={type.value} value={type.value}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="budgetRange">Budget Range</Label>
                    <Select
                      value={formData.budgetRange}
                      onValueChange={(value) => handleSelectChange("budgetRange", value)}
                    >
                      <SelectTrigger id="budgetRange" className="bg-background">
                        <SelectValue placeholder="Select budget" />
                      </SelectTrigger>
                      <SelectContent className="bg-background border border-border">
                        {budgetRanges.map((range) => (
                          <SelectItem key={range.value} value={range.value}>
                            {range.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="timeline">Timeline</Label>
                    <Select
                      value={formData.timeline}
                      onValueChange={(value) => handleSelectChange("timeline", value)}
                    >
                      <SelectTrigger id="timeline" className="bg-background">
                        <SelectValue placeholder="Select timeline" />
                      </SelectTrigger>
                      <SelectContent className="bg-background border border-border">
                        {timelines.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">
                    Project Description <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="description"
                    name="description"
                    placeholder="Tell me about your project, goals, and any specific requirements..."
                    value={formData.description}
                    onChange={handleInputChange}
                    required
                    maxLength={5000}
                    rows={6}
                    className="resize-none"
                  />
                  <p className="text-xs text-muted-foreground">
                    {formData.description.length}/5000 characters
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="referralSource">How did you hear about me?</Label>
                  <Input
                    id="referralSource"
                    name="referralSource"
                    type="text"
                    placeholder="e.g., Google, referral, Twitter, etc."
                    value={formData.referralSource}
                    onChange={handleInputChange}
                    maxLength={200}
                  />
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    "Submit Request"
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center mt-2">
                  Typically respond within 24 hours.
                </p>

                <p className="text-xs text-muted-foreground text-center">
                  By submitting this form, you agree to our{" "}
                  <a href="/privacy-policy" className="underline hover:text-foreground">
                    Privacy Policy
                  </a>
                  .
                </p>
              </form>
            </AnimatedSection>
          )}
        </div>
      </div>
    </Layout>
  );
}
