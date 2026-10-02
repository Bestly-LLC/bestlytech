import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { DeviceSignIn } from "@/components/admin/DeviceSignIn";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Fingerprint } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminMark, SIGNIN_STARE_RADIUS_PX } from "@/components/AdminMark";
import { rememberNext } from "@/lib/adminNext";
import { signInWithPasskey } from "@/lib/passkey";
import { BrandLoader } from "@/components/BrandLoader";
import { useAdminFavicon } from "@/hooks/useAdminFavicon";
import { AdminAccessDenied } from "@/components/admin/AdminAccessDenied";
import { useAdminTheme } from "@/hooks/useAdminTheme";

function speakWelcome(name: string) {
  if (!("speechSynthesis" in window)) return;
  // Cancel any pending speech
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(`Welcome, ${name}`);
  utterance.rate = 0.95;
  utterance.pitch = 1.0;
  utterance.volume = 0.8;
  // Try to pick a good voice (prefer Samantha/Karen on macOS, or any en-US)
  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.name.includes("Samantha") || v.name.includes("Karen")
    );
    const fallback = voices.find((v) => v.lang.startsWith("en"));
    if (preferred) utterance.voice = preferred;
    else if (fallback) utterance.voice = fallback;
    window.speechSynthesis.speak(utterance);
  };
  // Voices may load async
  if (window.speechSynthesis.getVoices().length > 0) {
    pickVoice();
  } else {
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }
}

