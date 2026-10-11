/**
 * privacy-verify: Vera (the Privacy Clerk) asks the person to confirm a data request they made on the phone with Maya.
 * One button. Nothing in the body is chosen by the caller except their first name, the date and the action phrase.
 * Short link only (bestly.tech/p/<8 characters>). Sent once, with one reminder after 3 days (see privacy-clerk).
 */
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  first_name?: string
  /** "delete your data" | "send you a copy of your data" | "stop sending you marketing" | "correct your data" */
  ask?: string
  /** e.g. "Oct 10" */
  requested_on?: string
  /** e.g. "bestly.tech/p/k7m3x9qa" */
  short_link?: string
  code?: string
}

const NB = ' '

const PrivacyVerifyEmail = ({ first_name, ask, requested_on, short_link, code }: Props) => {
  const name = (first_name || '').trim() || 'there'
  const link = short_link || 'bestly.tech/p/'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>One tap to confirm your data request</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>Bestly</Text>
            <Text style={tagline}>Privacy</Text>
          </Section>

          <Section style={body}>
            <Heading style={h1}>Hi {name},</Heading>
            <Text style={text}>
              On {requested_on || 'a recent day'} you asked Bestly to {ask || 'update your data'}. To make sure it was really you, tap the button below.
            </Text>

            <Section style={{ textAlign: 'center' as const, margin: '8px 0 28px' }}>
              <Button href={`https://${link}`} style={button}>Yes, this was me</Button>
            </Section>

            <Text style={text}>
              If the button does not work, open this link: <a href={`https://${link}`} style={linkStyle}>{link}</a>
            </Text>
            <Text style={text}>
              If you didn't ask for this, ignore this email and nothing will change.
            </Text>
            <Text style={textMuted}>
              This link works for 14{NB}days. Your reference is {code || 'on file'}.
            </Text>
          </Section>

          <Section style={footer}>
            <Text style={footerBrand}>Bestly LLC</Text>
            <Text style={footerMuted}>733 North Kings Road #205, Los Angeles, CA 90069</Text>
            <Text style={footerMuted}>Sent because a data request was made with your email address.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: PrivacyVerifyEmail,
  subject: 'Confirm your Bestly data request',
  displayName: 'Privacy request: confirm it was you (Vera)',
  from: 'Bestly Privacy <privacy@bestly.tech>',
  replyTo: 'privacy@bestly.tech',
  previewData: {
    first_name: 'Dana',
    ask: 'delete your data',
    requested_on: 'Oct 10',
    short_link: 'bestly.tech/p/k7m3x9qa',
    code: 'M-4821',
  },
}

const main = { backgroundColor: '#fafaf9', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff' }
const header = { backgroundColor: '#0a0a0a', padding: '36px 32px 28px', textAlign: 'center' as const }
const wordmark = { fontSize: '22px', fontWeight: '700' as const, color: '#ffffff', margin: '0 0 4px', letterSpacing: '-0.3px' }
const tagline = { fontSize: '11px', color: '#94a3b8', margin: '0', letterSpacing: '1px', textTransform: 'uppercase' as const }
const body = { padding: '36px 32px' }
const h1 = { fontSize: '24px', fontWeight: '600' as const, color: '#0a0a0a', margin: '0 0 16px', letterSpacing: '-0.3px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.7', margin: '0 0 18px' }
const textMuted = { fontSize: '13px', color: '#64748b', lineHeight: '1.7', margin: '24px 0 0' }
const button = { backgroundColor: '#c84d2b', color: '#ffffff', fontSize: '16px', fontWeight: '600' as const, padding: '14px 28px', borderRadius: '10px', textDecoration: 'none', display: 'inline-block' }
const linkStyle = { color: '#0a0a0a', textDecoration: 'underline' }
const footer = { backgroundColor: '#0a0a0a', padding: '20px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 2px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
