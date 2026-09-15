import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";

const CMP_OPTIONS = [
  "onetrust", "cookiebot", "didomi", "quantcast", "sourcepoint",
  "trustarc", "usercentrics", "iubenda", "complianz", "osano", "generic",
];

/** Must match the validate_cookie_pattern_action_type trigger on cookie_patterns. */
const ACTION_TYPES = ["reject", "accept", "close", "necessary", "save"];

const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

interface ManualPatternFormProps {
  onSuccess?: () => void;
}

export function ManualPatternForm({ onSuccess }: ManualPatternFormProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [domain, setDomain] = useState("");
  const [actionSelector, setActionSelector] = useState("");
  const [actionType, setActionType] = useState("reject");
  const [cmp, setCmp] = useState("generic");
  const [customCmp, setCustomCmp] = useState("");
  const [confidence, setConfidence] = useState([9]);
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setDomain("");
    setActionSelector("");
    setActionType("reject");
    setCmp("generic");
    setCustomCmp("");
    setConfidence([9]);
    setFormError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDomain = domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").replace(/[/?#].*$/, "");
    const trimmedSelector = actionSelector.trim();

    if (!DOMAIN_RE.test(trimmedDomain)) {
      setFormError("Enter a domain like shein.com (no path).");
      return;
    }
    if (!trimmedSelector) {
      setFormError("Enter the CSS selector of the button the extension should click.");
      return;
    }
    try {
      document.createDocumentFragment().querySelector(trimmedSelector);
    } catch {
      setFormError("That selector isn't valid CSS. Check brackets and quotes.");
      return;
    }
    setFormError(null);

    setSaving(true);
    try {
      const cmpValue = cmp === "other" ? (customCmp.trim().toLowerCase() || "generic") : cmp;

      // Upsert on (domain, selector, action_type). report_count / success_count are left out on
      // purpose: new rows take the column defaults, and re-adding an existing pattern no longer
      // wipes its real counts. Re-adding also re-activates a pattern that was switched off.
      const { data, error } = await supabase
        .from("cookie_patterns")
        .upsert(
          {
            domain: trimmedDomain,
            selector: trimmedSelector,
            action_type: actionType,
            cmp_fingerprint: cmpValue,
            source: "manual",
            confidence: confidence[0],
            is_active: true,
          } as never,
          { onConflict: "domain,selector,action_type" },
        )
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("the database saved nothing (your account may lack admin rights)");

      // Close any open missed-banner report for this domain. Zero rows just means nobody reported it.
      const { data: resolvedRows, error: resolveErr } = await supabase
        .from("missed_banner_reports")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("domain", trimmedDomain)
        .eq("resolved", false)
        .select("id");

      if (resolveErr) {
        toast.warning(`Pattern saved for ${trimmedDomain}, but its open report couldn't be marked resolved: ${resolveErr.message}`);
      } else {
        const n = resolvedRows?.length ?? 0;
        toast.success(`Pattern saved for ${trimmedDomain}${n ? `; resolved ${n} open report${n === 1 ? "" : "s"}` : ""}`);
      }
      resetForm();
      setOpen(false);
      onSuccess?.();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
      setFormError(`Couldn't save the pattern: ${message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) { setOpen(o); if (!o) setFormError(null); } }}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" aria-hidden /> Add pattern
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a pattern manually</DialogTitle>
          <DialogDescription>Tell the extension which button dismisses the cookie banner on a site.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="mp-domain">Domain</Label>
            <Input id="mp-domain" placeholder="e.g. shein.com" value={domain} onChange={(e) => setDomain(e.target.value)} required autoComplete="off" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mp-action">Button selector</Label>
            <Input id="mp-action" placeholder="e.g. #onetrust-reject-all-handler" value={actionSelector} onChange={(e) => setActionSelector(e.target.value)} required autoComplete="off" className="font-mono text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mp-action-type">What the button does</Label>
              <Select value={actionType} onValueChange={setActionType}>
                <SelectTrigger id="mp-action-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mp-cmp">Consent platform</Label>
              <Select value={cmp} onValueChange={setCmp}>
                <SelectTrigger id="mp-cmp"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CMP_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  <SelectItem value="other">Other…</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {cmp === "other" && (
            <div className="space-y-1.5">
              <Label htmlFor="mp-custom-cmp">Platform name</Label>
              <Input id="mp-custom-cmp" placeholder="e.g. my-custom-cmp" value={customCmp} onChange={(e) => setCustomCmp(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label id="mp-confidence-label">Confidence: {confidence[0] * 10}%</Label>
            <Slider aria-labelledby="mp-confidence-label" value={confidence} onValueChange={setConfidence} min={1} max={10} step={1} className="mt-2" />
          </div>

          {formError && (
            <p role="alert" className="text-sm text-red-400">{formError}</p>
          )}

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</> : "Save pattern"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
