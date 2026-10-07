-- 2026-10-06: second Live Activity kind (attr=turo) shares the Sky tokens/log/current tables.
alter table wall_sky_tokens add column if not exists attr text not null default 'aircraft';
alter table wall_sky_log add column if not exists attr text not null default 'aircraft';
alter table wall_sky_current add column if not exists attr text not null default 'aircraft';
create index if not exists wall_sky_tokens_attr_idx on wall_sky_tokens (attr, kind) where dead = false;
