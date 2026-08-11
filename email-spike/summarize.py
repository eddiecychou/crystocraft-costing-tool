#!/usr/bin/env python3
"""V8.1 email ingestion spike, Phase 1 step 3: DeepSeek structuring over the
deterministic thread data fetch_threads.py already produced.

Two things per customer, same as the plan:
  1. A summary (what's discussed, recent activity, open commitments).
  2. One "discover more" style question answered from the raw threads —
     a stand-in for the real chat UI, same retrieval approach (all matched
     threads in context) since volume is small enough at spike scale. A real
     Phase 2 build needs a proper retrieval strategy once volume grows past
     what fits in one prompt — this isn't it, deliberately, per the plan.

No Firestore, no UI — stdlib + a direct DeepSeek API call (urllib, no pip
install), output as data/{slug}_summary.json plus a human-readable printout
for the owner review step.

Usage: python3 summarize.py
"""
import json
import os
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
MAX_THREADS_PER_CUSTOMER = 30
MAX_BODY_CHARS = 1200

TEST_QUESTIONS = {
    'widdop-bingham': 'What did we last discuss with Widdop Bingham, and is anything still outstanding?',
    'marco-polo': 'What did we last discuss with Marco Polo, and is anything still outstanding?',
    'dawid-reiter': 'What did we last discuss with Dawid Reiter, and is anything still outstanding?',
    'sunlife': 'What did we last discuss with Sunlife, and is anything still outstanding?',
    'detesk': 'What did we last discuss with Detesk, and is anything still outstanding?',
}

SUMMARY_SYSTEM = (
    'You are reading a real B2B sales email history between Crystocraft (a corporate gift/crystal '
    'products supplier) and one of its customers, exported from the sales owner\'s live mailbox. '
    'Read the threads and produce a factual summary for the owner to review before a sales call. '
    'Do not invent facts not present in the emails. Return ONLY a valid JSON object: '
    '{ "summary": "2-4 sentence overview of the relationship and what is generally discussed", '
    '"recent_activity": "1-3 sentences on what happened most recently, with rough dates", '
    '"open_commitments": ["short bullet", "..."] }'
)

QA_SYSTEM = (
    'You are answering a question about a real B2B customer using their raw email thread history, '
    'exported from the sales owner\'s live mailbox. Answer ONLY from what is actually in the threads '
    'below — if the answer isn\'t there, say so plainly rather than guessing. Cite rough dates when '
    'relevant. Return ONLY a valid JSON object: { "answer": "2-5 sentence answer" }'
)


def load_env():
    env = {}
    with open(os.path.join(HERE, '.env')) as f:
        for line in f:
            line = line.strip()
            if line and '=' in line and not line.startswith('#'):
                k, v = line.split('=', 1)
                env[k] = v
    return env


def render_threads(data):
    lines = []
    for t in data['threads'][:MAX_THREADS_PER_CUSTOMER]:
        lines.append(f'\n=== Thread: {t["subject"]} ({t["message_count"]} messages, {t["date_range"][0]} to {t["date_range"][1]}) ===')
        for m in t['messages']:
            body = (m['body_text'] or '').strip()[:MAX_BODY_CHARS]
            lines.append(f'--- {m["date"]} | From: {m["from"]} | To: {m["to"]} ---\n{body}')
    return '\n'.join(lines)


def call_deepseek(api_key, system, user):
    body = json.dumps({
        'model': 'deepseek-chat',
        'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}],
        'response_format': {'type': 'json_object'},
        'temperature': 0.3,
        'max_tokens': 700,
    }).encode()
    req = urllib.request.Request(
        'https://api.deepseek.com/chat/completions',
        data=body,
        headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key}'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    text = data['choices'][0]['message']['content'].strip()
    return json.loads(text)


def main():
    env = load_env()
    api_key = env['DEEPSEEK_API_KEY']

    manifest = json.load(open(os.path.join(HERE, 'data', '_manifest.json')))
    results = {}

    for slug in manifest:
        path = os.path.join(HERE, 'data', f'{slug}.json')
        if not os.path.exists(path):
            continue
        data = json.load(open(path))
        if not data['threads']:
            print(f'{slug}: no threads, skipping')
            continue

        thread_text = render_threads(data)
        print(f'\n{"="*70}\n{slug}  ({data["thread_count"]} threads)\n{"="*70}')

        try:
            summary = call_deepseek(api_key, SUMMARY_SYSTEM, thread_text)
        except Exception as e:
            print(f'  SUMMARY FAILED: {e}')
            summary = {'error': str(e)}

        question = TEST_QUESTIONS.get(slug, 'What did we last discuss with this customer?')
        try:
            qa = call_deepseek(api_key, QA_SYSTEM, f'{thread_text}\n\nQuestion: {question}')
        except Exception as e:
            print(f'  QA FAILED: {e}')
            qa = {'error': str(e)}

        print('\n-- Summary --')
        print(json.dumps(summary, indent=2))
        print(f'\n-- Q&A: "{question}" --')
        print(json.dumps(qa, indent=2))

        results[slug] = {'summary': summary, 'test_question': question, 'test_answer': qa}

    with open(os.path.join(HERE, 'data', '_deepseek_output.json'), 'w') as f:
        json.dump(results, f, indent=2)
    print(f'\n\nSaved full output to data/_deepseek_output.json')


if __name__ == '__main__':
    main()
