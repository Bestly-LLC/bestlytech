/**
 * Call Guard: the one sentence shown above Send on /contact and /get-started. When a visitor types a phone number and sends,
 * submit-contact / submit-cloud-lead save this exact text with the number in call_consents (docs/call-guard-opusplan.md).
 * Keep it identical to CALL_CONSENT_TEXT in those two edge functions. It is a notice, not a pre-ticked box.
 */
export const CALL_CONSENT_TEXT =
  "By sending, you agree Bestly may call or text you about your request, including with an AI assistant. Consent isn't required to buy anything.";
