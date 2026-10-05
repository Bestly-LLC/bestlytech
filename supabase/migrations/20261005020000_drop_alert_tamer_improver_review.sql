-- Alert Tamer was a duplicate: bestly_raise already groups repeat alerts and throttles pushes.
-- The Improver scored it 5 from a miscount (4,292 log rows for one incident = 16 pushes). Remove the hire, put the Improver on review.
update team_hires set status='passed', cancelled_at=now(), decided_at=coalesce(decided_at,now())
 where id='ae21a6d8-beaa-46f7-901c-43a09a116a0f';
delete from bestly_agents where slug='alert-tamer' and kind='open_role' and status='planned';
update bestly_agents set profile = coalesce(profile,'{}'::jsonb) || jsonb_build_object(
  'on_review', true,
  'review_note', 'Oct 4: Improver scored Alert Tamer a 5 ("must-have") from a miscount: 4,292 log rows for one incident (16 pushes) read as 4,292 alerts. bestly_raise already groups and throttles repeats, so the hire was a duplicate. Count pushes, not event rows, and check what already exists before scoring a hire.',
  'review_at', now())
 where slug='improver';
