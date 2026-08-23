#!/usr/bin/env python3
"""V8.1 email ingestion, Phase 2 architecture step 1 — the historical
archive source (PST + mbox), a one-time-ish backfill of everything the live
IMAP sync (sync.py) can't reach (mail older than its BACKFILL_DAYS window).
Shares all matching/threading/upsert logic with sync.py via common.py — a
thread that later gets a new live-IMAP reply just gains a message, same doc.

Two very different readers feed the same pipeline:
  - mbox (Apple Mail export format): Python's stdlib `mailbox` module reads
    these natively as real email.message.Message objects — no adapter needed.
  - PST (Outlook): libpff-python (`pypff`, pip-installable, built here via
    Xcode Command Line Tools — no Homebrew/readpst needed). A PST message
    has no MIME body attached to its headers the way a real email does —
    Outlook stores headers (transport_headers, a real RFC822 header block
    with Message-ID/References intact) and body as separate properties. This
    file bridges that gap once, in pst_to_email_message(): parse
    transport_headers into a real Message, then inject the actual body
    (preferring plain text, falling back to HTML) as its payload. Everything
    downstream (thread_key, msg_record, get_body) then treats a PST message
    identically to an IMAP or mbox one.

Folder selection inside a PST: only FOLDER_BLOCKLIST is excluded (Deleted
Items, Drafts, Calendar, Contacts, Junk, sync-issue/RSS/Yammer internals,
etc.) — everything else is scanned, including sales.pst's hand-organized
CUSTOMER/* tree and eddie.pst's Archive folder (the bulk of the real
history). Matching still runs on message participants, not folder name, so
scanning a few internal-ops folders (BOM, pricing sheets, etc.) alongside
the customer ones is harmless — they just won't match anyone.

Resumable at the source level (one PST folder or one mbox file at a time) —
archive_state.json (gitignored) records which are done. A message is
matched/threaded the exact same way regardless of source, and upsert_thread
dedupes by Message-ID, so re-running a partially-done source is safe, just
wasteful of time, not correctness.

Usage:
  python3 archive_import.py --mbox              # all 5 mbox archives (small, fast — do this first)
  python3 archive_import.py --pst eddie          # eddie.pst only
  python3 archive_import.py --pst sales          # sales.pst only
  python3 archive_import.py --all                # everything

Reads email-sync/.env (same as sync.py).
"""
import argparse
import email
import glob
import json
import mailbox
import os
import sys
import time

import pypff

from common import Firestore, load_customer_index, load_marketing_contact_index, load_env, match_and_upsert, sign_in

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.expanduser('~/Outlook Archives')
PST_FILES = {'eddie': os.path.join(ARCHIVE_DIR, 'eddie.pst'), 'sales': os.path.join(ARCHIVE_DIR, 'sales.pst')}

# Case-insensitive substring match against a folder's own name (not its full
# path) — a blocked folder's subfolders are skipped too, by simply never
# recursing into it. English + the Chinese names actually seen in these two
# PSTs (see the folder walk this was built against).
FOLDER_BLOCKLIST = {
    'deleted', '刪除的郵件', 'drafts', '草稿', 'junk', 'spam', '垃圾郵件',
    'calendar', '行事曆', 'contacts', '連絡人', 'recipient cache', 'gal contacts',
    'organizational contacts', 'peoplecentricconversation buddies', 'cust_dir',
    'tasks', '工作', 'notes', '記事', 'journal', '日誌',
    'sync issues', '同步問題', 'conflicts', '衝突', 'local failures', 'server failures',
    'rss', 'yammer', 'personmetadata', 'conversation history', '交談歷程記錄',
    'eventcheckpoints', 'externalcontacts', 'social activity notifications',
    'detected items', '偵測的項目', 'search folder', '搜尋根目錄', 'spam search folder',
    'conversation action settings', '快速步驟設定', '同步',
}
BODY_MAX_CHARS = 4000  # matches common.MAX_BODY_CHARS; kept local to avoid an extra import


