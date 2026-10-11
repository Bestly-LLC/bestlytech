/**
 * privacy-done: Vera tells the person what was done with their data request.
 * kind: delete (counts + what the law makes us keep) | export (download button) | opt_out | correct is handled by hand.
 * The only free-form values are numbers, the fixed "kept because" reasons from privacy_data_map, and the short link.
 */
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  kind?: 'delete' | 'export' | 'opt_out'
  first_name?: string
  /** delete: how many places we removed or blanked their information from */
  places?: number
  /** delete: why some records stay, one line each */
  keeps?: string[]
  /** export: e.g. "bestly.tech/p/k7m3x9qa" */
  short_link?: string
  code?: string
}

const NB = ' '

const PrivacyDoneEmail = ({ kind = 'delete', first_name, places, keeps, short_link, code }: Props) => {
  const name = (first_name || '').trim() || 'there'
  const list = Array.isArray(keeps) ? keeps.filter(Boolean) : []
  const link = short_link || 'bestly.tech/p/'
  const n = typeof places === 'number' ? places : 0
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your Bestly data request is done</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>Bestly</Text>
            <Text style={tagline}>Privacy</Text>
          </Section>

          <Section style={body}>
            <Heading style={h1}>Hi {name},</Heading>

            {kind === 'delete' && (<>
              <Text style={text}>
                We deleted your information from {n}{NB}{n === 1 ? 'place' : 'places'} in our systems.
              </Text>
              {list.length > 0 && (
                <Section style={card}>
                  <Text style={cardLabel}>What we kept, and why</Text>
                  <Text style={cardIntro}>We kept a few records because the law requires it:</Text>
                  {list.map((r, i) => (<Text key={i} style={cardLine}>{r}</Text>))}
                  <Text style={cardOutro}>They're used for nothing else.</Text>
                </Section>
              )}
            </>)}

            {kind === 'export' && (<>
              <Text style={text}>Your data file is ready.</Text>
              <Section style={{ textAlign: 'center' as const, margin: '8px 0 24px' }}>
                <Button href={`https://${link}`} style={button}>Download my data</Button>
              </Section>
              <Text style={text}>
                The link works for 7{NB}days: <a href={`https://${link}`} style={linkStyle}>{link}</a>
              </Text>
            </>)}

            {kind === 'opt_out' && (
              <Text style={text}>
                You're off our marketing list. You'll still get receipts and messages you ask for.
              </Text>
            )}

            <Text style={textMuted}>
              Questions? Reply to this email or call (213){NB}641-0074. Reference: {code || 'on file'}.
            </Text>
          </Section>

          <Section style={footer}>
            <Text style={footerBrand}>Bestly LLC</Text>
            <Text style={footerMuted}>733 North Kings Road #205, Los Angeles, CA 90069</Text>
            <Text style={footerMuted}>Sent because you made a data request with Bestly.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: PrivacyDoneEmail,
  subject: 'Your Bestly data request is done',
  displayName: 'Privacy request: done (Vera)',
  from: 'Bestly Privacy <privacy@bestly.tech>',
  replyTo: 'privacy@bestly.tech',
  previewData: {
    kind: 'delete',
    first_name: 'Dana',
    places: 6,
    keeps: ['Sales tax records (4 years)', 'Keeps you off our email list'],
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
const textMuted = { fontSize: '14px', color: '#64748b', lineHeight: '1.7', margin: '24px 0 0' }
const card = { backgroundColor: '#f6f5f2', borderRadius: '10px', padding: '20px 22px', margin: '0 0 24px' }
const cardLabel = { fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600' as const, margin: '0 0 8px' }
const cardIntro = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0 0 8px' }
const cardLine = { fontSize: '14px', color: '#0a0a0a', fontWeight: '600' as const, lineHeight: '1.6', margin: '0 0 4px' }
const cardOutro = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '8px 0 0' }
const button = { backgroundColor: '#c84d2b', color: '#ffffff', fontSize: '16px', fontWeight: '600' as const, padding: '14px 28px', borderRadius: '10px', textDecoration: 'none', display: 'inline-block' }
const linkStyle = { color: '#0a0a0a', textDecoration: 'underline' }
const footer = { backgroundColor: '#0a0a0a', padding: '20px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 2px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
