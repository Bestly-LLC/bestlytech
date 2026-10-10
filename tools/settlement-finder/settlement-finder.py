"""Pi cron wrapper: runjob.py imports jobs.<job-name> as-is, and this job's name has a dash
(pi_jobs row 'settlement-finder'). The real worker is jobs/settlement_finder.py."""
from jobs.settlement_finder import main  # noqa: F401
