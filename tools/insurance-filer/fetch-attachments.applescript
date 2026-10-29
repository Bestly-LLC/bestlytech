-- Saves the attachments of one received email to a folder (the Pi/Supabase mail pipe keeps no attachments, so the Mac's Mail has them).
--
--   osascript fetch-attachments.applescript <rfc-message-id> <subject> <folder>
--
-- Finds the message by its RFC Message-ID in the inbox (fallback: by subject, newest first), saves each attachment into <folder>, and
-- prints one saved file name per line ("none" when it cannot find the message or it has no attachments).
on run argv
	set mid to item 1 of argv
	set subj to item 2 of argv
	set dest to item 3 of argv
	set savedNames to {}
	tell application "Mail"
		set found to {}
		try
			set found to (messages of inbox whose message id is mid)
		end try
		if (count of found) is 0 and subj is not "" then
			try
				set found to (messages of inbox whose subject is subj)
			end try
		end if
		if (count of found) is 0 then return "none"
		set m to item 1 of found
		repeat with att in mail attachments of m
			try
				set fname to name of att
				save att in (POSIX file (dest & "/" & fname))
				set end of savedNames to fname
			end try
		end repeat
	end tell
	if (count of savedNames) is 0 then return "none"
	set AppleScript's text item delimiters to linefeed
	return savedNames as text
end run
