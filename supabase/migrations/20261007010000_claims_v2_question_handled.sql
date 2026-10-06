-- Claims Closer v2: a question's answer is acted on exactly once (booking, retry of a Turo action, the garage yes/no, a shop's question).
alter table public.claim_questions add column if not exists handled_at timestamptz;
-- answers given before this column existed were handled by hand or are moot
update public.claim_questions set handled_at = coalesce(answered_at, now()) where answered_at is not null and handled_at is null;
