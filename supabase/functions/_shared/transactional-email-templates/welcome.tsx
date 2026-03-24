import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Img, Preview, Section, Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'Cookie Yeti'
const LOGO_URL = 'https://keowunrxpxlbgebujbao.supabase.co/storage/v1/object/public/email-assets/bestly-logo.png'

interface WelcomeProps {
  plan?: string
}

const WelcomeEmail = ({ plan }: WelcomeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Welcome to {SITE_NAME} — let's get you set up!</Preview>
    <Body style={main}>
      <Container style={container}>
        <a href="https://bestly.tech" style={{ textDecoration: 'none' }}><Img src={LOGO_URL} width="120" height="auto" alt="Bestly" style={logo} /></a>
        <Heading style={h1}>Welcome to {SITE_NAME}! 🐻‍❄️</Heading>
        <Text style={text}>
          You're all set with the <strong>{plan || 'Premium'}</strong> plan. Here's how to get started in under a minute:
        </Text>
        <Section style={stepBox}>
          <Text style={stepNumber}>1</Text>
          <Text style={stepText}>
            <strong>Install the extension</strong> — Download Cookie Yeti from the Chrome Web Store or App Store if you haven't already.
          </Text>
        </Section>
        <Section style={stepBox}>
          <Text style={stepNumber}>2</Text>
          <Text style={stepText}>
            <strong>Activate your account</strong> — Open the extension and enter the email you signed up with. We'll send you an activation code.
          </Text>
        </Section>
        <Section style={stepBox}>
          <Text style={stepNumber}>3</Text>
          <Text style={stepText}>
            <strong>Browse freely</strong> — Cookie Yeti will automatically handle cookie banners based on your preferences. No more pop-ups!
          </Text>
        </Section>
        <Section style={ctaSection}>
          <Button style={button} href="https://cookieyeti.app">
            Get Started
          </Button>
        </Section>
        <Text style={text}>
          If you need help, visit our support page or reply to this email. We're happy to assist!
        </Text>
        <Text style={footer}>
          The {SITE_NAME} Team · support@bestly.tech
        </Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: WelcomeEmail,
  subject: 'Welcome to Cookie Yeti! 🐻‍❄️',
  displayName: 'Welcome email',
  previewData: { plan: 'Yearly' },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: "'Plus Jakarta Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif" }
const container = { padding: '40px 25px', maxWidth: '520px', margin: '0 auto' }
const logo = { marginBottom: '24px' }
const h1 = { fontSize: '24px', fontWeight: 'bold' as const, color: '#1a365d', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#55575d', lineHeight: '1.6', margin: '0 0 20px' }
const stepBox = { backgroundColor: '#f0f7ff', borderRadius: '10px', padding: '16px 20px', marginBottom: '12px', border: '1px solid #bfdbfe', display: 'flex' as const }
const stepNumber = { fontSize: '18px', fontWeight: 'bold' as const, color: '#1a365d', margin: '0 12px 0 0', minWidth: '28px' }
const stepText = { fontSize: '14px', color: '#374151', lineHeight: '1.5', margin: '0' }
const ctaSection = { textAlign: 'center' as const, margin: '28px 0' }
const button = { backgroundColor: '#1a365d', color: '#f0f4f8', fontSize: '14px', fontWeight: '600' as const, borderRadius: '12px', padding: '12px 32px', textDecoration: 'none' }
const footer = { fontSize: '12px', color: '#999999', margin: '24px 0 0' }
