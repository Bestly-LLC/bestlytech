-- The contacts sync did 923 separate UPDATEs to refresh names and ran out of time (the inserts had already landed,
-- so the first run finished its real work and then returned a 500). One call instead: hand the whole address book
-- over as jsonb and let Postgres do the diff.
--
-- Only rows the sync owns are touched (source = 'icloud'). Rows Jared wrote by hand keep the name, relationship and
-- notes he gave them, because those are read into Ava's prompt on a call.

create or replace function public.ava_contacts_apply(p_people jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_added integer; v_renamed integer; v_total integer;
begin
  create temporary table _incoming (phone text primary key, name text, org text, uid text) on commit drop;

  insert into _incoming (phone, name, org, uid)
  select p.phone, p.name, nullif(p.org, ''), nullif(p.uid, '')
    from jsonb_to_recordset(p_people) as p(phone text, name text, org text, uid text)
   where p.phone is not null and p.name is not null and length(p.name) > 0
  on conflict (phone) do nothing;

  -- new numbers
  with ins as (
    insert into public.ava_contacts (name, phone, relationship, source, apple_uid, synced_at)
    select i.name, i.phone, i.org, 'icloud', i.uid, now()
      from _incoming i
     where not exists (select 1 from public.ava_contacts c where c.phone = i.phone)
    returning 1)
  select count(*) into v_added from ins;

  -- names and uids that moved on, synced rows only
  with upd as (
    update public.ava_contacts c
       set name      = i.name,
           apple_uid = coalesce(c.apple_uid, i.uid),
           synced_at = now()
      from _incoming i
     where c.phone = i.phone and c.source = 'icloud' and c.name is distinct from i.name
    returning 1)
  select count(*) into v_renamed from upd;

  -- everyone still in the book gets a fresh timestamp, so a row that stops appearing is visible by its stale one
  update public.ava_contacts c set synced_at = now()
    from _incoming i
   where c.phone = i.phone and c.source = 'icloud' and c.synced_at is distinct from now();

  select count(*) into v_total from public.ava_contacts;
  return jsonb_build_object('added', v_added, 'renamed', v_renamed, 'total', v_total);
end $function$;

revoke all on function public.ava_contacts_apply(jsonb) from public, anon, authenticated;
grant execute on function public.ava_contacts_apply(jsonb) to service_role;