def load_archive_state():
    path = os.path.join(HERE, 'archive_state.json')
    if os.path.exists(path):
        return json.load(open(path))
    return {'done': []}  # list of source ids already fully processed


def save_archive_state(state):
    with open(os.path.join(HERE, 'archive_state.json'), 'w') as f:
        json.dump(state, f, indent=2)


# ── PST → email.message.Message adapter ─────────────────────────────────

def pst_to_email_message(pff_msg):
    try:
        headers = pff_msg.get_transport_headers()
    except OSError:
        headers = None
    if not headers:
        return None
    try:
        msg = email.message_from_string(headers)
    except Exception:
        return None

    # pypff raises OSError (not just None) for a message whose body property
    # is missing/corrupt in the PST's own internal structure — real, seen
    # live on message ~5000 of a 52,803-message folder. Not our bug to fix;
    # treat as "no body available", same as if the property were absent.
    try:
        plain = pff_msg.get_plain_text_body()
    except OSError:
        plain = None
    try:
        html = pff_msg.get_html_body()
    except OSError:
        html = None
    if isinstance(plain, bytes):
        plain = plain.decode('utf-8', errors='replace')
    if isinstance(html, bytes):
        html = html.decode('utf-8', errors='replace')

    if plain:
        body = plain
    elif html:
        from common import html_to_text
        body = html_to_text(html)
    else:
        body = ''

    # Overwrite whatever Content-Type the original headers implied (often
    # application/ms-tnef for Outlook-internal formatting) — the body above
    # is already plain text regardless of the original wire format.
    if msg.is_multipart():
        # rare for a PST-sourced header block, but if present, don't fight
        # the existing MIME structure — just note the body couldn't attach
        for part in msg.walk():
            if part.get_content_type() in ('text/plain', 'text/html'):
                break
        else:
            msg.set_payload(body)
    else:
        del msg['Content-Type']
        msg['Content-Type'] = 'text/plain; charset=utf-8'
        msg.set_payload(body.encode('utf-8'), charset='utf-8')

    if not msg.get('Subject') and pff_msg.get_subject():
        msg['Subject'] = pff_msg.get_subject()
    return msg


def walk_pst_folder(folder, path=''):
    """Yields (path, pypff.message) for every message in every non-blocked
    folder under `folder`, recursively."""
    name = folder.get_name() or ''
    if name.strip().lower() in FOLDER_BLOCKLIST:
        return
    here = f'{path}/{name}' if path else name

    n = folder.get_number_of_sub_messages()
    for i in range(n):
        try:
            yield here, folder.get_sub_message(i)
        except OSError:
            continue  # a handful of PST records are known-corrupt in practice; skip, don't abort the run

    for i in range(folder.get_number_of_sub_folders()):
        yield from walk_pst_folder(folder.get_sub_folder(i), here)


def process_pst(which, fs, customer_index, state, log, rescan=False, contact_index=None):
    path = PST_FILES[which]
    if not os.path.exists(path):
        log(f'[skip] {path} not found')
        return

    pst = pypff.file()
    pst.open(path)
    root = pst.get_root_folder()

    # collect leaf folders up front so each is its own resumable/checkpointed unit
    folders = []
    def collect(folder, path=''):
        name = folder.get_name() or ''
        if name.strip().lower() in FOLDER_BLOCKLIST:
            return
        here = f'{path}/{name}' if path else name
        if folder.get_number_of_sub_messages() > 0:
            folders.append((here, folder))
        for i in range(folder.get_number_of_sub_folders()):
            collect(folder.get_sub_folder(i), here)
    for i in range(root.get_number_of_sub_folders()):
        collect(root.get_sub_folder(i))

    log(f'{which}.pst: {len(folders)} folder(s) with messages to scan\n')

    for folder_path, folder in folders:
        source_id = f'pst:{which}:{folder_path}'
        if source_id in state['done'] and not rescan:
            continue

        n = folder.get_number_of_sub_messages()
        msgs = []
        skipped = 0
        t0 = time.time()
        for i in range(n):
            try:
                pff_msg = folder.get_sub_message(i)
                msg = pst_to_email_message(pff_msg)
            except OSError:
                # pst_to_email_message already guards the specific properties
                # known to raise (transport_headers, plain/html body) — this
                # is a backstop against whatever the next one turns out to
                # be, on a folder that can take an hour-plus to scan. Skip
                # the one message, not the whole run.
                skipped += 1
                continue
            if msg is None:
                skipped += 1
                continue
            msgs.append(msg)
            if (i + 1) % 5000 == 0:
                log(f'  [{folder_path}] read {i + 1}/{n}...')

        log(f'[{folder_path}] {len(msgs)} readable of {n} ({skipped} skipped) in {time.time()-t0:.0f}s — matching...')
        match_and_upsert(fs, customer_index, msgs, source=f'pst:{which}', log=log, contact_index=contact_index)

        if source_id not in state['done']:
            state['done'].append(source_id)
        save_archive_state(state)

    pst.close()


