import { CALL_CONSENT_TEXT } from "@/lib/callConsent";

/** The call and text consent line that sits directly above a form's Send button. Plain text, wraps, never truncated. */
export function CallConsentNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-sm leading-relaxed text-muted-foreground ${className}`.trim()} data-testid="call-consent-note">
      {CALL_CONSENT_TEXT}
    </p>
  );
}
