-- SEC-04: DB-backed rate limiting for activation-code send + validate.
-- Previously the in-memory Map was reset on every Deno isolate restart,
-- making a 6-digit (1M-space) code brute-forceable with patience.
--
-- Applied to prod 2026-04-20 via Supabase Management API; this file is
-- the source-of-truth mirror.

CREATE TABLE IF NOT EXISTS public.activation_code_attempts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email        text    NOT NULL,
  action       text    NOT NULL CHECK (action IN ('send', 'validate')),
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (email, action)
);

ALTER TABLE public.activation_code_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages activation_code_attempts"
ON public.activation_code_attempts
FOR ALL
TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.check_activation_rate_limit(
  p_email  text,
  p_action text
) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_max_count  int;
  v_window_sec int;
  v_lock_sec   int;
  v_row        public.activation_code_attempts;
  v_now        timestamptz := now();
  v_retry_sec  int := 0;
BEGIN
  IF p_action = 'send' THEN
    v_max_count := 5; v_window_sec := 3600; v_lock_sec := 3600;
  ELSIF p_action = 'validate' THEN
    v_max_count := 10; v_window_sec := 900; v_lock_sec := 1800;
  ELSE
    RAISE EXCEPTION 'invalid action: %', p_action;
  END IF;

  INSERT INTO public.activation_code_attempts (email, action, count, window_start, updated_at)
  VALUES (p_email, p_action, 1, v_now, v_now)
  ON CONFLICT (email, action) DO UPDATE
    SET count = CASE
      WHEN public.activation_code_attempts.locked_until IS NOT NULL
        AND public.activation_code_attempts.locked_until > v_now
      THEN public.activation_code_attempts.count
      WHEN public.activation_code_attempts.window_start + (v_window_sec || ' seconds')::interval < v_now
      THEN 1
      ELSE public.activation_code_attempts.count + 1
    END,
    window_start = CASE
      WHEN public.activation_code_attempts.locked_until IS NOT NULL
        AND public.activation_code_attempts.locked_until > v_now
      THEN public.activation_code_attempts.window_start
      WHEN public.activation_code_attempts.window_start + (v_window_sec || ' seconds')::interval < v_now
      THEN v_now
      ELSE public.activation_code_attempts.window_start
    END,
    updated_at = v_now
  RETURNING * INTO v_row;

  IF v_row.count > v_max_count AND (v_row.locked_until IS NULL OR v_row.locked_until <= v_now) THEN
    UPDATE public.activation_code_attempts
      SET locked_until = v_now + (v_lock_sec || ' seconds')::interval,
          updated_at   = v_now
      WHERE id = v_row.id
      RETURNING locked_until INTO v_row.locked_until;
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > v_now THEN
    v_retry_sec := GREATEST(1, EXTRACT(EPOCH FROM (v_row.locked_until - v_now))::int);
    RETURN jsonb_build_object('allowed', false, 'remaining', 0, 'retry_after', v_retry_sec);
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'remaining', GREATEST(0, v_max_count - v_row.count),
    'retry_after', 0
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_activation_rate_limit(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.check_activation_rate_limit(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.cleanup_activation_rate_limits()
  RETURNS void
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = public
AS $$
  DELETE FROM public.activation_code_attempts
  WHERE updated_at < now() - interval '1 day'
    AND (locked_until IS NULL OR locked_until < now());
$$;

REVOKE ALL ON FUNCTION public.cleanup_activation_rate_limits() FROM public;
GRANT EXECUTE ON FUNCTION public.cleanup_activation_rate_limits() TO service_role;
