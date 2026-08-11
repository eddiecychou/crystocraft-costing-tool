#!/usr/bin/env python3
"""One-off: delete every customers/{id}/email_threads doc across the whole
customer base. Used once here to clear out the first sync.py run's output,
which had a matching bug (freemail domain fallback cross-contaminated
customers who shared a Gmail/Yahoo/etc. contact address) — see sync.py's
FREEMAIL_DOMAINS comment. Safe to run again any time a clean re-ingest is
wanted; this subcollection is entirely derived/regenerable from IMAP.
"""
import json
import os
import urllib.request

from sync import Firestore, load_env, sign_in

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    env = load_env()
    id_token = sign_in(env)
    fs = Firestore(env['FIREBASE_PROJECT_ID'], id_token)

    customers = fs.list_all('customers')
    total_deleted = 0
    for c in customers:
        cid = c['name'].rsplit('/', 1)[-1]
        threads = fs.list_all(f'customers/{cid}/email_threads')
        for t in threads:
            fs._req('DELETE', t['name'].split('/documents/', 1)[1])
            total_deleted += 1
        if threads:
            print(f'{cid}: deleted {len(threads)} thread doc(s)')

    print(f'\nTotal deleted: {total_deleted}')


if __name__ == '__main__':
    main()
