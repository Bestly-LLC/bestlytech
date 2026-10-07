-- Shops Jared already uses go first (2026-10-07). Jared: "this should have been one of the first places you tried"
-- about Paulee Body Shop on La Cienega, which Claims Closer ranked below five shops he had never used.
--   used_before   big ranking bonus in shopScore (claims-closer/estimates.ts), and the request email opens as a returning customer
--   contact_name  the person he deals with there; the request email greets them by first name
alter table public.claim_shops add column if not exists used_before boolean not null default false;
alter table public.claim_shops add column if not exists contact_name text;
update public.claim_shops set used_before = true, contact_name = coalesce(contact_name, 'Gus') where slug = 'paulee-kenduco';
update public.claim_shops set used_before = true where notes ilike '%jared used them before%';
