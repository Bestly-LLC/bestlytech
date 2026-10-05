-- Jared, 2026-10-04 (feedback on call #3): ask for the person who does the job, not a name.
-- Amazon playbook: "I'm here to speak with the person in charge of..." The name only confirms.
insert into public.rg_openers (key, audience, label, script, active)
values ('gk_role_first', 'gatekeeper', 'Role-first',
        'Hey, it''s Ava from RoofGuard, on a recorded line... I''m looking for whoever''s in charge of keeping your roof maintained. Would that be {{contact_name}}?',
        true)
on conflict (key) do update set script = excluded.script, active = true;

update public.rg_openers set active = false where key = 'gk_name_first';
