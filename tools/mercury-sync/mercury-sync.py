"""Wrapper so runjob.py can import jobs.mercury-sync (the pi_jobs name is hyphenated)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from mercury_sync import main  # noqa: E402,F401
