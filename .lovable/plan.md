

# Apple-esque Admin Login Redesign

## Design Direction

Inspired by Apple's sign-in screens (iCloud, Apple ID): ultra-clean, centered, generous whitespace, SF-style typography, frosted glass, subtle backdrop blur, no visible card borders — just floating content on a refined gradient.

## Visual Changes

**Layout**
- Remove the `Card` wrapper entirely — content floats on the page like Apple's login
- Full-screen dark gradient background with a subtle radial glow behind the form
- Center-aligned, narrower max-width (~360px) with generous vertical spacing

**Header**
- Bestly logo larger and centered, no shield icon
- "Admin" as a single word subtitle in light muted text, Apple-style
- Remove "Secure access for authorized personnel only" — Apple never explains, it implies

**Buttons — Apple Sign In**
- Black pill button with white Apple logo + white text (Apple's official style)
- Rounded-full (fully rounded corners), `h-12`, bold but not heavy

**Buttons — Passkey**
- White/light pill button with fingerprint icon, same rounded-full shape
- Subtle border, no fill — secondary treatment

**Divider**
- Thin line with centered "or" in small muted text — keep but make more minimal

**Form Fields**
- Borderless inputs with light bottom-border only (like Apple's text fields)
- Larger text, more padding, placeholder text only (no labels above)
- Remove visible `Label` components, use placeholder instead

**Sign In Button**
- Full-width, rounded-full, solid primary gradient or deep blue
- Clean "Sign In" text, no icon

**Loading State**
- Replace spinner with a pulsing Apple-style dot animation

**Animation**
- Fade-in + slight slide-up on mount using CSS or framer-motion

## Files Modified
- `src/pages/admin/AdminLogin.tsx` — complete visual overhaul, same logic preserved

