import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Fingerprint, Shield, Trash2, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

/** supabase.functions.invoke puts non-2xx bodies on error.context; pull the server's message out. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function functionErrorMessage(res: { data: any; error: any }, fallback: string): Promise<string> {
  if (res.data?.error) return String(res.data.error);
  const ctx = res.error?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch { /* not JSON */ }
  }
  return res.error?.message || fallback;
}

const MIN_PASSWORD_LENGTH = 6;

interface PasskeyRow {
  id: string;
  credential_id: string;
  device_type: string | null;
  device_name: string | null;
  created_at: string;
}

export function ChangePasswordDialog({ inline = false }: { inline?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([]);
  const [loadingPasskeys, setLoadingPasskeys] = useState(false);
  const [passkeyLoadError, setPasskeyLoadError] = useState<string | null>(null);
  const [passkeyToDelete, setPasskeyToDelete] = useState<PasskeyRow | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [registeringPasskey, setRegisteringPasskey] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) loadPasskeys();
  }, [open]);

  const loadPasskeys = async () => {
    setLoadingPasskeys(true);
    setPasskeyLoadError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.user) {
        setPasskeys([]);
        setPasskeyLoadError("Your session expired. Sign in again to manage passkeys.");
        return;
      }
      const { data, error } = await supabase
        .from("passkey_credentials")
        .select("id, credential_id, device_type, device_name, created_at")
        .eq("user_id", session.session.user.id)
        .order("created_at", { ascending: true });
      if (error) setPasskeyLoadError(`Couldn't load your passkeys: ${error.message}`);
      else setPasskeys((data as PasskeyRow[]) || []);
    } finally {
      setLoadingPasskeys(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < MIN_PASSWORD_LENGTH) { setPasswordError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`); return; }
    if (newPassword !== confirmPassword) { setPasswordError("The two passwords don't match."); return; }
    setPasswordError(null);
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      setPasswordError(`Password not changed: ${error.message}`);
    } else {
      toast.success("Password updated");
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
        toast.error(`Couldn't start registration: ${await functionErrorMessage(optionsRes, "no response from the server")}`);
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
        toast.error(`Registration failed: ${await functionErrorMessage(verifyRes, "the server rejected the credential")}`);
        return;
      }

      toast.success(keyType === "cross-platform" ? "Security key registered!" : "Passkey registered!");
      await loadPasskeys();
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        toast.info("Registration was cancelled.");
      } else if (err instanceof DOMException && err.name === "InvalidStateError") {
        toast.info("This device is already registered.");
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
      const { data, error } = await supabase
        .from("passkey_credentials")
        .delete()
        .eq("id", credentialDbId)
        .select("id");
      if (error) {
        toast.error(`Couldn't remove the credential: ${error.message}`);
      } else if (!data?.length) {
        // RLS only lets you delete your own credentials; 0 rows means it wasn't removed.
        toast.error("Nothing was removed. The credential may belong to another account or was already deleted.");
        await loadPasskeys();
      } else {
        setPasskeys((prev) => prev.filter((p) => p.id !== credentialDbId));
        toast.success("Credential removed");
      }
      setPasskeyToDelete(null);
    } catch (err) {
      toast.error(`Couldn't remove the credential: ${err instanceof Error ? err.message : "network error"}`);
    } finally {
      setDeletingId(null);
    }
  };

  const passkeyLabel = (pk: PasskeyRow) =>
    pk.device_name || (pk.device_type === "cross-platform" ? "Security Key" : "Platform Passkey");

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPasswordError(null); }}>
      <DialogTrigger asChild>
        {inline ? (
          <Button size="sm" className="h-9">
            <KeyRound className="h-4 w-4 mr-1.5" aria-hidden />
            Manage passkeys and password
          </Button>
        ) : (
          <Button variant="ghost" size="sm" aria-label="Security settings" className="h-9 text-muted-foreground hover:text-foreground">
            <KeyRound className="h-4 w-4 mr-1" aria-hidden />
            <span className="hidden sm:inline">Security</span>
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[27.5rem]">
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

          {loadingPasskeys && passkeys.length === 0 ? (
            <div className="space-y-2" role="status" aria-label="Loading passkeys">
              <Skeleton className="h-12 w-full rounded-md" />
            </div>
          ) : passkeyLoadError ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2 text-xs text-red-300">
              <span>{passkeyLoadError}</span>
              <Button variant="outline" size="sm" onClick={loadPasskeys} disabled={loadingPasskeys}>Retry</Button>
            </div>
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
                      <p className="text-sm font-medium truncate">{passkeyLabel(pk)}</p>
                      <p className="text-xs text-muted-foreground">
                        Registered {format(new Date(pk.created_at), "MMM d, yyyy")}
                      </p>
                    </div>
                  </div>
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${passkeyLabel(pk)} registered ${format(new Date(pk.created_at), "MMM d, yyyy")}`}
                          className="text-destructive hover:text-destructive h-9 w-9 shrink-0"
                          onClick={() => setPasskeyToDelete(pk)}
                          disabled={deletingId === pk.id}
                        >
                          {deletingId === pk.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left"><p className="text-xs">Remove</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? "password-error" : undefined}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={!!passwordError}
              aria-describedby={passwordError ? "password-error" : undefined}
              required
            />
          </div>
          {passwordError && <p id="password-error" role="alert" className="text-sm text-red-400">{passwordError}</p>}
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Updating…</> : "Update password"}
            </Button>
          </DialogFooter>
        </form>

        <AlertDialog open={!!passkeyToDelete} onOpenChange={(o) => { if (!o && !deletingId) setPasskeyToDelete(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this {passkeyToDelete?.device_type === "cross-platform" ? "security key" : "passkey"}?</AlertDialogTitle>
              <AlertDialogDescription>
                {passkeyToDelete ? `${passkeyLabel(passkeyToDelete)}, registered ${format(new Date(passkeyToDelete.created_at), "MMM d, yyyy")}. ` : ""}
                You won't be able to sign in with it again.
                {passkeys.length === 1 ? " It's your only one, so you'll need your password to sign in." : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={!!deletingId}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={!!deletingId}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => { e.preventDefault(); if (passkeyToDelete) handleDeletePasskey(passkeyToDelete.id); }}
              >
                {deletingId ? <><Loader2 className="h-4 w-4 animate-spin" /> Removing…</> : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
