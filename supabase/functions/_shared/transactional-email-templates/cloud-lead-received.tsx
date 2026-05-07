import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  contact_name?: string
  company_name?: string
  brief_url?: string
  cal_url?: string
}

const CloudLeadReceivedEmail = ({
  contact_name,
  company_name,
  brief_url,
  cal_url,
}: Props) => {
  const firstName = (contact_name || '').split(' ')[0] || 'there'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>We got your details — let's pick a discovery slot</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>Bestly</Text>
            <Text style={tagline}>In-House Cloud</Text>
          </Section>

          <Section style={body}>
            <Heading style={h1}>Hi {firstName},</Heading>
            <Text style={text}>
              Thanks for reaching out about an In-House Cloud for{' '}
              <strong style={{ color: '#0a0a0a' }}>{company_name || 'your team'}</strong>.
              Two quick steps and we'll walk into your call already prepped.
            </Text>

            {cal_url && (
              <Section style={ctaSection}>
                <Button style={button} href={cal_url}>
                  Pick your discovery slot →
                </Button>
                <Text style={textSmall}>30 minutes. No obligation.</Text>
              </Section>
            )}

            {brief_url && (
              <Section style={card}>
                <Text style={cardLabel}>Optional, takes 5 minutes</Text>
                <Text style={cardTitle}>Pre-call brief</Text>
                <Text style={cardBody}>
                  A few quick questions about your current stack so we walk in with context, not cold.
                </Text>
                <Section style={{ marginTop: '14px' }}>
                  <Button style={buttonOutline} href={brief_url}>
                    Fill the brief
                  </Button>
                </Section>
              </Section>
            )}

            <Text style={text}>
              On the call we'll do a line-by-line map of your current IT spend versus what an
              In-House Cloud deployment would cost — whether you move forward or not.
            </Text>

            <Text style={textMuted}>
              Questions before the call? Reply to this email or write{' '}
              <a href="mailto:jared@bestly.tech" style={link}>jared@bestly.tech</a>.
            </Text>
          </Section>

          <Section style={footer}>
            <Text style={footerBrand}>Bestly LLC</Text>
            <Text style={footerMuted}>Los Angeles, CA · jared@bestly.tech · bestly.tech</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: CloudLeadReceivedEmail,
  subject: (data: Record<string, any>) => `Got your details, ${(data.contact_name || '').split(' ')[0] || 'there'} — let's pick a slot`,
  displayName: 'Cloud lead received',
  previewData: {
    contact_name: 'Jane Cooper',
    company_name: 'Acme Co',
    brief_url: 'https://bestly.tech/brief/abc123',
    cal_url: 'https://cloud.bestly.tech/apps/calendar/appointment/BtktQYtGFocY',
  },
} satisfies TemplateEntry

/* ── Bestly brand styles ── */
const main = { backgroundColor: '#fafaf9', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff' }
const header = { backgroundColor: '#0a0a0a', padding: '36px 32px 28px', textAlign: 'center' as const }
const wordmark = { fontSize: '22px', fontWeight: '700' as const, color: '#ffffff', margin: '0 0 4px', letterSpacing: '-0.3px' }
const tagline = { fontSize: '11px', color: '#94a3b8', margin: '0', letterSpacing: '1px', textTransform: 'uppercase' as const }
const body = { padding: '36px 32px' }
const h1 = { fontSize: '24px', fontWeight: '600' as const, color: '#0a0a0a', margin: '0 0 16px', letterSpacing: '-0.3px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.7', margin: '0 0 24px' }
const textMuted = { fontSize: '13px', color: '#94a3b8', lineHeight: '1.7', margin: '24px 0 0' }
const ctaSection = { textAlign: 'center' as const, margin: '8px 0 28px' }
const button = { backgroundColor: '#c84d2b', color: '#ffffff', fontSize: '15px', fontWeight: '600' as const, borderRadius: '8px', padding: '13px 28px', textDecoration: 'none', display: 'inline-block' }
const buttonOutline = { backgroundColor: 'transparent', color: '#0a0a0a', fontSize: '14px', fontWeight: '500' as const, borderRadius: '8px', padding: '10px 20px', textDecoration: 'none', display: 'inline-block', border: '1px solid #d3d1c7' }
const textSmall = { fontSize: '12px', color: '#94a3b8', textAlign: 'center' as const, margin: '8px 0 0' }
const card = { backgroundColor: '#f6f5f2', borderRadius: '10px', padding: '20px 22px', margin: '0 0 28px' }
const cardLabel = { fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600' as const, margin: '0 0 4px' }
const cardTitle = { fontSize: '16px', color: '#0a0a0a', fontWeight: '600' as const, margin: '0 0 6px' }
const cardBody = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0' }
const link = { color: '#0a0a0a', textDecoration: 'underline' }
const footer = { backgroundColor: '#0a0a0a', padding: '20px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 2px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
