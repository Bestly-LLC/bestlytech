import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Fingerprint, Check } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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

export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPasskey, setHasPasskey] = useState<boolean | null>(null);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);

  useEffect(() => {
    if (open) checkPasskey();
  }, [open]);

  const checkPasskey = async () => {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) { setHasPasskey(false); return; }
    const { count, error } = await supabase
      .from("passkey_credentials")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.session.user.id);
    if (error) { setHasPasskey(false); return; }
    setHasPasskey((count ?? 0) > 0);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (newPassword !== confirmPassword) { toast.error("Passwords do not match"); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) { toast.error(error.message); } else {
      toast.success("Password updated successfully");
      setNewPassword(""); setConfirmPassword(""); setOpen(false);
    }
  };

  const handleRegisterPasskey = async () => {
    setRegisteringPasskey(true);
    try {
      if (!window.PublicKeyCredential) {
        toast.error("Your browser doesn't support passkeys.");
        return;
      }

      const optionsRes = await supabase.functions.invoke("webauthn-register", {
        body: { action: "options", origin: window.location.origin },
      });
      if (optionsRes.error || optionsRes.data?.error) {
        toast.error(optionsRes.data?.error || "Failed to get options");
        return;
      }

      const options = optionsRes.data;
      const credential = (await navigator.credentials.create({
        publicKey: {
          rp: options.rp,
          user: {
            id: base64urlToBuffer(options.user.id),
            name: options.user.name,
            displayName: options.user.displayName,
          },
          challenge: base64urlToBuffer(options.challenge),
          pubKeyCredParams: options.pubKeyCredParams,
          timeout: options.timeout,
          authenticatorSelection: options.authenticatorSelection,
          attestation: options.attestation,
          excludeCredentials: (options.excludeCredentials || []).map((c: any) => ({
            id: base64urlToBuffer(c.id), type: c.type,
          })),
        },
      })) as PublicKeyCredential;

      if (!credential) { toast.info("Passkey registration was cancelled."); return; }

      const attestationResponse = credential.response as AuthenticatorAttestationResponse;
      const verifyRes = await supabase.functions.invoke("webauthn-register", {
        body: {
          action: "verify",
          origin: window.location.origin,
          credential: {
            id: credential.id,
            rawId: bufferToBase64url(credential.rawId),
            type: credential.type,
            authenticatorAttachment: (credential as any).authenticatorAttachment,
            response: {
              clientDataJSON: bufferToBase64url(attestationResponse.clientDataJSON),
              attestationObject: bufferToBase64url(attestationResponse.attestationObject),
            },
          },
        },
      });

      if (verifyRes.error || verifyRes.data?.error) {
        toast.error(verifyRes.data?.error || "Registration failed");
        return;
      }

      setHasPasskey(true);
      toast.success("Passkey registered! You can now sign in with it.");
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        toast.info("Passkey registration was cancelled.");
      } else {
        toast.error(err instanceof Error ? err.message : "Registration failed");
      }
    } finally {
      setRegisteringPasskey(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
          <KeyRound className="h-4 w-4 mr-1" />
          <span className="hidden sm:inline">Security</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Security Settings</DialogTitle>
          <DialogDescription>Manage your password and passkey.</DialogDescription>
        </DialogHeader>

        {/* Passkey Section */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Fingerprint className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Passkey</span>
            </div>
            {hasPasskey ? (
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Check className="h-3 w-3" /> Registered
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive hover:text-destructive h-7 px-2"
                  onClick={handleDeletePasskey}
                  disabled={deletingPasskey}
                >
                  {deletingPasskey ? "Removing…" : "Remove"}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegisterPasskey}
                disabled={registeringPasskey || hasPasskey === null}
              >
                {registeringPasskey ? "Registering…" : "Register Passkey"}
              </Button>
            )}
          </div>
          {hasPasskey && (
            <p className="text-xs text-muted-foreground">
              Synced via iCloud Keychain across all your Apple devices. Remove to re-register.
            </p>
          )}
          {!hasPasskey && hasPasskey !== null && (
            <p className="text-xs text-muted-foreground">
              Register a passkey to sign in with Face ID, Touch ID, or your device PIN.
            </p>
          )}
        </div>

        <Separator />

        {/* Password Section */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Change Password</span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">New Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Updating…" : "Update Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
