#!/usr/bin/env python3
"""Shared logic for V8.1 email ingestion — Firestore REST auth/access,
customer matching, thread grouping, and upsert. Used by both sync.py (live
IMAP) and archive_import.py (PST/mbox historical archives) so the two
sources are guaranteed to write threads in the exact same shape and match
customers the exact same way. See sync.py's module docstring for the full
architecture description.
"""
import email
import email.utils
import hashlib
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.header import decode_header
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
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


# ── env ──────────────────────────────────────────────────────────────────

def load_env():
    env = {}
    with open(os.path.join(HERE, '.env')) as f:
        for line in f:
            line = line.strip()
            if line and '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k] = v
    return env


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
    # A PST-scale import runs well past an hour — Firebase ID tokens expire
    # after 60 minutes, so a long run needs to re-sign-in partway through,
    # not just once at startup like sync.py's much shorter runs get away with.
    def __init__(self, project_id, id_token, refresh_token_fn=None):
        self.base = f'https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents'
        self.token = id_token
        self.refresh_token_fn = refresh_token_fn

    def _req(self, method, path, body=None, params='', _retried=False):
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
            if e.code == 401 and self.refresh_token_fn and not _retried:
                self.token = self.refresh_token_fn()
                return self._req(method, path, body=body, params=params, _retried=True)
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


# ── message parsing helpers (shared by IMAP bytes and PST/mbox adapters) ──

def decode(s):
    if not s:
        return ''
    out = []
    for text, enc in decode_header(s):
        if not isinstance(text, bytes):
            out.append(text)
            continue
        # Old mail (seen in the 2018-era mbox archives) sometimes carries a
        # charset label like "unknown-8bit" that decode_header happily
        # returns but isn't a real Python codec — LookupError, not
        # UnicodeDecodeError, so it wasn't caught by errors='replace' alone.
        try:
            out.append(text.decode(enc or 'utf-8', errors='replace'))
        except LookupError:
            out.append(text.decode('utf-8', errors='replace'))
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
    """msg: an email.message.Message (from IMAP bytes or mbox). PST messages
    don't have a MIME body attached to their headers — see
    archive_import.py's pst_msg_record(), which sources the body from
    pypff's own get_plain_text_body()/get_html_body() instead and never
    calls this."""
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


def msg_record(msg):
    """msg: an email.message.Message. Used directly by sync.py (IMAP) and by
    archive_import.py for mbox messages (mailbox.mbox already yields these).
    PST messages build the equivalent dict by hand — see pst_msg_record()."""
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


def thread_key_from_headers(message_id, references_or_reply_to, subject):
    ref_ids = re.findall(r'<[^>]+>', references_or_reply_to or '')
    root = ref_ids[0] if ref_ids else ((message_id or '').strip() or normalize_subject(subject))
    return hashlib.sha1(root.encode()).hexdigest()[:24]


def thread_key(msg):
    refs = msg.get('References', '') or msg.get('In-Reply-To', '') or ''
    return thread_key_from_headers(msg.get('Message-ID', ''), refs, decode(msg.get('Subject', '')))


# ── customer matching ────────────────────────────────────────────────────

def load_customer_index(fs):
    """customerId -> {'emails': set(), 'domains': set(), 'name': str}"""
    docs = fs.list_all('customers')
    index = {}
    for doc in docs:
        cid = doc['name'].rsplit('/', 1)[-1]
        fields = from_fs_value({'mapValue': {'fields': doc.get('fields', {})}})
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


# V8.9 — email-sync extended to marketing_contacts. A live check (2026-08-23)
# found 116 mailbox addresses exact-matching a marketing_contacts email, 60
# of them NOT already linked to a customer (i.e. genuinely invisible to
# email-sync until now — messages to/from them were silently discarded by
# match_and_upsert's `if not hit: continue`). Contacts already linked to a
# customer (possible_customer_match set) are deliberately EXCLUDED from this
# index — that person already gets matched via load_customer_index above
# (same email, on their customer record), and including them here too would
# just create a second, redundant email_threads copy under the contact doc
# they've already "graduated" out of (see contactToEntity's own exclusion
# for the same reasoning, DailyDrafts.jsx).
def load_marketing_contact_index(fs):
    """contactId -> {'emails': set(), 'domains': set(), 'name': str}"""
    docs = fs.list_all('marketing_contacts')
    index = {}
    for doc in docs:
        cid = doc['name'].rsplit('/', 1)[-1]
        fields = from_fs_value({'mapValue': {'fields': doc.get('fields', {})}})
        if fields.get('possible_customer_match'):
            continue
        e = (fields.get('email') or '').strip().lower()
        if not e:
            continue
        d = e.split('@', 1)[1] if '@' in e else ''
        domains = {d} if d and d not in FREEMAIL_DOMAINS else set()
        name = ' '.join(x for x in [fields.get('first_name'), fields.get('last_name')] if x).strip() \
            or fields.get('company') or e
        index[cid] = {'emails': {e}, 'domains': domains, 'name': name}
    return index


