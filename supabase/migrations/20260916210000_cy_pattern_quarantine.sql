-- Cookie Yeti: stop learned "fixes" that aren't cookie buttons.
--
-- report-dismissal turned ONE user click on ANY overlay into a live pattern (default action
-- "reject"). Closing an admin drawer, a Shopify menu or a Studio notification panel taught the
-- extension to click that button on every visit, which reopened the thing the user had just
-- closed: an endless open/close loop. 39 such patterns were live.
--
-- Rule from now on: a pattern whose selector doesn't look like a cookie/consent control stays
-- off (is_active false, confidence 0) until the robot browser proves the button sits inside a
-- cookie banner and clicking it closes the banner (validation_status = 'passed').
-- Bestly's own sites never get automatic patterns. Operator-guided fixes (admin_guided) are exempt.

create or replace function public.cy_selector_cookie_like(p_selector text)
returns boolean language sql immutable as $$
  select coalesce(p_selector, '') ~* '(cookie|consent|gdpr|ccpa|privacy|onetrust|optanon|ot-pc|ot-sdk|didomi|cookiebot|cybot|usercentrics|uc-(deny|accept|btn)|truste|trustarc|quantcast|qc-cmp|sp_choice|sp_message|sourcepoint|osano|iubenda|cky-|cmplz|complianz|termly|klaro|cc-(deny|allow|dismiss|btn)|cmp|ketch|borlabs|brlbs|axeptio|tarteaucitron|guce|reject|decline|deny|necessary|essential)'
$$;

create or replace function public.cy_is_own_domain(p_domain text)
returns boolean language sql immutable as $$
  select lower(coalesce(p_domain, '')) ~ '(^|\.)bestly\.tech$'
$$;

create table if not exists public.cy_pattern_quarantine_log (
  id bigserial primary key,
  pattern_id uuid not null,
  domain text,
  selector text,
  previous jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table public.cy_pattern_quarantine_log enable row level security;
drop policy if exists "Admins read quarantine log" on public.cy_pattern_quarantine_log;
create policy "Admins read quarantine log" on public.cy_pattern_quarantine_log
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));

create or replace function public.cy_pattern_gate()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  own boolean := public.cy_is_own_domain(NEW.domain);
begin
  if NEW.source = 'admin_guided' then return NEW; end if;
  if coalesce(NEW.validation_status, '') = 'passed' and not own then return NEW; end if;
  if public.cy_selector_cookie_like(NEW.selector) and not own then return NEW; end if;

  -- Quarantine. Log the state we're overriding the first time a live row gets caught.
  if TG_OP = 'UPDATE' and (OLD.is_active or coalesce(OLD.confidence, 0) > 0) then
    insert into public.cy_pattern_quarantine_log (pattern_id, domain, selector, previous, reason)
    values (OLD.id, OLD.domain, OLD.selector, to_jsonb(OLD), case when own then 'own_domain' else 'not_cookie_selector' end);
  end if;
  NEW.is_active := false;
  NEW.confidence := 0;
  if own then
    NEW.validation_status := 'blocked_own_domain';
  elsif coalesce(NEW.validation_status, '') not in ('rejected_not_cookie_banner', 'not_dismissed', 'not_seen', 'needs_robot_check') then
    NEW.validation_status := 'needs_robot_check';
  end if;
  return NEW;
end $$;

drop trigger if exists cy_pattern_gate on public.cookie_patterns;
create trigger cy_pattern_gate before insert or update on public.cookie_patterns
  for each row execute function public.cy_pattern_gate();

-- Apply the rule to everything already live.
update public.cookie_patterns set updated_at = now()
where source is distinct from 'admin_guided'
  and (is_active or coalesce(confidence, 0) > 0)
  and (public.cy_is_own_domain(domain)
       or (not public.cy_selector_cookie_like(selector) and coalesce(validation_status, '') <> 'passed'));
