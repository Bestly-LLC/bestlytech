-- Ava's line (816) 429-9495 receives texts so the Claims Closer can read what insurers text (Jared 2026-10-29: "Option 1").
-- Insurer forms now carry Ava's number instead of Jared's cell. Inbound only: Ava never texts out from here.
-- Login / verification codes are never kept: their digits are blanked before anything is stored, and nothing ever types them.

create table if not exists public.ava_texts (
  id uuid primary key default gen_random_uuid(),
  telnyx_id text unique,
  from_number text not null,
  to_number text not null,
  body text not null,                 -- codes already blanked
  kind text not null default 'other' check (kind in ('insurer', 'code', 'other')),
  oc_id uuid references public.outside_claims(id) on delete set null,
  claim_no text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.ava_texts enable row level security;
revoke all on public.ava_texts from public, anon, authenticated;
create index if not exists ava_texts_received_idx on public.ava_texts (received_at desc);

create table if not exists public.ava_texts_health (
  id boolean primary key default true check (id),
  ok boolean, detail jsonb, checked_at timestamptz, last_text_at timestamptz
);
insert into public.ava_texts_health (id) values (true) on conflict do nothing;
alter table public.ava_texts_health enable row level security;
revoke all on public.ava_texts_health from public, anon, authenticated;

-- the webhook URL token (Vault only)
create or replace function public.ava_texts_token() returns text
language plpgsql security definer set search_path = public, vault as $$
declare t text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  select decrypted_secret into t from vault.decrypted_secrets where name = 'ava_texts_in_token' limit 1;
  if t is null then
    t := encode(extensions.gen_random_bytes(24), 'hex');
    perform vault.create_secret(t, 'ava_texts_in_token', 'URL token for the Telnyx inbound-text webhook on Ava''s line (ava-texts edge function)');
  end if;
  return t;
end $$;
revoke all on function public.ava_texts_token() from public, anon, authenticated;
grant execute on function public.ava_texts_token() to service_role;

-- one inbound text, already confirmed with Telnyx's own API by the edge function
create or replace function public.ava_text_in(p_telnyx_id text, p_from text, p_to text, p_text text, p_at timestamptz default now(), p_verified boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_kind text := 'other'; v_body text := coalesce(p_text, ''); v_oc outside_claims; v_ins ins_insurers; v_no text; v_id uuid; v_low text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  if exists (select 1 from ava_texts where telnyx_id = p_telnyx_id) then return jsonb_build_object('ok', true, 'dup', true); end if;
  v_low := lower(v_body);
  -- a login / verification code: blank every 4-8 digit run, keep only that it happened
  if v_low ~ '(verif|security code|one.?time|passcode|login code|sign.?in code|\mcode\M|\motp\M)' and v_body ~ '\d{4,8}' then
    v_kind := 'code';
    v_body := regexp_replace(v_body, '\d{4,8}', '[code hidden]', 'g');
  end if;
  -- which insurer? by name in the text (insurers text from short codes, so the sender number says little)
  select * into v_ins from ins_insurers i where i.enabled and strpos(v_low, lower(i.name)) > 0 order by length(i.name) desc limit 1;
  if v_ins.slug is not null then
    if v_kind <> 'code' then v_kind := 'insurer'; end if;
    select * into v_oc from outside_claims o
     where o.kind = 'guest_insurer' and o.status <> 'closed' and lower(coalesce(o.insurer, '')) = lower(v_ins.name)
     order by o.updated_at desc limit 1;
  end if;
  if v_kind = 'insurer' then
    v_no := substring(v_body from '(?i)claim\s*(?:number|no\.?|#|id)?\s*(?:is|:)?\s*#?\s*((?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{5,16})');
    if p_verified and v_no is not null and v_oc.id is not null and coalesce(v_oc.claim_no, '') = '' and v_no <> coalesce((select turo_claim_no::text from claim_cases where id = v_oc.case_id), '') then
      perform ins_set_claim_no(v_oc.id, v_no, 'from a ' || v_ins.name || ' text to Ava''s line');
    else
      v_no := null;
    end if;
  end if;
  insert into ava_texts (telnyx_id, from_number, to_number, body, kind, oc_id, claim_no, received_at)
  values (p_telnyx_id, coalesce(p_from, ''), coalesce(p_to, ''), left(v_body, 2000), v_kind, v_oc.id, v_no, coalesce(p_at, now()))
  returning id into v_id;
  update ava_texts_health set last_text_at = now() where id;

  if v_oc.id is not null then
    perform ins_event(v_oc.id, case when v_kind = 'code' then 'insurer_code_text' else 'insurer_text' end,
      case when v_kind = 'code' then v_ins.name || ' texted Ava''s line a login code. Not used: I start over instead of typing codes.'
           else v_ins.name || ' texted Ava''s line: "' || left(regexp_replace(v_body, '\s+', ' ', 'g'), 300) || '"' end,
      jsonb_build_object('text_id', v_id, 'from', p_from, 'claim_no', v_no));
    if v_kind = 'insurer' then
      perform bestly_raise('claims.ava_text.' || left(v_id::text, 8), 'problem', 'info',
        case when v_no is not null then v_ins.name || ' sent the claim number' else v_ins.name || ' texted about the claim' end,
        'Claims Closer here. ' || v_ins.name || ' texted Ava''s line about ' || coalesce(v_oc.title, 'a claim') || ': "' || left(regexp_replace(v_body, '\s+', ' ', 'g'), 240) || '"'
          || case when v_no is not null then ' I saved claim number ' || v_no || '.' else '' end
          || case when not p_verified then ' (Texts on my line are not signature-checked yet, so I do not change the claim from a text.)' else '' end,
        'turo', null, true);
    end if;
  elsif v_kind = 'other' and v_body !~ '^Bestly self-check' then
    perform bestly_raise('ava.text_in.' || left(v_id::text, 8), 'problem', 'info', 'New text on my line',
      'Ava here. ' || coalesce(p_from, 'Someone') || ' texted my line: "' || left(regexp_replace(v_body, '\s+', ' ', 'g'), 240) || '"', 'ava', null, true);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'kind', v_kind, 'oc_id', v_oc.id, 'claim_no', v_no);
end $$;
revoke all on function public.ava_text_in(text, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.ava_text_in(text, text, text, text, timestamptz, boolean) to service_role;

-- the edge function reports how the line looks after each self-check / heal
create or replace function public.ava_texts_health_put(p_ok boolean, p_detail jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then raise exception 'Service role only'; end if;
  update ava_texts_health set ok = p_ok, detail = p_detail, checked_at = now() where id;
  if p_ok then
    perform bestly_raise('ava.texts_line', 'resolved', 'info', 'Texts reach my line again', null, 'ava', null, true);
  else
    perform bestly_raise('ava.texts_line', 'problem', 'warning', 'Texts are not reaching my line',
      'Ava here. Insurer texts to (816) 429-9495 are not reaching me (' || left(coalesce(p_detail->>'why', 'unknown'), 160) || '). I keep retrying the fix every hour.', 'ava', null, false);
  end if;
end $$;
revoke all on function public.ava_texts_health_put(boolean, jsonb) from public, anon, authenticated;
grant execute on function public.ava_texts_health_put(boolean, jsonb) to service_role;

-- watchdog: hourly self-check + heal (re-attaches the number / re-points the webhook), and flags a check that stopped running
create or replace function public.ava_texts_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare h ava_texts_health;
begin
  select * into h from ava_texts_health where id;
  if h.checked_at is not null and h.checked_at < now() - interval '3 hours' then
    perform bestly_raise('ava.texts_line_check', 'problem', 'warning', 'My text-line check stopped',
      'Ava here. I have not checked that texts reach my line since ' || to_char(h.checked_at at time zone 'America/Los_Angeles', 'Mon FMDD FMHH12:MI AM') || '. Scout, please look at the ava-texts function.', 'ava', null, false);
  else
    perform bestly_raise('ava.texts_line_check', 'resolved', 'info', 'My text-line check runs again', null, 'ava', null, true);
  end if;
  perform invoke_edge_function('ava-texts', jsonb_build_object('op', 'heal'), 30000);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.ava_texts_watch() from public, anon, authenticated;

-- insurer forms carry Ava's line from now on (packet "Your phone")
update public.ins_settings set owner_phone = '(816) 429-9495', updated_at = now() where id;

select cron.schedule('ava-texts-watch', '17 * * * *', 'select public.ava_texts_watch();');

-- UNDO
-- select cron.unschedule('ava-texts-watch');
-- update public.ins_settings set owner_phone = '(816) 500-7236', updated_at = now() where id;
-- drop function if exists public.ava_texts_watch(), public.ava_texts_health_put(boolean, jsonb), public.ava_text_in(text, text, text, text, timestamptz, boolean), public.ava_texts_token();
-- drop table if exists public.ava_texts_health, public.ava_texts;
-- (Telnyx: detach (816) 429-9495 from the "Ava texts (inbound)" messaging profile in the portal, or PATCH messaging_profile_id null.)
