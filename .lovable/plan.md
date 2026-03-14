

## SMS Notifications for New Submissions

Send a text message to 816-500-7236 whenever a client submits a hire request (`/hire`) or a seller intake (`/amazon-setup`).

### Approach

Use the **Twilio connector** to send SMS from the existing edge functions that already handle these submissions.

### Steps

1. **Connect Twilio** — Link a Twilio connection to this project. You'll need a Twilio account with a phone number that can send SMS.

2. **Update `submit-hire-request` edge function** — After the database insert succeeds, send an SMS summary via the Twilio gateway with the client name, project type, and budget.

3. **Update `validate-intake` edge function** (or create a lightweight `notify-intake-submission` function) — When a seller intake status changes to "Submitted", send an SMS with the client name, platform(s), and submission ID.

### SMS Content Examples

**Hire request:**
> "New hire request from John Doe — Web App, Budget: $5k–$10k"

**Intake submission:**
> "New intake submitted by Jane Smith — Amazon, Shopify — ID: abc123"

### Prerequisites

- A Twilio account with an SMS-capable phone number
- The Twilio connector linked to this project (provides `TWILIO_API_KEY` and uses the gateway for auth)

### What do you need to provide

- Your Twilio "From" phone number (the number Twilio assigns you to send from)

Shall I proceed? I'll start by connecting Twilio.

