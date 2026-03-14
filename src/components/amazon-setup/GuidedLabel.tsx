import { FieldGuidance } from './FieldGuidance';

interface GuidedLabelProps {
  label: string;
  fieldName: string;
  required?: boolean;
  getGuidance: (fieldName: string) => { guidance_text: string; answer_recommendation: string | null; reason: string | null } | undefined;
}

export const GuidedLabel = ({ label, fieldName, required = false, getGuidance }: GuidedLabelProps) => {
  const guidance = getGuidance(fieldName);
  return (
    <label className="text-sm font-medium inline-flex items-center">
      {label}
      {required && <span className="text-destructive ml-0.5">*</span>}
      <FieldGuidance guidance={guidance} />
    </label>
  );
};
