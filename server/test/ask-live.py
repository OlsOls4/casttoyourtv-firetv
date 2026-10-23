#!/usr/bin/env python3
"""Live /api/ask checks (not part of `npm test`): latency/provider mix and the no-dialogue spoiler guard.

usage: python3 server/test/ask-live.py https://casttoyourtv-firetv.vercel.app [n=8]
"""
import json, re, statistics, sys, time, urllib.request

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'https://casttoyourtv-firetv.vercel.app'
N = int(sys.argv[2]) if len(sys.argv) > 2 else 8


def post(body):
    r = urllib.request.Request(BASE + '/api/ask', data=json.dumps(body).encode(), headers={'content-type': 'application/json'})
    t0 = time.time()
    with urllib.request.urlopen(r, timeout=30) as resp:
        j = json.loads(resp.read())
    j['_wall'] = int((time.time() - t0) * 1000)
    return j


def cues():
    srt = urllib.request.urlopen(BASE + '/media/sintel_en.srt', timeout=15).read().decode()
    out = []
    for b in re.split(r'\n\s*\n', srt.replace('\r', '')):
        lines = b.strip().split('\n')
        for i, l in enumerate(lines):
            if '-->' in l:
                a, z = [x.strip().replace(',', '.') for x in l.split('-->')]
                f = lambda x: sum(float(p) * m for p, m in zip(x.split(':'), (3600, 60, 1)))
                out.append({'s': f(a), 'e': f(z.split()[0]), 'text': ' '.join(lines[i + 1:])})
                break
    return out


C = cues()
print('target', BASE)
print('-- spoiler guard (no dialogue yet): expect source=rule, no model')
for body in [{'mode': 'recap', 't': 100, 'title': 'Sintel', 'cues': 'x'},
             {'mode': 'recap', 't': 150, 'title': 'Sintel', 'cues': []},
             {'mode': 'ask', 't': 100, 'title': 'Sintel', 'cues': C, 'question': 'what happens to the dragon?'},
             {'mode': 'recap', 't': -5, 'cues': C},
             {'mode': 'missed', 't': 100, 'since': 150, 'cues': C}]:
    j = post(body)
    print(f"  {json.dumps({k: body[k] for k in body if k != 'cues'})[:70]:72} source={j.get('source')} ms={j.get('ms')} | {j.get('answer', '')[:70]}")

print(f'-- latency, {N} x recap/ask at 2:20 with real cues')
rows = []
for i in range(N):
    body = {'mode': 'recap', 't': 140, 'title': 'Sintel', 'cues': C} if i % 2 == 0 else {'mode': 'ask', 't': 140, 'cues': C, 'question': 'Why is she looking for a dragon?'}
    j = post(body)
    rows.append(j)
    print(f"  {body['mode']:6} source={j.get('source'):7} model={str(j.get('model'))[:28]:28} ms={j.get('ms')} providerMs={j.get('providerMs')} gemErr={str(j.get('geminiError', ''))[:50]}")
ms = [r['ms'] for r in rows if 'ms' in r]
print(f"  median ms {statistics.median(ms):.0f}, max {max(ms)}, sources " + json.dumps({s: sum(r.get('source') == s for r in rows) for s in set(r.get('source') for r in rows)}))
