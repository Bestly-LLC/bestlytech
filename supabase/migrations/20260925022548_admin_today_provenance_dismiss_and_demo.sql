-- Four things wrong with the to-do list, all of them in admin_today_rows()/admin_today_done().
--
-- 1. No provenance. The rows carried a source LABEL ("Studio") and nothing about which table,
--    which record, or what condition put it there. Nothing to show on hover.
-- 2. Demo data. studio_requests has a client_slug 're-demo' row, "Real-estate carousel — 1847
--    Hillhurst Avenue (test listing)", and nothing filtered it out.
-- 3. No check mark on most rows. admin_today_done() handled 'cy:' and 'bell:' and RAISED for
--    everything else, so ticking a Studio item threw instead of clearing it.
-- 4. Studio links went to the wrong place: raw rotating Vercel deployment URLs
--    (bestly-review-9i04xpfbn-bestly.vercel.app) that go stale, or the bare studio.bestly.tech
--    homepage rather than the item being flagged.
--
-- The full body of admin_today_rows() is long; it is the previous version with four changes:
-- provenance columns, the demo filter on studio_requests, canonical Studio deep links, and the
-- dismissal join at the bottom. See the database for the authoritative definition.

create table if not exists public.admin_today_dismissed (
  key          text primary key,
  fingerprint  text not null,
  dismissed_at timestamptz not null default now()
);
alter table public.admin_today_dismissed enable row level security;
drop policy if exists "today dismissed: admin" on public.admin_today_dismissed;
create policy "today dismissed: admin" on public.admin_today_dismissed for all to authenticated
  using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

/** Is this Studio row a demo or test build rather than real client work? */
create or replace function public.studio_is_demo(p_slug text, p_title text, p_ctx jsonb)
returns boolean language sql immutable as $$
  select coalesce(p_slug, '') ~* '^(re-)?demo'
      or coalesce(p_title, '') ~* '\((test|demo)[^)]*\)'
      or coalesce(p_title, '') ~* '\b(test listing|sample listing)\b'
      or coalesce(p_ctx->>'test', 'false')::boolean
      or coalesce(p_ctx->>'demo', 'false')::boolean;
$$;

-- admin_today_rows() and admin_today() are recreated here with the signature below; the body is
-- reproduced in full in the database. Both were dropped and recreated because the return type
-- gained origin_table, origin_id, why and fingerprint.
--
--   returns table(key text, source text, severity text, title text, detail text,
--                 action_label text, url text, since timestamptz, item_count integer,
--                 rank integer, origin_table text, origin_id text, why text, fingerprint text)
