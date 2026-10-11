"""Pi cron wrapper: runjob.py imports jobs.<job-name> as-is, and this job's name has a dash
(pi_jobs row 'settlement-mercury'). The real worker is jobs/settlement_mercury.py."""
from jobs.settlement_mercury import main  # noqa: F401
