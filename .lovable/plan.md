

## Hire Me Intake Form Implementation Plan

### Overview
Create a dedicated "Hire Me" intake form page for potential clients who want to hire you. The form will collect detailed project information, store submissions in the database, and send email notifications from `support@bestly.tech` to `jaredbest@icloud.com`.

### What We'll Build

**1. New Database Table: `hire_requests`**
- Stores all intake form submissions with comprehensive project details
- Fields: name, email, company, project type, budget range, timeline, project description, how they found you

**2. New Edge Function: `submit-hire-request`**
- Validates form data with sanitization
- Stores submission in database
- Sends formatted email notification via SMTP to jaredbest@icloud.com
- Includes rate limiting and honeypot spam protection

**3. New Page: `/hire` (Hire.tsx)**
- Professional intake form with the following fields:
  - Name (required)
  - Email (required)
  - Company/Organization (optional)
  - Project Type (dropdown: Web App, Mobile App, Browser Extension, AI/Automation, Consulting, Other)
  - Budget Range (dropdown: Under $5K, $5K-$15K, $15K-$50K, $50K+, Not Sure)
  - Timeline (dropdown: ASAP, 1-2 months, 3-6 months, Flexible)
  - Project Description (textarea, required)
  - How did you hear about me? (optional)
- Success state with confirmation message
- SEO optimized with proper meta tags

**4. Navigation Update**
- Add "Hire Me" link to header navigation

---

### Technical Details

**Database Schema:**
```sql
CREATE TABLE hire_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT,
  project_type TEXT NOT NULL,
  budget_range TEXT,
  timeline TEXT,
  description TEXT NOT NULL,
  referral_source TEXT,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS Policies
ALTER TABLE hire_requests ENABLE ROW LEVEL SECURITY;

-- Allow public inserts
CREATE POLICY "Anyone can submit hire request"
  ON hire_requests FOR INSERT
  WITH CHECK (true);

-- Service role manages all
CREATE POLICY "Service role can manage hire requests"
  ON hire_requests FOR ALL
  USING (auth.role() = 'service_role');
```

**Edge Function Features:**
- Uses existing SMTP secrets (SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT)
- Sends FROM: support@bestly.tech (SMTP_USER)
- Sends TO: jaredbest@icloud.com (hardcoded in function)
- Professional email format with all project details
- Rate limiting (5 submissions per hour per IP)
- Honeypot field for bot protection
- Input sanitization

**Email Format:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEW HIRE REQUEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

From: [Name] <[Email]>
Company: [Company or N/A]

PROJECT DETAILS
───────────────
Type: [Project Type]
Budget: [Budget Range]
Timeline: [Timeline]

Description:
[Project Description]

Referral Source: [How they heard about you]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Submitted: [Timestamp]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### Files to Create/Modify

| File | Action |
|------|--------|
| `supabase/migrations/[timestamp].sql` | Create `hire_requests` table with RLS |
| `supabase/functions/submit-hire-request/index.ts` | Edge function for form submission + email |
| `supabase/config.toml` | Add new function config |
| `src/pages/Hire.tsx` | New intake form page |
| `src/App.tsx` | Add route for `/hire` |
| `src/components/layout/Header.tsx` | Add "Hire Me" navigation link |

---

### Form Fields Summary

| Field | Type | Required | Options |
|-------|------|----------|---------|
| Name | Text input | Yes | - |
| Email | Email input | Yes | - |
| Company | Text input | No | - |
| Project Type | Select | Yes | Web App, Mobile App, Browser Extension, AI/Automation, Consulting, Other |
| Budget Range | Select | No | Under $5K, $5K-$15K, $15K-$50K, $50K+, Not Sure |
| Timeline | Select | No | ASAP, 1-2 months, 3-6 months, Flexible |
| Project Description | Textarea | Yes | - |
| Referral Source | Text input | No | - |

---

### User Experience Flow
1. User navigates to `/hire` or clicks "Hire Me" in navigation
2. User fills out intake form with project details
3. On submit: loading state shown
4. Backend validates, stores in database, sends email
5. User sees success confirmation with "We'll be in touch within 2-3 business days"
6. You receive formatted email at jaredbest@icloud.com

