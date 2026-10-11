-- Nickel: housekeeping (2026-10-10). Part 3 of 4.
-- The same settlement shows up on classaction.org and on Top Class Actions under different names ("Equinox - Data Breach
-- Class Action Settlement" and "$685,000 Equinox data breach class action settlement"). The finder dedupes most of them
-- on the way in; this sweeps up the rest every day. Keep the OLDEST row (but a row whose claim is already in motion, or still open to be asked/filed, wins over one that was judged 'no'), mark the newer duplicate's claim skipped with
-- notes 'duplicate of <name>'. A claim that is approved / filing / needs_you / filed / paid / denied is never touched.
-- Key = first distinctive word of the name (money amounts, "class action settlement", "data breach", ... stripped) + the
-- same claim deadline.

create or replace function public.settlement_norm_key(p_name text) returns text
language sql immutable as $$
  select coalesce((
    select t from unnest(regexp_split_to_array(
      regexp_replace(
        regexp_replace(lower(replace(replace(coalesce(p_name, ''), '’', ''), '''', '')), '\$[0-9][0-9.,]*\s*[mbk]?\M', ' ', 'g'),
        'trans union', 'transunion', 'g'),
      '[^a-z0-9]+')) with ordinality as x(t, o)
    where length(t) >= 3
      and t <> all (array['class','action','settlement','data','breach','lawsuit','unwanted','calls','call','texts','text','tcpa',
                          'the','inc','llc','corp','company','group','products','product','services','service','litigation',
                          'consumer','consumers','privacy','security','incident','antitrust','price','prices','fixing','pricefixing',
                          'usa','and','for','with','new','over'])
    order by o limit 1), '');
$$;

create or replace function public.settlement_housekeeping() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_rows int;
begin
  for r in
    with o as (
      select s.id, s.name, s.deadline, s.found_at, settlement_norm_key(s.name) as k,
             case when c.status in ('approved', 'filing', 'needs_you', 'filed', 'paid', 'denied') then 0
                  when c.status in ('found', 'ready') then 1 else 2 end as live
      from settlements s left join settlement_claims c on c.settlement_id = s.id
      where s.status = 'open' and s.deadline is not null),
    g as (
      select o.*, row_number() over (partition by k, deadline order by live, found_at, id) as rn,
             first_value(name) over (partition by k, deadline order by live, found_at, id) as keep_name,
             count(*) over (partition by k, deadline) as cnt
      from o where k <> '')
    select id, keep_name from g where cnt > 1 and rn > 1
  loop
    insert into settlement_claims (settlement_id, match, evidence, question, status, notes)
    values (r.id, 'no', '[]'::jsonb, null, 'skipped', 'duplicate of ' || r.keep_name)
    on conflict (settlement_id) do update set status = 'skipped', notes = 'duplicate of ' || r.keep_name, updated_at = now()
      where settlement_claims.status in ('found', 'ready', 'skipped')
        and settlement_claims.notes is distinct from 'duplicate of ' || r.keep_name;
    get diagnostics v_rows = row_count;
    if v_rows > 0 then
      n := n + 1;
      perform settlement_log((select id from settlement_claims where settlement_id = r.id), 'duplicate_merged', jsonb_build_object('keep', r.keep_name));
    end if;
  end loop;
  return jsonb_build_object('merged', n);
end $$;
revoke all on function public.settlement_housekeeping() from public, anon, authenticated;

-- 8:15 AM Pacific daylight (15:15 UTC): after the Pi finder (7:20 AM), before the 9:05 AM digest.
select cron.schedule('settlement-housekeeping', '15 15 * * *', $c$select public.settlement_housekeeping()$c$);

-- Fix today's duplicates now (Equinox, Lands' End, Community Dental, Concora, plus any other same-day pair).
select public.settlement_housekeeping();

-- Nickel's team card: same card as before, plus the new job in the pulse. welcome=false so the Recruiter does not re-welcome him.
select public.team_onboard($j$[
 {"slug":"settlements","name":"Nickel","role":"Settlements Clerk","reports_to":"scout","runs_on":"pi","icon":"badge-dollar-sign",
  "schedule":"Daily 7:20 AM finder, 8:15 AM housekeeping, 9:05 AM digest; mail and email checks all day","admin_url":"/admin/settlements",
  "what_it_does":"Finds open class action settlements every morning and checks your email and receipts to see which ones you are actually part of. Sends one digest a day; one tap on Yes, file all and he files them (if a site has a CAPTCHA, he hands you the filled-in form to submit). Then he watches your USPS mail scans and your inbox and checks each claim off the moment a check or payment shows up. You can also tap Got paid.",
  "pulse":{"src":"pi_job","key":"settlement-finder","gap":1560,"alert":true,"also":["settlement-daily","settlement-housekeeping"]},
  "owns":["settle."],"welcome":false}
]$j$::jsonb);
