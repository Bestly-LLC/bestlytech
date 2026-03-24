

# Rebrand Cookie Yeti Emails — Apple-Playful Design

## Overview

Redesign all four Cookie Yeti email templates around the yeti icon as the hero element, with an Apple-inspired clean/minimal layout that still feels fun and playful. Think Apple's product announcement emails — generous whitespace, centered layout, bold typography, subtle gradients — but with the yeti's personality.

## Design Direction

- **Hero element**: The Cookie Yeti icon (uploaded image) centered at the top of every email, displayed large and prominent (like Apple's product hero shots)
- **Color palette**: Deep navy header (#0f172a) with the yeti icon floating on it, clean white body, soft ice-blue accents (#bfdbfe, #e0f2fe) for info boxes
- **Typography**: Plus Jakarta Sans, tight letter-spacing on headings, generous line-height on body — same Apple-like precision but warmer
- **Playful touches**: Subtle emoji usage, friendly copy tone ("You're in." not "Your order has been confirmed"), rounded corners, soft shadows
- **No Bestly logo** on Cookie Yeti emails — the yeti icon IS the brand mark. "Cookie Yeti" text sits beneath it.

## Files Changed

### 1. Upload the new Cookie Yeti icon to email-assets storage bucket
- Upload the provided `CookieYeti-icon-2.png` so it's accessible via a public URL for all email templates

### 2. `supabase/functions/_shared/transactional-email-templates/order-confirmation.tsx`
- Replace Bestly logo with large centered yeti icon (~80px)
- Add "Cookie Yeti" wordmark below icon, linked to bestly.tech
- Apple-style centered layout: icon → wordmark → bold headline → order details card → footer
- Headline: "You're in." (playful, confident)
- Order details in a clean card with soft ice-blue background
- Minimal footer with "Cookie Yeti by Bestly" text

### 3. `supabase/functions/_shared/transactional-email-templates/welcome.tsx`
- Same yeti-icon-first header treatment
- Headline: "Welcome aboard." with a subtle snowflake or yeti emoji
- Steps redesigned as Apple-style numbered list with bold step titles, light descriptions
- CTA button with rounded pill shape, navy background
- Warm, concise copy

### 4. `supabase/functions/_shared/transactional-email-templates/subscription-update.tsx`
- Same yeti-icon header
- Status-specific headlines kept playful: "All good." (renewed), "We'll miss you." (canceled), "Heads up." (past_due), "Time's up." (expired)
- Clean status card with color-coded left border (green/red/amber/gray)
- Action buttons for past_due/expired/canceled states

### 5. `supabase/functions/_shared/email-template.ts` (activationCodeEmail function)
- Update to use the new icon from storage bucket instead of the lovable.app URL
- Match the same Apple-playful design system: large centered yeti icon, "Cookie Yeti" wordmark, clean white body
- Activation code box with the same ice-blue styling but cleaner, more spacious layout

### 6. Redeploy edge functions
- Deploy `send-transactional-email`, `auth-email-hook`, and `send-activation-code` to apply changes

## Shared Design System (all templates)

```text
┌─────────────────────────────┐
│     (deep navy #0f172a)     │
│                             │
│       🏔️ [Yeti Icon]        │
│        80×80, rounded       │
│                             │
│       Cookie Yeti           │
│    (white, 20px, bold)      │
│                             │
│    tagline in ice-blue      │
│                             │
├─────────────────────────────┤
│                             │
│     (white body, 36px pad)  │
│                             │
│   Big Bold Headline.        │
│   (#0f172a, 28px, -0.5px)   │
│                             │
│   Friendly body copy        │
│   (#64748b, 15px, 1.7 lh)  │
│                             │
│   ┌─ ice-blue card ───────┐ │
│   │  details / code / etc │ │
│   └───────────────────────┘ │
│                             │
│      [ CTA Button ]         │
│   (navy pill, 14px bold)    │
│                             │
├─────────────────────────────┤
│     (navy footer)           │
│  Cookie Yeti by Bestly      │
│  Los Angeles, CA            │
└─────────────────────────────┘
```

