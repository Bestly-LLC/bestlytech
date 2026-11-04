-- 2026-11-03 (Jared: "fix hint"). claim_check and the approval_items claim gate returned client_brand.resource_hint as the
-- fix hint. For centering-you that is her whole safety doc, which opens "Nothing must be included on every Centering YOU
-- post", so AI writers fed the hint were told to add nothing and looped (cy_maker failed 4/4 for 36 hrs).
-- New: resource_fix = a short, actionable note; returned as the hint when set. Her doc (resource_hint) is unchanged and is
-- still returned as 'standard'.
alter table public.client_brand add column if not exists resource_fix text;
comment on column public.client_brand.resource_fix is
  'Short, actionable fix note returned as the hint when copy trips the help-line rule (resource_when without resource_has). resource_hint keeps the client''s full standard.';

update public.client_brand b set resource_fix =
  'This names a postpartum mental health condition (for example postpartum depression, anxiety or rage, intrusive thoughts, '
  || 'or postpartum or perinatal mental health), so her rule needs a way to get help. In a caption, add this sentence before '
  || 'the last line: "If you are struggling, call or text the National Maternal Mental Health Hotline at 1-833-852-6262, '
  || 'free, day or night, or 988 in a crisis." On a slide, cover or other on-screen text, reword without naming the condition.'
from public.approval_clients c
where c.id = b.client_id and c.slug = 'centering-you' and b.resource_fix is null;

CREATE OR REPLACE FUNCTION public.claim_check(_client_slug text, _text text, _context text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v record; v_hint text; v_std text;
begin
  if not public.claim_gate_ready(_client_slug) then
    insert into public.claim_block_log (client_slug, reason, context)
    values (_client_slug, 'claim gate not set up', left(coalesce(_context, _text), 500));
    return jsonb_build_object('ok', false, 'severity', 'setup',
      'reason', 'claim gate not set up for this client',
      'hint', 'Approve at least one claim rule for this client in Settings › Claim rules, or confirm there that house rules are enough.');
  end if;

  select * into v from public.claim_violation(_client_slug, _text);

  if found and v.severity = 'hard' then
    insert into public.claim_block_log (client_slug, rule_id, reason, blocked_text, context)
    values (_client_slug, v.rule_id, v.label, v.pattern, left(coalesce(_context, _text), 500));
    return jsonb_build_object('ok', false, 'severity', 'hard', 'reason', v.label, 'pattern', v.pattern);
  end if;

  if public.claim_needs_resource(_client_slug, _text)
     and not public.claim_has_resource(_client_slug, _text) then
    select coalesce(b.resource_fix, b.resource_hint), b.resource_hint into v_hint, v_std from public.client_brand b
      join public.approval_clients c on c.id = b.client_id where c.slug = _client_slug;
    insert into public.claim_block_log (client_slug, reason, context)
    values (_client_slug, 'missing crisis resource', left(coalesce(_context, _text), 500));
    return jsonb_strip_nulls(jsonb_build_object('ok', false, 'severity', 'hard', 'reason', 'missing crisis resource',
                                                'hint', v_hint, 'standard', v_std));
  end if;

  if found and v.severity = 'soft' then
    return jsonb_build_object('ok', true, 'severity', 'soft', 'reason', v.label, 'pattern', v.pattern);
  end if;
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.approval_items_claim_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_slug text; v_text text; v record; v_hint text;
begin
  select c.slug into v_slug from public.approval_clients c where c.id = new.client_id;
  -- new work only: editing an existing post never trips the setup check
  if tg_op = 'INSERT' and not public.claim_gate_ready(v_slug) then
    raise exception 'claim gate: not set up for client %', v_slug
      using errcode = 'check_violation',
            hint = 'Approve a claim rule for this client, or confirm house rules are enough (studio_claim_gate_ack).';
  end if;
  v_text := coalesce(new.title, '') || E'\n' || coalesce(new.caption, '');
  select * into v from public.claim_violation(v_slug, v_text);
  if found and v.severity = 'hard' then
    raise exception 'claim gate: % (matched "%")', v.label, v.pattern
      using errcode = 'check_violation',
            hint = 'Call claim_check() before inserting to get this as a verdict instead of an error.';
  end if;
  if public.claim_needs_resource(v_slug, v_text) and not public.claim_has_resource(v_slug, v_text) then
    select coalesce(b.resource_fix, b.resource_hint) into v_hint from public.client_brand b
      join public.approval_clients c on c.id = b.client_id where c.slug = v_slug;
    raise exception 'claim gate: copy needs a way to get help and carries none'
      using errcode = 'check_violation', hint = coalesce(v_hint, 'Add a way to get help.');
  end if;
  return new;
end;
$function$;
