import { HelpCircle, Lightbulb } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface FieldGuidanceProps {
  guidance?: {
    guidance_text: string;
    answer_recommendation: string | null;
    reason: string | null;
  };
}

export const FieldGuidance = ({ guidance }: FieldGuidanceProps) => {
  if (!guidance) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center w-4 h-4 rounded-full text-muted-foreground hover:text-primary transition-colors ml-1.5 align-middle"
          aria-label="Field help"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-80 text-sm space-y-2 p-3"
      >
        <p className="text-foreground leading-relaxed">{guidance.guidance_text}</p>
        {guidance.answer_recommendation && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-primary/5 border border-primary/10">
            <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-foreground/80">
              <span className="font-medium">Tip:</span> {guidance.answer_recommendation}
            </p>
          </div>
        )}
        {guidance.reason && (
          <p className="text-xs text-muted-foreground italic">{guidance.reason}</p>
        )}
      </PopoverContent>
    </Popover>
  );
};
