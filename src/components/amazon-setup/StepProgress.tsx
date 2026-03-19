import { useIntakeForm } from '@/contexts/IntakeFormContext';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

const STEP_LABELS = [
  'Readiness', 'Business', 'Owner', 'Bank', 'Brand & Accounts', 'Review',
];

export const StepProgress = () => {
  const { currentStep, completedSteps, formData, setCurrentStep } = useIntakeForm();
  const platforms = formData.selected_platforms;
  const percentage = Math.round((currentStep / (STEP_LABELS.length - 1)) * 100);

  const handleStepClick = (i: number) => {
    if (completedSteps.includes(i) || i === currentStep) {
      setCurrentStep(i);
    }
  };

  return (
    <div className="mb-8">
      <p className="text-sm text-muted-foreground text-center mb-2">
        Step {currentStep + 1} of {STEP_LABELS.length} &mdash; {percentage}% complete
      </p>
      {platforms.length > 0 && (
        <div className="flex items-center justify-center gap-1.5 mb-3">
          {platforms.map(p => (
            <Badge key={p} variant="outline" className="text-[10px] px-2 py-0">{p}</Badge>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between max-w-lg mx-auto">
        {STEP_LABELS.map((label, i) => {
          const isClickable = completedSteps.includes(i) || i === currentStep;
          return (
            <div
              key={i}
              className={cn('flex flex-col items-center gap-1', isClickable && 'cursor-pointer')}
              onClick={() => handleStepClick(i)}
              role={isClickable ? 'button' : undefined}
              tabIndex={isClickable ? 0 : undefined}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border-2 transition-all',
                  i === currentStep
                    ? 'bg-primary text-primary-foreground border-primary'
                    : completedSteps.includes(i)
                    ? 'bg-primary/20 text-primary border-primary/40 hover:bg-primary/30'
                    : 'bg-muted text-muted-foreground border-border'
                )}
              >
                {completedSteps.includes(i) && i !== currentStep ? '\u2713' : i + 1}
              </div>
              <span className="text-[10px] text-muted-foreground hidden sm:block">{label}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden max-w-lg mx-auto">
        <div
          className="h-full bg-primary rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
