import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const STEP_LABELS = [
  'Readiness', 'Business', 'Owner', 'Bank',
  'Brand', 'Authorization', 'Account', 'Review',
];

export const StepProgress = () => {
  const { currentStep, completedSteps, formData } = useIntakeForm();
  const platforms = formData.selected_platforms;

  return (
    <div className="mb-8">
      <p className="text-sm text-muted-foreground text-center mb-2">
        Step {currentStep + 1} of {STEP_LABELS.length}
      </p>
      {platforms.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 mb-3">
          {platforms.map(p => (
            <Badge key={p} variant="outline" className="text-[10px] px-2 py-0">{p}</Badge>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between max-w-lg mx-auto">
        {STEP_LABELS.map((label, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 transition-all',
                i === currentStep
                  ? 'bg-primary text-primary-foreground border-primary'
                  : completedSteps.includes(i)
                  ? 'bg-primary/20 text-primary border-primary/40'
                  : 'bg-muted text-muted-foreground border-border'
              )}
            >
              {completedSteps.includes(i) && i !== currentStep ? '✓' : i + 1}
            </div>
            <span className="text-[10px] text-muted-foreground hidden sm:block">{label}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden max-w-lg mx-auto">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${((currentStep) / (STEP_LABELS.length - 1)) * 100}%` }}
        />
      </div>
    </div>
  );
};
