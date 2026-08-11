#!/usr/bin/env python3
"""V8.1 email ingestion spike, Phase 1 steps 1-2: connect to the live IMAP
mailbox and produce a deterministic (no AI) envelope + thread grouping for a
handful of named customers, as local JSON — see PROJECT-PLAN.md's "Where
V8.1 starts" and the owner-approved plan this came from.

Deliberately NOT wired to Firestore or any UI. Output is local JSON files
under data/ (gitignored) for a human (or the next script, summarize.py) to
read. Stdlib only (imaplib/email) — no pip install needed.

Usage: python3 fetch_threads.py
Reads IMAP_HOST/IMAP_PORT/IMAP_USER/IMAP_PASS from .env in this directory.
"""
import email
import email.utils
import imaplib
import json
import os
import re
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
DAYS_BACK = 90  # plan said "~month"; widened since not every customer emails monthly

# name -> list of match tokens (domains or exact addresses, lowercase)
CUSTOMERS = {
    'widdop-bingham': ['widdop.co.uk'],
    'marco-polo': ['biuro@marcopolosc.pl'],
    'dawid-reiter': ['dawid@sovenir.pl'],
    'sunlife': ['karina.sy.cheng@sunlife.com'],
    'detesk': ['veronika.fojtikova@detesk.cz'],
}

FOLDERS = ['INBOX', 'INBOX.Sent Messages']


def load_env():
    env = {}
    with open(os.path.join(HERE, '.env')) as f:
        for line in f:
            line = line.strip()
            if line and '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k] = v
    return env


def decode(s):
    if not s:
        return ''
    parts = decode_header(s)
    out = []
    for text, enc in parts:
        if isinstance(text, bytes):
            out.append(text.decode(enc or 'utf-8', errors='replace'))
        else:
            out.append(text)
    return ''.join(out)


class _TextExtractor(HTMLParser):
    """Crude HTML->text fallback for the rare message with no text/plain
    part. Not meant to be a real renderer — just enough for DeepSeek to read
    the words, since layout doesn't matter for summarization."""
    def __init__(self):
        super().__init__()
        self.chunks = []
    def handle_data(self, data):
        self.chunks.append(data)
    def text(self):
        return ' '.join(self.chunks)


def html_to_text(html):
    p = _TextExtractor()
    try:
        p.feed(html)
    except Exception:
        pass
    return re.sub(r'\s+', ' ', p.text()).strip()


def get_body(msg):
    plain, html = None, None
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            disp = str(part.get('Content-Disposition') or '')
            if 'attachment' in disp:
                continue
            if ctype == 'text/plain' and plain is None:
                plain = _decode_part(part)
            elif ctype == 'text/html' and html is None:
                html = _decode_part(part)
    else:
        if msg.get_content_type() == 'text/plain':
            plain = _decode_part(msg)
        elif msg.get_content_type() == 'text/html':
            html = _decode_part(msg)
    if plain:
        return plain.strip()
    if html:
        return html_to_text(html)
    return ''


def _decode_part(part):
    try:
        payload = part.get_payload(decode=True)
        charset = part.get_content_charset() or 'utf-8'
        return payload.decode(charset, errors='replace')
    except Exception:
        return ''


def addr_list(header_val):
    if not header_val:
        return []
    return [addr.lower() for _, addr in email.utils.getaddresses([header_val]) if addr]


def matches_customer(tokens, addrs):
    for addr in addrs:
        for tok in tokens:
            if '@' in tok:
                if addr == tok:
                    return True
            elif addr.endswith('@' + tok) or addr.endswith('.' + tok):
                return True
    return False


def normalize_subject(subj):
    return re.sub(r'^\s*(re|fwd?|fw)\s*:\s*', '', subj or '', flags=re.I).strip().lower()


def fetch_all_messages(M, folder, since_str):
    typ, _ = M.select(folder, readonly=True)
    if typ != 'OK':
        print(f'  [skip] could not select {folder}')
        return []
    typ, data = M.search(None, f'(SINCE {since_str})')
    if typ != 'OK' or not data or not data[0]:
        return []
    ids = data[0].split()
    print(f'  {folder}: {len(ids)} messages since {since_str}')
    out = []
    for i, num in enumerate(ids):
        typ, msg_data = M.fetch(num, '(RFC822)')
        if typ != 'OK' or not msg_data or not msg_data[0]:
            continue
        raw = msg_data[0][1]
        msg = email.message_from_bytes(raw)
        out.append(msg)
    return out


