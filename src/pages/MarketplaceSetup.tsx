import { Layout } from '@/components/layout/Layout';
import { SEOHead } from '@/components/SEOHead';
import { IntakeFormProvider, useIntakeForm } from '@/contexts/IntakeFormContext';
import { GuidanceProvider } from '@/contexts/GuidanceContext';
import { StepProgress } from '@/components/amazon-setup/StepProgress';
import { Step0Readiness } from '@/components/amazon-setup/steps/Step0Readiness';
import { Step1Business } from '@/components/amazon-setup/steps/Step1Business';
import { Step2Owner } from '@/components/amazon-setup/steps/Step2Owner';
import { Step3Bank } from '@/components/amazon-setup/steps/Step3Bank';
import { Step4Brand } from '@/components/amazon-setup/steps/Step4Brand';
import { Step5Auth } from '@/components/amazon-setup/steps/Step5Auth';
import { Step6Account } from '@/components/amazon-setup/steps/Step6Account';
import { Step7Review } from '@/components/amazon-setup/steps/Step7Review';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Save, LogOut } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const FormContent = () => {
  const { currentStep, saving, formId, saveNow } = useIntakeForm();
  const { toast } = useToast();

  const steps = [
    <Step0Readiness key={0} />,
    <Step1Business key={1} />,
    <Step2Owner key={2} />,
    <Step3Bank key={3} />,
    <Step4Brand key={4} />,
    <Step5Auth key={5} />,
    <Step6Account key={6} />,
    <Step7Review key={7} />,
  ];

  const handleSaveAndExit = async () => {
    await saveNow();
    toast({
      title: '✓ Progress saved',
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
    <Layout>
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
    </Layout>
  );
};

export default MarketplaceSetup;