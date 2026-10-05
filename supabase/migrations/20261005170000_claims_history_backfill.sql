-- Claims history (2026-10-05). Jared: put the past Turo claims on the Claims page, the successful ones up front with
-- their details, the ones he didn't follow through tucked away. Source: Turo's own Claims dashboard
-- (/api/claims/host/2907746, /api/v2/incidents/{id}, /api/claims/{id}, read from the Pi's signed-in Turo) plus
-- Turo claim mail in bestly_mail. Backfilled cases are closed (status paid/closed, needs_work false) so Claims Closer
-- never drafts or alerts on them.

alter table public.claim_cases add column if not exists turo_claim_no text;
alter table public.claim_cases add column if not exists turo_incident_id bigint;
alter table public.claim_cases add column if not exists car text;
alter table public.claim_cases add column if not exists host_responsibility numeric;   -- Jared's damage responsibility on that trip
alter table public.claim_cases add column if not exists recovered_amount numeric;      -- money that actually reached Jared
alter table public.claim_cases add column if not exists outcome text;                  -- one plain line
alter table public.claim_cases add column if not exists history boolean not null default false;
alter table public.claim_cases add column if not exists closed_at timestamptz;

-- the open Willie case: Turo's numbers for it
update public.claim_cases set turo_claim_no = '1096164', turo_incident_id = 653528, car = 'Tesla Model 3 2020',
  host_responsibility = 2750, guest_max = 500
where reservation_id = 59754331;

insert into public.claim_cases (reservation_id, guest_first, guest_last, car, path, status, opened_at, closed_at, turo_claim_no,
  turo_incident_id, host_responsibility, guest_max, recovered_amount, estimate_amount, outcome, facts, needs_work, history, goal)
values
 -- won
 (59835700, 'Kenneth', 'Torres', 'Tesla Model 3 2020', 'resolve_directly', 'paid', '2026-08-04 12:00-07', '2026-08-23 15:00-07', '1061726',
  626969, 2750, 0, 255.00, 255.00, 'Resolved directly. Kenneth paid the $255 invoice.', null, false, true, null),
 (58851466, 'Izora', 'Brown', 'Tesla Model Y 2021 (NOMAD)', 'turo_claim', 'paid', '2026-07-02 12:00-07', '2026-09-03 12:00-07', '1040132',
  2007090, 2750, null, null, null,
  'Turo-managed total loss. Settlement: actual cash value $29,161 + $3,383.18 taxes and fees, minus your $2,750 damage responsibility. Final payment $2,060.69 after earlier payments; title transferred through IAA.',
  'Rear-ended on I-5 on Jul 2, 2026 by an at-fault driver. An unapproved driver was behind the wheel. Revised settlement Aug 17, IAA work order Aug 28, payment info Sep 3.', false, true, null),
 (56621243, 'Maxwell', 'Poll', 'Tesla Model 3 2020', 'resolve_directly', 'paid', '2026-04-30 12:00-07', null, '1001909',
  584134, 2750, 500, 339.45, 339.45, 'Resolved directly. Maxwell paid the $339.45 invoice.', null, false, true, null),
 (39317066, 'Jesse', 'Nguyen', 'Tesla Model 3 2020', 'turo_claim', 'paid', '2025-04-11 12:00-07', null, '772258',
  1722724, 250, null, 539.58, 789.58, 'Turo-managed. Repair cost $789.58 minus your $250 damage responsibility: Turo paid $539.58.', null, false, true, null),
 (34833189, 'Margaux', 'Salarda', 'Tesla Model 3 2020', 'resolve_directly', 'paid', '2024-11-11 12:00-08', null, '695033',
  367105, 250, 0, 106.85, 106.85, 'Resolved directly. Margaux paid the $106.85 invoice.', null, false, true, null),
 -- not followed through (collapsed on the page)
 (50482225, 'Gemma', 'Mahoney', 'Tesla Model 3 2020', 'turo_claim', 'closed', '2025-11-01 12:00-07', null, '904158',
  1913723, 2500, null, null, null, 'Turo-managed, stopped at "Estimate ready" (step 4 of 6). No payment. Your damage responsibility was $2,500.', null, false, true, null),
 (53663180, 'Jason', 'Rock', 'Tesla Model 3 2020', 'resolve_directly', 'closed', '2026-02-02 12:00-08', null, '952234',
  546343, 1500, 3000, null, 486.70, 'Invoice for $486.70 expired unpaid; window to resolve directly closed.', null, false, true, null),
 (55646887, 'Jose', 'Cervantes-Sandoval', 'Tesla Model 3 2020', 'resolve_directly', 'closed', '2026-03-31 12:00-07', null, '985003',
  571525, 1500, 3000, null, null, 'No invoice was sent; window to resolve directly closed.', null, false, true, null),
 (57210984, 'Ahmed', 'Hegazy', 'Tesla Model 3 2020', 'resolve_directly', 'closed', '2026-05-14 12:00-07', null, '1009906',
  589640, 2750, 0, null, null, 'No invoice was sent; window to resolve directly closed.', null, false, true, null),
 (43517821, 'Ryan', 'Brady', 'Tesla Model 3 2020', 'resolve_directly', 'closed', '2025-06-08 12:00-07', null, '808705',
  444179, 250, 500, null, 180.00, 'Invoice for $180 expired unpaid; window to resolve directly closed.', null, false, true, null),
 (36348505, 'Amayrani', 'Vargas', 'Tesla Model 3 2020', 'resolve_directly', 'closed', '2024-10-28 12:00-07', null, '688054',
  362650, 250, 0, null, 188.85, 'Invoice for $188.85 expired unpaid; window to resolve directly closed.', null, false, true, null),
 (38880841, 'Victor', 'Santos', 'Tesla Model 3 2020', 'turo_claim', 'closed', '2024-12-11 12:00-08', null, '709331',
  1588518, null, null, null, null, 'Turo-managed. Turo shows "Status temporarily unavailable"; no payment on record.', null, false, true, null),
 (34870341, 'Anthony', 'Alfaro', 'Tesla Model 3 2020', 'turo_claim', 'closed', '2024-08-15 12:00-07', null, '645161',
  1494890, null, null, null, null, 'Turo-managed. Turo shows "Status temporarily unavailable"; no payment on record.', null, false, true, null)
on conflict (reservation_id) do nothing;
