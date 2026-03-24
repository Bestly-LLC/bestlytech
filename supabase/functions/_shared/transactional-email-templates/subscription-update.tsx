import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Img, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Cookie Yeti'
const ICON_URL = 'https://keowunrxpxlbgebujbao.supabase.co/storage/v1/object/public/email-assets/cookieyeti-icon.png'

type Status = 'renewed' | 'canceled' | 'past_due' | 'expired'

interface SubscriptionUpdateProps {
  status?: Status
  plan?: string
  periodEnd?: string
}

const STATUS_CONFIG: Record<Status, { headline: string; borderColor: string; preview: string }> = {
  renewed:  { headline: 'All good.',       borderColor: '#22c55e', preview: 'Subscription renewed' },
  canceled: { headline: "We'll miss you.", borderColor: '#ef4444', preview: 'Subscription canceled' },
  past_due: { headline: 'Heads up.',       borderColor: '#f59e0b', preview: 'Payment past due' },
  expired:  { headline: "Time's up.",      borderColor: '#94a3b8', preview: 'Subscription expired' },
}

const getMessage = (status: Status, plan?: string, periodEnd?: string): string => {
  switch (status) {
    case 'renewed':
      return `Your ${plan || 'subscription'} has been renewed. You're all set to keep browsing without cookie interruptions.`
    case 'canceled':
      return periodEnd
        ? `Your ${plan || 'subscription'} has been canceled. You'll have access until ${periodEnd}. We'd love to have you back anytime.`
        : `Your ${plan || 'subscription'} has been canceled. We'd love to have you back anytime.`
    case 'past_due':
      return `We couldn't process your payment for the ${plan || 'subscription'} plan. Update your payment method to keep things running smoothly.`
    case 'expired':
      return `Your ${plan || 'subscription'} has expired. Renew to get back to a cleaner, quieter internet.`
  }
}

const SubscriptionUpdateEmail = ({ status = 'renewed', plan, periodEnd }: SubscriptionUpdateProps) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.renewed
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{config.preview} — {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Hero header */}
          <Section style={header}>
            <a href="https://bestly.tech" style={{ textDecoration: 'none' }}>
              <Img src={ICON_URL} width="80" height="80" alt="Cookie Yeti" style={icon} />
            </a>
            <a href="https://bestly.tech" style={{ textDecoration: 'none' }}>
              <Text style={wordmark}>{SITE_NAME}</Text>
            </a>
            <Text style={tagline}>Distraction-Free Browsing</Text>
          </Section>

          {/* Body */}
          <Section style={body}>
            <Heading style={h1}>{config.headline}</Heading>

            <Section style={{ ...statusCard, borderLeft: `4px solid ${config.borderColor}` }}>
              <Text style={statusText}>{getMessage(status, plan, periodEnd)}</Text>
            </Section>

            {(status === 'past_due' || status === 'expired' || status === 'canceled') && (
              <Section style={ctaSection}>
                <Button style={button} href="https://cookieyeti.app">
                  {status === 'past_due' ? 'Update Payment' : status === 'expired' ? 'Renew Now' : 'Resubscribe'}
                </Button>
              </Section>
            )}

            <Text style={textSmall}>
              Questions? Reach out at support@bestly.tech.
            </Text>
          </Section>

          {/* Footer */}
          <Section style={footer}>
            <Text style={footerBrand}>{SITE_NAME} by Bestly</Text>
            <Text style={footerMuted}>Los Angeles, CA · support@bestly.tech</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SubscriptionUpdateEmail,
  subject: (data: Record<string, any>) => {
    const titles: Record<string, string> = {
      renewed: 'All good — subscription renewed',
      canceled: "We'll miss you — subscription canceled",
      past_due: 'Heads up — payment past due',
      expired: "Time's up — subscription expired",
    }
    return titles[data.status] || 'Cookie Yeti subscription update'
  },
  displayName: 'Subscription status update',
  previewData: { status: 'renewed', plan: 'Yearly', periodEnd: 'March 15, 2027' },
} satisfies TemplateEntry

/* ── Styles ── */
const main = { backgroundColor: '#ffffff', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }
const container = { maxWidth: '520px', margin: '0 auto' }
const header = { backgroundColor: '#0f172a', borderRadius: '16px 16px 0 0', padding: '40px 32px 32px', textAlign: 'center' as const }
const icon = { display: 'block' as const, margin: '0 auto 12px', borderRadius: '18px' }
const wordmark = { fontSize: '22px', fontWeight: '700' as const, color: '#ffffff', margin: '0 0 4px', letterSpacing: '-0.3px' }
const tagline = { fontSize: '13px', color: '#94a3b8', margin: '0', letterSpacing: '0.5px' }
const body = { padding: '36px 32px' }
const h1 = { fontSize: '28px', fontWeight: '700' as const, color: '#0f172a', margin: '0 0 20px', letterSpacing: '-0.5px', textAlign: 'center' as const }
const statusCard = { backgroundColor: '#f8fafc', borderRadius: '12px', padding: '20px 24px', marginBottom: '24px' }
const statusText = { fontSize: '15px', color: '#475569', lineHeight: '1.7', margin: '0' }
const ctaSection = { textAlign: 'center' as const, margin: '4px 0 24px' }
const button = { backgroundColor: '#0f172a', color: '#f0f4f8', fontSize: '15px', fontWeight: '600' as const, borderRadius: '50px', padding: '14px 40px', textDecoration: 'none' }
const textSmall = { fontSize: '13px', color: '#94a3b8', textAlign: 'center' as const, margin: '0 0 8px' }
const footer = { backgroundColor: '#0f172a', borderRadius: '0 0 16px 16px', padding: '24px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 4px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
