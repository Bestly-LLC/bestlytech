import { useState } from "react";
import { Link } from "react-router-dom";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  KeyRound,
  Mail,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  ShieldCheck,
} from "lucide-react";

// CY-02: Activation page. Users (from Chrome, Safari, iOS, macOS) land here
// to request + validate an activation code for Cookie Yeti Pro.
// Calls send-activation-code and validate-activation-code edge functions.

type Step = "email" | "code" | "done";
type Platform = "chrome" | "safari" | "ios" | "macos" | "firefox";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "chrome", label: "Chrome" },
  { value: "safari", label: "Safari" },
  { value: "ios", label: "iOS" },
  { value: "macos", label: "macOS" },
  { value: "firefox", label: "Firefox" },
];

export default function CookieYetiActivate() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [platform, setPlatform] = useState<Platform>("chrome");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "send-activation-code",
        { body: { email: email.trim().toLowerCase(), platform } }
      );
      if (fnError) throw fnError;
      if (data?.error) {
        if (data.error === "Too many requests") {
          setError("Too many attempts. Please wait an hour and try again.");
        } else {
          setError(data.error);
        }
        return;
      }
      setStep("code");
    } catch (err: any) {
      setError(err.message || "Failed to send activation code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "validate-activation-code",
        {
          body: {
            email: email.trim().toLowerCase(),
            code: code.trim(),
            platform,
          },
        }
      );
      if (fnError) throw fnError;
      if (data?.error) {
        setError(
          data.error === "rate_limited"
            ? "Too many attempts. Please wait a few minutes."
            : data.error === "Invalid or expired code"
            ? "That code is invalid or has expired. Please request a new one."
            : data.error
        );
        return;
      }
      if (data?.activated) {
        setStep("done");
      }
    } catch (err: any) {
      setError(err.message || "Validation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <SEOHead
        title="Activate Cookie Yeti | Bestly LLC"
        description="Enter your activation code to unlock Cookie Yeti Pro."
      />

      <section className="min-h-[70vh] flex items-center justify-center bg-gradient-to-b from-secondary/40 to-background">
        <div className="mx-auto max-w-md w-full px-6 py-20">
          {/* ---- Step 1: Email ---- */}
          {step === "email" && (
            <div className="text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 border border-primary/20 mb-6">
                <Mail className="h-8 w-8 text-primary" aria-hidden="true" />
              </div>

              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                Activate Cookie Yeti
              </h1>
              <p className="mt-3 text-muted-foreground">
                Enter the email you used at checkout and select your platform.
                We will send you a 6-digit activation code.
              </p>

              <form onSubmit={handleSendCode} className="mt-8 space-y-4 text-left">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-foreground mb-1.5"
                  >
                    Email address
                  </label>
                  <Input
                    id="email"
                    type="email"
                    required
                    autoFocus
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <div>
                  <label
                    htmlFor="platform"
                    className="block text-sm font-medium text-foreground mb-1.5"
                  >
                    Platform
                  </label>
                  <select
                    id="platform"
                    value={platform}
                    onChange={(e) => setPlatform(e.target.value as Platform)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {PLATFORMS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Mail className="h-4 w-4 mr-2" />
                  )}
                  Send Activation Code
                </Button>
              </form>
            </div>
          )}

          {/* ---- Step 2: Code ---- */}
          {step === "code" && (
            <div className="text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 border border-primary/20 mb-6">
                <KeyRound className="h-8 w-8 text-primary" aria-hidden="true" />
              </div>

              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                Enter Your Code
              </h1>
              <p className="mt-3 text-muted-foreground">
                We sent a 6-digit code to{" "}
                <span className="font-medium text-foreground">{email}</span>.
                It expires in 15 minutes.
              </p>

              <form
                onSubmit={handleValidateCode}
                className="mt-8 space-y-4 text-left"
              >
                <div>
                  <label
                    htmlFor="code"
                    className="block text-sm font-medium text-foreground mb-1.5"
                  >
                    Activation code
                  </label>
                  <Input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    required
                    autoFocus
                    maxLength={6}
                    placeholder="123456"
                    className="text-center text-2xl tracking-[0.5em] font-mono"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/[^0-9]/g, ""))
                    }
                  />
                </div>

                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || code.length < 6}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <ShieldCheck className="h-4 w-4 mr-2" />
                  )}
                  Activate
                </Button>

                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setCode("");
                    setError(null);
                  }}
                  className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Wrong email? Go back
                </button>
              </form>
            </div>
          )}

          {/* ---- Step 3: Done ---- */}
          {step === "done" && (
            <div className="text-center">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10 border border-green-500/20 mb-6">
                <CheckCircle2
                  className="h-8 w-8 text-green-500"
                  aria-hidden="true"
                />
              </div>

              <h1 className="text-3xl font-bold tracking-tight text-foreground">
                Cookie Yeti Activated!
              </h1>
              <p className="mt-3 text-muted-foreground">
                Your {PLATFORMS.find((p) => p.value === platform)?.label}{" "}
                extension is now active. Enjoy distraction-free browsing.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button asChild>
                  <Link to="/cookie-yeti">
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back to Cookie Yeti
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/support">Need help?</Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
