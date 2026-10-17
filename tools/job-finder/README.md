# Job Finder on the Pi

Moves the Claude scheduled task "Job Finder" (`trig_01W3dUTL4HFVoCcfRYFAW8GG`, left disabled as the fallback) to the Pi.
Free: stdlib Python, LinkedIn's public guest search (no login), the Nextcloud Deck API, and the free AI ladder only for a one-line role summary.
Daily at 7:00 AM PT (`0 7 * * *`).

## What it does
1. Searches in tiers: **A** skill match near 90069 (account management, customer success, partnerships, BD, sales, solutions, plus forward deployed /
   solutions / implementation engineer, also remote US), **B** wider LA commute plus hospitality and guest services management, **C** walkable West Hollywood retail,
   hospitality, concierge, front desk.
2. Scores and drops roles that are too far or not his lane.
3. **Never offers overnight / graveyard / night audit / third shift work.** Checked in the title and again in the full posting text before anything is posted.
   If the posting text cannot be read, the role is held back, not posted.
4. Posts the best new ones (default 8 per tier) to the **New** stack of Deck board 7 with the tier label, skipping anything already anywhere on the board or in the archive
   (the `<!-- linkedin-id: N -->` marker in each card).
5. Sweeps **Shortlist**: a card whose posting is gone or says it no longer accepts applications is moved to **Closed**.
6. Adds a one-sentence "about the role" note from the free AI (only the posting text, nothing about Jared).

Not carried over: the Claude task could submit applications through a browser. The Pi job only finds and files; applying stays with Jared (each card has the
Tailor resume / Apply checklist). The old `application-profile.json` rules (never guess answers, never fill SSN/DOB/EEO) therefore do not apply to this job.

## Controls
`job_finder_settings` (switch and cards-per-tier), changed with `select job_finder_set(p_enabled => false)` / `job_finder_set(p_max_per_tier => 5)` as an admin.

## Credentials
Read from Supabase Vault through `pi_secret`: `nextcloud_user`, `nextcloud_app_password`, `nextcloud_base_url`. Never in a file or in the job output.
**The old Claude task prompt held a Nextcloud account password in plain text. Rotate that password.**

## Install / test
    sh install.sh                                  # on the Pi
    python3 tools/job-finder/test_job_finder.py    # offline tests
    python3 -c "import sys; sys.path.insert(0,'/opt/bestly/cron'); from jobs.job_finder import main; print(main(['--dry']))"   # searches, writes nothing

## Undo
`select job_finder_set(p_enabled => false)`, or delete the `job_finder` line with `crontab -e` (backup at `/home/pi/scripts/crontab.bak-*-jobfinder`), then re-enable the Claude task if wanted.
