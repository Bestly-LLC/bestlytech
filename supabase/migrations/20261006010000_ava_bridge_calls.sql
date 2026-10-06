-- "Get a human, then get me on": Ava dials a company, works the phone tree and the hold queue, then transfers the live
-- human to Jared's cell. Jared's ask (2026-10-05): he wanted her to read his SSN to his credit union; she never gets it.
-- Nothing identifying him enters the prompt on a bridge call, so nothing identifying him can be said.
-- Two columns so the list and the Coach can tell a bridge call apart from an ordinary outbound one.

alter table public.ava_calls
  add column if not exists bridge     boolean not null default false,
  add column if not exists bridge_org text;

create index if not exists ava_calls_bridge on public.ava_calls (bridge) where bridge;

comment on column public.ava_calls.bridge is 'Ava called a company to reach a human and hand the call to Jared. She shares nothing about him on these.';
