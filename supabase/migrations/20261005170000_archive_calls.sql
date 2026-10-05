-- 2026-10-05 Archive calls on both Ava pages (Jared: "make it so I can archive calls on personal Ava and RoofGuard").
-- Archive = out of the call lists and the message inbox, but kept: it still counts in the scorecard, spend, coach
-- reviews and history, and it can be put back. (Delete stays the stronger option: out of the scorecard too.)
-- Archiving also marks it read, so it stops counting as unread.
--   rg_archive_call(id, archive) / ava_archive_call(id, archive)   admin only; archive=false puts it back
--   admin_archived_calls(source, limit)                              the Archived list on each page
-- The list functions (rg_call_board, rg_inbound_calls, ava_costs) get "and archived_at is null" patched
-- into their current definitions, so this never rolls back other sessions' edits to those functions. A lead's own call
-- sheet (rg_lead_calls) still shows its archived calls, so one can be opened and put back from there.

alter table public.rg_calls add column if not exists archived_at timestamptz;
alter table public.ava_calls add column if not exists archived_at timestamptz;

create or replace function public.rg_archive_call(p_id uuid, p_archive boolean default true) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  update rg_calls set archived_at = case when p_archive then coalesce(archived_at, now()) end,
                      read_at = case when p_archive then coalesce(read_at, now()) else read_at end
   where id = p_id and deleted_at is null;
end $$;

create or replace function public.ava_archive_call(p_id uuid, p_archive boolean default true) returns void
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  update ava_calls set archived_at = case when p_archive then coalesce(archived_at, now()) end,
                       read_at = case when p_archive then coalesce(read_at, now()) else read_at end
   where id = p_id and deleted_at is null;
end $$;

revoke all on function public.rg_archive_call(uuid, boolean) from public, anon;
revoke all on function public.ava_archive_call(uuid, boolean) from public, anon;
grant execute on function public.rg_archive_call(uuid, boolean) to authenticated;
grant execute on function public.ava_archive_call(uuid, boolean) to authenticated;

create or replace function public.admin_archived_calls(p_source text, p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  if p_source = 'roofguard' then
    return (select coalesce(jsonb_agg(to_jsonb(x) order by x.archived_at desc), '[]') from (
      select c.id, c.call_no, c.direction, coalesce(l.company, c.caller_name, c.to_number) as name, c.summary, c.outcome,
             c.duration_sec, coalesce(c.ended_at, c.queued_at) as at, c.archived_at, c.lead_id
        from rg_calls c left join rg_leads l on l.id = c.lead_id
       where c.archived_at is not null and c.deleted_at is null
       order by c.archived_at desc limit p_limit) x);
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.archived_at desc), '[]') from (
    select c.id, c.call_no, c.direction, coalesce(c.caller_name, c.phone) as name, c.summary, c.message,
           c.duration_sec, c.created_at as at, c.archived_at
      from ava_calls c
     where c.archived_at is not null and c.deleted_at is null
     order by c.archived_at desc limit p_limit) x);
end $$;
revoke all on function public.admin_archived_calls(text, int) from public, anon;
grant execute on function public.admin_archived_calls(text, int) to authenticated;

-- patch the list functions in place (fails loudly if a function no longer looks the way this expects)
do $$
declare d text; n text;
begin
  -- RoofGuard board (one row per lead): skip archived calls
  d := pg_get_functiondef('public.rg_call_board(integer)'::regprocedure);
  if position('archived_at' in d) = 0 then
    n := replace(d, 'and c.moved_to_ava_at is null and c.deleted_at is null and c.direction = ''outbound''',
                    'and c.moved_to_ava_at is null and c.deleted_at is null and c.archived_at is null and c.direction = ''outbound''');
    if n = d then raise exception 'rg_call_board: pattern not found'; end if;
    execute n;
  end if;
  -- RoofGuard incoming calls / messages
  d := pg_get_functiondef('public.rg_inbound_calls(integer)'::regprocedure);
  if position('archived_at' in d) = 0 then
    n := replace(d, 'c.direction in (''inbound'', ''callback'') and c.deleted_at is null',
                    'c.direction in (''inbound'', ''callback'') and c.deleted_at is null and c.archived_at is null');
    if n = d then raise exception 'rg_inbound_calls: pattern not found'; end if;
    execute n;
  end if;
  -- personal Ava: unread messages leave the badge once archived
  d := pg_get_functiondef('public.ava_costs()'::regprocedure);
  if position('archived_at' in d) = 0 then
    n := replace(d, 'c.message is not null and c.read_at is null and c.deleted_at is null',
                    'c.message is not null and c.read_at is null and c.deleted_at is null and c.archived_at is null');
    if n = d then raise exception 'ava_costs: pattern not found'; end if;
    execute n;
  end if;
end $$;
