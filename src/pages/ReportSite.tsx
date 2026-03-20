import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CheckCircle, AlertCircle, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type FormState = "idle" | "loading" | "success" | "error";

export default function ReportSite() {
  const [searchParams] = useSearchParams();
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [formState, setFormState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Pre-fill URL from query params
  useEffect(() => {
    const urlParam = searchParams.get("url");
    if (urlParam) {
      setWebsiteUrl(urlParam);
    }
  }, [searchParams]);

  // Get metadata from URL params (set by extension)
  const browser = searchParams.get("browser") || "";
  const version = searchParams.get("version") || "";

  const validateUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return ["http:", "https:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    // Client-side validation
    if (!websiteUrl.trim()) {
      setErrorMessage("Please enter a website URL.");
      return;
    }

    if (!validateUrl(websiteUrl)) {
      setErrorMessage("Please enter a valid URL (e.g., https://example.com)");
      return;
    }

    setFormState("loading");

    try {
      const { data, error } = await supabase.functions.invoke("report-site", {
        body: {
          websiteUrl: websiteUrl.trim(),
          notes: notes.trim(),
          browser,
          version,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          honeypot,
        },
      });

      if (error) {
        console.error("Function error:", error);
        setErrorMessage(error.message || "Failed to submit report. Please try again.");
        setFormState("error");
        return;
      }

      if (data?.error) {
        setErrorMessage(data.error);
        setFormState("error");
        return;
      }

      setFormState("success");
    } catch (err) {
      console.error("Submit error:", err);
      setErrorMessage("An unexpected error occurred. Please try again.");
      setFormState("error");
    }
  };

  const handleReset = () => {
    setWebsiteUrl("");
    setNotes("");
    setHoneypot("");
    setFormState("idle");
    setErrorMessage("");
  };

  return (
    <>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <section className="border-b border-border bg-secondary/20">
          <div className="mx-auto max-w-3xl px-6 py-16 lg:px-8">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Report a Site
            </h1>
            <p className="mt-4 text-lg text-muted-foreground leading-relaxed">
              Help us improve Cookie Yeti by reporting websites where the extension doesn't work correctly.
            </p>
          </div>
        </section>

        {/* Form Section */}
        <section className="py-16">
          <div className="mx-auto max-w-2xl px-6 lg:px-8">
            {formState === "success" ? (
              <div className="text-center py-12">
                <CheckCircle className="mx-auto h-16 w-16 text-green-600" />
                <h2 className="mt-6 text-2xl font-semibold text-foreground">
                  Thank you for your report!
                </h2>
                <p className="mt-4 text-muted-foreground">
                  We'll investigate this website and improve Cookie Yeti accordingly.
                </p>
                <Button onClick={handleReset} variant="outline" className="mt-8">
                  Submit Another Report
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Honeypot field - hidden from users */}
                <div className="absolute opacity-0 pointer-events-none h-0 overflow-hidden" aria-hidden="true">
                  <Label htmlFor="hp_field">Leave this empty</Label>
                  <Input
                    id="hp_field"
                    name="hp_field"
                    type="text"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>

                {/* Website URL */}
                <div className="space-y-2">
                  <Label htmlFor="websiteUrl" className="text-sm font-medium text-foreground">
                    Website URL <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="websiteUrl"
                    name="websiteUrl"
                    type="url"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://example.com"
                    required
                    className="w-full"
                    disabled={formState === "loading"}
                  />
                  <p className="text-sm text-muted-foreground">
                    The URL of the website where Cookie Yeti isn't working correctly.
                  </p>
                </div>

                {/* Additional Notes */}
                <div className="space-y-2">
                  <Label htmlFor="notes" className="text-sm font-medium text-foreground">
                    Additional Notes
                  </Label>
                  <Textarea
                    id="notes"
                    name="notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Describe the issue you're experiencing..."
                    maxLength={2000}
                    rows={5}
                    className="w-full resize-none"
                    disabled={formState === "loading"}
                  />
                  <p className="text-sm text-muted-foreground">
                    Optional. Describe what's not working (e.g., "Cookie banner not detected", "Extension crashes").
                  </p>
                </div>

                {/* Error Message */}
                {formState === "error" && errorMessage && (
                  <div className="flex items-start gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-4">
                    <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{errorMessage}</p>
                  </div>
                )}

                {/* Submit Button */}
                <Button
                  type="submit"
                  disabled={formState === "loading"}
                  className="w-full sm:w-auto"
                >
                  {formState === "loading" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Submit Report
                    </>
                  )}
                </Button>

                {/* Privacy Note */}
                <p className="text-xs text-muted-foreground">
                  We only collect the information you provide here to improve Cookie Yeti. 
                  No personal data is stored long-term. See our{" "}
                  <a href="/privacy" className="underline hover:text-foreground">
                    Privacy Policy
                  </a>.
                </p>
              </form>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
