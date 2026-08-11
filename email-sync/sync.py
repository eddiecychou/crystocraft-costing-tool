#!/usr/bin/env python3
"""V8.1 email ingestion, Phase 2 architecture steps 1-3 (live IMAP source
only — PST ingestion is a separate, later script once the PST files are
actually reachable; see PROJECT-PLAN.md's V8.1 entry).

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
always summarizing whatever's actually been ingested) and PST parsing.

Usage: python3 sync.py
Reads email-sync/.env — IMAP + Firebase Web API key + an admin user's own
email/password (used only to mint a short-lived ID token via Firebase Auth,
exactly like the browser app itself does; never stored beyond this process).
"""
import email
import email.utils
import hashlib
import imaplib
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
BACKFILL_DAYS = 90
FOLDERS = ['INBOX', 'INBOX.Sent Messages']
OWN_DOMAINS = {'uart.com.hk', 'crystocraft.com'}
# Free/webmail domains are never a valid signal for "same company, different
# person" — found live: a customer with one @gmail.com contact was pulling
# in every unrelated @gmail.com sender in the mailbox as a "domain match".
# These get exact-contact-email matching only, same as any other address.
FREEMAIL_DOMAINS = {
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com',
    'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
    'aol.com', 'protonmail.com', 'proton.me', 'gmx.com', 'mail.com', 'qq.com',
    '163.com', '126.com', 'yeah.net', 'foxmail.com', 'naver.com',
}
MAX_BODY_CHARS = 4000
MAX_MESSAGES_PER_THREAD_DOC = 200  # defensive cap, Firestore doc size limit


# ── env / state ──────────────────────────────────────────────────────────

def load_env():
    env = {}
    with open(os.path.join(HERE, '.env')) as f:
        for line in f:
            line = line.strip()
            if line and '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k] = v
    return env


def load_state():
    path = os.path.join(HERE, 'state.json')
    if os.path.exists(path):
        return json.load(open(path))
    return {'uids': {}}  # folder -> last synced UID (int)


def save_state(state):
    with open(os.path.join(HERE, 'state.json'), 'w') as f:
        json.dump(state, f, indent=2)


# ── Firebase Auth + Firestore REST ──────────────────────────────────────

def sign_in(env):
    url = f'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={env["FIREBASE_WEB_API_KEY"]}'
    body = json.dumps({
        'email': env['ADMIN_EMAIL'], 'password': env['ADMIN_PASSWORD'], 'returnSecureToken': True,
    }).encode()
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise SystemExit(f'Firebase sign-in failed: {e.read().decode()}')
    return data['idToken']


def to_fs_value(v):
    if v is None:
        return {'nullValue': None}
    if isinstance(v, bool):
        return {'booleanValue': v}
    if isinstance(v, int):
        return {'integerValue': str(v)}
    if isinstance(v, float):
        return {'doubleValue': v}
    if isinstance(v, str):
        return {'stringValue': v}
    if isinstance(v, list):
        return {'arrayValue': {'values': [to_fs_value(x) for x in v]}}
    if isinstance(v, dict):
        return {'mapValue': {'fields': {k: to_fs_value(x) for k, x in v.items()}}}
    return {'stringValue': str(v)}


def from_fs_value(v):
    if 'nullValue' in v:
        return None
    if 'booleanValue' in v:
        return v['booleanValue']
    if 'integerValue' in v:
        return int(v['integerValue'])
    if 'doubleValue' in v:
        return v['doubleValue']
    if 'stringValue' in v:
        return v['stringValue']
    if 'arrayValue' in v:
        return [from_fs_value(x) for x in v['arrayValue'].get('values', [])]
    if 'mapValue' in v:
        return {k: from_fs_value(x) for k, x in v['mapValue'].get('fields', {}).items()}
    return None


class Firestore:
    def __init__(self, project_id, id_token):
        self.base = f'https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents'
        self.token = id_token

    def _req(self, method, path, body=None, params=''):
        url = f'{self.base}/{path}{params}'
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={
            'Authorization': f'Bearer {self.token}', 'Content-Type': 'application/json',
        })
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise RuntimeError(f'{method} {path} -> {e.code}: {e.read().decode()[:300]}')

    def get(self, path):
        return self._req('GET', path)

    def list_all(self, collection_path, page_size=300):
        out = []
        params = f'?pageSize={page_size}'
        while True:
            data = self._req('GET', collection_path, params=params)
            if not data:
                break
            out.extend(data.get('documents', []))
            token = data.get('nextPageToken')
            if not token:
                break
            params = f'?pageSize={page_size}&pageToken={token}'
        return out

    def set_fields(self, doc_path, fields_dict):
        mask = '&'.join(f'updateMask.fieldPaths={k}' for k in fields_dict)
        body = {'fields': {k: to_fs_value(v) for k, v in fields_dict.items()}}
        self._req('PATCH', doc_path, body=body, params=f'?{mask}')


