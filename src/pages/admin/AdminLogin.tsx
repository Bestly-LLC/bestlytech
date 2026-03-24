import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Navigate } from "react-router-dom";
import { Fingerprint } from "lucide-react";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import bestlyLogo from "@/assets/bestly-logo.png";

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export default function AdminLogin() {
  const { user, loading, isAdmin, signIn } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="flex gap-1">
          <div className="h-2 w-2 rounded-full bg-white/60 animate-pulse" style={{ animationDelay: "0ms" }} />
          <div className="h-2 w-2 rounded-full bg-white/60 animate-pulse" style={{ animationDelay: "150ms" }} />
          <div className="h-2 w-2 rounded-full bg-white/60 animate-pulse" style={{ animationDelay: "300ms" }} />
        </div>
      </div>
    );
  }

  if (user && isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signIn(email, password);
    setSubmitting(false);

    if (error) {
      toast({
        title: "Login Failed",
        description: error.message,
        variant: "destructive",
      });
    } else {
      navigate("/admin");
    }
  };

  const handleAppleSignIn = async () => {
    setOauthLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("apple", {
        redirect_uri: window.location.origin + "/admin",
      });
      if (result?.error) {
        toast({
          title: "Apple Sign In Failed",
          description: result.error.message || "An error occurred",
          variant: "destructive",
        });
      }
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
      if (!window.PublicKeyCredential) {
        toast({
          title: "Not Supported",
          description: "Your browser does not support passkeys.",
          variant: "destructive",
        });
        return;
      }

      const optionsRes = await supabase.functions.invoke("webauthn-authenticate", {
        body: {
          action: "options",
          origin: window.location.origin,
        },
      });

      if (optionsRes.error || optionsRes.data?.error) {
        toast({
          title: "Passkey Error",
          description: optionsRes.data?.error || "Failed to start passkey authentication",
          variant: "destructive",
        });
        return;
      }

      const options = optionsRes.data;

      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        challenge: base64urlToBuffer(options.challenge),
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: options.userVerification as UserVerificationRequirement,
        allowCredentials: (options.allowCredentials || []).map((c: any) => ({
          id: base64urlToBuffer(c.id),
          type: c.type,
          transports: c.transports,
        })),
      };

      const assertion = (await navigator.credentials.get({
        publicKey: publicKeyOptions,
      })) as PublicKeyCredential;

      if (!assertion) {
        toast({
          title: "Cancelled",
          description: "Passkey authentication was cancelled.",
        });
        return;
      }

      const assertionResponse = assertion.response as AuthenticatorAssertionResponse;

      const verifyRes = await supabase.functions.invoke("webauthn-authenticate", {
        body: {
          action: "verify",
          origin: window.location.origin,
          credential: {
            id: assertion.id,
            rawId: bufferToBase64url(assertion.rawId),
            type: assertion.type,
            response: {
              clientDataJSON: bufferToBase64url(assertionResponse.clientDataJSON),
              authenticatorData: bufferToBase64url(assertionResponse.authenticatorData),
              signature: bufferToBase64url(assertionResponse.signature),
              userHandle: assertionResponse.userHandle
                ? bufferToBase64url(assertionResponse.userHandle)
                : null,
            },
          },
        },
      });

      if (verifyRes.error || verifyRes.data?.error) {
        toast({
          title: "Authentication Failed",
          description: verifyRes.data?.error || "Passkey verification failed",
          variant: "destructive",
        });
        return;
      }

      const { token_hash, email: userEmail } = verifyRes.data;

      const { error: otpError } = await supabase.auth.verifyOtp({
        token_hash,
        type: "magiclink",
      });

      if (otpError) {
        toast({
          title: "Session Failed",
          description: otpError.message,
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Welcome back!", description: `Signed in as ${userEmail}` });
      navigate("/admin");
    } catch (err) {
      console.error("Passkey error:", err);
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        toast({
          title: "Cancelled",
          description: "Passkey authentication was cancelled.",
        });
      } else {
        toast({
          title: "Passkey Error",
          description: err instanceof Error ? err.message : "An unexpected error occurred",
          variant: "destructive",
        });
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4">
      {/* Subtle radial glow */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(255,255,255,0.03)_0%,_transparent_70%)]" />

      <div
        className="relative w-full max-w-[340px] space-y-10"
        style={{
          animation: "apple-fade-in 1s cubic-bezier(0.16, 1, 0.3, 1) forwards",
          opacity: 0,
        }}
      >
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex justify-center">
            <img
              src={bestlyLogo}
              alt="Bestly"
              className="h-12 object-contain brightness-0 invert"
            />
          </div>
          <p className="text-[13px] text-white/40 font-light tracking-wide">
            Admin
          </p>
        </div>

        {/* Auth Buttons */}
        <div className="space-y-3">
          {/* Apple Sign In — official black pill */}
          <button
            type="button"
            onClick={handleAppleSignIn}
            disabled={oauthLoading}
            className="w-full h-12 rounded-full bg-white text-black font-medium text-[15px] flex items-center justify-center gap-2.5 transition-all duration-200 hover:bg-white/90 active:scale-[0.98] disabled:opacity-50"
          >
            <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            {oauthLoading ? "Signing in…" : "Sign in with Apple"}
          </button>

          {/* Passkey — outline pill */}
          <button
            type="button"
            onClick={handlePasskeySignIn}
            disabled={passkeyLoading}
            className="w-full h-12 rounded-full bg-transparent text-white font-medium text-[15px] flex items-center justify-center gap-2.5 border border-white/20 transition-all duration-200 hover:bg-white/5 active:scale-[0.98] disabled:opacity-50"
          >
            <Fingerprint className="h-[18px] w-[18px]" />
            {passkeyLoading ? "Authenticating…" : "Sign in with Passkey"}
          </button>
        </div>

        {/* Collapsible email/password */}
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowEmail(!showEmail)}
            className="text-[12px] text-white/20 hover:text-white/40 transition-colors duration-200 font-light"
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
            <span className="px-4 text-[11px] text-white/30 font-light">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required={showEmail}
                placeholder="Email"
                className="w-full bg-transparent border-0 border-b border-white/15 text-white text-[15px] pb-3 pt-1 placeholder:text-white/25 focus:outline-none focus:border-white/40 transition-colors duration-200"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={showEmail}
                placeholder="Password"
                className="w-full bg-transparent border-0 border-b border-white/15 text-white text-[15px] pb-3 pt-1 placeholder:text-white/25 focus:outline-none focus:border-white/40 transition-colors duration-200"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-full bg-[hsl(221,83%,53%)] text-white font-medium text-[15px] transition-all duration-200 hover:bg-[hsl(221,83%,48%)] active:scale-[0.98] disabled:opacity-50"
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
