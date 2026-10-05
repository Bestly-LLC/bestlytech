/**
 * roofguard-info — what Ava emails during a call, the moment someone asks for something to look over.
 *
 * Solicited only: it goes out while the caller is on a recorded line asking for it. The caller
 * controls nothing in here except their first name — the body is fixed, so Ava can never be talked
 * into mailing arbitrary content to someone.
 *
 * Signed by Ava from ava@bestly.tech; replies go to Eli, who runs the program. Bestly is the
 * referral partner for RoofGuard, which is Legacy Building Maintenance Company's program — the
 * first lines say so, because an email about RoofGuard arriving from bestly.tech otherwise reads
 * as a mismatch.
 *
 * No attachment on purpose: a PDF from an unknown sender to a facilities director is a spam-filter
 * magnet and often unopened on a phone. The whole story is in the email.
 */
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  contact_name?: string
  company_name?: string
  eli_email?: string
  eli_phone?: string
  /** One-click opt-out, passed in by the sender. Left out, only the reply-to opt-out line shows. */
  unsubscribe_url?: string
}

const RoofGuardInfoEmail = ({ contact_name, company_name, eli_email, eli_phone, unsubscribe_url }: Props) => {
  const firstName = (contact_name || '').split(' ')[0] || 'there'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>The RoofGuard overview you asked for on our call</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>RoofGuard</Text>
            <Text style={tagline}>Commercial roof maintenance</Text>
          </Section>

          <Section style={body}>
            <Heading style={h1}>Hi {firstName},</Heading>

            <Text style={text}>
              You asked me to send something over on our call just now, so here it is.
            </Text>

            <Text style={text}>
              Quick note on who's who: RoofGuard is a commercial roof maintenance program run by
              Legacy Building Maintenance Company. Eli Cooper runs it. I'm Ava, the assistant at
              Bestly, the referral partner for the program, which is why this is coming from a
              bestly.tech address.
            </Text>

            <Section style={card}>
              <Text style={cardLabel}>The part most people haven't checked</Text>
              <Text style={cardTitle}>Your roof warranty probably has conditions on it</Text>
              <Text style={cardBody}>
                Most commercial roof warranties only hold if the roof gets documented maintenance on
                a schedule. Hardly anyone keeps that paperwork up. When a claim comes, the warranty
                is often already void, and a roof that should have been covered becomes a capital
                project instead.
              </Text>
            </Section>

            <Section style={card}>
              <Text style={cardLabel}>What the program does</Text>
              <Text style={cardTitle}>One predictable monthly line instead of a surprise</Text>
              <Text style={cardBody}>
                Scheduled inspections and maintenance across your buildings, documented so the
                warranty stays intact, for one flat monthly cost. It sits in your operating budget
                rather than waiting to become a capital request. Your accountant can confirm how
                that applies to you.
              </Text>
            </Section>

            <Text style={text}>
              <strong style={{ color: '#0a0a0a' }}>What happens next, if you want it:</strong> a
              20-minute call with Eli. He'll look at
              {company_name ? ` ${company_name}'s` : ' your'} buildings and give you a per-facility
              figure. No obligation, and no one will chase you if the number doesn't work.
            </Text>

            <Text style={text}>
              Eli Cooper
              {eli_email ? <><br />{eli_email}</> : null}
              {eli_phone ? <><br />{eli_phone}</> : null}
            </Text>

            <Text style={textMuted}>
              Reply to this email and it goes straight to Eli. If I got the wrong address or you'd
              rather not hear from us, reply and say so and that's the end of it.
            </Text>
          </Section>

          <Section style={footer}>
            <Text style={footerBrand}>Bestly LLC</Text>
            <Text style={footerMuted}>733 North Kings Road #205, Los Angeles, CA 90069</Text>
            <Text style={footerMuted}>
              Sent because you asked for it on a recorded call with Ava.
            </Text>
            {unsubscribe_url ? (
              <Text style={footerMuted}>
                <a href={unsubscribe_url} style={{ color: '#64748b', textDecoration: 'underline' }}>
                  Don&rsquo;t email me again
                </a>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

export const template: TemplateEntry = {
  component: RoofGuardInfoEmail,
  subject: 'The RoofGuard overview you asked for',
  displayName: 'RoofGuard info (sent by Ava on a call)',
  from: 'Ava at RoofGuard <ava@bestly.tech>',
  replyTo: 'eli@bestly.tech',
  previewData: {
    contact_name: 'Dana Cole',
    company_name: 'Riverside Medical Center',
    eli_email: 'eli@bestly.tech',
    eli_phone: '(816) 544-0206',
    unsubscribe_url: 'https://bestly.tech/unsubscribe?token=preview',
  },
}

const main = { backgroundColor: '#fafaf9', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff' }
const header = { backgroundColor: '#0a0a0a', padding: '36px 32px 28px', textAlign: 'center' as const }
const wordmark = { fontSize: '22px', fontWeight: '700' as const, color: '#ffffff', margin: '0 0 4px', letterSpacing: '-0.3px' }
const tagline = { fontSize: '11px', color: '#94a3b8', margin: '0', letterSpacing: '1px', textTransform: 'uppercase' as const }
const body = { padding: '36px 32px' }
const h1 = { fontSize: '24px', fontWeight: '600' as const, color: '#0a0a0a', margin: '0 0 16px', letterSpacing: '-0.3px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.7', margin: '0 0 24px' }
const textMuted = { fontSize: '13px', color: '#94a3b8', lineHeight: '1.7', margin: '24px 0 0' }
const card = { backgroundColor: '#f6f5f2', borderRadius: '10px', padding: '20px 22px', margin: '0 0 28px' }
const cardLabel = { fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600' as const, margin: '0 0 4px' }
const cardTitle = { fontSize: '16px', color: '#0a0a0a', fontWeight: '600' as const, margin: '0 0 6px' }
const cardBody = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0' }
const footer = { backgroundColor: '#0a0a0a', padding: '20px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 2px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