# ── IMAP fetch (same parsing approach as the Phase 1 spike) ─────────────

def decode(s):
    if not s:
        return ''
    out = []
    for text, enc in decode_header(s):
        out.append(text.decode(enc or 'utf-8', errors='replace') if isinstance(text, bytes) else text)
    return ''.join(out)


class _TextExtractor(HTMLParser):
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


def _decode_part(part):
    try:
        payload = part.get_payload(decode=True)
        charset = part.get_content_charset() or 'utf-8'
        return payload.decode(charset, errors='replace')
    except Exception:
        return ''


def get_body(msg):
    plain, html = None, None
    if msg.is_multipart():
        for part in msg.walk():
            if 'attachment' in str(part.get('Content-Disposition') or ''):
                continue
            ctype = part.get_content_type()
            if ctype == 'text/plain' and plain is None:
                plain = _decode_part(part)
            elif ctype == 'text/html' and html is None:
                html = _decode_part(part)
    else:
        if msg.get_content_type() == 'text/plain':
            plain = _decode_part(msg)
        elif msg.get_content_type() == 'text/html':
            html = _decode_part(msg)
    return (plain or (html_to_text(html) if html else '')).strip()


def addr_list(header_val):
    if not header_val:
        return []
    return [addr.lower() for _, addr in email.utils.getaddresses([header_val]) if addr]


def normalize_subject(subj):
    return re.sub(r'^\s*(re|fwd?|fw)\s*:\s*', '', subj or '', flags=re.I).strip().lower()


def fetch_new_messages(M, folder, last_uid):
    typ, _ = M.select(folder, readonly=True)
    if typ != 'OK':
        print(f'  [skip] could not select {folder}')
        return [], last_uid

    if last_uid:
        typ, data = M.uid('search', None, f'UID {last_uid + 1}:*')
    else:
        since = (datetime.now(timezone.utc) - timedelta(days=BACKFILL_DAYS)).strftime('%d-%b-%Y')
        typ, data = M.uid('search', None, f'(SINCE {since})')

    if typ != 'OK' or not data or not data[0]:
        return [], last_uid

    uids = [int(u) for u in data[0].split()]
    # a bare "UID N:*" search with nothing newer than N returns [N] itself on
    # some servers (Dovecot included) rather than an empty set — drop it
    if last_uid:
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


# ── customer matching ────────────────────────────────────────────────────

def load_customer_index(fs):
    """customerId -> {'emails': set(), 'domains': set(), 'name': str}"""
    docs = fs.list_all('customers')
    index = {}
    for d in docs:
        cid = d['name'].rsplit('/', 1)[-1]
        fields = from_fs_value({'mapValue': {'fields': d.get('fields', {})}})
        emails, domains = set(), set()
        contacts = fields.get('contacts') or []
        for c in contacts:
            e = (c.get('email') or '').strip().lower()
            if e:
                emails.add(e)
                d = e.split('@', 1)[1] if '@' in e else ''
                if d and d not in FREEMAIL_DOMAINS:
                    domains.add(d)
        # legacy fallback, pre-contacts[] records (see domain/customer.js contactsOf())
        for legacy_key in ('contact_email', 'contact_emails'):
            v = fields.get(legacy_key)
            legacy_vals = v if isinstance(v, list) else ([v] if v else [])
            for e in legacy_vals:
                e = (e or '').strip().lower()
                if e:
                    emails.add(e)
                    d = e.split('@', 1)[1] if '@' in e else ''
                    if d and d not in FREEMAIL_DOMAINS:
                        domains.add(d)
        if emails:
            index[cid] = {'emails': emails, 'domains': domains, 'name': fields.get('company_name') or fields.get('name') or cid}
    return index


def match_customer(participants, customer_index):
    """Returns (customerId, match_reason, matched_email) or None. Exact
    contact-email match wins over a same-domain fallback match."""
    domain_hit = None
    for addr in participants:
        if '@' not in addr:
            continue
        domain = addr.split('@', 1)[1]
        if domain in OWN_DOMAINS:
            continue
        for cid, info in customer_index.items():
            if addr in info['emails']:
                return cid, 'contact', addr
            if domain_hit is None and domain in info['domains']:
                domain_hit = (cid, 'domain', addr)
    return domain_hit


# ── threading + upsert ───────────────────────────────────────────────────

