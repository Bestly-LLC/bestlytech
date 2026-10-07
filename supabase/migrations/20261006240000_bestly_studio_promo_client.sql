-- Track S (Studio promo), 2026-10-06. Record of what was applied with execute_sql (apply_migration gets cancelled).
-- House client `bestly-studio`: Bestly's own promotion of Bestly Studio. Copy of bestly-cloud's row shape. Items made for it land in
-- Studio > Drafts > To review (internal); nothing posts until Jared says go (no social account is connected to social_brand
-- 'bestlystudio'). Claim rules start unapproved (approved_by null): Jared reviews them in Studio > Settings > Claim rules.
-- Human copy of the rules: docs/studio-promo/claims.md.

insert into public.approval_clients (slug, name, brand_note, active, kind, social_brand, publish_mode, notify_email, code_prefix)
select 'bestly-studio', 'Bestly Studio',
       'Bestly Studio: Bestly''s done-for-you social content service. We make a business''s posts and short videos, a person at Bestly checks every one, the client approves from their phone (or asks for changes with a note), and we post for them. Privacy-first, plain-spoken, anti-big-tech. No prices, no results or follower promises, no client names or quotes, never "AI does it all", only real screenshots of the real Studio on the demo client. Never invent customers, numbers or certifications. See docs/studio-promo/claims.md.',
       true, 'house', 'bestlystudio', 'push', false, 'BS'
where not exists (select 1 from public.approval_clients where slug = 'bestly-studio');

insert into public.montage_brand_policy (client_slug, montage_ok, ai_footage_ok, ai_voice_ok, note)
values ('bestly-studio', true, true, true,
        'Jared 2026-10-06: promote Bestly Studio on Bestly''s own accounts. Montage, AI footage and AI voice allowed. Text-only or abstract footage only: never a mocked app screen, never property footage, no client names.')
on conflict (client_slug) do nothing;

