#!/usr/bin/env python3
"""Local OC job calendar. Polling is host-independent; never sends marketing.
Only completed periods are checkpointed. An OS lock prevents overlapping ticks.
"""
import argparse
from datetime import datetime, timedelta, timezone
import fcntl
import json
import os
from pathlib import Path
import subprocess
import tempfile

HKT = timezone(timedelta(hours=8), 'HKT')
JOBS = {
    'email-hourly-sync': ('email-sync/hourly_sync.sh', 'hourly'),
    'email-rescan': ('email-sync/weekly_rescan.sh', 'weekly'),
    'whatsapp-auto-import': ('scripts/whatsapp-sync.sh', 'daily'),
}


def period(kind, now):
    if now.tzinfo is None:
        raise ValueError('An explicit timestamp offset is required')
    hk = now.astimezone(HKT)
    if kind == 'hourly':
        return hk.strftime('%Y-%m-%dT%H')
    # Most recent 03:00 HKT, including a single catch-up after sleep.
    day = (hk - timedelta(hours=3)).date()
    if kind == 'weekly':
        day -= timedelta(days=(day.weekday() + 1) % 7)  # Sunday
    elif kind != 'daily':
        raise ValueError('Unknown schedule')
    return day.isoformat()


def checkpoint(path, key):
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix='.checkpoint-')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump({'completed_period': key}, f)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def tick(job, repo, state_dir, now, execute=subprocess.run, seed=False):
    script, kind = JOBS[job]
    state_dir = Path(state_dir)
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Hourly and weekly email jobs share IMAP UID state: never overlap them.
    resource = 'email' if job.startswith('email-') else 'whatsapp'
    with (state_dir / (resource + '.lock')).open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 'busy'
        path = state_dir / (job + '.json')
        key = period(kind, now)
        if not path.exists():
            # First install establishes a baseline, never kicks off an import.
            checkpoint(path, key)
            return 'initialized'
        previous = json.loads(path.read_text())['completed_period']
        if seed or previous >= key:
            return 'not-due'  # includes backward clock correction
        env = dict(os.environ, TZ='Asia/Hong_Kong')
        result = execute(['/bin/bash', str(Path(repo) / script)], env=env, check=False)
        if result.returncode:
            return 'failed'  # retry next poll; original job remains idempotent
        checkpoint(path, key)
        return 'completed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('job', choices=JOBS)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--state-dir', required=True)
    parser.add_argument('--seed', action='store_true', help='Initialize only; never execute a job')
    args = parser.parse_args()
    result = tick(args.job, args.repo, args.state_dir, datetime.now(timezone.utc), seed=args.seed)
    print(datetime.now(HKT).isoformat(timespec='seconds'), args.job, result)
    return 1 if result == 'failed' else 0


if __name__ == '__main__':
    raise SystemExit(main())
