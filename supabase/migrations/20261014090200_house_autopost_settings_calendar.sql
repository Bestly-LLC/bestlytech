-- House autopost part 3 of 6: caps per account, posting times, per-brand holiday calendars (Spark, 2026-10-14).
-- Jared 12:49 AM: @bestly_llc 7/week SHARED by bestly-cloud + bestly-studio + bestly-agent; InventoryProof 7; HOKU 4; Cookie Yeti 5.
-- Instagram only today; other platforms later are a setting (social_brand_settings.platforms), not a rewrite.

-- 0. Backup of what the old direct-post pipeline was set to (rollback) ------------------------------
create table if not exists public.house_autopost_backup (
  key text primary key, taken_at timestamptz not null default now(), data jsonb not null
);
alter table public.house_autopost_backup enable row level security;
insert into public.house_autopost_backup (key, data)
select 'social_brand_settings:' || brand, to_jsonb(s) from public.social_brand_settings s
 where brand in ('cookieyeti', 'inventoryproof', 'hoku')
on conflict (key) do nothing;

-- 1. Caps and windows. enabled=false = the old "bank" pipeline (social_bank_tick) stops posting directly -----
update public.social_brand_settings set posts_per_week = 5, enabled = false, platforms = '{"instagram": true}'::jsonb where brand = 'cookieyeti';
update public.social_brand_settings set posts_per_week = 7, enabled = false, platforms = '{"instagram": true}'::jsonb where brand = 'inventoryproof';
update public.social_brand_settings set posts_per_week = 4, enabled = false, platforms = '{"instagram": true}'::jsonb where brand = 'hoku';
insert into public.social_brand_settings (brand, slot_utc, runway_target_days, per_run, enabled, posts_per_week, window_start, window_end, tz, days, platforms)
values ('bestly', '17:00', 14, 1, false, 7, '08:00', '21:00', 'America/Los_Angeles', null, '{"instagram": true}'::jsonb)
on conflict (brand) do update set posts_per_week = 7, enabled = false, platforms = '{"instagram": true}'::jsonb;

-- 2. Posting times. Where an account has history, its own proven hour; weekends are a starting guess ------
-- HOKU 11 AM, InventoryProof 1 PM, Cookie Yeti 9 AM, Bestly ~10:30 AM (what the old daily posts used). Fewer than 7 posts per
-- weekday so far, so no real day-of-week signal yet; Phase 4 learning will move these (source becomes 'learned').
insert into public.studio_post_times (brand, dow, at, weight, source)
select b, d, t, 1, s from (values
  ('hoku', 0, '11:00'::time, 'history'), ('hoku', 1, '11:00', 'history'), ('hoku', 2, '11:00', 'history'), ('hoku', 3, '11:00', 'history'),
  ('hoku', 4, '11:00', 'history'), ('hoku', 5, '11:00', 'history'), ('hoku', 6, '11:00', 'history'),
  ('inventoryproof', 0, '10:00', 'prior'), ('inventoryproof', 1, '13:00', 'history'), ('inventoryproof', 2, '13:00', 'history'),
  ('inventoryproof', 3, '13:00', 'history'), ('inventoryproof', 4, '13:00', 'history'), ('inventoryproof', 5, '13:00', 'history'), ('inventoryproof', 6, '10:00', 'prior'),
  ('cookieyeti', 0, '10:00', 'prior'), ('cookieyeti', 1, '09:00', 'history'), ('cookieyeti', 2, '09:00', 'history'),
  ('cookieyeti', 3, '09:00', 'history'), ('cookieyeti', 4, '09:00', 'history'), ('cookieyeti', 5, '09:00', 'history'), ('cookieyeti', 6, '10:00', 'prior'),
  ('bestly', 0, '18:00', 'prior'), ('bestly', 1, '10:30', 'history'), ('bestly', 2, '10:30', 'history'),
  ('bestly', 3, '10:30', 'history'), ('bestly', 4, '10:30', 'history'), ('bestly', 5, '10:30', 'history'), ('bestly', 6, '09:30', 'prior')
) v(b, d, t, s)
on conflict do nothing;

