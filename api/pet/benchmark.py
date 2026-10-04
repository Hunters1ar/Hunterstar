"""Run on Hunterella; measure port 8090 without touching the CLI or printing keys."""
import http.client
import json
from pathlib import Path
import time

from server import SYSTEM_PROMPT

key = Path('/etc/portfolio-pet/model.key').read_text().strip()
for run in range(2):
    conn = http.client.HTTPConnection('127.0.0.1', 8090, timeout=110)
    start, first, answer, timings = time.monotonic(), None, '', {}
    conn.request('POST', '/v1/chat/completions', json.dumps({
        'model': 'Hunterstar-Pet-Hermes-3',
        'messages': [{'role': 'system', 'content': SYSTEM_PROMPT},
                     {'role': 'user', 'content': 'Say hello and briefly introduce yourself.'}],
        'max_tokens': 60, 'temperature': 0, 'stream': True,
    }), {'Content-Type': 'application/json', 'Authorization': f'Bearer {key}'})
    response = conn.getresponse()
    if response.status != 200:
        raise RuntimeError(f'Benchmark returned HTTP {response.status}')
    completed = False
    while line := response.readline():
        if not line.startswith(b'data:'):
            continue
        raw = line[5:].strip()
        if raw == b'[DONE]':
            completed = True
            break
        data = json.loads(raw)
        timings = data.get('timings', timings)
        for choice in data.get('choices', []):
            token = choice.get('delta', {}).get('content', '')
            if token:
                first = first or time.monotonic()
                answer += token
    if not completed or not answer:
        raise RuntimeError('Benchmark stream was incomplete')
    print(json.dumps({'run': run + 1, 'firstTokenSeconds': round(first - start, 3),
                      'totalSeconds': round(time.monotonic() - start, 3),
                      'timings': timings, 'answer': answer}), flush=True)
    conn.close()
