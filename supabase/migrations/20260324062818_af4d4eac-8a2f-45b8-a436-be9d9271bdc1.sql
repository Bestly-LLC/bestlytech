CREATE OR REPLACE FUNCTION public.validate_seller_intake_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status NOT IN ('Draft', 'Submitted', 'In Review', 'Issues Flagged', 'Approved', 'Archived') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$function$;