-- Track S (studio-promo), 2026-10-06. Record of a live change. The employee that owns the bestly_social job (daily-post, Social Poster)
-- now also owns the Bestly Studio promo rotation (cron `bestly_social studio`, Mon/Wed/Fri 11:25, reports under the same job key).
select public.team_onboard('[{"slug":"daily-post","name":"Social Poster","role":"Social Media Manager","reports_to":"spark","dept":"studio","runs_on":"pi","icon":"image","welcome":false,
"schedule":"daily, carousels on Tuesdays; Bestly Studio promo pieces to review Mon/Wed/Fri",
"what_it_does":"Makes the daily Instagram and Facebook post and the Tuesday carousel for Bestly Cloud. Also makes the Bestly Studio promo pieces (a card on Monday, a carousel on Wednesday, a short video on Friday) and files them into Studio > Drafts > To review for Jared. Those never post on their own. It stops at four waiting pieces.",
"pulse":{"gap":1560,"key":"bestly_social","src":"pi_job","also":["social-autoconnect","social-bank-tick","social-engine-watch"]}}]'::jsonb);