def process_mbox(fs, customer_index, state, log, rescan=False, contact_index=None):
    mbox_dirs = sorted(glob.glob(os.path.join(ARCHIVE_DIR, '*.mbox')))
    for mbox_dir in mbox_dirs:
        mbox_file = os.path.join(mbox_dir, 'mbox')
        if not os.path.exists(mbox_file):
            continue
        source_id = f'mbox:{os.path.basename(mbox_dir)}'
        if source_id in state['done'] and not rescan:
            continue

        log(f'\n{os.path.basename(mbox_dir)}...')
        mb = mailbox.mbox(mbox_file)
        msgs = []
        n = len(mb)
        for i, msg in enumerate(mb):
            msgs.append(msg)
            if (i + 1) % 5000 == 0:
                log(f'  read {i + 1}/{n}...')

        log(f'{len(msgs)} messages — matching...')
        match_and_upsert(fs, customer_index, msgs, source='mbox', log=log, contact_index=contact_index)

        if source_id not in state['done']:
            state['done'].append(source_id)
        save_archive_state(state)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mbox', action='store_true', help='process all 5 mbox archives')
    ap.add_argument('--pst', choices=['eddie', 'sales'], help='process one PST file')
    ap.add_argument('--all', action='store_true', help='mbox + both PSTs')
    ap.add_argument('--rescan', action='store_true',
                     help='ignore archive_state.json checkpoints and re-scan everything selected, '
                          'to catch a customer added to Firestore since the archives were first ingested')
    args = ap.parse_args()
    if not (args.mbox or args.pst or args.all):
        ap.error('pass --mbox, --pst eddie/sales, or --all')

    env = load_env()
    if not env.get('ADMIN_EMAIL') or not env.get('ADMIN_PASSWORD'):
        raise SystemExit('Set ADMIN_EMAIL / ADMIN_PASSWORD in email-sync/.env first.')

    def log(msg):
        print(msg)
        sys.stdout.flush()

    log('Signing in...')
    id_token = sign_in(env)
    fs = Firestore(env['FIREBASE_PROJECT_ID'], id_token, refresh_token_fn=lambda: sign_in(env))

    log('Loading customer directory...')
    customer_index = load_customer_index(fs)
    log(f'  {len(customer_index)} customers with at least one contact email')
    # V8.9 — marketing_contacts alongside customers, same as sync.py.
    contact_index = load_marketing_contact_index(fs)
    log(f'  {len(contact_index)} marketing_contacts (not already linked to a customer) with an email\n')

    state = load_archive_state()

    if args.mbox or args.all:
        process_mbox(fs, customer_index, state, log, rescan=args.rescan, contact_index=contact_index)
    if args.pst or args.all:
        which_list = [args.pst] if args.pst else ['eddie', 'sales']
        for which in which_list:
            process_pst(which, fs, customer_index, state, log, rescan=args.rescan, contact_index=contact_index)

    log('\nDone.')


if __name__ == '__main__':
    main()
