-- Create the update function first
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Waitlist subscribers table
CREATE TABLE public.waitlist_subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  products TEXT[] DEFAULT '{}',
  source TEXT,
  confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.waitlist_subscribers ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (public signup)
CREATE POLICY "Anyone can subscribe to waitlist"
ON public.waitlist_subscribers
FOR INSERT
WITH CHECK (true);

-- Only service role can read/update/delete
CREATE POLICY "Service role can manage waitlist"
ON public.waitlist_subscribers
FOR ALL
USING (auth.role() = 'service_role');

-- Contact form submissions table
CREATE TABLE public.contact_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  category TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.contact_submissions ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert (public form)
CREATE POLICY "Anyone can submit contact form"
ON public.contact_submissions
FOR INSERT
WITH CHECK (true);

-- Only service role can read/update/delete
CREATE POLICY "Service role can manage contact submissions"
ON public.contact_submissions
FOR ALL
USING (auth.role() = 'service_role');

-- Update timestamp trigger for waitlist
CREATE TRIGGER update_waitlist_updated_at
BEFORE UPDATE ON public.waitlist_subscribers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();