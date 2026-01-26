-- Create hire_requests table for intake form submissions
CREATE TABLE public.hire_requests (
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

-- Enable Row Level Security
ALTER TABLE public.hire_requests ENABLE ROW LEVEL SECURITY;

-- Allow anyone to submit a hire request (public form)
CREATE POLICY "Anyone can submit hire request"
  ON public.hire_requests
  FOR INSERT
  WITH CHECK (true);

-- Service role can manage all hire requests
CREATE POLICY "Service role can manage hire requests"
  ON public.hire_requests
  FOR ALL
  USING (auth.role() = 'service_role');