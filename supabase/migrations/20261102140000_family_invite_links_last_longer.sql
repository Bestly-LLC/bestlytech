-- Family Cookbook: a sign-in link lasts 30 days, not 7.
--
-- Mariah's first invite went stale before she got to it. Seven days is a developer's idea of "soon"; a link to a
-- recipe box sits in a text message until someone has a quiet evening. The link is still single-use and still only
-- a sha-256 here, so the cost of a longer life is small and the cost of an expired one is a person who never joins.
--
-- family-auth sets expires_at explicitly now, so this default is only the belt to that function's braces.

alter table public.family_invites alter column expires_at set default now() + interval '30 days';
