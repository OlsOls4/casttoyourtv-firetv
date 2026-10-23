#!/usr/bin/env python3
"""Relay concurrency repro (round-2 tester). Not part of `npm test`: it hits a live deployment.

usage: python3 server/test/relay-load.py https://casttoyourtv-firetv.vercel.app [parallel=10] [retry=0]

burst:     N parallel trials, each with a fresh code: POST cast -> GET poll -> POST question -> GET &q=1.
household: 6 "TVs" poll every 2 s while 6 phones post 5 questions each over ~26 s.
retry=1 makes the phone behave like the updated /s/ sender: it re-posts with the same id until
`?status=id` says delivered (or 8 s pass).
"""
import json, random, string, sys, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'https://casttoyourtv-firetv.vercel.app'
PAR = int(sys.argv[2]) if len(sys.argv) > 2 else 10
RETRY = len(sys.argv) > 3 and sys.argv[3] == '1'
URL = BASE + '/api/relay'
instances = set()


def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers={'content-type': 'application/json'})
    with urllib.request.urlopen(r, timeout=15) as resp:
        instances.add((resp.headers.get('x-vercel-id') or '').split('::')[-1][:5])
        return json.loads(resp.read() or b'{}')


def code():
    return 'LT' + ''.join(random.choices(string.ascii_uppercase + string.digits, k=4))


def rid():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))


def send(c, body):
    body = dict(body, code=c, id=rid())
    out = req('POST', URL, body)
    if RETRY:
        t0 = time.time()
        while time.time() - t0 < 8:
            time.sleep(0.7)
            if req('GET', f'{URL}?code={c}&status={body["id"]}').get('delivered'):
                return out
            req('POST', URL, body)  # same id: deduplicated server-side
    return out


def trial(_):
    c = code()
    got_cast = got_q = False
    try:
        req('GET', f'{URL}?code={c}')  # TV is on the pair screen
        threading.Thread(target=send, args=(c, {'videoUrl': 'https://example.com/v.mp4', 'title': 'load'}), daemon=True).start()
        for _ in range(10):
            time.sleep(0.5)
            if req('GET', f'{URL}?code={c}').get('cast'):
                got_cast = True
                break
        threading.Thread(target=send, args=(c, {'question': 'who is she?'}), daemon=True).start()
        for _ in range(10):
            time.sleep(0.5)
            if req('GET', f'{URL}?code={c}&q=1').get('question'):
                got_q = True
                break
    except Exception as e:
        print('err', e)
    return got_cast, got_q


def burst():
    with ThreadPoolExecutor(PAR) as ex:
        res = list(ex.map(trial, range(PAR * 2)))
    print(f'burst x{PAR} parallel ({len(res)} trials): cast {sum(a for a, _ in res)}/{len(res)}, question {sum(b for _, b in res)}/{len(res)}')


def household():
    codes = [code() for _ in range(6)]
    got = {c: set() for c in codes}
    stop = time.time() + 34

    def tv(c):
        while time.time() < stop:
            try:
                q = req('GET', f'{URL}?code={c}&q=1').get('question')
                if q:
                    got[c].add(q['text'])
            except Exception:
                pass
            time.sleep(2)

    def phone(c):
        for i in range(5):
            try:
                send(c, {'question': f'q{i} {c}'})
            except Exception:
                pass
            time.sleep(random.uniform(3, 6.5))

    ts = [threading.Thread(target=tv, args=(c,)) for c in codes] + [threading.Thread(target=phone, args=(c,)) for c in codes]
    [t.start() for t in ts]
    [t.join() for t in ts]
    print(f'household (6 TVs + 6 phones x5 questions): delivered {sum(len(v) for v in got.values())}/30')


if __name__ == '__main__':
    print('target', BASE, 'retry' if RETRY else 'no-retry')
    burst()
    household()
    print('distinct instances seen:', len(instances))
