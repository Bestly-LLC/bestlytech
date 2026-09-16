-- Activity feed said "New intake from Unknown" whenever a seller merely opened the intake form:
-- trg_log_submission fired AFTER INSERT, and the first autosave inserts an empty Draft.
-- Log when the seller actually submits (Draft -> Submitted) instead, with the business and
-- client name that exist by then.
create or replace function public.log_intake_submitted()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into admin_activity_log (event_type, description, metadata)
  values (
    'new_submission',
    'Intake submitted: ' || coalesce(
      nullif(trim(new.business_legal_name), '') || coalesce(' (' || nullif(trim(new.client_name), '') || ')', ''),
      nullif(trim(new.client_name), ''),
      'unnamed seller'
    ),
    jsonb_build_object('intake_id', new.id, 'status', new.status, 'platform', new.platform)
  );
  return new;
end $$;

revoke all on function public.log_intake_submitted() from public, anon, authenticated;

drop trigger if exists trg_log_submission on public.seller_intakes;
drop trigger if exists trg_log_intake_submitted on public.seller_intakes;

create trigger trg_log_intake_submitted
  after update of status on public.seller_intakes
  for each row
  when (old.status = 'Draft' and new.status = 'Submitted')
  execute function public.log_intake_submitted();

-- The old insert-time logger is no longer attached to anything.
drop function if exists public.log_new_submission();
