#!/usr/bin/env python3
"""Install tested local HKT scheduler. Preview by default; --apply required.
Copies only the runner, preserving existing repo scripts, secrets and sync state.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import plistlib
import shutil
import subprocess

from runner import JOBS, tick


def configuration(label, runner, repo, state, python):
    return {
        'Label': label,
        'ProgramArguments': [str(python), str(runner), label.removeprefix('com.crystocraft.'),
                             '--repo', str(repo), '--state-dir', str(state)],
        'StartInterval': 60,
        'RunAtLoad': False,
        'EnvironmentVariables': {'TZ': 'Asia/Hong_Kong'},
        'StandardOutPath': str(state / (label + '.log')),
        'StandardErrorPath': str(state / (label + '.log')),
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--apply', action='store_true')
    p.add_argument('--repo', type=Path, required=True)
    args = p.parse_args()
    home = Path.home()
    base = home / 'Library/Application Support/Crystocraft/oc-scheduler'
    agents = home / 'Library/LaunchAgents'
    python = Path('/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3')
    changes = []
    for job, (script, _) in JOBS.items():
        label = 'com.crystocraft.' + job
        path = agents / (label + '.plist')
        old = plistlib.loads(path.read_bytes())
        # Refuse a guessed/new job or an unexpected target.
        if old['ProgramArguments'] != ['/bin/bash', str(args.repo / script)]:
            raise SystemExit('Unexpected existing job target: ' + label)
        changes.append((path, old, configuration(label, base / 'runner.py', args.repo, base / 'state', python)))
    print(json.dumps({'apply': args.apply, 'jobs': [v[1]['Label'] for v in changes],
                      'calendar': 'Hourly; daily 03:00 HKT; Sunday 03:00 HKT',
                      'runner': str(base / 'runner.py'), 'run_on_install': False}))
    if not args.apply:
        return
    import os
    domain = 'gui/' + str(os.getuid())
    # Never interrupt a running sync.
    for _, old, _ in changes:
        status = subprocess.run(['launchctl', 'print', domain + '/' + old['Label']], capture_output=True, text=True)
        if 'state = running' in status.stdout:
            raise SystemExit('Job is running; retry after it finishes: ' + old['Label'])
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    backup = base / ('backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    backup.mkdir(mode=0o700)
    shutil.copy2(Path(__file__).with_name('runner.py'), base / 'runner.py')
    for path, old, new in changes:
        shutil.copy2(path, backup / path.name)
        tick(old['Label'].removeprefix('com.crystocraft.'), args.repo, base / 'state', datetime.now(timezone.utc), seed=True)
        status = subprocess.run(['launchctl', 'print', domain + '/' + old['Label']], capture_output=True)
        if status.returncode == 0:
            subprocess.run(['launchctl', 'bootout', domain, str(path)], check=True)
        path.write_bytes(plistlib.dumps(new))
        try:
            subprocess.run(['launchctl', 'bootstrap', domain, str(path)], check=True)
        except Exception:
            path.write_bytes(plistlib.dumps(old))
            subprocess.run(['launchctl', 'bootstrap', domain, str(path)], check=False)
            raise
    print('Installed without executing imports. Original plists backed up at ' + str(backup))


if __name__ == '__main__':
    main()
