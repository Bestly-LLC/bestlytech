import { useState } from "react";
import { SEOHead } from "@/components/SEOHead";
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

export default function Contact() {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    category: "",
    subject: "",
    message: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { error } = await supabase.functions.invoke("submit-contact", {
        body: formData,
      });

      if (error) throw error;

      setIsSuccess(true);
      toast({
        title: "Message sent",
        description: "Thank you for contacting us. We'll respond within 2-3 business days.",
      });

      setFormData({
        name: "",
        email: "",
        category: "",
        subject: "",
        message: "",
      });
    } catch (error: any) {
      console.error("Contact form error:", error);
      toast({
        title: "Error",
        description: "There was a problem sending your message. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  return (
    <>
      <SEOHead
        title="Contact Us"
        description="Have a question, partnership inquiry, or need support? Contact Bestly LLC and we'll get back to you within 2-3 business days."
        path="/contact"
      />

      <div className="relative">
        <div className="absolute inset-0 bg-mesh opacity-30" />
        <div className="relative mx-auto max-w-7xl px-6 py-16 lg:px-8 lg:py-24">
        {/* Page Header */}
        <AnimatedSection className="mb-16 max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Contact Us
          </h1>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
            Drop us a line. We'll get back to you within 2-3 business days.
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
                  Thank you for reaching out. We'll get back to you within 2-3 business days.
                </p>
                <Button variant="outline" onClick={() => setIsSuccess(false)}>
                  Send Another Message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">Name *</Label>
                    <Input
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
                    <Label htmlFor="category">Category *</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(value) =>
                        setFormData((prev) => ({ ...prev, category: value }))
                      }
                      required
                      disabled={isSubmitting}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="app-support">App Support</SelectItem>
                        <SelectItem value="platform-partners">Platform Partners</SelectItem>
                        <SelectItem value="retail-distribution">Retail / Distribution</SelectItem>
                        <SelectItem value="hardware-support">Hardware / Device Support</SelectItem>
                        <SelectItem value="privacy">Privacy Inquiry</SelectItem>
                        <SelectItem value="general">General Inquiry</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="subject">Subject *</Label>
                    <Input
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

                <div>
                  <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      "Send Message"
                    )}
                  </Button>
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
                    <span>Los Angeles, CA, United States</span>
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
                  We typically respond to inquiries within 2-3 business days.
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
