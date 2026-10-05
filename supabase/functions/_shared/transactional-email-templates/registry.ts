/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'

export interface TemplateEntry {
  component: React.ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  to?: string
  displayName?: string
  previewData?: Record<string, any>
  /**
   * Who the email comes from, e.g. 'Ava at RoofGuard <ava@bestly.tech>'.
   * Must be on bestly.tech (the domain verified in Resend) or the dispatcher ignores it.
   * Left out, it goes out as the site default.
   */
  from?: string
  /** Where replies should land. Left out, replies go to the from address. */
  replyTo?: string
}

import { template as orderConfirmation } from './order-confirmation.tsx'
import { template as welcome } from './welcome.tsx'
import { template as subscriptionUpdate } from './subscription-update.tsx'
import { template as cloudLeadReceived } from './cloud-lead-received.tsx'
import { template as cloudBriefSubmitted } from './cloud-brief-submitted.tsx'
import { template as cloudDepositPaid } from './cloud-deposit-paid.tsx'
import { template as cloudIntakeReceived } from './cloud-intake-received.tsx'
import { template as roofguardInfo } from './roofguard-info.tsx'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'order-confirmation': orderConfirmation,
  'welcome': welcome,
  'subscription-update': subscriptionUpdate,
  // Bestly In-House Cloud transactional emails
  'cloud-lead-received': cloudLeadReceived,
  'cloud-brief-submitted': cloudBriefSubmitted,
  'cloud-deposit-paid': cloudDepositPaid,
  'cloud-intake-received': cloudIntakeReceived,
  // RoofGuard: what Ava emails during a call when someone asks for information
  'roofguard-info': roofguardInfo,
}
