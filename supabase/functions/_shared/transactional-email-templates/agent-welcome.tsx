/**
 * agent-welcome: sent by the Stripe webhook the moment a Bestly Agent order is paid (docs/maya-sales-opusplan.md, part 7).
 * Transactional: the buyer just paid for this, so it carries the setup link, the money-back promise and the way to reach us.
 * Signed by Maya from maya@bestly.tech; replies go to Jared. Bestly brand voice: plain, no emoji, no jargon.
 */
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

interface Props {
  contact_name?: string
  company_name?: string
  plan_name?: string
  /** "$49 a month" */
  price?: string
  /** https://bestly.tech/agent/welcome?o=<token> */
  setup_url?: string
}

// Nextcloud Appointments on cloud.bestly.tech: the same kickoff booking link as bestly.tech/get-started.
const KICKOFF_URL = 'https://cloud.bestly.tech/apps/calendar/appointment/BtktQYtGFocY'

const AgentWelcomeEmail = ({ contact_name, company_name, plan_name, price, setup_url }: Props) => {
  const firstName = (contact_name || '').split(' ')[0] || 'there'
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>You're in. Here's what happens next</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <Text style={wordmark}>Bestly</Text>
            <Text style={tagline}>Bestly Agent</Text>
          </Section>

          <Section style={body}>
            <Heading style={h1}>You're in, {firstName}.</Heading>
            <Text style={text}>
              Thanks for choosing Bestly Agent{company_name ? ` for ${company_name}` : ''}. Your payment went through.
              Here's what happens next.
            </Text>

            <Section style={card}>
              <Text style={cardLabel}>Your plan</Text>
              <Text style={cardValue}>{plan_name || 'Bestly Agent'}{price ? `, ${price}` : ''}</Text>
              <Text style={cardBody}>No setup fee. Cancel anytime. If it isn't right for you, tell us within 30 days and you get all of your money back.</Text>
            </Section>

            <Text style={step}><strong style={strong}>1. Answer a few questions.</strong> Tell us about your business: your hours, what calls should end in, who to transfer to, and what she must never say. It takes about ten minutes, and it saves as you type.</Text>
            {setup_url && (
              <Section style={ctaSection}>
                <Button style={button} href={setup_url}>
                  Answer the setup questions →
                </Button>
              </Section>
            )}
            <Text style={step}><strong style={strong}>2. We build it.</strong> We set up your agent, connect your phone and apps, and test her with practice calls.</Text>
            <Text style={step}><strong style={strong}>3. You try her.</strong> Call her yourself. Tell us anything you'd change.</Text>
            <Text style={step}><strong style={strong}>4. She goes live.</strong> Usually within a few days.</Text>

            <Text style={text}>
              Want to talk it through first? <a href={KICKOFF_URL} style={link}>Book a kickoff call</a> or call us at{' '}
              <a href="tel:+12136410074" style={link}>(213) 641-0074</a>.
            </Text>

            <Text style={textMuted}>
              Questions? Just reply to this email and it goes to Jared.
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

export const template: TemplateEntry = {
  component: AgentWelcomeEmail,
  subject: "You're in. Here's what happens next",
  displayName: 'Bestly Agent welcome (after payment)',
  from: 'Maya at Bestly <maya@bestly.tech>',
  replyTo: 'jared@bestly.tech',
  previewData: {
    contact_name: 'Dana Cole',
    company_name: 'Riverside Dental',
    plan_name: 'Starter',
    price: '$199 a month',
    setup_url: 'https://bestly.tech/agent/welcome?o=preview',
  },
}

/* ── Bestly brand styles (same as the cloud-* emails) ── */
const main = { backgroundColor: '#fafaf9', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }
const container = { maxWidth: '560px', margin: '0 auto', backgroundColor: '#ffffff' }
const header = { backgroundColor: '#0a0a0a', padding: '36px 32px 28px', textAlign: 'center' as const }
const wordmark = { fontSize: '22px', fontWeight: '700' as const, color: '#ffffff', margin: '0 0 4px', letterSpacing: '-0.3px' }
const tagline = { fontSize: '11px', color: '#94a3b8', margin: '0', letterSpacing: '1px', textTransform: 'uppercase' as const }
const body = { padding: '36px 32px' }
const h1 = { fontSize: '24px', fontWeight: '600' as const, color: '#0a0a0a', margin: '0 0 16px', letterSpacing: '-0.3px' }
const text = { fontSize: '15px', color: '#475569', lineHeight: '1.7', margin: '0 0 18px' }
const step = { fontSize: '15px', color: '#475569', lineHeight: '1.7', margin: '0 0 14px' }
const strong = { color: '#0a0a0a' }
const textMuted = { fontSize: '13px', color: '#94a3b8', lineHeight: '1.7', margin: '24px 0 0' }
const ctaSection = { textAlign: 'center' as const, margin: '8px 0 24px' }
const button = { backgroundColor: '#c84d2b', color: '#ffffff', fontSize: '15px', fontWeight: '600' as const, borderRadius: '8px', padding: '13px 28px', textDecoration: 'none', display: 'inline-block' }
const card = { backgroundColor: '#f6f5f2', borderRadius: '10px', padding: '20px 22px', margin: '0 0 28px' }
const cardLabel = { fontSize: '10px', color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '1px', fontWeight: '600' as const, margin: '0 0 4px' }
const cardValue = { fontSize: '20px', color: '#0a0a0a', fontWeight: '600' as const, margin: '0 0 8px' }
const cardBody = { fontSize: '14px', color: '#475569', lineHeight: '1.6', margin: '0' }
const link = { color: '#0a0a0a', textDecoration: 'underline' }
const footer = { backgroundColor: '#0a0a0a', padding: '20px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 2px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
