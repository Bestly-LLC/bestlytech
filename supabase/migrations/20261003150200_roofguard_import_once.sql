-- One-time import helper created during the RoofGuard load, then locked. No role can execute it;
-- the 1,161 leads were loaded through the Supabase admin connection instead. (Spark, 2026-10-03)
create table if not exists public.rg_import_tokens (
  token_sha256 text primary key,
  expires_at   timestamptz not null,
  used_rows    int not null default 0
);
alter table public.rg_import_tokens enable row level security;

create or replace function public.rg_import(p_token text, p_rows jsonb)
returns int
language plpgsql security definer set search_path = public, extensions as $$
begin
  raise exception 'rg_import is retired';
end $$;
revoke execute on function public.rg_import(text, jsonb) from anon, public, authenticated;
