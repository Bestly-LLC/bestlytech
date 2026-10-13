-- Bestly Agent ad (Jared 2026-10-12, 9:38 PM: "Make an ad for our new product Bestly Agents."). Record of what was applied with execute_sql
-- (apply_migration gets cancelled). Plan: docs/bestly-agent-ad-opusplan.md.
--   1. House client `bestly-agent` (copy of bestly-cloud's row shape; code prefix BA). social_brand 'bestlyagent' has no social account, so nothing posts:
--      everything lands in Studio > Drafts > To review. (There is no house-brand -> account mapping table yet; when it exists, map bestlyagent -> @bestly_llc.)
--   2. montage_brand_policy row (Montage, AI footage and AI voice allowed). There is no studio_audio_features table in the live project, so there is no voiceover switch to turn on.
--   3. A real claim rule pack from the facts (prices, minutes and terms exactly as stated; no compliance, no invented proof). Active but unapproved
--      (approved_by null), like bestly-cloud and bestly-studio: Jared reviews them in Studio > Settings > Claim rules.
--   4. Music picker: a brand with no track of its own and no shared track may borrow a track from the other Bestly-branded house clients (bestly-cloud, bestly-studio)
--      (Bestly Agent has none yet and nothing new is generated). montage_music_ready counts the same pool.

insert into public.approval_clients (slug, name, brand_note, active, kind, social_brand, publish_mode, notify_email, code_prefix)
select 'bestly-agent', 'Bestly Agent',
       'Bestly Agent: an AI receptionist (her name is Maya) that answers a business''s phone and does the work: books appointments, answers questions, and connects to the apps the business already uses (calendar, customer list, help desk, payments, crew schedule; 120+ apps, new connections usually the same day). Calls, texts and website chat in 90+ languages, and the owner sees every call. Plans: Lite $49 a month (30 minutes), Starter $199 a month (150 minutes), Growth $499 a month (500 minutes). No setup fee, 30-day money back, cancel anytime. Demo page: bestly.tech/agent. Plain words for the least-informed viewer. Never invent customers, stats or certifications; no compliance claims (HIPAA etc.); no absolutes (never / always / guaranteed).',
       true, 'house', 'bestlyagent', 'push', false, 'BA'
where not exists (select 1 from public.approval_clients where slug = 'bestly-agent');

insert into public.montage_brand_policy (client_slug, montage_ok, ai_footage_ok, ai_voice_ok, note)
values ('bestly-agent', true, true, true,
        'Jared 2026-10-12: ads for Bestly Agent. Montage and the AI voice (Maya''s own ElevenLabs voice) allowed. No b-roll orders without a yes. Fictional callers and made-up businesses from public/agent-demo only, never real customers.')
on conflict (client_slug) do nothing;

insert into public.claim_rules (client_slug, severity, pattern, label, notes)
select 'bestly-agent', v.sev, v.pat, v.lbl, v.note
from (values
 ('hard', $p$\$ ?(?!(49|199|499)([^0-9]|$))[0-9][0-9,.]*$p$,
  'price not on the plan list', 'Only the three plan prices exist: $49, $199 and $499 a month. Any other dollar amount is wrong.'),
 ('hard', $p$(?<![0-9])(?!(30|150|500)[ -]?min)[0-9]+[ -]?min(ute)?s?$p$,
  'minutes not on the plan list', 'Plans include 30 (Lite), 150 (Starter) or 500 (Growth) minutes. Any other minute count is wrong.'),
 ('hard', $p$(?<![0-9])(?!30[ -]day)[0-9]+[ -]days?( money[- ]back| refund| to get your money back)$p$,
  'money-back window', 'The money-back window is 30 days.'),
 ('hard', $p$(free (trial|plan|month|week|setup|set[- ]up|forever)|try it free|no cost|setup fee of|set[- ]up fee of|contract|lock[- ]in)$p$,
  'terms not offered', 'There is no free plan or trial. The terms are: no setup fee, 30-day money back, cancel anytime. Say no more than that.'),
 ('hard', $p$(hipaa|soc ?2|gdpr|pci|iso ?27001|compliant|compliance|certified|fair housing|legally)$p$,
  'compliance claim', 'Never claim compliance or certification (no HIPAA, no medical-grade).'),
 ('hard', $p$(trusted by|loved by|used by|chosen by|testimonials?|(our )?(clients?|customers?) (say|said|love|loves|tell|told)|five[- ]stars?|5[- ]stars?|rated|award[- ]winning|thousands of|hundreds of|millions of|[0-9][0-9,.]* ?(%|percent)|[0-9][0-9,.]*x)$p$,
  'invented proof', 'No customers, stats, ratings, awards or testimonials: we have none to show.'),
 ('hard', $p$(never|always|guarantee[sd]?|guaranteed|nobody|no one|completely|fully|totally|entirely|every time|perfect(ly)?|flawless(ly)?|100 ?%|zero (missed|errors?|mistakes?)|no mistakes|24/7|24 hours|around the clock|day and night|unlimited)$p$,
  'absolute or availability promise', 'No absolutes (never, always, guaranteed, 24/7, perfect). Say the plain, smaller, true thing.'),
 ('hard', $p$(more (customers|clients|leads|sales|revenue|bookings|jobs|business)|(increase|boost|grow)s? (your )?(sales|revenue|bookings|leads|business)|save(s)? (you )?(hours|time|money|thousands)|pays? for itself|replace(s)? (your )?(staff|team|receptionist|employees|people)|fire your|cheaper than (a|an|hiring))$p$,
  'results or replacement claim', 'No promised results, savings or replacing people. Say what she does, not what you will earn.'),
 ('hard', $p$(sounds? (just )?(like )?(a )?(real )?(human|person)|human[- ]like|indistinguishable|can'?t tell|cannot tell|won'?t know|callers? (will )?not know|pass(es)? as (a )?(human|person))$p$,
  'passes as human', 'She is an AI receptionist and the ad says so. Never imply callers cannot tell.'),
 ('hard', $p$(google (calendar|workspace)|outlook|calendly|hubspot|salesforce|zendesk|intercom|freshdesk|stripe|square|jobber|housecall ?pro|quickbooks|shopify|slack|zapier|servicetitan|twilio|telnyx|openai|chatgpt|gpt|claude|elevenlabs)$p$,
  'named app or vendor', 'Do not name apps or AI vendors: Bestly connects each customer''s own apps, they are not prebuilt logos. Say "your calendar", "your customer list".'),
 ('soft', $p$(omnichannel|llm|large language model|agentic|chatbot|bot|automation platform|workflows?|api|apis|integrations?|sdk|neural|machine learning|artificial intelligence)$p$,
  'jargon', 'Plain words only. Say "an AI receptionist", "the apps you use", never tech terms.'),
 ('soft', $p$(whatsapp|e-?mail|emails)$p$,
  'channel not wired yet', 'Texts and website chat are the safe channels in an ad. Email and WhatsApp are listed on the page but not wired for customers yet: leave them out of video copy.'),
 ('soft', $p$(hackers?|they are watching|spying|you are losing|you(?:'|’)?re losing|falling behind|your competitors)$p$,
  'fear bait', 'Plain and calm. Name the pain (a missed call) without scaring anyone.')
) as v(sev, pat, lbl, note)
where not exists (select 1 from public.claim_rules r where r.client_slug = 'bestly-agent' and r.label = v.lbl);

-- Music: a brand with no own/shared track borrows from the other active Bestly house brands (nothing new is generated).
create or replace function public.montage_music_pick(p_brand text, p_mood text, p_job uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_last uuid; v_n int; v_borrow boolean := false; r studio_music_tracks;
begin
  select count(*) into v_n from studio_music_tracks where active and (brand_slug = p_brand or brand_slug is null);
  if v_n = 0 then
    v_borrow := true;
    select count(*) into v_n from studio_music_tracks t
     where t.active and t.brand_slug in (select c.slug from approval_clients c where c.kind = 'house' and c.active and c.slug like 'bestly-%' and c.slug <> p_brand);
  end if;
  if v_n = 0 then return null; end if;
  select track_id into v_last from studio_music_uses where brand_slug = p_brand order by used_at desc limit 1;
  select t.* into r from studio_music_tracks t
   where t.active
     and (case when v_borrow then t.brand_slug in (select c.slug from approval_clients c where c.kind = 'house' and c.active and c.slug like 'bestly-%' and c.slug <> p_brand)
               else (t.brand_slug = p_brand or t.brand_slug is null) end)
     and (v_n = 1 or t.id is distinct from v_last)
   order by (t.mood = p_mood) desc, (t.brand_slug = p_brand) desc,
            coalesce((select max(u.used_at) from studio_music_uses u where u.track_id = t.id and u.brand_slug = p_brand), 'epoch'::timestamptz) asc,
            random()
   limit 1;
  insert into studio_music_uses (track_id, brand_slug, job_id, mood) values (r.id, p_brand, p_job, p_mood);
  return to_jsonb(r);
end $$;

create or replace function public.montage_music_ready(p_brand text) returns integer
language sql security definer set search_path to 'public' as $$
  select case
    when (select count(*) from studio_music_tracks where active and (brand_slug = p_brand or brand_slug is null)) > 0
      then (select count(*) from studio_music_tracks where active and (brand_slug = p_brand or brand_slug is null))::int
    else (select count(*) from studio_music_tracks t
           where t.active and t.brand_slug in (select c.slug from approval_clients c where c.kind = 'house' and c.active and c.slug like 'bestly-%' and c.slug <> p_brand))::int
  end;
$$;

revoke all on function public.montage_music_pick(text, text, uuid), public.montage_music_ready(text) from public, anon, authenticated;
grant execute on function public.montage_music_pick(text, text, uuid), public.montage_music_ready(text) to service_role;
