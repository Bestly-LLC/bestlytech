-- 1) Find-the-car stays locked while the key is held (license + host check-in not confirmed yet).
do $$ declare d text;
begin
  d := pg_get_functiondef('public.lax_guest_public(text)'::regprocedure);
  if d like '%find_hold%' then return; end if;
  d := replace(d, 'return jsonb_build_object(''ok'', true, ''kind'', kind,',
    'if coalesce(v_held,false) then spot := null; ctl := jsonb_build_object(''state'',''off''); end if;' || chr(10) || '  return jsonb_build_object(''ok'', true, ''kind'', kind,');
  d := replace(d, '''spot'', spot, ''key'', key,', '''spot'', spot, ''find_hold'', coalesce(v_held,false), ''key'', key,');
  if d not like '%find_hold%' or d not like '%ctl := jsonb_build_object(''state'',''off'')%' then raise exception 'patch did not apply'; end if;
  execute d;
end $$;

-- 2) One shared entry link per pickup type (/turo-key home, /turo-lax LAX): phone + last name -> that guest's trip page.
create table if not exists guest_entry_attempts (
  id bigserial primary key, at timestamptz not null default now(), phone_digits text, ok boolean not null, reservation_id bigint);
alter table guest_entry_attempts enable row level security;
create index if not exists guest_entry_attempts_at on guest_entry_attempts (at);

create or replace function guest_entry_lookup(p_kind text, p_phone text, p_last text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ph text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
        ln text := regexp_replace(lower(coalesce(p_last,'')), '[^a-z]', '', 'g');
        t turo_trips; tok text; bad_phone int; bad_all int;
begin
  if length(ph) < 10 or length(ln) < 2 then return jsonb_build_object('ok', false, 'reason', 'missing'); end if;
  -- Host test login: lets Jared walk the whole flow without a real booking.
  if ph = '5555550100' and ln = 'test' then
    return jsonb_build_object('ok', true, 'token', case when p_kind = 'lax' then 'demo-lax' else 'demo-home' end, 'first', 'Test', 'demo', true);
  end if;
  select count(*) into bad_phone from guest_entry_attempts where not ok and phone_digits = ph and at > now() - interval '15 minutes';
  select count(*) into bad_all from guest_entry_attempts where not ok and at > now() - interval '15 minutes';
  if bad_phone >= 5 or bad_all >= 60 then return jsonb_build_object('ok', false, 'reason', 'slow_down'); end if;
  select tt.* into t from turo_trips tt join lax_guest_links l using (reservation_id)
   where regexp_replace(lower(coalesce(tt.guest_last,'')), '[^a-z]', '', 'g') = ln
     and tt.ends_at > now() - interval '1 day' and coalesce(tt.status,'') not ilike '%cancel%'
     and (right(regexp_replace(coalesce(tt.guest_phone,''), '\D', '', 'g'), 10) in ('', ph))
   order by (tt.starts_at > now() - interval '1 day') desc, tt.starts_at limit 1;
  if t.reservation_id is null then
    insert into guest_entry_attempts (phone_digits, ok) values (ph, false);
    return jsonb_build_object('ok', false, 'reason', 'nomatch');
  end if;
  select token into tok from lax_guest_links where reservation_id = t.reservation_id;
  insert into guest_entry_attempts (phone_digits, ok, reservation_id) values (ph, true, t.reservation_id);
  return jsonb_build_object('ok', true, 'token', tok, 'first', t.guest_first, 'kind', lax_trip_kind(t.airport_code));
end $$;
revoke all on function guest_entry_lookup(text,text,text) from public;
grant execute on function guest_entry_lookup(text,text,text) to anon, authenticated, service_role;
