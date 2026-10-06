-- 2026-10-06 Guest login for international guests (/turo-key, /turo-lax).
--
-- What was broken:
--   1. guest_entry_lookup kept the LAST 10 digits of the phone and refused anything shorter, so 8-digit numbers
--      (Singapore, Hong Kong) could never sign in, and the old page mangled +82 numbers before they got here.
--   2. Names lost their accents instead of having them converted ("García" -> "garca", never matching "Garcia"),
--      non-Latin names were wiped to nothing, and a guest typing names in the other order failed.
--   3. turo_enrich_from_mail only read US phones "(406) 555-0199". Turo writes international guests as
--      "Hanseung +82 10-7494-4115 Reservation ID #..." - so their phone never reached turo_trips. It also took the
--      phone from the newest email only, and the booking email has no phone at all.
--
-- Fix:
--   - turo_phone_match(): compare the trailing digits (up to 10, at least 7) so +82 10-..., 010-... and 10-... are
--     the same phone, and 8-digit countries work.
--   - turo_name_tokens(): unaccent + lowercase, keeps letters from any script, splits on spaces/hyphens.
--   - guest_entry_lookup v2: phone must match when we know it; the name may be the last name, the first name, any
--     part of a two-part last name, or both names in either order. A name typed in another script (e.g. Korean)
--     is accepted only when the phone matches exactly.
--   - turo_enrich_from_mail v2: reads any phone written right before "Reservation ID", newest phone per trip.
--   - Korean host demo: +82 10-5555-0100 / Test (page: /turo-key?test=kr).
--   - Attempts now keep the name key and full digits so the login watchdog (next migration) can tie failures to a trip.

create extension if not exists unaccent with schema extensions;

-- ------------------------------------------------------------------ helpers
create or replace function public.turo_phone_match(p_entered text, p_stored text)
returns boolean language sql immutable set search_path = public as $$
  -- null = we don't know the guest's phone; true/false otherwise
  select case
    when length(regexp_replace(coalesce(p_stored, ''), '\D', '', 'g')) < 7 then null
    when length(regexp_replace(coalesce(p_entered, ''), '\D', '', 'g')) < 7 then false
    else right(regexp_replace(p_entered, '\D', '', 'g'),
               least(10, length(regexp_replace(p_entered, '\D', '', 'g')), length(regexp_replace(p_stored, '\D', '', 'g'))))
       = right(regexp_replace(p_stored, '\D', '', 'g'),
               least(10, length(regexp_replace(p_entered, '\D', '', 'g')), length(regexp_replace(p_stored, '\D', '', 'g'))))
  end
$$;

create or replace function public.turo_name_tokens(p text)
returns text[] language sql stable set search_path = public, extensions as $$
  select coalesce(array_agg(w) filter (where length(w) >= 2), '{}')
    from regexp_split_to_table(lower(extensions.unaccent(coalesce(p, ''))), '[^[:alpha:]]+') w
$$;

create or replace function public.turo_name_key(p text)
returns text language sql stable set search_path = public, extensions as $$
  select regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '[^[:alpha:]]', '', 'g')
$$;

-- Does what the guest typed fit this trip's name? (last, first, part of a compound last name, or both in either order)
create or replace function public.turo_name_fits(p_entered text, p_first text, p_last text)
returns boolean language sql stable set search_path = public, extensions as $$
  with e as (select turo_name_key(p_entered) k, turo_name_tokens(p_entered) toks),
       g as (select turo_name_key(p_last) l, turo_name_key(p_first) f, turo_name_tokens(p_last) ltoks, turo_name_tokens(p_first) ftoks)
  select length(e.k) >= 2 and (
           e.k in (g.l, g.f, g.f || g.l, g.l || g.f)
        or e.toks && g.ltoks
        or (cardinality(e.toks) >= 2 and e.toks && g.ftoks and e.toks && g.ltoks))
    from e, g
$$;

-- Letters outside a-z after unaccent (Hangul, kana, Han, Cyrillic...): the guest typed their name in their own script.
create or replace function public.turo_name_non_latin(p text)
returns boolean language sql stable set search_path = public, extensions as $$
  select lower(extensions.unaccent(coalesce(p, ''))) ~ '[^a-z[:space:][:punct:][:digit:]]'
$$;

revoke all on function public.turo_phone_match(text, text) from public, anon;
revoke all on function public.turo_name_tokens(text) from public, anon;
revoke all on function public.turo_name_key(text) from public, anon;
revoke all on function public.turo_name_fits(text, text, text) from public, anon;
revoke all on function public.turo_name_non_latin(text) from public, anon;
grant execute on function public.turo_phone_match(text, text), public.turo_name_tokens(text), public.turo_name_key(text),
  public.turo_name_fits(text, text, text), public.turo_name_non_latin(text) to authenticated, service_role;

alter table public.guest_entry_attempts add column if not exists name_key text;
alter table public.guest_entry_attempts add column if not exists kind text;

