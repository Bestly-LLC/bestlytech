-- Sends one email from jared@bestly.tech with the "Bestly" signature and any number of attachments.
-- A sibling of ~/Bestly/send-bestly.applescript (same sender, same signature, same 3 second settle) that takes a CC and many attachments.
--
--   osascript send-bestly-multi.applescript <to> <subject> <body-file> <cc-or-dash> [attachment-path ...]
--
-- Only ever run by filer.py for a draft Jared tapped to approve. The body file is UTF-8 plain text. "-" means no CC.
on run argv
	set toAddr to item 1 of argv
	set subj to item 2 of argv
	set bodyPath to item 3 of argv
	set ccAddr to item 4 of argv
	set bodyText to read (POSIX file bodyPath) as «class utf8»
	tell application "Mail"
		set msg to make new outgoing message with properties {sender:"Jared Best <jared@bestly.tech>", subject:subj, content:bodyText, visible:true}
		tell msg
			make new to recipient at end of to recipients with properties {address:toAddr}
			if ccAddr is not "-" and ccAddr is not "" then
				make new cc recipient at end of cc recipients with properties {address:ccAddr}
			end if
		end tell
		if (count of argv) > 4 then
			repeat with i from 5 to (count of argv)
				set attPath to item i of argv
				tell content of msg
					make new attachment with properties {file name:(POSIX file attPath) as alias} at after last paragraph
				end tell
			end repeat
		end if
		set message signature of msg to signature "Bestly"
		delay 3
		send msg
	end tell
	return "sent"
end run