def main():
    env = load_env()
    since_str = (datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)).strftime('%d-%b-%Y')

    print(f'Connecting to {env["IMAP_HOST"]}...')
    M = imaplib.IMAP4_SSL(env['IMAP_HOST'], int(env['IMAP_PORT']))
    M.login(env['IMAP_USER'], env['IMAP_PASS'])
    print('Logged in.\n')

    all_msgs = []
    seen_message_ids = set()
    for folder in FOLDERS:
        print(f'Fetching {folder}...')
        for msg in fetch_all_messages(M, folder, since_str):
            mid = msg.get('Message-ID', '').strip()
            if mid and mid in seen_message_ids:
                continue  # dedupe INBOX.Sent vs INBOX.Sent Messages (same underlying folder)
            if mid:
                seen_message_ids.add(mid)
            all_msgs.append(msg)
    M.logout()
    print(f'\nTotal unique messages fetched: {len(all_msgs)}\n')

    os.makedirs(os.path.join(HERE, 'data'), exist_ok=True)
    manifest = {}

    for slug, tokens in CUSTOMERS.items():
        matched = []
        for msg in all_msgs:
            from_addrs = addr_list(msg.get('From'))
            to_addrs = addr_list(msg.get('To'))
            cc_addrs = addr_list(msg.get('Cc'))
            if matches_customer(tokens, from_addrs + to_addrs + cc_addrs):
                matched.append(msg)

        # Thread grouping: Message-ID -> record; walk References/In-Reply-To
        # to find each message's thread root, falling back to normalized
        # subject when a message has no threading headers at all (common
        # with some webmail/forwarded mail).
        records = []
        for msg in matched:
            mid = msg.get('Message-ID', '').strip()
            refs = msg.get('References', '') or msg.get('In-Reply-To', '') or ''
            ref_ids = re.findall(r'<[^>]+>', refs)
            date_hdr = msg.get('Date')
            try:
                dt = email.utils.parsedate_to_datetime(date_hdr) if date_hdr else None
            except Exception:
                dt = None
            records.append({
                'message_id': mid,
                'in_reply_to_chain': ref_ids,
                'subject': decode(msg.get('Subject', '')),
                'norm_subject': normalize_subject(decode(msg.get('Subject', ''))),
                'from': msg.get('From', ''),
                'to': msg.get('To', ''),
                'cc': msg.get('Cc', ''),
                'date': dt.isoformat() if dt else date_hdr,
                'body_text': get_body(msg)[:8000],  # cap per message; DeepSeek pass will chunk if needed
            })

        # Union by message-id reference chain, else by normalized subject
        by_mid = {r['message_id']: r for r in records if r['message_id']}
        thread_of = {}
        threads = []

        def find_thread(mid):
            seen = set()
            cur = mid
            while cur in thread_of and thread_of[cur] not in seen:
                seen.add(cur)
                cur = thread_of[cur]
            return cur

        for r in records:
            root = None
            for ref in r['in_reply_to_chain']:
                if ref in by_mid or ref in thread_of:
                    root = find_thread(ref)
                    break
            if root is None and r['message_id']:
                # fall back to matching an existing thread with same normalized subject
                for t in threads:
                    if t['norm_subject'] and t['norm_subject'] == r['norm_subject']:
                        root = t['thread_id']
                        break
            if root is None:
                root = r['message_id'] or f'no-id-{len(threads)}'
                threads.append({'thread_id': root, 'norm_subject': r['norm_subject'], 'messages': []})
            if r['message_id']:
                thread_of[r['message_id']] = root
            target = next((t for t in threads if t['thread_id'] == root), None)
            if target is None:
                target = {'thread_id': root, 'norm_subject': r['norm_subject'], 'messages': []}
                threads.append(target)
            target['messages'].append(r)

        for t in threads:
            t['messages'].sort(key=lambda r: r['date'] or '')
            t['subject'] = t['messages'][0]['subject'] if t['messages'] else ''
            t['message_count'] = len(t['messages'])
            t['date_range'] = [t['messages'][0]['date'], t['messages'][-1]['date']] if t['messages'] else [None, None]
            del t['norm_subject']

        threads.sort(key=lambda t: t['date_range'][1] or '', reverse=True)

        out_path = os.path.join(HERE, 'data', f'{slug}.json')
        with open(out_path, 'w') as f:
            json.dump({'customer': slug, 'match_tokens': tokens, 'thread_count': len(threads), 'threads': threads}, f, indent=2)

        manifest[slug] = {'matched_messages': len(matched), 'threads': len(threads)}
        print(f'{slug}: {len(matched)} messages -> {len(threads)} threads -> {out_path}')

    with open(os.path.join(HERE, 'data', '_manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)

    print('\nDone.')


if __name__ == '__main__':
    main()
