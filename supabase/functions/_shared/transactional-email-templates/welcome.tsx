import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Img, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Cookie Yeti'
const ICON_URL = 'https://keowunrxpxlbgebujbao.supabase.co/storage/v1/object/public/email-assets/cookieyeti-icon.png'

interface WelcomeProps {
  plan?: string
}

const WelcomeEmail = ({ plan }: WelcomeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome aboard — let's get you set up</Preview>
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

        {/* Body */}
        <Section style={body}>
          <Heading style={h1}>Welcome aboard. ❄️</Heading>
          <Text style={text}>
            You're set with the <strong>{plan || 'Premium'}</strong> plan. Here's how to get started in under a minute.
          </Text>

          <Section style={step}>
            <Text style={stepNum}>1</Text>
            <Text style={stepContent}>
              <strong style={{ color: '#0f172a' }}>Install the extension</strong>
              <br />
              Grab Cookie Yeti from the Chrome Web Store or App Store.
            </Text>
          </Section>

          <Section style={step}>
            <Text style={stepNum}>2</Text>
            <Text style={stepContent}>
              <strong style={{ color: '#0f172a' }}>Activate your account</strong>
              <br />
              Open the extension, enter your email, and we'll send you a code.
            </Text>
          </Section>

          <Section style={step}>
            <Text style={stepNum}>3</Text>
            <Text style={stepContent}>
              <strong style={{ color: '#0f172a' }}>Browse freely</strong>
              <br />
              Cookie banners? Gone. Enjoy a cleaner internet.
            </Text>
          </Section>

          <Section style={ctaSection}>
            <Button style={button} href="https://cookieyeti.app">
              Get Started
            </Button>
          </Section>

          <Text style={textSmall}>
            Need help? Just reply to this email or visit our support page.
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
  component: WelcomeEmail,
  subject: 'Welcome aboard, Cookie Yeti is ready ❄️',
  displayName: 'Welcome email',
  previewData: { plan: 'Yearly' },
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
const text = { fontSize: '15px', color: '#64748b', lineHeight: '1.7', margin: '0 0 28px', textAlign: 'center' as const }
const step = { backgroundColor: '#f0f9ff', borderRadius: '12px', padding: '16px 20px', marginBottom: '10px', border: '1px solid #e0f2fe' }
const stepNum = { fontSize: '20px', fontWeight: '800' as const, color: '#0f172a', margin: '0 0 4px' }
const stepContent = { fontSize: '14px', color: '#64748b', lineHeight: '1.6', margin: '0' }
const ctaSection = { textAlign: 'center' as const, margin: '28px 0 20px' }
const button = { backgroundColor: '#0f172a', color: '#f0f4f8', fontSize: '15px', fontWeight: '600' as const, borderRadius: '50px', padding: '14px 40px', textDecoration: 'none' }
const textSmall = { fontSize: '13px', color: '#94a3b8', textAlign: 'center' as const, margin: '0 0 8px' }
const footer = { backgroundColor: '#0f172a', borderRadius: '0 0 16px 16px', padding: '24px 32px', textAlign: 'center' as const }
const footerBrand = { fontSize: '13px', fontWeight: '600' as const, color: '#e2e8f0', margin: '0 0 4px' }
const footerMuted = { fontSize: '11px', color: '#64748b', margin: '0' }
