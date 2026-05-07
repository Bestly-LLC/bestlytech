import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  contact_name?: string
  company_name?: string
}

const CloudBriefSubmittedEmail = ({ contact_name, company_name }: Props) => {
  const firstName = (contact_name || '').split(' ')[0] || 'there'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Brief received — see you on the call</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>Bestly</Text>
            <Text style={tagline}>In-House Cloud</Text>
          </Section>

          <Section style={body}>
            <Heading style={h1}>Brief received, {firstName}.</Heading>
            <Text style={text}>
              Thanks for taking the time. Jared will walk into your discovery call already prepped on
              {company_name ? ` ${company_name}'s` : ' your'} stack and your priorities.
            </Text>
            <Text style={text}>
              You'll get a calendar reminder before the call. If you remember anything else worth flagging,
              just reply to this email — we'll fold it into the prep notes.
            </Text>
            <Text style={textMuted}>
              See you soon.<br />— Jared
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
  component: CloudBriefSubmittedEmail,
  subject: 'Brief received — see you on the call',
  displayName: 'Cloud brief submitted',
  previewData: { contact_name: 'Jane Cooper', company_name: 'Acme Co' },
} satisfies TemplateEntry

/* ── Bestly brand styles (same as cloud-lead-received for consistency) ── */
const main = { backgroundColor: '#fafaf9', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff' }
const header = { backgroundColor: '#0a0a0a', padding: '36px 32px 28px', textAlign: 'center' as const }
const wordmark = { fontSize: '22px', fontWeight: '700' as const, color: '#ffffff', margin: '0 0 4px', letterSpacing: '-0.3px' }
const tagline = { fontSize: '11px', color: '#94a3b8', margin: '0', letterSpacing: '1px', textTransform: 'uppercase' as const }
const body = { padding: '36px 32px' }
const h1 = { fontSize: '24px', fontWeight: '600' as const, color: '#0a0a0a', margin: '0 0 16px', letterSpacing: '-0.3px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.7', margin: '0 0 18px' }
const textMuted = { fontSize: '14px', color: '#64748b', lineHeight: '1.7', margin: '24px 0 0' }
const footer = { backgroundColor: '#0a0a0a', padding: '20px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 2px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
