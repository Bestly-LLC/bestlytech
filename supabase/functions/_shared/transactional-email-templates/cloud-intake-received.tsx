import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  contact_name?: string
  company_name?: string
  install_eta?: string
}

const CloudIntakeReceivedEmail = ({ contact_name, company_name, install_eta }: Props) => {
  const firstName = (contact_name || '').split(' ')[0] || 'there'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Intake received — your build is starting</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>Bestly</Text>
            <Text style={tagline}>In-House Cloud</Text>
          </Section>

          <Section style={body}>
            <Heading style={h1}>Intake received, {firstName}.</Heading>
            <Text style={text}>
              Your technical intake is in. We have everything we need to start your{' '}
              {company_name ? <strong style={{ color: '#0a0a0a' }}>{company_name}</strong> : 'cloud'} build.
            </Text>

            <Section style={card}>
              <Text style={cardLabel}>What's next</Text>
              <Text style={cardBody}>
                Over the next few days we'll provision your hardware, configure each service,
                apply your branding, and run an internal smoke test before anything ships.
                {install_eta ? ` Install is currently slated for ${install_eta}.` : ' We\'ll send a delivery date once hardware is assembled.'}
              </Text>
            </Section>

            <Text style={text}>
              You'll get progress updates from us — no need to chase. If anything in the intake
              changes (a new user joins, a domain choice shifts), just reply with the update and
              we'll fold it in.
            </Text>

            <Text style={textMuted}>
              — Jared<br />
              <a href="mailto:jared@bestly.tech" style={link}>jared@bestly.tech</a>
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
  component: CloudIntakeReceivedEmail,
  subject: 'Intake received — your build is starting',
  displayName: 'Cloud intake received',
  previewData: {
    contact_name: 'Jane Cooper',
    company_name: 'Acme Co',
    install_eta: '',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#fafaf9', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff' }
const header = { backgroundColor: '#0a0a0a', padding: '36px 32px 28px', textAlign: 'center' as const }
const wordmark = { fontSize: '22px', fontWeight: '700' as const, color: '#ffffff', margin: '0 0 4px', letterSpacing: '-0.3px' }
const tagline = { fontSize: '11px', color: '#94a3b8', margin: '0', letterSpacing: '1px', textTransform: 'uppercase' as const }
const body = { padding: '36px 32px' }
const h1 = { fontSize: '24px', fontWeight: '600' as const, color: '#0a0a0a', margin: '0 0 16px', letterSpacing: '-0.3px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.7', margin: '0 0 18px' }
const textMuted = { fontSize: '14px', color: '#64748b', lineHeight: '1.7', margin: '24px 0 0' }
const card = { backgroundColor: '#f6f5f2', borderRadius: '10px', padding: '20px 22px', margin: '0 0 24px' }
const cardLabel = { fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600' as const, margin: '0 0 6px' }
const cardBody = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0' }
const link = { color: '#0a0a0a', textDecoration: 'underline' }
const footer = { backgroundColor: '#0a0a0a', padding: '20px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 2px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
