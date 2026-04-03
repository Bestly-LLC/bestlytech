import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Fingerprint, Shield, Trash2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { format } from "date-fns";
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

interface PasskeyRow {
  id: string;
  credential_id: string;
  device_type: string | null;
  device_name: string | null;
  created_at: string;
}

export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [loadingPasskeys, setLoadingPasskeys] = useState(false);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) loadPasskeys();
  }, [open]);

  const loadPasskeys = async () => {
    setLoadingPasskeys(true);
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session?.user) { setPasskeys([]); setLoadingPasskeys(false); return; }
    const { data, error } = await supabase
      .from("passkey_credentials")
      .select("id, credential_id, device_type, device_name, created_at")
      .eq("user_id", session.session.user.id)
      .order("created_at", { ascending: true });
    if (error) { setPasskeys([]); } else { setPasskeys((data as PasskeyRow[]) || []); }
    setLoadingPasskeys(false);
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

  const handleRegister = async (keyType: "platform" | "cross-platform") => {
    setRegisteringPasskey(true);
    try {
      if (!window.PublicKeyCredential) {
        toast.error("Your browser doesn't support passkeys.");
        return;
      }

      const optionsRes = await supabase.functions.invoke("webauthn-register", {
        body: {
          action: "options",
          origin: window.location.origin,
          keyType: keyType === "cross-platform" ? "cross-platform" : undefined,
        },
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

      if (!credential) { toast.info("Registration was cancelled."); return; }

      const attestationResponse = credential.response as AuthenticatorAttestationResponse;
      const verifyRes = await supabase.functions.invoke("webauthn-register", {
        body: {
          action: "verify",
          origin: window.location.origin,
          keyType: keyType === "cross-platform" ? "cross-platform" : undefined,
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

      toast.success(keyType === "cross-platform" ? "Security key registered!" : "Passkey registered!");
      await loadPasskeys();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        toast.info("Registration was cancelled.");
      } else {
        toast.error(err instanceof Error ? err.message : "Registration failed");
      }
    } finally {
      setRegisteringPasskey(false);
    }
  };

  const handleDeletePasskey = async (credentialDbId: string) => {
    setDeletingId(credentialDbId);
    try {
      const { error } = await supabase
        .from("passkey_credentials")
        .delete()
        .eq("id", credentialDbId);
      if (error) {
        toast.error("Failed to remove credential");
      } else {
        setPasskeys((prev) => prev.filter((p) => p.id !== credentialDbId));
        toast.success("Credential removed.");
      }
    } catch {
      toast.error("Failed to remove credential");
    } finally {
      setDeletingId(null);
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
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Security Settings</DialogTitle>
          <DialogDescription>Manage your passkeys, security keys, and password.</DialogDescription>
        </DialogHeader>

        {/* Passkeys & Security Keys Section */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2 mb-2">
            <Fingerprint className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Passkeys & Security Keys</span>
          </div>

          {loadingPasskeys ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : passkeys.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No passkeys or security keys registered. Add one below.
            </p>
          ) : (
            <div className="space-y-2">
              {passkeys.map((pk) => (
                <div
                  key={pk.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {pk.device_type === "cross-platform" ? (
                      <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                    ) : (
                      <Fingerprint className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {pk.device_name || (pk.device_type === "cross-platform" ? "Security Key" : "Platform Passkey")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Registered {format(new Date(pk.created_at), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive h-7 w-7 p-0 shrink-0"
                    onClick={() => handleDeletePasskey(pk.id)}
                    disabled={deletingId === pk.id}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRegister("platform")}
              disabled={registeringPasskey}
              className="flex-1"
            >
              <Fingerprint className="h-3.5 w-3.5 mr-1.5" />
              {registeringPasskey ? "Registering…" : "Add Passkey"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleRegister("cross-platform")}
              disabled={registeringPasskey}
              className="flex-1"
            >
              <Shield className="h-3.5 w-3.5 mr-1.5" />
              {registeringPasskey ? "Registering…" : "Add Security Key"}
            </Button>
          </div>
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
