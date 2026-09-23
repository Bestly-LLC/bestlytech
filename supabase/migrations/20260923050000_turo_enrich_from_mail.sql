-- Turo earnings and mileage, recovered from the inbox.
--
-- The upcoming-trips API feed gives who and when but NOT what a trip pays or how many
-- miles it includes. Turo's own "X has an upcoming trip with your Tesla Model 3" email
-- carries all three, keyed by the same reservation id:
--
--   Tesla Model 3 2020 booked by Omar
--   Trip start: 9/19/26 10:00 am   Trip end: 9/20/26 10:00 am
--   You earn: $88.83
--   Mileage included: unlimited
--   Reservation ID #61304880
--
-- Those emails are already being ingested into bestly_mail, so the money was sitting in
-- the database the whole time - it just was not joined to anything. This does the join.
--
-- Trips get changed ("Willie has changed their trip..."), and a change sends a fresh email
-- with new numbers, so the LATEST email per reservation wins, never the first.

alter table public.turo_trips add column if not exists miles_unlimited boolean not null default false;
alter table public.turo_trips add column if not exists guest_phone text;
alter table public.turo_trips add column if not exists enriched_at timestamptz;

comment on column public.turo_trips.miles_unlimited is
  'True when Turo said "Mileage included: unlimited". Distinct from miles_included being null, which means we simply do not know yet.';

create or replace function public.turo_enrich_from_mail()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer := 0;
begin
  with parsed as (
    select distinct on (rid)
      rid,
      nullif(replace(earns, ',', ''), '')::numeric        as earnings,
      case when miles ilike 'unlimited' then null
           else nullif(replace(miles, ',', ''), '')::int end as miles_included,
      (miles ilike 'unlimited')                            as miles_unlimited,
      phone,
      sent_at
    from (
      select
        (regexp_match(b, 'Reservation ID #(\d+)'))[1]::bigint          as rid,
        (regexp_match(b, 'You earn: \$([0-9,.]+)'))[1]                 as earns,
        (regexp_match(b, 'Mileage included: ([A-Za-z0-9,]+)'))[1]      as miles,
        (regexp_match(b, '\((\d{3}\) \d{3}-\d{4})'))[1]                as phone,
        sent_at
      from (
        select sent_at, regexp_replace(body_text, '\s+', ' ', 'g') as b
        from bestly_mail
        where from_addr ilike '%turo%'
          and body_text is not null
          and body_text ilike '%Reservation ID%'
      ) x
    ) y
    where rid is not null and earns is not null
    -- newest email for a reservation wins: a changed trip re-quotes the numbers
    order by rid, sent_at desc
  )
  update turo_trips t
     set earnings        = coalesce(p.earnings, t.earnings),
         miles_included  = coalesce(p.miles_included, t.miles_included),
         miles_unlimited = p.miles_unlimited,
         guest_phone     = coalesce(p.phone, t.guest_phone),
         enriched_at     = now(),
         updated_at      = now()
    from parsed p
   where t.reservation_id = p.rid
     and (t.earnings is distinct from p.earnings
       or t.miles_included is distinct from p.miles_included
       or t.miles_unlimited is distinct from p.miles_unlimited
       or t.guest_phone is distinct from p.phone);

  get diagnostics touched = row_count;
  return touched;
end $$;

comment on function public.turo_enrich_from_mail is
  'Fills turo_trips.earnings / miles_included / guest_phone from Turo''s own trip emails in bestly_mail. Idempotent and safe to run on a schedule; the newest email per reservation wins.';

revoke all on function public.turo_enrich_from_mail() from public, anon;
grant execute on function public.turo_enrich_from_mail() to service_role;