export default function AdminLogin() {
  const { bento } = useAdminTheme();
  const { user, loading, isAdmin, roleError, checking, recheck, signIn, signOut } = useAdminAuth();
  useAdminFavicon();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  
  const { toast } = useToast();
  const [params] = useSearchParams();
  // Only ever go back inside the admin.
  const nextRaw = params.get("next") ?? "";
  const next = nextRaw.startsWith("/admin") && !nextRaw.startsWith("//") ? nextRaw : "/admin";

  // `checking` covers the moment right after sign-in, before the role check answers.
  if (loading || (user && checking && !isAdmin)) {
    return (
      <BrandLoader tone="dark" fullScreen label="Checking your admin session" />
    );
  }

  if (user && isAdmin) {
    return <Navigate to={next} replace />;
  }

  // Signed in but not an admin (or the role check failed): say so instead of showing the form again.
  if (user) {
    return <AdminAccessDenied email={user.email} checkFailed={!!roleError} onRetry={recheck} onSignOut={signOut} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    // No "@" means a username: look up which admin email it belongs to.
    let login = email.trim();
    if (!login.includes("@")) {
      const { data, error: lookupError } = await supabase.rpc("admin_login_email" as never, { p_username: login } as never);
      if (lookupError) {
        setSubmitting(false);
        toast({ title: "Couldn't look up that username", description: lookupError.message, variant: "destructive" });
        return;
      }
      login = (data as unknown as string | null) ?? login;
    }
    const { error } = await signIn(login, password);
    setSubmitting(false);

    if (error) {
      toast({
        title: "Login Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      speakWelcome("Jared");
      // Navigation handled by the isAdmin redirect in the render
    }
  };

  const handleAppleSignIn = async () => {
    setOauthLoading(true);
    rememberNext(next); // Apple sends us back to /admin; AdminRoute picks this up and finishes the trip
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "apple",
        options: {
          redirectTo: window.location.origin + "/admin",
        },
      });
      if (error) {
        toast({
          title: "Apple Sign In Failed",
          description: error.message || "An error occurred",
          variant: "destructive",
        });
      }
      // Voice will play after redirect back, handled by the auth state check
    } catch (err) {
      toast({
        title: "Apple Sign In Failed",
        description: err instanceof Error ? err.message : "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setOauthLoading(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setPasskeyLoading(true);
    try {
      const problem = await signInWithPasskey();
      if (problem === "cancelled") {
        toast({
          title: "Cancelled",
          description: "Passkey authentication was cancelled.",
        });
        return;
      }
      if (problem) {
        toast({
          title: "Passkey Error",
          description: problem,
          variant: "destructive",
        });
        return;
      }
      const { data } = await supabase.auth.getSession();
      speakWelcome("Jared");
      toast({ title: "Welcome back!", description: `Signed in as ${data.session?.user.email ?? "Jared"}` });
      // Navigation handled by the isAdmin redirect in the render
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 ${bento ? "admin-shell admin-bento bg-[#F3F2EE]" : "bg-black"}`}>
      {/* Subtle radial glow */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.03)_0%,_transparent_70%)] bento:hidden" />

      <div
        className="relative w-full max-w-[21.25rem] space-y-10 bento:max-w-[26rem] bento:rounded-[2rem] bento:bg-[#fff] bento:px-10 bento:py-12 bento:shadow-[0_1px_2px_rgba(17,17,20,0.04),0_30px_60px_-30px_rgba(17,17,20,0.25)]"
        style={{
          animation: "apple-fade-in 1s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          opacity: 0,
        }}
      >
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <AdminMark label="Bestly Admin" stareRadius={SIGNIN_STARE_RADIUS_PX} className="h-20 w-20" />
          </div>
          <p className="text-[0.8125rem] text-white/55 font-light tracking-wide">
            Bestly Admin
          </p>
          {next.startsWith("/admin/approve") && (
            <p className="mx-auto max-w-[18rem] rounded-2xl bg-white/[0.06] px-4 py-3 text-[0.9375rem] leading-snug text-white/80 bento:bg-[#F3F2EE]">
              Sign in on this phone first. Then you come straight back to approve the other screen.
            </p>
          )}
        </div>

        {/* Auth Buttons */}
        <div className="space-y-3">
          {/* Apple Sign In — official black pill */}
          <button
            type="button"
            onClick={handleAppleSignIn}
            disabled={oauthLoading}
            className="w-full h-12 rounded-full bg-white text-black font-medium text-[0.9375rem] flex items-center justify-center gap-2.5 transition-all duration-200 hover:bg-white/90 active:scale-[0.98] disabled:opacity-50"
          >
            <svg className="h-[1.125rem] w-[1.125rem]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            {oauthLoading ? "Signing in…" : "Sign in with Apple"}
          </button>

          {/* Passkey — outline pill */}
          <button
            type="button"
            onClick={handlePasskeySignIn}
            disabled={passkeyLoading}
            className="w-full h-12 rounded-full bg-transparent text-white font-medium text-[0.9375rem] flex items-center justify-center gap-2.5 border border-white/20 transition-all duration-200 hover:bg-white/5 active:scale-[0.98] disabled:opacity-50"
          >
            <Fingerprint className="h-[1.125rem] w-[1.125rem]" />
            {passkeyLoading ? "Authenticating…" : "Sign in with Passkey"}
          </button>

          {/* For browsers that can't show a passkey or Apple prompt (the Claude app's built-in browser) */}
          <DeviceSignIn onSignedIn={() => speakWelcome("Jared")} />
        </div>

        {/* Collapsible email/password */}
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowEmail(!showEmail)}
            className="text-[0.75rem] text-white/20 hover:text-white/40 transition-colors duration-200 font-light bento:text-white/55 bento:hover:text-white/80"
          >
            {showEmail ? "Hide" : "Sign in with email instead"}
          </button>
        </div>

        <div
          className="overflow-hidden transition-all duration-300 ease-in-out"
          style={{ maxHeight: showEmail ? "300px" : "0", opacity: showEmail ? 1 : 0 }}
        >
          <div className="relative flex items-center mb-6">
            <div className="flex-1 h-px bg-white/10" />
            <span className="px-4 text-[0.6875rem] text-white/50 font-light">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required={showEmail}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="Username or email"
                className="w-full bg-transparent border-0 border-b border-white/15 text-white text-[0.9375rem] pb-3 pt-1 placeholder:text-white/45 focus:outline-none focus:border-white/40 transition-colors duration-200"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={showEmail}
                autoComplete="current-password"
                placeholder="Password"
                className="w-full bg-transparent border-0 border-b border-white/15 text-white text-[0.9375rem] pb-3 pt-1 placeholder:text-white/45 focus:outline-none focus:border-white/40 transition-colors duration-200"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-full bg-[hsl(221,83%,53%)] text-white font-medium text-[0.9375rem] transition-all duration-200 hover:bg-[hsl(221,83%,48%)] active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/80 animate-pulse" style={{ animationDelay: "0ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/80 animate-pulse" style={{ animationDelay: "150ms" }} />
                  <span className="h-1.5 w-1.5 rounded-full bg-white/80 animate-pulse" style={{ animationDelay: "300ms" }} />
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes apple-fade-in {
          from {
            opacity: 0;
            transform: translateY(12px) scale(0.98);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
      `}</style>
    </div>
  );
}
