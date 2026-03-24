import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Img, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Cookie Yeti'
const LOGO_URL = 'https://keowunrxpxlbgebujbao.supabase.co/storage/v1/object/public/email-assets/bestly-logo.png'

interface OrderConfirmationProps {
  plan?: string
  amount?: string
  orderDate?: string
}

const OrderConfirmationEmail = ({ plan, amount, orderDate }: OrderConfirmationProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {SITE_NAME} order is confirmed — {plan || 'subscription'} plan</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src={LOGO_URL} width="120" height="auto" alt="Bestly" style={logo} />
        <Section style={headerBanner}>
          <Text style={headerEmoji}>🎉</Text>
          <Heading style={h1}>Order Confirmed!</Heading>
        </Section>
        <Text style={text}>
          Thank you for subscribing to <strong>{SITE_NAME}</strong>! Your order has been successfully processed.
        </Text>
        <Section style={orderBox}>
          <Text style={orderLabel}>Plan</Text>
          <Text style={orderValue}>{plan || 'Subscription'}</Text>
          <Hr style={divider} />
          <Text style={orderLabel}>Amount</Text>
          <Text style={orderValue}>{amount || '—'}</Text>
          <Hr style={divider} />
          <Text style={orderLabel}>Date</Text>
          <Text style={orderValue}>{orderDate || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</Text>
        </Section>
        <Text style={text}>
          Your subscription is now active. You can start using {SITE_NAME} right away to automatically handle cookie consent banners across the web.
        </Text>
        <Text style={footer}>
          If you have any questions about your order, contact us at support@bestly.tech.
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: OrderConfirmationEmail,
  subject: 'Your Cookie Yeti order is confirmed',
  displayName: 'Order confirmation',
  previewData: { plan: 'Yearly', amount: '$39.99', orderDate: 'January 15, 2026' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Plus Jakarta Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif" }
const container = { padding: '40px 25px', maxWidth: '520px', margin: '0 auto' }
const logo = { marginBottom: '24px' }
const headerBanner = { textAlign: 'center' as const, marginBottom: '24px' }
const headerEmoji = { fontSize: '40px', margin: '0 0 8px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1a365d', margin: '0 0 8px', textAlign: 'center' as const }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.6', margin: '0 0 20px' }
const orderBox = { backgroundColor: '#f0f7ff', borderRadius: '12px', padding: '20px 24px', marginBottom: '24px', border: '1px solid #bfdbfe' }
const orderLabel = { fontSize: '12px', color: '#64748b', margin: '0 0 2px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' }
const orderValue = { fontSize: '16px', color: '#1a365d', fontWeight: '600' as const, margin: '0 0 4px' }
const divider = { borderColor: '#bfdbfe', margin: '12px 0' }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
