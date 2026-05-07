import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text, Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  contact_name?: string
  company_name?: string
  amount?: string
  intake_url?: string
  install_eta?: string
}

const CloudDepositPaidEmail = ({ contact_name, company_name, amount, intake_url, install_eta }: Props) => {
  const firstName = (contact_name || '').split(' ')[0] || 'there'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Deposit received — let's start your build</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>Bestly</Text>
            <Text style={tagline}>In-House Cloud</Text>
          </Section>

          <Section style={body}>
            <Heading style={h1}>Deposit received, {firstName}.</Heading>
            <Text style={text}>
              Thanks{company_name ? `, and welcome to the build phase for ${company_name}` : ''}. We'll
              start ordering hardware and configuring your cloud right away.
            </Text>

            <Section style={card}>
              <Text style={cardLabel}>Receipt</Text>
              <Text style={cardValue}>{amount || '—'}</Text>
              <Hr style={divider} />
              <Text style={cardLabel}>What happens next</Text>
              <Text style={cardBody}>
                One last thing: a 5-stage technical intake. Network, branding, users, migration sources,
                and policy. Most teams finish it in 30-45 minutes — auto-saved as you go, can be
                shared with your IT lead.
              </Text>
            </Section>

            {intake_url && (
              <Section style={ctaSection}>
                <Button style={button} href={intake_url}>
                  Open the technical intake →
                </Button>
              </Section>
            )}

            <Text style={text}>
              Once you submit the intake, we'll start the actual build. {install_eta
                ? `Your install date is currently slated for ${install_eta}.`
                : 'Hardware typically ships 4–6 weeks after intake submission.'}
            </Text>

            <Text style={textMuted}>
              Anything looking off? Reply or write{' '}
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
  component: CloudDepositPaidEmail,
  subject: 'Deposit received — let\'s start your build',
  displayName: 'Cloud deposit paid',
  previewData: {
    contact_name: 'Jane Cooper',
    company_name: 'Acme Co',
    amount: '$5,000.00',
    intake_url: 'https://bestly.tech/intake/abc123',
    install_eta: '',
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
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.7', margin: '0 0 18px' }
const textMuted = { fontSize: '13px', color: '#94a3b8', lineHeight: '1.7', margin: '24px 0 0' }
const ctaSection = { textAlign: 'center' as const, margin: '8px 0 24px' }
const button = { backgroundColor: '#c84d2b', color: '#ffffff', fontSize: '15px', fontWeight: '600' as const, borderRadius: '8px', padding: '13px 28px', textDecoration: 'none', display: 'inline-block' }
const card = { backgroundColor: '#f6f5f2', borderRadius: '10px', padding: '20px 22px', margin: '0 0 28px' }
const cardLabel = { fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600' as const, margin: '0 0 4px' }
const cardValue = { fontSize: '20px', color: '#0a0a0a', fontWeight: '600' as const, margin: '0 0 4px' }
const cardBody = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0' }
const divider = { borderColor: '#e3e1db', margin: '14px 0' }
const link = { color: '#0a0a0a', textDecoration: 'underline' }
const footer = { backgroundColor: '#0a0a0a', padding: '20px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 2px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
