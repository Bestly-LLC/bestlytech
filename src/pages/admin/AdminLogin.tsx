import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Navigate } from "react-router-dom";
import { Shield, Fingerprint } from "lucide-react";
import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";
import bestlyLogo from "@/assets/bestly-logo.png";

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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
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
      // Use WebAuthn / passkey via Supabase's built-in support
      // First check if the browser supports WebAuthn
      if (!window.PublicKeyCredential) {
        toast({
          title: "Not Supported",
          description: "Your browser does not support passkeys.",
          variant: "destructive",
        });
        return;
      }

      // Supabase doesn't have native passkey support yet, so we use
      // signInWithOAuth as the primary passwordless method.
      // For now, show a helpful message about passkey availability.
      toast({
        title: "Passkeys Coming Soon",
        description: "Passkey authentication will be available in a future update. Use Apple Sign In or email/password for now.",
      });
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
      <Card className="w-full max-w-sm shadow-xl border-border/50">
        <CardHeader className="text-center space-y-3 pb-2">
          <div className="flex justify-center">
            <img src={bestlyLogo} alt="Bestly" className="h-8 object-contain" />
          </div>
          <div className="flex items-center justify-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <CardTitle className="text-lg">Admin Portal</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Secure access for authorized personnel only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Apple Sign In */}
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 h-11 font-medium"
            onClick={handleAppleSignIn}
            disabled={oauthLoading}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            {oauthLoading ? "Signing in..." : "Sign in with Apple"}
          </Button>

          {/* Passkey */}
          <Button
            type="button"
            variant="outline"
            className="w-full gap-2 h-11 font-medium"
            onClick={handlePasskeySignIn}
            disabled={passkeyLoading}
          >
            <Fingerprint className="h-4 w-4" />
            {passkeyLoading ? "Authenticating..." : "Sign in with Passkey"}
          </Button>

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
              or
            </span>
          </div>

          {/* Email/Password */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-medium">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="admin@bestly.tech"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-medium">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
