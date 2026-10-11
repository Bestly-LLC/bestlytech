-- Retire three duplicate Team cards (status only; rows are never deleted). The chat session that did the rest of the roster cleanup was
-- not allowed to run a plain UPDATE (the approval prompt was cancelled), so this one is applied separately. Idempotent.
--   the-improver     planned duplicate of the active "improver" card (The Improver, Head of Operations, Mondays 8:45 AM)
--   pi-model-prober  duplicate of "model-prober" (pi_jobs model_prober, daily 4:17 AM); model-prober's pulse already names the job
--   pi-charge-stop   duplicate of "plug-puller" (pi_jobs charge_stop is the Plug Puller job)
-- UNDO: update bestly_agents set status = profile->'retired'->>'before_status' where slug in (...);

update public.bestly_agents set status = 'retired', updated_at = now(),
 profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object('retired', jsonb_build_object('at', now(), 'before_status', status, 'why',
   case slug when 'the-improver' then 'Duplicate of the active card improver (The Improver, Head of Operations, Mondays 8:45 AM).'
             when 'pi-model-prober' then 'Duplicate of model-prober (pi_jobs model_prober, daily 4:17 AM). That card keeps the heartbeat.'
             else 'Duplicate of plug-puller (Plug Puller). charge_stop is the Plug Puller job; that card owns it.' end))
 where slug in ('the-improver', 'pi-model-prober', 'pi-charge-stop') and status <> 'retired';
