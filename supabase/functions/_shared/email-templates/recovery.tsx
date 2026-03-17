/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
}

export const RecoveryEmail = ({ siteName, confirmationUrl }: RecoveryEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your password for {siteName}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img src="https://keowunrxpxlbgebujbao.supabase.co/storage/v1/object/public/email-assets/bestly-logo.png" width="120" height="auto" alt="Bestly" style={logo} />
        <Heading style={h1}>Reset your password</Heading>
        <Text style={text}>
          We received a request to reset your password for {siteName}. Click the button below to choose a new password.
        </Text>
        <Button style={button} href={confirmationUrl}>Reset Password</Button>
        <Text style={footer}>If you didn't request a password reset, you can safely ignore this email.</Text>
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }
const container = { padding: '40px 25px' }
const logo = { marginBottom: '24px' }
const h1 = { fontSize: '22px', fontWeight: 'bold' as const, color: '#1a2766', margin: '0 0 20px' }
const text = { fontSize: '14px', color: '#6b6e7b', lineHeight: '1.6', margin: '0 0 25px' }
const button = { backgroundColor: '#1a2766', color: '#f0f4f8', fontSize: '14px', fontWeight: '600' as const, borderRadius: '12px', padding: '12px 24px', textDecoration: 'none' }
const footer = { fontSize: '12px', color: '#999999', margin: '30px 0 0' }
