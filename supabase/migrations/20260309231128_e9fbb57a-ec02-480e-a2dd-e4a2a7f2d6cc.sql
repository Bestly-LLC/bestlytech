
-- Create cookie_patterns table
CREATE TABLE public.cookie_patterns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL,
  selector TEXT NOT NULL,
  action_type TEXT NOT NULL,
  cmp_fingerprint TEXT NOT NULL DEFAULT 'generic',
  confidence REAL NOT NULL DEFAULT 0.5,
  report_count INTEGER NOT NULL DEFAULT 1,
  success_count INTEGER NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'community',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain, selector, action_type)
);

-- Validation trigger for action_type instead of CHECK constraint
CREATE OR REPLACE FUNCTION public.validate_cookie_pattern_action_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $$
BEGIN
  IF NEW.action_type NOT IN ('accept', 'reject', 'necessary', 'save', 'close') THEN
    RAISE EXCEPTION 'Invalid action_type: %. Must be one of: accept, reject, necessary, save, close', NEW.action_type;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_cookie_pattern_action_type
  BEFORE INSERT OR UPDATE ON public.cookie_patterns
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_cookie_pattern_action_type();

-- Update updated_at trigger
CREATE TRIGGER trg_cookie_patterns_updated_at
  BEFORE UPDATE ON public.cookie_patterns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Indexes
CREATE INDEX idx_cookie_patterns_domain ON public.cookie_patterns (domain);
CREATE INDEX idx_cookie_patterns_updated_at ON public.cookie_patterns (updated_at);

-- Enable RLS
ALTER TABLE public.cookie_patterns ENABLE ROW LEVEL SECURITY;

-- RLS policies: public read and insert
CREATE POLICY "Anyone can read cookie patterns"
  ON public.cookie_patterns
  FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Anyone can insert cookie patterns"
  ON public.cookie_patterns
  FOR INSERT
  TO public
  WITH CHECK (true);

-- Service role can manage all
CREATE POLICY "Service role can manage cookie patterns"
  ON public.cookie_patterns
  FOR ALL
  TO public
  USING (auth.role() = 'service_role'::text);

-- SECURITY DEFINER function: upsert_pattern
CREATE OR REPLACE FUNCTION public.upsert_pattern(
  _domain TEXT,
  _selector TEXT,
  _action_type TEXT,
  _cmp_fingerprint TEXT DEFAULT 'generic',
  _source TEXT DEFAULT 'community'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  INSERT INTO public.cookie_patterns (domain, selector, action_type, cmp_fingerprint, source, last_seen)
  VALUES (_domain, _selector, _action_type, _cmp_fingerprint, _source, now())
  ON CONFLICT (domain, selector, action_type)
  DO UPDATE SET
    report_count = cookie_patterns.report_count + 1,
    confidence = LEAST(cookie_patterns.confidence + 0.02, 1.0),
    last_seen = now(),
    updated_at = now();
END;
$$;

-- SECURITY DEFINER function: record_pattern_success
CREATE OR REPLACE FUNCTION public.record_pattern_success(
  _domain TEXT,
  _selector TEXT,
  _action_type TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  UPDATE public.cookie_patterns
  SET
    success_count = success_count + 1,
    confidence = LEAST(confidence + 0.03, 1.0),
    updated_at = now()
  WHERE domain = _domain
    AND selector = _selector
    AND action_type = _action_type;
END;
$$;