insert into public.claim_rules (client_slug, severity, pattern, label, notes)
select 'bestly-studio', v.sev, v.pat, v.lbl, v.note
from (values
 ('hard', $p$(\$ ?[0-9]|[0-9]+ ?(dollars|bucks)|per month|a month|monthly (fee|price|plan|rate)|per post|cheap(er|est)?|affordable|low[- ]cost|budget[- ]friendly|free (trial|month|week|audit|sample|posts?)|starting at|pricing|prices?)$p$,
  'price claim', 'No prices: Jared has not set public pricing. "Book a free call" is the only free thing we may say.'),
 ('hard', $p$(more (followers|likes|leads|clients|customers|sales|engagement|reach|views|business)|grow(s|ing)? your (following|audience|followers|business|brand)|go(es)? viral|viral|[0-9][0-9,.]* ?(%|percent|x)|double your|triple your|guarantee[sd]?|boost(s|ed)? your|increase(s|d)? (your )?(sales|leads|engagement|followers|reach|revenue)|bring(s)? (you )?(in )?(new )?(clients|customers|leads)|results)$p$,
  'results promise', 'No results, stats or follower/lead/sales promises.'),
 ('hard', $p$(fully automated|100% automated|automated for you|runs itself|autopilot|hands[- ](free|off)|set (it )?and (forget|forget it)|zero effort|no effort|ai[- ](powered|generated|driven)|powered by ai|written by ai|made by ai|ai does|ai writes|ai makes|robots?|no (human|person|people) (involved|needed|touch|review)|without (a |any )?(human|person|people))$p$,
  'AI does it all', 'A person at Bestly checks every post. Never imply it is automatic or AI-only.'),
 ('hard', $p$(centering ?you|elizabeth|o'?brien|trusted by|loved by|chosen by|used by|testimonials?|(our )?(clients?|customers?) (say|said|love|loves|tell|told)|what (our )?(clients?|customers?)|five[- ]stars?|5[- ]stars?|rated|(client|customer|google|star) reviews?)$p$,
  'client name or testimonial', 'No client names, quotes, logos, ratings or testimonials (no testimonial without written consent).'),
 ('hard', $p$((listing|property|home|house)s? (videos?|reels?|tours?|walk[- ]?throughs?)|virtual (tours?|staging)|virtually staged|drone|ai[- ](video|footage|tour)s?|turn(s|ing)? (your )?listings)$p$,
  'real estate footage', 'Real estate is an audience, not a promise: no listing videos, tours or AI property footage. The photo-based real-estate offer is not built yet.'),
 ('hard', $p$(instant(ly)?|in (minutes|seconds|an hour|[0-9]+ hours|24 hours|a day)|same[- ]day|overnight|24/7|around the clock|unlimited|infinite|limitless|as many (posts|videos) as|daily|every day|[0-9]+ (posts?|videos?|reels?) (a|per|each) (day|week|month))$p$,
  'speed or volume promise', 'No turnaround, availability, unlimited or posts-per-week promises. Terms are not set.'),
 ('hard', $p$(every platform|all (your )?(social )?(platforms|accounts|channels|networks)|everywhere you post)$p$,
  'platform over-claim', 'Instagram posting works today. Do not claim all platforms. (Facebook, LinkedIn and others are soft-flagged.)'),
 ('hard', $p$(never (shared|sold|stored|trained|leaves?)|encrypted|end[- ]to[- ]end|on[- ]device|(we )?(do not|don'?t|never) (store|share|sell|train|see|keep)|your (photos|data|content|files) (stay|stays|never|are safe)|no (ai )?training|data (stays|never))$p$,
  'privacy claim about Studio', 'Photos and notes pass through the tools that draft and edit posts. Make no privacy or security promises about Studio.'),
 ('hard', $p$(team of (experts|pros|professionals|designers|writers|editors|specialists)|award[- ]winning|experts?|years of experience|since [0-9]{4}|(dedicated|personal|your own) (team|manager|strategist|editor|designer)|social media (manager|expert|guru))$p$,
  'invented credentials', 'Bestly is a small studio. No team size, awards, experience or dedicated-person claims.'),
 ('hard', $p$(hipaa|soc ?2|gdpr|iso ?27001|compliant|compliance|certified|fair housing)$p$,
  'compliance claim', 'Never claim compliance or certification.'),
 ('hard', $p$(without (asking|your (approval|ok|okay)|you (seeing|approving|knowing))|posts? (everything|anything) (for you )?automatically|auto[- ]?posts? (everything|without))$p$,
  'posts without approval', 'Nothing is posted before the client approves it. Never imply otherwise.'),
 ('hard', $p$(no (contracts?|commitments?|obligations?|lock[- ]in|strings)|cancel anytime|month[- ]to[- ]month|money[- ]back)$p$,
  'terms promise', 'Terms are not set: no no-contract, cancel-anytime or refund promises.'),
 ('hard', $p$(your competitors|you(?:'|’)?re losing (clients|customers|business)|falling behind|beat the algorithm|hack the algorithm|crack the algorithm)$p$,
  'fear or hype bait', 'Plain and calm. No fear, no algorithm hacks.'),
 ('soft', $p$(ai|artificial intelligence|machine learning)$p$,
  'mentions AI', 'Allowed in an honest explanation (we use AI tools, a person checks every post). Not as the headline. Jared decides.'),
 ('soft', $p$(facebook|linkedin|youtube|pinterest|threads|twitter|tiktok)$p$,
  'platform named', 'Only Instagram posting works today. Naming other platforms is fine for the format a video is made for, not for where we post.'),
 ('soft', $p$(private|privacy|secure|security|safe)$p$,
  'privacy word', 'Keep privacy words to the board link ("a private link to your board"). No promises about data.'),
 ('soft', $p$(just listed|just sold|open house|new listing|real estate)$p$,
  'real estate mention', 'Real estate agents are an audience. Keep it to "for real estate agents", no listing copy.'),
 ('soft', $p$(algorithm|engagement|reach|followers|growth|grow)$p$,
  'growth language', 'Easy to turn into a results promise. Check the sentence.')
) as v(sev, pat, lbl, note)
where not exists (select 1 from public.claim_rules r where r.client_slug = 'bestly-studio' and r.label = v.lbl);
