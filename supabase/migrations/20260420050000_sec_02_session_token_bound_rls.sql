-- SEC-02: Bind anonymous access on seller_intakes/intake_documents to a
-- session_token that the client sends as x-intake-token header. Previously
-- the form-ID UUID was the only barrier to PII (SSN/ITIN, bank holder
-- names, addresses, etc.). UUIDs leak into browser history, referrers,
-- screenshots, and share links — they are not secrets.
--
-- Rollout is non-breaking: existing rows are marked requires_session_token
-- = FALSE so legacy URLs keep working. New rows default to TRUE and the
-- client includes the token in both the URL (?s=<token>) and every
-- Supabase request header.
--
-- Applied to prod 2026-04-20 via Supabase Management API; this file is the
-- source-of-truth mirror.

ALTER TABLE public.seller_intakes
  ADD COLUMN IF NOT EXISTS requires_session_token boolean NOT NULL DEFAULT true;

UPDATE public.seller_intakes
  SET requires_session_token = false
  WHERE created_at < now()
    AND requires_session_token = true;

CREATE OR REPLACE FUNCTION public.current_intake_token() RETURNS text
  LANGUAGE sql STABLE
AS $$
  SELECT coalesce(
    nullif(
      (current_setting('request.headers', true)::json ->> 'x-intake-token'),
      ''
    ),
    ''
  );
$$;

REVOKE ALL ON FUNCTION public.current_intake_token() FROM public;
GRANT EXECUTE ON FUNCTION public.current_intake_token() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Anon can read own draft intake"    ON public.seller_intakes;
DROP POLICY IF EXISTS "Anon can update own draft intake"  ON public.seller_intakes;
DROP POLICY IF EXISTS "Public can select draft intakes"   ON public.seller_intakes;
DROP POLICY IF EXISTS "Public can update draft intakes"   ON public.seller_intakes;
DROP POLICY IF EXISTS "Public can insert seller intakes"  ON public.seller_intakes;
DROP POLICY IF EXISTS "Allow public insert of intakes"    ON public.seller_intakes;

CREATE POLICY "Anon select draft intake by token"
ON public.seller_intakes
FOR SELECT
USING (
  status = 'Draft'
  AND (requires_session_token = false
       OR session_token::text = public.current_intake_token())
);

CREATE POLICY "Anon update draft intake by token"
ON public.seller_intakes
FOR UPDATE
USING (
  status = 'Draft'
  AND (requires_session_token = false
       OR session_token::text = public.current_intake_token())
)
WITH CHECK (
  status = 'Draft'
  AND (requires_session_token = false
       OR session_token::text = public.current_intake_token())
);

CREATE POLICY "Anon insert new draft intake"
ON public.seller_intakes
FOR INSERT
WITH CHECK (status = 'Draft');

DROP POLICY IF EXISTS "Public can select draft intake documents" ON public.intake_documents;
DROP POLICY IF EXISTS "Public can update draft intake documents" ON public.intake_documents;
DROP POLICY IF EXISTS "Public can delete draft intake documents" ON public.intake_documents;
DROP POLICY IF EXISTS "Public can insert intake documents"       ON public.intake_documents;

CREATE POLICY "Anon select intake docs by token"
ON public.intake_documents
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.seller_intakes si
  WHERE si.id = intake_documents.intake_id
    AND si.status = 'Draft'
    AND (si.requires_session_token = false
         OR si.session_token::text = public.current_intake_token())
));

CREATE POLICY "Anon insert intake docs by token"
ON public.intake_documents
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.seller_intakes si
  WHERE si.id = intake_documents.intake_id
    AND si.status = 'Draft'
    AND (si.requires_session_token = false
         OR si.session_token::text = public.current_intake_token())
));

CREATE POLICY "Anon update intake docs by token"
ON public.intake_documents
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.seller_intakes si
  WHERE si.id = intake_documents.intake_id
    AND si.status = 'Draft'
    AND (si.requires_session_token = false
         OR si.session_token::text = public.current_intake_token())
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.seller_intakes si
  WHERE si.id = intake_documents.intake_id
    AND si.status = 'Draft'
    AND (si.requires_session_token = false
         OR si.session_token::text = public.current_intake_token())
));

CREATE POLICY "Anon delete intake docs by token"
ON public.intake_documents
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.seller_intakes si
  WHERE si.id = intake_documents.intake_id
    AND si.status = 'Draft'
    AND (si.requires_session_token = false
         OR si.session_token::text = public.current_intake_token())
));
