-- Jared, 2026-10-04: number every call so feedback can name one ("call #3").
-- One shared counter across personal Ava (ava_calls) and RoofGuard (rg_calls), so a number never means two calls.
-- Existing calls are numbered in the order they happened. Calls moved from RoofGuard use their personal-Ava number;
-- the hidden originals get none.

create sequence if not exists public.ava_call_no_seq;
alter table public.ava_calls add column if not exists call_no bigint;
alter table public.rg_calls add column if not exists call_no bigint;

with all_calls as (
  select 'ava' src, id, created_at at_ from public.ava_calls where call_no is null
  union all
  select 'rg', id, queued_at from public.rg_calls where call_no is null and moved_to_ava_at is null
), numbered as (
  select src, id, row_number() over (order by at_, id) n from all_calls
), a as (
  update public.ava_calls t set call_no = n.n from numbered n where n.src = 'ava' and n.id = t.id returning 1
)
update public.rg_calls t set call_no = n.n from numbered n where n.src = 'rg' and n.id = t.id;

select setval('public.ava_call_no_seq', greatest(
  (select coalesce(max(call_no), 0) from public.ava_calls),
  (select coalesce(max(call_no), 0) from public.rg_calls), 1));

alter table public.ava_calls alter column call_no set default nextval('public.ava_call_no_seq');
alter table public.rg_calls alter column call_no set default nextval('public.ava_call_no_seq');
create unique index if not exists ava_calls_call_no_key on public.ava_calls (call_no);
create unique index if not exists rg_calls_call_no_key on public.rg_calls (call_no);
grant usage on sequence public.ava_call_no_seq to authenticated, service_role;
