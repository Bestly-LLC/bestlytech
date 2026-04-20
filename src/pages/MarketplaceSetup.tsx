import { useEffect, useState } from 'react';
import { SEOHead } from '@/components/SEOHead';
import { IntakeFormProvider, useIntakeForm } from '@/contexts/IntakeFormContext';
import { GuidanceProvider } from '@/contexts/GuidanceContext';
import { StepProgress } from '@/components/amazon-setup/StepProgress';
import { Step0Readiness } from '@/components/amazon-setup/steps/Step0Readiness';
import { Step1Business } from '@/components/amazon-setup/steps/Step1Business';
import { Step2Owner } from '@/components/amazon-setup/steps/Step2Owner';
import { Step3Bank } from '@/components/amazon-setup/steps/Step3Bank';
import { Step4BrandAccounts } from '@/components/amazon-setup/steps/Step4BrandAccounts';
import { Step5Review } from '@/components/amazon-setup/steps/Step5Review';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Save, LogOut, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// INTAKE-08: show autosave status as a relative "Saved Xs ago" label so
// users can see at a glance that the 30s background save is still firing.
function relativeTime(when: Date, now: Date): string {
  const s = Math.max(0, Math.floor((now.getTime() - when.getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

const FormContent = () => {
  const { currentStep, saving, formId, saveNow, lastSavedAt } = useIntakeForm();
  const { toast } = useToast();
  // Tick every 15s so the "Saved Xs ago" label stays accurate without
  // requiring a real save to update the UI.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(iv);
  }, []);

  const steps = [
    <Step0Readiness key={0} />,
    <Step1Business key={1} />,
    <Step2Owner key={2} />,
    <Step3Bank key={3} />,
    <Step4BrandAccounts key={4} />,
    <Step5Review key={5} />,
  ];

  const handleSaveAndExit = async () => {
    await saveNow();
    toast({
      title: '\u2713 Progress saved',
      description: `Bookmark this page or save your ID (${formId?.slice(0, 8)}) to return later.`,
      duration: 5000,
    });
  };

  return (
    <div className="max-w-[700px] mx-auto px-4 py-8">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold mb-1">Marketplace Account Setup</h1>
        <p className="text-sm text-muted-foreground">Complete this form to get your seller accounts set up professionally.</p>
        <div className="flex items-center justify-center gap-3 mt-2">
          {saving && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Save className="w-3 h-3 animate-pulse" /> Saving...
            </div>
          )}
          {!saving && lastSavedAt && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3 h-3" />
              <span title={lastSavedAt.toLocaleString()}>Saved {relativeTime(lastSavedAt, now)}</span>
            </div>
          )}
          {formId && (
            <Badge variant="outline" className="text-xs font-mono">
              ID: {formId.slice(0, 8)}
            </Badge>
          )}
        </div>
        {currentStep > 0 && (
          <Button variant="ghost" size="sm" className="mt-2 text-xs text-muted-foreground" onClick={handleSaveAndExit}>
            <LogOut className="w-3 h-3 mr-1" /> Save & Exit
          </Button>
        )}
      </div>
      <StepProgress />
      {steps[currentStep]}
    </div>
  );
};

const MarketplaceSetup = () => {
  return (
    <>
      <SEOHead
        title="Marketplace Account Setup | Bestly"
        description="Professional Amazon, Shopify & TikTok Shop account setup. Complete our intake form to get started."
        path="/marketplace-setup"
      />
      <IntakeFormProvider>
        <GuidanceProvider>
          <FormContent />
        </GuidanceProvider>
      </IntakeFormProvider>
    </>
  );
};

export default MarketplaceSetup;
