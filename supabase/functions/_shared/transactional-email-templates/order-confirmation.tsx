import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Img, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Cookie Yeti'
const ICON_URL = 'https://keowunrxpxlbgebujbao.supabase.co/storage/v1/object/public/email-assets/cookieyeti-icon.png'

interface OrderConfirmationProps {
  plan?: string
  amount?: string
  orderDate?: string
}

const OrderConfirmationEmail = ({ plan, amount, orderDate }: OrderConfirmationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You're in — {plan || 'subscription'} plan confirmed</Preview>
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

        {/* Body content */}
        <Section style={body}>
          <Heading style={h1}>You're in. 🎉</Heading>
          <Text style={text}>
            Your order has been confirmed. Welcome to a cleaner, quieter internet.
          </Text>

          <Section style={card}>
            <Text style={cardLabel}>Plan</Text>
            <Text style={cardValue}>{plan || 'Subscription'}</Text>
            <Hr style={divider} />
            <Text style={cardLabel}>Amount</Text>
            <Text style={cardValue}>{amount || '—'}</Text>
            <Hr style={divider} />
            <Text style={cardLabel}>Date</Text>
            <Text style={cardValue}>{orderDate || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</Text>
          </Section>

          <Text style={text}>
            You're all set. Cookie Yeti will automatically handle cookie consent banners so you can browse without interruptions.
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

export const template = {
  component: OrderConfirmationEmail,
  subject: "You're in — order confirmed",
  displayName: 'Order confirmation',
  previewData: { plan: 'Yearly', amount: '$7.99', orderDate: 'March 24, 2026' },
} satisfies TemplateEntry

/* ── Styles ── */
const main = { backgroundColor: '#ffffff', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }
const container = { maxWidth: '520px', margin: '0 auto' }
const header = { backgroundColor: '#0f172a', borderRadius: '16px 16px 0 0', padding: '40px 32px 32px', textAlign: 'center' as const }
const icon = { display: 'block' as const, margin: '0 auto 12px', borderRadius: '18px' }
const wordmark = { fontSize: '22px', fontWeight: '700' as const, color: '#ffffff', margin: '0 0 4px', letterSpacing: '-0.3px' }
const tagline = { fontSize: '13px', color: '#94a3b8', margin: '0', letterSpacing: '0.5px' }
const body = { padding: '36px 32px' }
const h1 = { fontSize: '28px', fontWeight: '700' as const, color: '#0f172a', margin: '0 0 12px', letterSpacing: '-0.5px', textAlign: 'center' as const }
const text = { fontSize: '15px', color: '#64748b', lineHeight: '1.7', margin: '0 0 24px', textAlign: 'center' as const }
const card = { backgroundColor: '#f0f9ff', borderRadius: '14px', padding: '24px 28px', marginBottom: '24px', border: '1px solid #e0f2fe' }
const cardLabel = { fontSize: '11px', color: '#94a3b8', margin: '0 0 2px', textTransform: 'uppercase' as const, letterSpacing: '0.8px', fontWeight: '600' as const }
const cardValue = { fontSize: '17px', color: '#0f172a', fontWeight: '600' as const, margin: '0 0 4px' }
const divider = { borderColor: '#e0f2fe', margin: '14px 0' }
const footer = { backgroundColor: '#0f172a', borderRadius: '0 0 16px 16px', padding: '24px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 4px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