-- 3. Calendar: keywords let the planner match a post's topic to an upcoming date or season ----------------
alter table public.studio_calendar_events add column if not exists keywords text[] not null default '{}';
comment on column public.studio_calendar_events.keywords is
  'Words in a post''s title or caption that make this date a good home for it. The planner picks such posts first for the event window.';

-- Election Day pause applies to everyone (Jared); Christmas Day to every house brand; Thanksgiving to the business brands
insert into public.studio_calendar_events (client_slug, starts_on, ends_on, name, kind, relevance, angle, blackout, created_by)
select null, '2026-11-03', '2026-11-03', 'Election Day', 'blackout', 'medium', 'No posts on Election Day.', true, 'Spark'
 where not exists (select 1 from public.studio_calendar_events where client_slug is null and name = 'Election Day');
insert into public.studio_calendar_events (client_slug, starts_on, ends_on, name, kind, relevance, angle, blackout, created_by)
select s, '2026-12-25', '2026-12-25', 'Christmas Day', 'blackout', 'medium', 'No posts on Christmas Day.', true, 'Spark'
  from unnest(array['bestly-cloud','bestly-studio','bestly-agent','inventoryproof','cookie-yeti','hoku']) s
 where not exists (select 1 from public.studio_calendar_events e where e.client_slug = s and e.name = 'Christmas Day');
insert into public.studio_calendar_events (client_slug, starts_on, ends_on, name, kind, relevance, angle, blackout, created_by)
select s, '2026-11-26', '2026-11-26', 'Thanksgiving', 'blackout', 'medium', 'Business audience is offline; no post.', true, 'Spark'
  from unnest(array['bestly-cloud','bestly-studio','bestly-agent','cookie-yeti']) s
 where not exists (select 1 from public.studio_calendar_events e where e.client_slug = s and e.name = 'Thanksgiving');

