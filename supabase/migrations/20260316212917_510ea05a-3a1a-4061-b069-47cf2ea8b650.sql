
-- 1. Create enum
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- 2. Create table
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Service role policy (no dependency on has_role)
CREATE POLICY "Service role manages user_roles"
  ON public.user_roles FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 4. Create SECURITY DEFINER function
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- 5. Admin read policy using has_role
CREATE POLICY "Admins can read user_roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 6. Seed admin role
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'jaredbest@icloud.com'
ON CONFLICT DO NOTHING;

-- 7. Waitlist admin policy
CREATE POLICY "Admin full access waitlist_subscribers"
  ON public.waitlist_subscribers FOR ALL
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text)
  WITH CHECK ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text);

-- 8. Fix ai_generation_log default
ALTER TABLE public.ai_generation_log ALTER COLUMN ai_model SET DEFAULT 'google/gemini-3-flash-preview';

-- 9. Missing policies for missed_banner_reports
CREATE POLICY "Admin full access missed_banner_reports"
  ON public.missed_banner_reports FOR ALL
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text)
  WITH CHECK ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text);

CREATE POLICY "Service role manages missed_banner_reports"
  ON public.missed_banner_reports FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 10. Missing policies for pattern_fix_log
CREATE POLICY "Admin full access pattern_fix_log"
  ON public.pattern_fix_log FOR ALL
  TO authenticated
  USING ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text)
  WITH CHECK ((auth.jwt() ->> 'email'::text) = 'jaredbest@icloud.com'::text);

CREATE POLICY "Service role manages pattern_fix_log"
  ON public.pattern_fix_log FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
