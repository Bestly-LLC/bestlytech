-- Money interrupts are real money, not usage meters (found 2026-10-06: a failed LTX video sat in Needs you as "money"
-- because its body carries "Charged $0.02 for 1 min of GPU · Today $1.12 · Credit $113.72 left").
-- Usage-report phrases are dropped before matching, and a bare amount must be $1 or more.
create or replace function public.interrupt_class(p_title text, p_body text, p_source text, p_level text)
returns text language plpgsql immutable set search_path to 'public' as $function$
declare t text := lower(coalesce(p_title, '') || ' ' || coalesce(p_body, '')); s text := lower(coalesce(p_source, ''));
        ti text := lower(coalesce(p_title, ''));
begin
  if p_level = 'critical' then return 'critical'; end if;
  -- Good news never interrupts; it goes to the recap.
  if ti ~ '^\s*(fixed|resolved)\y' or ti ~ '(is working again|back to normal|is back\y|is steady|recovered|caught up|reachable again|all clear)' then
    return null;
  end if;
  if ti ~ '^(your day|today''s recap|bestly today)' then return 'recap'; end if;
  -- The Fix Ladder's "Scout found the fix and needs your yes" is a paid-AI ask, not a person waiting: drop that line first.
  t := regexp_replace(t, '(next: )?scout (found the fix and )?needs your yes[^.]*\.?', '', 'g');
  -- Usage meters (GPU minutes, today's spend, credit left) are not money moving: drop them first.
  t := regexp_replace(t, '(charged \$\s?[0-9.,]+ for [^·\n]*|today \$\s?[0-9.,]+[^·\n]*|credit \$\s?[0-9.,]+ left[^·\n]*)', '', 'g');
  if s in ('blue steel', 'claims closer') or s like 'turo%' and t ~ '(pick-?up|drop-?off|return|check-?in)'
     or t ~ '(\$\s?[1-9]|refund|chargeback|charged (you|your)|card was charged|charge failed|not billed|payment|payout|invoice|deposit|parking ticket|citation|\ytowed?\y|move blue steel|street sweeping)' then
    return 'money';
  end if;
  if t ~ '(ready for your ok|is waiting (on|for) you|wrote back|replied to you|for your reply|message from (?!jared)|left (you )?a (message|voicemail)|new lead|booking request|wants to (talk|book|meet)|asked for you)' then
    return 'person';
  end if;
  if t ~ '(sign-?in request|login request|approve (this|the|a) (sign|login|device)|suspicious|breach|intrud|unauthori[sz]ed|break-?in|moved with no trip|is unlocked|smoke|water leak|weather alert|earthquake|tsunami|flood warning|couldn.t fix (a|this|the) security|security risk)' then
    return 'security';
  end if;
  if t ~ '(still down|down for (an hour|over an hour|[0-9]+ h)|nobody could fix)' then return 'down'; end if;
  return null;
end $function$;
