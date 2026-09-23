-- Cookie Yeti pattern poisoning guard (2026-09-23 audit).
--
-- New and unverified patterns sit at confidence 0.2, below the 0.3 serving threshold, until corroborated.
-- But two anon-callable RPCs let anyone skip that:
--   record_pattern_success  +1 confidence per call, unlimited: 10 calls took any pattern to 10
--   upsert_pattern          re-submitting an existing selector bumped its confidence +1 every time
-- Now a public (anon/authenticated) caller counts once per pattern per IP (hashed; request.headers from
-- PostgREST). A quarantined pattern (< 0.3) needs three different IPs to go live (+0.05 each); a live one
-- gains +1 per new IP. Server-side callers (service_role: the AI generator, validator) keep the old
-- behaviour. success_count/report_count still count every call, so stats are unchanged.

create table if not exists public.pattern_votes (
  pattern_id uuid not null references public.cookie_patterns(id) on delete cascade,
  voter text not null,
  kind text not null check (kind in ('success', 'report')),
  at timestamptz not null default now(),
  primary key (pattern_id, voter, kind)
);
alter table public.pattern_votes enable row level security;
drop policy if exists "Admins read pattern votes" on public.pattern_votes;
create policy "Admins read pattern votes" on public.pattern_votes for select to authenticated using (has_role(auth.uid(), 'admin'));

create or replace function public._public_voter() returns text language sql stable set search_path = public as $$
  select md5('cy-vote:' || coalesce(
    nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip',
    split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1),
    'unknown'));
$$;

-- returns true when this is a new public voter for the pattern (and records the vote)
create or replace function public._pattern_vote(p_id uuid, p_kind text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into pattern_votes (pattern_id, voter, kind) values (p_id, _public_voter(), p_kind)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public._pattern_vote(uuid, text) from public, anon, authenticated;

create or replace function public.record_pattern_success(_domain text, _selector text, _action_type text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r cookie_patterns;
  _untrusted boolean := coalesce(auth.role(), '') in ('anon', 'authenticated');
begin
  select * into r from cookie_patterns where domain = _domain and selector = _selector and action_type = _action_type;
  if r.id is null then return; end if;
  if not _untrusted then
    update cookie_patterns set success_count = success_count + 1, confidence = least(confidence + 1, 10), updated_at = now() where id = r.id;
    return;
  end if;
  if _pattern_vote(r.id, 'success') then
    update cookie_patterns set success_count = success_count + 1,
      confidence = case when confidence < 0.3 then confidence + 0.05 else least(confidence + 1, 10) end,
      updated_at = now()
     where id = r.id;
  else
    update cookie_patterns set success_count = success_count + 1, updated_at = now() where id = r.id;
  end if;
end $$;

create or replace function public.upsert_pattern(_domain text, _selector text, _action_type text, _cmp_fingerprint text default 'generic', _source text default 'community')
returns void language plpgsql security definer set search_path = public as $$
declare
  _trimmed_selector text;
  _trimmed_domain text;
  _untrusted boolean;
  _conf real;
  _existing uuid;
begin
  _trimmed_selector := lower(trim(_selector));
  _trimmed_domain := lower(trim(_domain));

  _untrusted := coalesce(auth.role(), '') in ('anon', 'authenticated');

  if _trimmed_selector in ('body', 'html', 'head', 'body *', 'html *', '*') then
    raise warning 'Rejected dangerous selector "%" for domain "%"', _selector, _domain;
    return;
  end if;

  if _untrusted then
    -- A caller holding only the public anon key may not label its own
    -- submission, and may not publish a brand-new selector straight to
    -- every installed extension.
    _source := 'extension';
    _conf := 0.2;  -- below the 0.3 serving threshold until corroborated
    if _trimmed_domain is null or _trimmed_domain = '' or length(_trimmed_domain) > 253
       or _trimmed_selector is null or length(_trimmed_selector) < 2
       or length(_trimmed_selector) > 300 then
      raise warning 'Rejected malformed submission for domain "%"', _domain;
      return;
    end if;
  else
    _conf := 5;  -- unchanged behaviour for service_role / server-side callers
  end if;

  if _trimmed_domain in (
    'icloud.com', 'mail.google.com', 'drive.google.com', 'docs.google.com',
    'outlook.live.com', 'outlook.office.com', 'teams.microsoft.com',
    'accounts.google.com', 'appleid.apple.com'
  ) then
    raise warning 'Rejected pattern for excluded domain "%"', _domain;
    return;
  end if;

  select id into _existing from cookie_patterns where domain = _domain and selector = _selector and action_type = _action_type;

  if _existing is null then
    insert into public.cookie_patterns (domain, selector, action_type, cmp_fingerprint, source, confidence, last_seen)
    values (_domain, _selector, _action_type, _cmp_fingerprint, _source, _conf, now())
    on conflict (domain, selector, action_type) do nothing;
    if _untrusted then
      select id into _existing from cookie_patterns where domain = _domain and selector = _selector and action_type = _action_type;
      if _existing is not null then perform _pattern_vote(_existing, 'report'); end if;
    end if;
    return;
  end if;

  if not _untrusted then
    update cookie_patterns set report_count = report_count + 1, confidence = least(confidence + 1, 10),
      last_seen = now(), updated_at = now() where id = _existing;
  elsif _pattern_vote(_existing, 'report') then
    update cookie_patterns set report_count = report_count + 1,
      confidence = case when confidence < 0.3 then confidence + 0.05 else least(confidence + 1, 10) end,
      last_seen = now(), updated_at = now() where id = _existing;
  else
    update cookie_patterns set report_count = report_count + 1, last_seen = now(), updated_at = now() where id = _existing;
  end if;
end $$;
