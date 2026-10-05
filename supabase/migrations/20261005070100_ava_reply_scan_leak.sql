-- Ava answers both lines, part 2a (Spark, 2026-10-04): the reply scan gains a "leak" check.
-- Agent lines are scanned for key-like strings (sk-, xi-, eyJ, 32+ hex characters), the words "api key", "password",
-- "vault" or "token", Jared's cell number and the home street. A hit is stored as kind 'code_leak' with leak = true
-- (the old check constraint only knows code_leak / no_hangup / repeat and cannot be changed in place).
create or replace function public.ava_reply_scan(p_transcript jsonb)
 returns table(kind text, excerpt text) language sql immutable set search_path to 'public'
as $function$
  with t as (
    select ord, e->>'role' role, coalesce(e->>'message', '') msg, coalesce((e->>'time_in_call_secs')::int, 0) secs
      from jsonb_array_elements(coalesce(p_transcript, '[]'::jsonb)) with ordinality x(e, ord)
  ), last_t as (select max(secs) m from t)
  select 'code_leak', left(msg, 240) from t
   where role = 'agent' and msg ~* '(tool_code|default_api|print\(|end_call\(|transfer_to_number\(|voicemail_detection\(|system__|\{\{|\}\}|```|function_call|<tool)'
  union all
  select 'no_hangup', left(msg, 240) from t, last_t
   where role = 'agent' and msg ~* '\m(goodbye|bye now|have a (good|great) (day|one|night)|thanks for your time)\M' and last_t.m - t.secs >= 10
  union all
  select 'repeat', left(msg, 240) from (
    select msg, count(*) n from t where role = 'agent' and length(msg) > 25 group by msg) r where n > 1
  union all
  select 'leak', left(msg, 240) from t
   where role = 'agent' and (
         msg ~* '(\msk-[a-z0-9_-]{8,}|\mxi-[a-z0-9_-]{8,}|eyJ[a-z0-9_-]{10,}|[0-9a-f]{32,}|api[ _-]?key|password|\mvault\M|\mtoken\M)'
      or msg ~* '(816[^0-9]{0,3}500[^0-9]{0,3}7236|five[ ,.-]+zero[ ,.-]+zero[ ,.-]+seven[ ,.-]+two[ ,.-]+three[ ,.-]+six)'
      or msg ~* '(\m733\M[^.]{0,30}kings|\mkings (road|rd)\M)')
$function$;
