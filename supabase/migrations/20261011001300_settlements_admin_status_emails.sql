-- Nickel: denial / deficiency / approval emails from the settlement administrator (2026-10-10). Part 4 of 4.
-- Same trigger (settlement_check_email on bestly_mail), all existing behavior kept (payment emails, filing receipts,
-- unmatched pile). New, for a claim that was already sent in (approved / filing / needs_you / filed):
--   "claim has been denied / rejected / not approved"  -> status denied + event 'denied_by_admin'
--   "deficient / additional information required / incomplete claim / cure"
--                                                      -> status needs_you, why "The administrator says the claim is
--                                                         missing something - open the email", url = the claim form
--   "claim approved / valid claim" (no payment wording) -> event 'approved_by_admin' only
-- A paid claim is never downgraded. Receipts that merely say "if your claim is deficient we will contact you" are ignored.

create or replace function public.settlement_check_email() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_text text := lower(coalesce(new.from_name, '') || ' ' || coalesce(new.from_addr, '') || ' ' || coalesce(new.subject, '') || ' '
                             || left(coalesce(new.body_text, ''), 4000));
  v_pay boolean; v_receipt boolean; v_hit uuid; v_amt int; v_conf text; v_admin boolean;
  v_denied boolean; v_defic boolean; v_appr boolean; v_st uuid; v_sid uuid; v_s settlements; v_ref text;
begin
  v_pay := v_text ~ '(you''ve got money|sent you \$|paid you|payment (has been )?(issued|sent|is on its way)|your settlement payment|digital payment|virtual (prepaid )?card|e-?check|claim payment|has been deposited)';
  v_receipt := v_text ~ '(claim (has been )?(received|submitted)|thank you for (submitting|filing) your claim|claim (id|number|confirmation))';
  v_denied := not v_pay and v_text ~ 'claim (has been |was |is )?(denied|rejected|not approved)';
  v_defic := not v_pay and not v_denied
             and v_text ~ '(deficien|additional information (is )?required|incomplete claim|\mcure\M)'
             and v_text !~ 'if (your|the|any) claim[^.]{0,80}(deficien|incomplete)';
  v_appr := not v_pay and not v_denied and not v_defic and v_text ~ '(claim (has been |was |is )?approved|valid claim)';
  if not (v_pay or v_receipt or v_denied or v_defic or v_appr) then return new; end if;
  v_ref := coalesce(new.message_id, new.id::text);

  -- 1) status emails about a claim that was already sent in
  if v_denied or v_defic or v_appr then
    select c.id, c.settlement_id into v_st, v_sid from settlement_claims c join settlements s on s.id = c.settlement_id
     where c.status in ('filed', 'approved', 'filing', 'needs_you')
       and ( (length(coalesce(s.defendant, '')) >= 4 and v_text like '%' || lower(s.defendant) || '%')
          or (length(s.name) >= 6 and v_text like '%' || lower(regexp_replace(s.name, '\s*(class action\s*)?settlement$', '', 'i')) || '%') )
     order by c.filed_at desc nulls last limit 1;
    if v_st is not null then
      select * into v_s from settlements where id = v_sid;
      if v_denied then
        update settlement_claims set status = 'denied', updated_at = now() where id = v_st and status <> 'paid';
        perform settlement_log(v_st, 'denied_by_admin', jsonb_build_object('ref', v_ref, 'subject', left(new.subject, 160)));
        perform settlement_notify('Claim denied: ' || v_s.name, 'The administrator says the claim was denied. Open the email if you want to dispute it.',
                                  'recap', 'https://bestly.tech/admin/settlements', 'denied.' || v_st::text);
      elsif v_defic then
        update settlement_claims set status = 'needs_you', needs_you_why = 'The administrator says the claim is missing something — open the email',
               needs_you_url = v_s.claim_url, updated_at = now()
         where id = v_st and status in ('filed', 'approved', 'filing', 'needs_you');
        perform settlement_log(v_st, 'deficiency_notice', jsonb_build_object('ref', v_ref, 'subject', left(new.subject, 160)));
        perform settlement_notify('Claim needs a fix: ' || v_s.name, 'The administrator says the claim is missing something. Open the email, then the claim form.',
                                  'recap', 'https://bestly.tech/admin/settlements', 'deficient.' || v_st::text);
      else
        -- log only; a receipt that says "valid claim" in its boilerplate still falls through to the receipt handling below
        perform settlement_log(v_st, 'approved_by_admin', jsonb_build_object('ref', v_ref, 'subject', left(new.subject, 160)));
      end if;
      if v_denied or v_defic then return new; end if;
    end if;
    if not (v_receipt) then return new; end if;
  end if;

  -- 2) payment emails and filing receipts (unchanged)
  select c.id into v_hit from settlement_claims c join settlements s on s.id = c.settlement_id
   where c.status not in ('paid', 'skipped', 'expired', 'denied')
     and ( (length(coalesce(s.defendant, '')) >= 4 and v_text like '%' || lower(s.defendant) || '%')
        or (length(s.name) >= 6 and v_text like '%' || lower(regexp_replace(s.name, '\s*(class action\s*)?settlement$', '', 'i')) || '%') )
   order by c.filed_at desc nulls last limit 1;
  v_amt := settlement_amount_cents(new.subject || ' ' || left(coalesce(new.body_text, ''), 4000));
  if v_hit is not null then
    if v_pay then
      perform settlement_paid_internal(v_hit, 'email', v_ref, v_amt);
    elsif v_receipt then
      v_conf := (regexp_match(v_text, 'claim (?:id|number|confirmation)(?: number)?[:#\s]*([a-z0-9-]{5,})'))[1];
      update settlement_claims set status = case when status in ('found', 'ready', 'approved', 'filing', 'needs_you') then 'filed' else status end,
             filed_at = coalesce(filed_at, new.sent_at, now()), confirmation = coalesce(confirmation, upper(v_conf)), updated_at = now()
       where id = v_hit;
      perform settlement_log(v_hit, 'receipt_email', jsonb_build_object('ref', v_ref, 'confirmation', v_conf));
    end if;
  elsif v_pay then
    select exists (select 1 from settlement_admins a where v_text ilike a.pattern) into v_admin;
    if v_admin then
      insert into settlement_unmatched (via, ref, summary, amount_cents)
      values ('email', v_ref, left(coalesce(new.from_name, new.from_addr) || ' — ' || coalesce(new.subject, ''), 200), v_amt)
      on conflict (ref) do nothing;
    end if;
  end if;
  return new;
exception when others then
  return new;  -- never break mail sync
end $$;
