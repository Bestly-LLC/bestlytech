-- Family Cookbook, part 8: Vera (Privacy Clerk) learns the one personal column.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled)
values ('family_members', 'email', 'email', 'blank', 'Family Cookbook invite email. Blanked on a deletion request; the person keeps their seat but can no longer be mailed.', true)
on conflict do nothing;