-- ------------------------------------------------------------------ the lookup
create or replace function public.guest_entry_lookup(p_kind text, p_phone text, p_last text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare dg text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
        nk text := turo_name_key(p_last);
        t turo_trips; tok text; bad_phone int; bad_all int;
begin
  if length(dg) < 7 or (length(nk) < 2 and not turo_name_non_latin(p_last)) then
    return jsonb_build_object('ok', false, 'reason', 'missing');
  end if;
  -- Host test logins: US (555) 555-0100 and Korea +82 10-5555-0100, last name Test.
  if nk = 'test' and (right(dg, 10) = '5555550100' or right(dg, 10) = '1055550100') then
    return jsonb_build_object('ok', true, 'token', case when p_kind = 'lax' then 'demo-lax' else 'demo-home' end, 'first', 'Test', 'demo', true);
  end if;
  select count(*) into bad_phone from guest_entry_attempts where not ok and right(phone_digits, 7) = right(dg, 7) and at > now() - interval '15 minutes';
  select count(*) into bad_all from guest_entry_attempts where not ok and at > now() - interval '15 minutes';
  if bad_phone >= 5 or bad_all >= 60 then return jsonb_build_object('ok', false, 'reason', 'slow_down'); end if;

  select tt.* into t
    from turo_trips tt join lax_guest_links l using (reservation_id)
   where tt.ends_at > now() - interval '1 day' and coalesce(tt.status, '') not ilike '%cancel%'
     and case turo_phone_match(dg, tt.guest_phone)
           when true then turo_name_fits(p_last, tt.guest_first, tt.guest_last) or turo_name_non_latin(p_last)
           when false then false
           -- phone unknown: the LAST name has to fit (a first name alone is not enough without the phone)
           else length(nk) >= 2 and length(turo_name_key(tt.guest_last)) >= 2 and nk in (turo_name_key(tt.guest_last), turo_name_key(tt.guest_first) || turo_name_key(tt.guest_last),
                       turo_name_key(tt.guest_last) || turo_name_key(tt.guest_first))
                or turo_name_tokens(p_last) && turo_name_tokens(tt.guest_last)
         end
   order by turo_phone_match(dg, tt.guest_phone) is true desc,      -- a phone match beats a name-only match
            (tt.starts_at > now() - interval '1 day') desc, tt.starts_at
   limit 1;

  if t.reservation_id is null then
    insert into guest_entry_attempts (phone_digits, ok, name_key, kind) values (dg, false, nullif(nk, ''), p_kind);
    return jsonb_build_object('ok', false, 'reason', 'nomatch');
  end if;
  select token into tok from lax_guest_links where reservation_id = t.reservation_id;
  insert into guest_entry_attempts (phone_digits, ok, reservation_id, name_key, kind) values (dg, true, t.reservation_id, nullif(nk, ''), p_kind);
  return jsonb_build_object('ok', true, 'token', tok, 'first', t.guest_first, 'kind', lax_trip_kind(t.airport_code));
end $$;
revoke all on function public.guest_entry_lookup(text, text, text) from public;
grant execute on function public.guest_entry_lookup(text, text, text) to anon, authenticated, service_role;

-- ------------------------------------------------------------------ phones from Turo's emails, any country
create or replace function public.turo_enrich_from_mail()
returns integer language plpgsql security definer set search_path = public as $$
declare touched integer := 0; p_touched integer := 0;
begin
  with mails as (
    select sent_at, regexp_replace(body_text, '\s+', ' ', 'g') as b
      from bestly_mail
     where from_addr ilike '%turo%' and body_text is not null and body_text ilike '%Reservation ID%'
  ), parsed as (
    select distinct on (rid) rid,
           nullif(replace(earns, ',', ''), '')::numeric as earnings,
           case when miles ilike 'unlimited' then null else nullif(replace(miles, ',', ''), '')::int end as miles_included,
           (miles ilike 'unlimited') as miles_unlimited
      from (select (regexp_match(b, 'Reservation ID #(\d+)'))[1]::bigint as rid,
                   (regexp_match(b, 'You earn: \$([0-9,.]+)'))[1] as earns,
                   (regexp_match(b, 'Mileage included: ([A-Za-z0-9,]+)'))[1] as miles, sent_at
              from mails) y
     where rid is not null and earns is not null
     order by rid, sent_at desc
  )
  update turo_trips t
     set earnings = coalesce(p.earnings, t.earnings),
         miles_included = coalesce(p.miles_included, t.miles_included),
         miles_unlimited = p.miles_unlimited,
         enriched_at = now(), updated_at = now()
    from parsed p
   where t.reservation_id = p.rid
     and (t.earnings is distinct from p.earnings or t.miles_included is distinct from p.miles_included
       or t.miles_unlimited is distinct from p.miles_unlimited);
  get diagnostics touched = row_count;

  -- The guest's phone sits right before "Reservation ID #": "+82 10-7494-4115", "(406) 555-0199", "+44 7700 900123".
  -- Not every Turo email carries it (the booking email doesn't), so take the newest email that does.
  with phones as (
    select distinct on (rid) rid, btrim(ph) as ph
      from (select (regexp_match(b, '((?:\+\d{1,3}[ .-]?)?\(?\d[\d ().-]{5,}\d) ?Reservation ID #(\d+)'))[1] as ph,
                   (regexp_match(b, 'Reservation ID #(\d+)'))[1]::bigint as rid, sent_at
              from (select sent_at, regexp_replace(body_text, '\s+', ' ', 'g') as b
                      from bestly_mail
                     where from_addr ilike '%turo%' and body_text is not null and body_text ilike '%Reservation ID%') m) x
     where rid is not null and ph is not null and length(regexp_replace(ph, '\D', '', 'g')) between 7 and 15
     order by rid, sent_at desc
  )
  update turo_trips t
     set guest_phone = case when p.ph ~ '^\d{3}\) ' then '(' || p.ph else p.ph end, updated_at = now()
    from phones p
   where t.reservation_id = p.rid
     and regexp_replace(coalesce(t.guest_phone, ''), '\D', '', 'g') is distinct from regexp_replace(p.ph, '\D', '', 'g');
  get diagnostics p_touched = row_count;
  return touched + p_touched;
end $$;
comment on function public.turo_enrich_from_mail is
  'Fills turo_trips.earnings / miles_included / guest_phone from Turo''s own trip emails in bestly_mail. Any country''s phone (the number written right before "Reservation ID"). Idempotent; newest email wins.';
revoke all on function public.turo_enrich_from_mail() from public, anon;
grant execute on function public.turo_enrich_from_mail() to service_role;
