with timeout of 10800 seconds
	display notification "Stopping and transcribing… this takes a few minutes." with title "Meeting Recorder"
	try
		do shell script "$HOME/MeetingRec/stop.sh > /tmp/meetingrec-stop.log 2>&1"
	on error errMsg
		display alert "Transcribing hit a problem" message errMsg as warning giving up after 600
		return
	end try

	set tp to do shell script "ls -t $HOME/MeetingRec/recordings/*-transcript-named.txt 2>/dev/null | head -1; true"
	if tp is "" then
		set tp to do shell script "ls -t $HOME/MeetingRec/recordings/*-transcript.txt 2>/dev/null | head -1; true"
	end if
	if tp is "" then
		display alert "No transcript came out" message "See /tmp/meetingrec-stop.log" as warning giving up after 600
		return
	end if
	set fileName to do shell script "basename " & quoted form of tp

	display notification "Transcript ready. It's in Scout too." with title "Meeting Recorder" sound name "Glass"

	set r to display dialog "Transcript ready:" & return & fileName & return & return & "It's also in Scout on the admin. What next?" buttons {"Just Open", "Dispatch", "Send to Claude"} default button "Send to Claude" with title "Meeting Recorder" with icon note giving up after 1800
	if gave up of r then return
	set theChoice to button returned of r

	if theChoice is "Send to Claude" then
		do shell script "$HOME/MeetingRec/postprocess.sh claude " & quoted form of tp & " > /dev/null 2>&1 &"
	else if theChoice is "Dispatch" then
		do shell script "$HOME/MeetingRec/postprocess.sh dispatch " & quoted form of tp & " > /dev/null 2>&1 || true"
	else
		do shell script "open -e " & quoted form of tp
	end if
end timeout
