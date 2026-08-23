#!/usr/bin/env python3
"""V8.1 email ingestion, Phase 2 architecture steps 1-3 — the LIVE IMAP
source. Historical PST/mbox archives are archive_import.py, a one-time-ish
backfill sharing this file's matching/threading/upsert logic via common.py.

What this does, every run:
  1. UID-based incremental IMAP fetch (INBOX + Sent) — only messages newer
     than the last run, tracked in state.json (gitignored, local to this
     Mac). First run backfills the last BACKFILL_DAYS.
  2. Deterministic envelope parse — same shape as the Phase 1 spike
     (fetch_threads.py): headers, body text, References-based threading.
  3. Match each message's non-Crystocraft participants against every
     customer's contacts[] emails (exact) or domain (fallback, lower
     confidence — see match_reason on each thread doc). Bucket addresses
     like sales@/crystocraft@ on OUR side are excluded from matching, not
     treated as a "customer".
  4. Upsert into customers/{id}/email_threads/{threadId} via Firestore REST,
     authenticated as a real admin user (Firebase Auth REST sign-in) so this
     is subject to the exact same firestore.rules isAdmin() gate as every
     other write in this app — no service-account/admin-SDK trust path
     introduced. New messages merge into an existing thread doc (matched by
     the thread's root Message-ID) rather than overwriting it.

Deliberately NOT done here: DeepSeek summarization (that's
refresh-email-summary.js, run on-demand from the CustomerDetail UI so it's
always summarizing whatever's actually been ingested).

Usage: python3 sync.py
Reads email-sync/.env — IMAP + Firebase Web API key + an admin user's own
email/password (used only to mint a short-lived ID token via Firebase Auth,
exactly like the browser app itself does; never stored beyond this process).
"""
import argparse
import email
import imaplib
import json
import os
from datetime import datetime, timedelta, timezone

from common import Firestore, load_customer_index, load_marketing_contact_index, load_env, match_and_upsert, sign_in

HERE = os.path.dirname(os.path.abspath(__file__))
BACKFILL_DAYS = 90
FOLDERS = ['INBOX', 'INBOX.Sent Messages']


def load_state():
    path = os.path.join(HERE, 'state.json')
    if os.path.exists(path):
        return json.load(open(path))
    return {'uids': {}}  # folder -> last synced UID (int)


def save_state(state):
    with open(os.path.join(HERE, 'state.json'), 'w') as f:
        json.dump(state, f, indent=2)


def fetch_new_messages(M, folder, last_uid, rescan=False):
    typ, _ = M.select(folder, readonly=True)
    if typ != 'OK':
        print(f'  [skip] could not select {folder}')
        return [], last_uid

    if last_uid and not rescan:
        typ, data = M.uid('search', None, f'UID {last_uid + 1}:*')
    else:
        since = (datetime.now(timezone.utc) - timedelta(days=BACKFILL_DAYS)).strftime('%d-%b-%Y')
        typ, data = M.uid('search', None, f'(SINCE {since})')

    if typ != 'OK' or not data or not data[0]:
        return [], last_uid

    uids = [int(u) for u in data[0].split()]
    # a bare "UID N:*" search with nothing newer than N returns [N] itself on
    # some servers (Dovecot included) rather than an empty set — drop it.
    # Skipped entirely on --rescan: the whole point is to re-fetch messages
    # already below last_uid, to catch a customer added to Firestore since.
    if last_uid and not rescan:
        uids = [u for u in uids if u > last_uid]
    if not uids:
        return [], last_uid

    print(f'  {folder}: {len(uids)} new message(s)')
    out = []
    for uid in uids:
        typ, msg_data = M.uid('fetch', str(uid), '(RFC822)')
        if typ != 'OK' or not msg_data or not msg_data[0]:
            continue
        msg = email.message_from_bytes(msg_data[0][1])
        out.append(msg)
    return out, max(uids)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rescan', action='store_true',
                     help='re-fetch the full BACKFILL_DAYS window regardless of last_uid, '
                          'to catch a customer added to Firestore since messages were first seen')
    args = ap.parse_args()

    env = load_env()
    if not env.get('ADMIN_EMAIL') or not env.get('ADMIN_PASSWORD'):
        raise SystemExit('Set ADMIN_EMAIL / ADMIN_PASSWORD in email-sync/.env first (an admin login for this app).')

    print('Signing in...')
    id_token = sign_in(env)
    fs = Firestore(env['FIREBASE_PROJECT_ID'], id_token)

    print('Loading customer directory...')
    customer_index = load_customer_index(fs)
    print(f'  {len(customer_index)} customers with at least one contact email')
    # V8.9 — marketing_contacts alongside customers (see common.py's
    # load_marketing_contact_index/match_entity). A live check found 60
    # marketing_contacts emails already sitting in this mailbox with no
    # customer match at all — previously discarded by match_and_upsert
    # rather than stored anywhere.
    contact_index = load_marketing_contact_index(fs)
    print(f'  {len(contact_index)} marketing_contacts (not already linked to a customer) with an email')

    state = load_state()
    print(f'\nConnecting to {env["IMAP_HOST"]}...')
    M = imaplib.IMAP4_SSL(env['IMAP_HOST'], int(env['IMAP_PORT']))
    M.login(env['IMAP_USER'], env['IMAP_PASS'])

    all_new_msgs = []
    for folder in FOLDERS:
        print(f'Fetching {folder}...')
        last_uid = state['uids'].get(folder, 0)
        msgs, new_last_uid = fetch_new_messages(M, folder, last_uid, rescan=args.rescan)
        all_new_msgs.extend(msgs)
        # Still advance the checkpoint on a rescan (to whatever's newest seen)
        # so the next NORMAL run continues incrementally rather than re-doing
        # this same full sweep.
        if new_last_uid and new_last_uid != last_uid:
            state['uids'][folder] = new_last_uid
    M.close()
    M.logout()

    print(f'\n{len(all_new_msgs)} new message(s) total. Matching against customers and marketing_contacts...')
    match_and_upsert(fs, customer_index, all_new_msgs, source='imap', contact_index=contact_index)

    save_state(state)

    # Last-sync stamp, readable by the app (CustomerDetail.jsx's Email Summary
    # card) — this Mac's own filesystem (state.json's mtime) isn't visible to
    # the deployed web app, so the fact has to land in Firestore for the UI to
    # show "last synced". Written even when 0 new messages arrived — that IS
    # the fact ("checked, nothing new"), not an omission.
    fs.set_fields('settings/email_sync_status', {
        'last_run_at': datetime.now(timezone.utc).isoformat(),
        'new_messages': len(all_new_msgs),
        'run_type': 'rescan' if args.rescan else 'imap',
    })

    print('\nDone. State saved to state.json (per-folder last UID).')


if __name__ == '__main__':
    main()