insert into public.studio_calendar_events (client_slug, starts_on, ends_on, name, kind, relevance, angle, blackout, keywords, created_by)
select v.slug, v.s::date, v.e::date, v.name, v.kind, v.rel, v.angle, false, v.kw, 'Spark'
  from (values
    ('bestly-cloud', '2026-10-01', '2026-10-31', 'Cybersecurity Awareness Month', 'awareness', 'high', 'Passwords, logins and who can see your files are the story this month.', array['password','login','private','privacy','secure','backup']),
    ('bestly-cloud', '2026-11-15', '2026-11-21', 'International Fraud Awareness Week', 'awareness', 'medium', 'Scams and phishing are in the news.', array['fraud','scam','phish']),
    ('bestly-cloud', '2026-11-28', '2026-11-28', 'Small Business Saturday', 'shopping', 'high', 'Small businesses are the audience that day.', array['small business']),
    ('bestly-cloud', '2027-01-28', '2027-01-28', 'Data Privacy Day', 'awareness', 'high', 'Privacy is the whole day.', array['privacy','private','data']),
    ('bestly-cloud', '2027-03-31', '2027-03-31', 'World Backup Day', 'awareness', 'medium', 'Backups are the whole day.', array['backup','restore']),
    ('bestly-cloud', '2027-04-13', '2027-04-13', 'Identity Management Day', 'awareness', 'medium', 'Logins and accounts are the whole day.', array['login','password','account','offboard']),
    ('bestly-studio', '2026-11-27', '2026-11-27', 'Black Friday', 'shopping', 'medium', 'Everyone is posting offers; show the easy way to keep a feed going.', array['post','offer','sale']),
    ('bestly-studio', '2026-11-28', '2026-11-28', 'Small Business Saturday', 'shopping', 'high', 'Small businesses are the audience that day.', array['small business','instagram','social']),
    ('bestly-studio', '2027-01-01', '2027-01-15', 'New year, new posting plan', 'awareness', 'medium', 'People plan their year in January.', array['week','plan','feed']),
    ('bestly-agent', '2026-11-27', '2026-12-24', 'Holiday rush', 'shopping', 'high', 'Holiday weeks are when a missed call costs the most.', array['missed call','phone','answer','receptionist']),
    ('bestly-agent', '2026-11-28', '2026-11-28', 'Small Business Saturday', 'shopping', 'high', 'Small businesses are the audience that day.', array['customer','call']),
    ('inventoryproof', '2026-10-01', '2026-12-31', 'Fire season in Southern California', 'awareness', 'high', 'Fire season is when people think about what they would lose.', array['fire','disaster','evacuat','claim','insur']),
    ('inventoryproof', '2026-11-27', '2026-11-30', 'Black Friday to Cyber Monday', 'shopping', 'medium', 'New gear arrives; document it.', array['valuables','gift','electronics','photograph']),
    ('inventoryproof', '2026-12-01', '2026-12-26', 'Holiday gifts', 'holiday', 'medium', 'New things come into the house.', array['valuables','photograph','document']),
    ('inventoryproof', '2027-05-01', '2027-08-31', 'Moving season', 'awareness', 'high', 'Most moves happen in summer.', array['mov','pack','box']),
    ('inventoryproof', '2027-06-28', '2027-06-28', 'Insurance Awareness Day', 'awareness', 'medium', 'Insurance is the whole day.', array['insur','claim']),
    ('hoku', '2026-11-01', '2027-02-28', 'Dry-air season', 'awareness', 'medium', 'Heaters on, skin dries out.', array['dry','air','skin','mist','face']),
    ('hoku', '2026-11-27', '2026-11-27', 'Black Friday gifts', 'shopping', 'medium', 'Gift angle, no discount.', array['gift']),
    ('hoku', '2026-12-15', '2027-01-03', 'Holiday travel', 'holiday', 'medium', 'A small can travels well.', array['travel','bag','flight','carry']),
    ('hoku', '2027-02-14', '2027-02-14', 'Valentine''s Day', 'holiday', 'medium', 'Gift angle.', array['gift','love']),
    ('hoku', '2027-05-09', '2027-05-09', 'Mother''s Day', 'holiday', 'high', 'Gift angle.', array['gift','mom']),
    ('hoku', '2027-06-01', '2027-08-31', 'Summer heat', 'awareness', 'medium', 'Hot walks, hot days.', array['heat','sun','walk','summer']),
    ('cookie-yeti', '2026-10-01', '2026-10-31', 'Cybersecurity Awareness Month', 'awareness', 'high', 'Tracking and consent are part of the story this month.', array['cookie','consent','banner','privacy','track']),
    ('cookie-yeti', '2026-11-01', '2026-12-24', 'Holiday online shopping', 'shopping', 'medium', 'Everyone is clicking through banners to shop.', array['shop','cart','checkout','banner','consent']),
    ('cookie-yeti', '2026-11-30', '2026-11-30', 'Cyber Monday', 'shopping', 'medium', 'Peak shopping day, peak tracking.', array['tracking','track','cookie']),
    ('cookie-yeti', '2027-01-28', '2027-01-28', 'Data Privacy Day', 'awareness', 'high', 'Privacy is the whole day.', array['privacy','track','cookie','consent']),
    ('cookie-yeti', '2027-02-09', '2027-02-09', 'Safer Internet Day', 'awareness', 'medium', 'Safer browsing is the whole day.', array['privacy','cookie','banner'])
  ) as v(slug, s, e, name, kind, rel, angle, kw)
 where not exists (select 1 from public.studio_calendar_events x where x.client_slug = v.slug and x.name = v.name and x.starts_on = v.s::date);
