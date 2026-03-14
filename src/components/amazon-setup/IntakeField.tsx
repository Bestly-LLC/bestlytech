import { Input } from '@/components/ui/input';
import { GuidedLabel } from './GuidedLabel';

interface IntakeFieldProps {
  name: string;
  label: string;
  required?: boolean;
  value: string;
  onChange: (name: string, value: string) => void;
  error?: string;
  getGuidance: (fieldName: string) => any;
  [key: string]: any;
}

export const IntakeField = ({
  name,
  label,
  required = true,
  value,
  onChange,
  error,
  getGuidance,
  ...props
}: IntakeFieldProps) => (
  <div>
    <GuidedLabel label={label} fieldName={name} required={required} getGuidance={getGuidance} />
    <Input
      value={value || ''}
      onChange={(e) => onChange(name, e.target.value)}
      className="mt-1"
      {...props}
    />
    {error && <p className="text-xs text-destructive mt-1">{error}</p>}
  </div>
);
