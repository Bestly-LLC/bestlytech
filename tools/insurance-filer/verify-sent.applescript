-- Confirms a message really is in Sent. Mail.app says "sent" before the server has it, and a silent failure must never look like a success.
--
--   osascript verify-sent.applescript <to> <subject> <minutes>
--
-- Prints "found:<n>" when n messages with that subject, sent in the last <minutes>, include <to> among their recipients, else "none".
on run argv
	set toAddr to item 1 of argv
	set subj to item 2 of argv
	set mins to (item 3 of argv) as integer
	set found to 0
	tell application "Mail"
		set cutoff to (current date) - (mins * minutes)
		set hits to (messages of sent mailbox whose subject is subj and date sent is greater than cutoff)
		repeat with m in hits
			set addrs to address of to recipients of m
			repeat with a in addrs
				if (a as text) is toAddr then
					set found to found + 1
					exit repeat
				end if
			end repeat
		end repeat
	end tell
	if found > 0 then return "found:" & found
	return "none"
end run