def thread_key(msg):
    refs = msg.get('References', '') or msg.get('In-Reply-To', '') or ''
    ref_ids = re.findall(r'<[^>]+>', refs)
    root = ref_ids[0] if ref_ids else (msg.get('Message-ID', '').strip() or normalize_subject(decode(msg.get('Subject', ''))))
    return hashlib.sha1(root.encode()).hexdigest()[:24]


def msg_record(msg):
    date_hdr = msg.get('Date')
    try:
        dt = email.utils.parsedate_to_datetime(date_hdr) if date_hdr else None
    except Exception:
        dt = None
    return {
        'message_id': msg.get('Message-ID', '').strip(),
        'date': dt.isoformat() if dt else (date_hdr or ''),
        'from': msg.get('From', ''),
        'to': msg.get('To', ''),
        'cc': msg.get('Cc', ''),
        'subject': decode(msg.get('Subject', '')),
        'body_text': get_body(msg)[:MAX_BODY_CHARS],
    }


def upsert_thread(fs, customer_id, tkey, new_records, match_reason, matched_email):
    doc_path = f'customers/{customer_id}/email_threads/{tkey}'
    existing = fs.get(doc_path)
    if existing:
        existing_fields = from_fs_value({'mapValue': {'fields': existing.get('fields', {})}})
        messages = existing_fields.get('messages') or []
        seen = {m.get('message_id') for m in messages if m.get('message_id')}
        for r in new_records:
            if not r['message_id'] or r['message_id'] not in seen:
                messages.append(r)
                seen.add(r['message_id'])
    else:
        messages = new_records

    messages.sort(key=lambda m: m['date'] or '')
    messages = messages[-MAX_MESSAGES_PER_THREAD_DOC:]
    dates = [m['date'] for m in messages if m['date']]

    fs.set_fields(doc_path, {
        'thread_id': tkey,
        'subject': messages[0]['subject'] if messages else '',
        'messages': messages,
        'message_count': len(messages),
        'date_range': [dates[0] if dates else None, dates[-1] if dates else None],
        'match_reason': match_reason,
        'matched_email': matched_email,
        'synced_at': datetime.now(timezone.utc).isoformat(),
    })


def main():
    env = load_env()
    if not env.get('ADMIN_EMAIL') or not env.get('ADMIN_PASSWORD'):
        raise SystemExit('Set ADMIN_EMAIL / ADMIN_PASSWORD in email-sync/.env first (an admin login for this app).')

    print('Signing in...')
    id_token = sign_in(env)
    fs = Firestore(env['FIREBASE_PROJECT_ID'], id_token)

    print('Loading customer directory...')
    customer_index = load_customer_index(fs)
    print(f'  {len(customer_index)} customers with at least one contact email')

    state = load_state()
    print(f'\nConnecting to {env["IMAP_HOST"]}...')
    M = imaplib.IMAP4_SSL(env['IMAP_HOST'], int(env['IMAP_PORT']))
    M.login(env['IMAP_USER'], env['IMAP_PASS'])

    all_new_msgs = []
    for folder in FOLDERS:
        print(f'Fetching {folder}...')
        last_uid = state['uids'].get(folder, 0)
        msgs, new_last_uid = fetch_new_messages(M, folder, last_uid)
        all_new_msgs.extend(msgs)
        if new_last_uid and new_last_uid != last_uid:
            state['uids'][folder] = new_last_uid
    M.close()
    M.logout()

    print(f'\n{len(all_new_msgs)} new message(s) total. Matching against customers...')

    # group new messages by (customer, thread_key) before upserting, so a
    # thread with 2 new messages in this run only reads/writes its Firestore
    # doc once
    buckets = {}  # (customer_id, tkey) -> {'records': [...], 'reason':, 'email':}
    matched_count = 0
    for msg in all_new_msgs:
        participants = set(addr_list(msg.get('From')) + addr_list(msg.get('To')) + addr_list(msg.get('Cc')))
        hit = match_customer(participants, customer_index)
        if not hit:
            continue
        cid, reason, addr = hit
        matched_count += 1
        tkey = thread_key(msg)
        key = (cid, tkey)
        if key not in buckets:
            buckets[key] = {'records': [], 'reason': reason, 'email': addr}
        buckets[key]['records'].append(msg_record(msg))

    print(f'{matched_count} of {len(all_new_msgs)} new messages matched a customer -> {len(buckets)} thread(s) touched\n')

    for (cid, tkey), b in buckets.items():
        name = customer_index.get(cid, {}).get('name', cid)
        print(f'  {name}: +{len(b["records"])} message(s) ({b["reason"]} match on {b["email"]})')
        upsert_thread(fs, cid, tkey, b['records'], b['reason'], b['email'])

    save_state(state)
    print('\nDone. State saved to state.json (per-folder last UID).')


if __name__ == '__main__':
    main()
