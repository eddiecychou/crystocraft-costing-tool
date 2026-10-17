import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from datetime import datetime
from types import SimpleNamespace
import fcntl
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/oc-scheduler'))
from runner import period, tick
from install import configuration


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


class Schedules(unittest.TestCase):
    def test_calendar_boundary_across_host_zones(self):
        previous = os.environ.get('TZ')
        try:
            for zone in ['UTC', 'Australia/Sydney', 'America/Los_Angeles', 'Asia/Hong_Kong']:
                os.environ['TZ'] = zone
                self.assertEqual(period('daily', instant('2026-10-17T15:59:59Z')), '2026-10-17')
                self.assertEqual(period('daily', instant('2026-10-17T16:00:00Z')), '2026-10-17')  # midnight is not run time
                self.assertEqual(period('daily', instant('2026-10-17T18:59:59Z')), '2026-10-17')
                self.assertEqual(period('daily', instant('2026-10-17T19:00:00Z')), '2026-10-18')
                self.assertEqual(period('weekly', instant('2026-10-17T18:59:59Z')), '2026-10-11')
                self.assertEqual(period('weekly', instant('2026-10-17T19:00:00Z')), '2026-10-18')
                self.assertEqual(period('hourly', instant('2026-10-17T16:00:00Z')), '2026-10-18T00')
        finally:
            if previous is None: os.environ.pop('TZ', None)
            else: os.environ['TZ'] = previous

    def test_year_leap_and_dst_boundaries(self):
        self.assertEqual(period('daily', instant('2026-12-31T19:00:00Z')), '2027-01-01')
        self.assertEqual(period('daily', instant('2028-02-28T19:00:00Z')), '2028-02-29')
        self.assertEqual(period('weekly', instant('2026-10-03T19:00:00Z')), '2026-10-04')  # Sydney DST change
        with self.assertRaises(ValueError): period('daily', datetime(2026, 10, 18))

    def test_no_install_run_no_midnight_run_once_at_three_catch_up_and_clock_rollback(self):
        with tempfile.TemporaryDirectory() as state:
            calls = []
            def run(*a, **kw):
                calls.append((a, kw))
                return SimpleNamespace(returncode=0)
            def at(value): return tick('whatsapp-auto-import', '/fictional', state, instant(value), execute=run)
            self.assertEqual(at('2026-10-17T15:00:00Z'), 'initialized')
            self.assertEqual(at('2026-10-17T16:00:00Z'), 'not-due')
            self.assertEqual(at('2026-10-17T19:00:00Z'), 'completed')
            self.assertEqual(at('2026-10-17T19:01:00Z'), 'not-due')
            self.assertEqual(at('2026-10-17T18:00:00Z'), 'not-due')
            self.assertEqual(at('2026-10-21T04:00:00Z'), 'completed')  # one catch-up, no replay storm
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls[0][1]['env']['TZ'], 'Asia/Hong_Kong')
            self.assertEqual(calls[0][0][0], ['/bin/bash', '/fictional/scripts/whatsapp-sync.sh'])

    def test_failure_retry_and_shared_email_lock(self):
        with tempfile.TemporaryDirectory() as state:
            before, due = instant('2026-10-17T18:59:59Z'), instant('2026-10-17T19:00:00Z')
            tick('email-rescan', '/fictional', state, before)
            self.assertEqual(tick('email-rescan', '/fictional', state, due, execute=lambda *a, **kw: SimpleNamespace(returncode=1)), 'failed')
            with (Path(state) / 'email.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                self.assertEqual(tick('email-rescan', '/fictional', state, due), 'busy')
                self.assertEqual(tick('email-hourly-sync', '/fictional', state, due), 'busy')
            self.assertEqual(tick('email-rescan', '/fictional', state, due, execute=lambda *a, **kw: SimpleNamespace(returncode=0)), 'completed')
            self.assertEqual(tick('email-rescan', '/fictional', state, due), 'not-due')

    def test_generated_launch_agent_does_not_use_host_calendar_or_run_on_install(self):
        config = configuration('com.crystocraft.email-rescan', Path('/runner'), Path('/repo'), Path('/state'), Path('/python'))
        self.assertEqual(config['StartInterval'], 60)
        self.assertNotIn('StartCalendarInterval', config)
        self.assertFalse(config['RunAtLoad'])
        self.assertEqual(config['EnvironmentVariables']['TZ'], 'Asia/Hong_Kong')


if __name__ == '__main__': unittest.main()
