import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Img, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Cookie Yeti'
const LOGO_URL = 'https://keowunrxpxlbgebujbao.supabase.co/storage/v1/object/public/email-assets/bestly-logo.png'

type Status = 'renewed' | 'canceled' | 'past_due' | 'expired'

interface SubscriptionUpdateProps {
  status?: Status
  plan?: string
  periodEnd?: string
}

const STATUS_CONFIG: Record<Status, { emoji: string; title: string; color: string }> = {
  renewed: { emoji: '✅', title: 'Subscription Renewed', color: '#16a34a' },
  canceled: { emoji: '😢', title: 'Subscription Canceled', color: '#dc2626' },
  past_due: { emoji: '⚠️', title: 'Payment Past Due', color: '#d97706' },
  expired: { emoji: '⏰', title: 'Subscription Expired', color: '#6b7280' },
}

const getMessage = (status: Status, plan?: string, periodEnd?: string): string => {
  switch (status) {
    case 'renewed':
      return `Your ${plan || 'subscription'} plan has been successfully renewed. You're all set to keep browsing without cookie interruptions!`
    case 'canceled':
      return periodEnd
        ? `Your ${plan || 'subscription'} has been canceled. You'll continue to have access until ${periodEnd}. We hope to see you back!`
        : `Your ${plan || 'subscription'} has been canceled. We hope to see you back!`
    case 'past_due':
      return `We were unable to process your payment for the ${plan || 'subscription'} plan. Please update your payment method to keep your subscription active.`
    case 'expired':
      return `Your ${plan || 'subscription'} has expired. Renew now to continue enjoying ad-free, cookie-free browsing.`
  }
}

const SubscriptionUpdateEmail = ({ status = 'renewed', plan, periodEnd }: SubscriptionUpdateProps) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.renewed
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{config.title} — {SITE_NAME}</Preview>
      <Body style={main}>
        <Container style={container}>
          <a href="https://bestly.tech" style={{ textDecoration: 'none' }}><Img src={LOGO_URL} width="120" height="auto" alt="Bestly" style={logo} /></a>
          <Section style={{ textAlign: 'center' as const, marginBottom: '24px' }}>
            <Text style={{ fontSize: '40px', margin: '0 0 8px' }}>{config.emoji}</Text>
            <Heading style={{ ...h1, color: config.color }}>{config.title}</Heading>
          </Section>
          <Text style={text}>{getMessage(status, plan, periodEnd)}</Text>
          {(status === 'past_due' || status === 'expired') && (
            <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
              <Button style={button} href="https://cookieyeti.app">
                {status === 'past_due' ? 'Update Payment' : 'Renew Subscription'}
              </Button>
            </Section>
          )}
          {status === 'canceled' && (
            <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
              <Button style={button} href="https://cookieyeti.app">
                Resubscribe
              </Button>
            </Section>
          )}
          <Text style={footer}>
            Questions? Contact us at support@bestly.tech.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: SubscriptionUpdateEmail,
  subject: (data: Record<string, any>) => {
    const titles: Record<string, string> = {
      renewed: 'Your Cookie Yeti subscription has been renewed',
      canceled: 'Your Cookie Yeti subscription has been canceled',
      past_due: 'Action required: Cookie Yeti payment past due',
      expired: 'Your Cookie Yeti subscription has expired',
    }
    return titles[data.status] || 'Cookie Yeti subscription update'
  },
  displayName: 'Subscription status update',
  previewData: { status: 'renewed', plan: 'Yearly', periodEnd: 'March 15, 2027' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Plus Jakarta Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif" }
const container = { padding: '40px 25px', maxWidth: '520px', margin: '0 auto' }
const logo = { marginBottom: '24px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, margin: '0 0 8px', textAlign: 'center' as const }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.6', margin: '0 0 20px' }
const button = { backgroundColor: '#1a365d', color: '#f0f4f8', fontSize: '14px', fontWeight: '600' as const, borderRadius: '12px', padding: '12px 32px', textDecoration: 'none' }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