def match_entity(participants, customer_index, contact_index=None):
    """Returns (collection, entityId, match_reason, matched_email) or None.
    Priority: exact customer match > exact contact match > customer domain
    match > contact domain match — a customer record outranks a
    marketing_contacts one at every tier, since it's the more authoritative/
    complete record when both could plausibly apply."""
    contact_index = contact_index or {}
    domain_hit = None
    for addr in participants:
        if '@' not in addr:
            continue
        domain = addr.split('@', 1)[1]
        if domain in OWN_DOMAINS:
            continue
        for cid, info in customer_index.items():
            if addr in info['emails']:
                return 'customers', cid, 'contact', addr
        for mcid, info in contact_index.items():
            if addr in info['emails']:
                return 'marketing_contacts', mcid, 'contact', addr
        if domain_hit is None:
            for cid, info in customer_index.items():
                if domain in info['domains']:
                    domain_hit = ('customers', cid, 'domain', addr)
                    break
        if domain_hit is None:
            for mcid, info in contact_index.items():
                if domain in info['domains']:
                    domain_hit = ('marketing_contacts', mcid, 'domain', addr)
                    break
    return domain_hit


# ── upsert ────────────────────────────────────────────────────────────────

def upsert_thread(fs, collection, entity_id, tkey, new_records, match_reason, matched_email, source):
    doc_path = f'{collection}/{entity_id}/email_threads/{tkey}'
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
        'source': source,  # 'imap' | 'pst' | 'mbox' — last writer wins, informational only
    })


def match_and_upsert(fs, customer_index, msgs, source, log=print, contact_index=None):
    """Shared by sync.py and archive_import.py: group messages by
    (collection, entity, thread) so a thread touched by several messages in
    one run only costs one Firestore GET+PATCH, then upsert each. `msgs` is
    a list of real email.message.Message objects — IMAP/mbox produce these
    natively; archive_import.py builds an equivalent one for each PST
    message (headers parsed from pypff's transport_headers, body injected
    as the payload) specifically so thread_key()/msg_record() below need no
    per-source special-casing. Returns (matched_count, threads_touched_count).

    `contact_index` (V8.9, optional) — marketing_contacts alongside
    customers, see load_marketing_contact_index()/match_entity() above. A
    caller that doesn't pass one keeps the original customers-only
    behavior, so this stays backward compatible rather than a breaking
    signature change."""
    buckets = {}  # (collection, entity_id, tkey) -> {'records': [...], 'reason':, 'email':}
    matched_count = 0
    for msg in msgs:
        participants = set(addr_list(msg.get('From')) + addr_list(msg.get('To')) + addr_list(msg.get('Cc')))
        hit = match_entity(participants, customer_index, contact_index)
        if not hit:
            continue
        collection, eid, reason, addr = hit
        matched_count += 1
        tkey = thread_key(msg)
        key = (collection, eid, tkey)
        if key not in buckets:
            buckets[key] = {'records': [], 'reason': reason, 'email': addr}
        buckets[key]['records'].append(msg_record(msg))

    log(f'{matched_count} of {len(msgs)} messages matched -> {len(buckets)} thread(s) touched\n')

    index_by_collection = {'customers': customer_index, 'marketing_contacts': contact_index or {}}
    for (collection, eid, tkey), b in buckets.items():
        name = index_by_collection[collection].get(eid, {}).get('name', eid)
        label = 'customer' if collection == 'customers' else 'lead'
        log(f'  {name} ({label}): +{len(b["records"])} message(s) ({b["reason"]} match on {b["email"]})')
        upsert_thread(fs, collection, eid, tkey, b['records'], b['reason'], b['email'], source)

    # Stamp a cheap boolean on the PARENT doc, once per entity touched this
    # run (not once per thread — owner asked directly "how do I know which
    # leads have email history" with no way to answer it short of opening
    # each of 2,635 contacts one at a time or grepping this log). Read by
    # MarketingContacts.jsx to badge the list; customers/ gets the same flag
    # for consistency even though that page doesn't surface it yet.
    for collection, eid in {(c, e) for (c, e, _tkey) in buckets}:
        fs.set_fields(f'{collection}/{eid}', {'has_email_threads': True})

    return matched_count, len(buckets)
