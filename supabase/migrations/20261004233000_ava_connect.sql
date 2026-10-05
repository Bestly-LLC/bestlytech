-- Ava "Connect me" skill (Spark, 2026-10-04). Jared: "she can call ahead and then connect the call to my 816-500-7236."
-- Ava calls the person, says why Jared wants to talk, checks they're free, then transfers the live call to Jared's cell.
-- The transfer tool can only ever dial Jared's own number (set here), never anyone else.
alter table public.ava_settings add column if not exists jared_cell text not null default '+18165007236';
alter table public.ava_calls add column if not exists connect_to_jared boolean not null default false;
