-- Allow the self-test command for the Mac meeting recorder agent
alter table public.meeting_recorder_commands drop constraint if exists meeting_recorder_commands_action_check;
alter table public.meeting_recorder_commands add constraint meeting_recorder_commands_action_check check (action in ('start','stop','selftest'));
