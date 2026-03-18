import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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

const ACTION_TYPES = ["reject", "accept", "close", "necessary", "save"];

interface ManualPatternFormProps {
  onSuccess?: () => void;
}

export function ManualPatternForm({ onSuccess }: ManualPatternFormProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [domain, setDomain] = useState("");
  const [bannerSelector, setBannerSelector] = useState("");
  const [actionSelector, setActionSelector] = useState("");
  const [actionType, setActionType] = useState("reject");
  const [cmp, setCmp] = useState("generic");
  const [customCmp, setCustomCmp] = useState("");
  const [confidence, setConfidence] = useState([0.9]);

  const resetForm = () => {
    setDomain("");
    setBannerSelector("");
    setActionSelector("");
    setActionType("reject");
    setCmp("generic");
    setCustomCmp("");
    setConfidence([0.9]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedDomain = domain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").replace(/\/.*$/, "");
    const trimmedSelector = actionSelector.trim();

    if (!trimmedDomain || !trimmedSelector) {
      toast.error("Domain and Action Selector are required");
      return;
    }

    setSaving(true);
    try {
      const cmpValue = cmp === "other" ? (customCmp.trim() || "generic") : cmp;

      // Upsert into cookie_patterns
      const { error } = await supabase.from("cookie_patterns").upsert(
        {
          domain: trimmedDomain,
          selector: trimmedSelector,
          action_type: actionType,
          cmp_fingerprint: cmpValue,
          source: "manual",
          confidence: confidence[0],
          report_count: 1,
          success_count: 0,
        },
        { onConflict: "domain,selector,action_type" }
      );
      if (error) throw error;

      // Mark any matching missed_banner_reports as resolved
      await supabase
        .from("missed_banner_reports")
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq("domain", trimmedDomain);

      toast.success(`Pattern added for ${trimmedDomain}`);
      resetForm();
      setOpen(false);
      onSuccess?.();
    } catch (err: any) {
      toast.error(`Failed to add pattern: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Plus className="h-4 w-4" /> Add Pattern
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Pattern Manually</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mp-domain">Domain *</Label>
            <Input id="mp-domain" placeholder="e.g. shein.com" value={domain} onChange={(e) => setDomain(e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mp-banner">Banner Selector (optional)</Label>
            <Input id="mp-banner" placeholder="e.g. #onetrust-banner-sdk" value={bannerSelector} onChange={(e) => setBannerSelector(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mp-action">Action Selector *</Label>
            <Input id="mp-action" placeholder="e.g. #onetrust-accept-btn-handler" value={actionSelector} onChange={(e) => setActionSelector(e.target.value)} required />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Action Type</Label>
              <Select value={actionType} onValueChange={setActionType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>CMP</Label>
              <Select value={cmp} onValueChange={setCmp}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CMP_OPTIONS.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  <SelectItem value="other">Other...</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {cmp === "other" && (
            <div className="space-y-1.5">
              <Label htmlFor="mp-custom-cmp">Custom CMP Name</Label>
              <Input id="mp-custom-cmp" placeholder="e.g. my-custom-cmp" value={customCmp} onChange={(e) => setCustomCmp(e.target.value)} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Confidence: {confidence[0].toFixed(2)}</Label>
            <Slider value={confidence} onValueChange={setConfidence} min={0} max={1} step={0.05} className="mt-2" />
          </div>

          <Button type="submit" disabled={saving} className="w-full">
            {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</> : "Add Pattern"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
