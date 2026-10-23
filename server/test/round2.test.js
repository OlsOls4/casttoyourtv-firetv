// Round-2 fixes: no model call without spoken dialogue, input validation, the provider race,
// and the relay's single-writer store. Run: node --test server/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { answer, buildPrompt, raceProviders, MODES } = require('../lib/ask-core');

const CUES = [
  { s: 107.25, e: 110.5, text: 'This blade has a dark past.' },
  { s: 111.8, e: 115.8, text: "You're a fool for traveling alone, little girl." },
  { s: 207.25, e: 210.5, text: 'FUTURE-1 We are almost done.' },
];

// Fake keys + a fetch spy: any model call is recorded (and would fail loudly if made).
function spyFetch(t) {
  const calls = [];
  const orig = global.fetch;
  const env = { g: process.env.GEMINI_API_KEY, q: process.env.GROQ_API_KEY };
  process.env.GEMINI_API_KEY = 'test-g';
  process.env.GROQ_API_KEY = 'test-q';
  global.fetch = async url => { calls.push(String(url)); throw new Error('network disabled in tests'); };
  t.after(() => {
    global.fetch = orig;
    if (env.g === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = env.g;
    if (env.q === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = env.q;
  });
  return calls;
}

// --- 1. Spoiler leak: nothing spoken yet => built-in answer, no model call ---------------------
const EMPTY_CASES = [
  ['cues missing', { t: 100 }],
  ['cues empty array', { t: 150, cues: [] }],
  ['cues a string (tester repro)', { t: 100, cues: 'x' }],
  ['cues malformed objects', { t: 100, cues: [{ foo: 1 }, null, 3, { s: 'abc', text: '' }] }],
  ['all cues after current time', { t: 100, cues: CUES }],
  ['t = 0 at the very start', { t: 0, cues: CUES }],
];
for (const mode of Object.keys(MODES).filter(m => m !== 'missed')) {
  for (const [label, extra] of EMPTY_CASES) {
    test(`no dialogue yet (${label}), mode "${mode}": rule answer, no model call`, async t => {
      const calls = spyFetch(t);
      const out = await answer({ mode, title: 'Sintel', question: 'what happens to the dragon?', ...extra });
      assert.equal(calls.length, 0, `model called: ${calls.join(', ')}`);
      assert.equal(out.source, 'rule');
      assert.match(out.answer, /No one has spoken yet/);
      assert.equal(out.cuesUsed, 0);
    });
  }
}

test('recap with dialogue earlier but none in the last five minutes: rule answer, no model call', async t => {
  const calls = spyFetch(t);
  const out = await answer({ mode: 'recap', t: 900, cues: CUES.slice(0, 2) });
  assert.equal(calls.length, 0);
  assert.equal(out.source, 'rule');
  assert.match(out.answer, /Quiet stretch/);
});

test('prompt never sends the film title and forbids outside knowledge', () => {
  const p = buildPrompt({ mode: 'recap', title: 'Sintel', t: 120, cues: CUES });
  assert.doesNotMatch(p.system + p.user, /Sintel/);
  assert.match(p.system, /do not use any outside knowledge/i);
  assert.match(p.system, /does not answer the question, say so/);
  assert.match(p.system, /Don't assume anyone's gender/);
});

// --- 5. Input validation ------------------------------------------------------------------------
for (const bad of [-5, 'abc', NaN, Infinity, {}]) {
  test(`invalid t (${String(bad)}): rule answer, no model call`, async t => {
    const calls = spyFetch(t);
    const out = await answer({ mode: 'recap', t: bad, cues: CUES });
    assert.equal(calls.length, 0);
    assert.equal(out.source, 'rule');
    assert.match(out.answer, /couldn't tell where you are/);
  });
}

test('missed: stepped out after the current time -> rule answer, no model call', async t => {
  const calls = spyFetch(t);
  const out = await answer({ mode: 'missed', t: 100, since: 150, cues: CUES, name: 'Sam' });
  assert.equal(calls.length, 0);
  assert.equal(out.source, 'rule');
  assert.match(out.answer, /Welcome back, Sam! You stepped out after/);
});

test('valid input with dialogue does reach the providers (guard is not over-eager)', async t => {
  const calls = spyFetch(t);
  const out = await answer({ mode: 'recap', t: 120, cues: CUES });
  assert.ok(calls.length >= 1, 'expected a provider call');
  assert.equal(out.source, 'offline'); // both providers fail in tests -> offline fallback
  assert.ok(out.geminiError && out.groqError);
  assert.doesNotMatch(out.answer, /FUTURE/);
});

// --- 2. Provider race ---------------------------------------------------------------------------
const delay = (ms, v, fail) => new Promise((res, rej) => setTimeout(() => (fail ? rej(new Error(fail)) : res(v)), ms));

test('race: a fast Gemini answer wins and Groq is never started', async () => {
  let groqStarted = false;
  const r = await raceProviders('s', 'u', [
    ['gemini', () => delay(50, { text: 'G', model: 'gm' }), 2800],
    ['groq', () => { groqStarted = true; return delay(10, { text: 'Q', model: 'qm' }); }, 3500],
  ]);
  assert.equal(r.winner, 'gemini');
  assert.equal(r.text, 'G');
  assert.equal(groqStarted, false);
});

test('race: slow Gemini -> hedged Groq answers first and the label says groq', async () => {
  const r = await raceProviders('s', 'u', [
    ['gemini', (s, u, signal) => new Promise((res, rej) => { const id = setTimeout(() => res({ text: 'G' }), 3000); signal.addEventListener('abort', () => { clearTimeout(id); rej(new Error('aborted')); }); }), 2800],
    ['groq', () => delay(20, { text: 'Q', model: 'qm' }), 3500],
  ]);
  assert.equal(r.winner, 'groq');
  assert.equal(r.text, 'Q');
  assert.equal(r.model, 'qm');
  assert.ok(r.totalMs < 1500, `took ${r.totalMs} ms`);
  assert.ok(r.providerMs < 200);
});

test('race: Gemini fails fast -> Groq starts immediately (no hedge wait)', async () => {
  const r = await raceProviders('s', 'u', [
    ['gemini', () => delay(10, null, 'gemini 429'), 2800],
    ['groq', () => delay(10, { text: 'Q' }), 3500],
  ]);
  assert.equal(r.winner, 'groq');
  assert.ok(r.totalMs < 300, `took ${r.totalMs} ms`);
  assert.match(r.errors.gemini, /429/);
});

test('race: both fail -> no winner (caller falls back offline)', async () => {
  const r = await raceProviders('s', 'u', [
    ['gemini', () => delay(5, null, 'g down'), 2800],
    ['groq', () => delay(5, null, 'q down'), 3500],
  ]);
  assert.equal(r.winner, null);
  assert.ok(r.errors.gemini && r.errors.groq);
});

test('answer(): provider label and model come from the winner', async () => {
  const out = await answer({ mode: 'recap', t: 120, cues: CUES }, { race: async () => ({ winner: 'groq', text: 'Hi', model: 'openai/gpt-oss-20b', providerMs: 412, errors: { gemini: 'gemini: timeout' } }) });
  assert.equal(out.source, 'groq');
  assert.equal(out.model, 'openai/gpt-oss-20b');
  assert.equal(out.providerMs, 412);
  assert.equal(out.geminiError, 'gemini: timeout');
});

// --- 3. Relay (in-memory store backend; same code path as the Runtime Cache) ----------------------
process.env.RELAY_STORE = 'memory';
const relay = require('../api/relay');
function call(method, { query, body } = {}) {
  return new Promise(resolve => {
    const res = {
      headers: {}, code: 200,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.code = c; return this; },
      json(o) { resolve({ status: this.code, body: o }); },
      end() { resolve({ status: this.code, body: null }); },
    };
    relay({ method, query: query || {}, body: body || {} }, res);
  });
}

test('relay: cast is delivered once; status reports delivered', async () => {
  const p = await call('POST', { body: { code: 'TT0001', videoUrl: 'https://x/v.mp4', id: 'cast00001' } });
  assert.equal(p.body.id, 'cast00001');
  assert.equal((await call('GET', { query: { code: 'TT0001', status: 'cast00001' } })).body.delivered, false);
  assert.equal((await call('GET', { query: { code: 'TT0001' } })).body.cast.videoUrl, 'https://x/v.mp4');
  assert.equal((await call('GET', { query: { code: 'TT0001' } })).body.cast, null);
  assert.equal((await call('GET', { query: { code: 'TT0001', status: 'cast00001' } })).body.delivered, true);
});

test('relay: questions arrive in order, retries with the same id are deduplicated', async () => {
  await call('POST', { body: { code: 'TT0002', question: 'one', id: 'qqq00001' } });
  await call('POST', { body: { code: 'TT0002', question: 'one', id: 'qqq00001' } }); // retry
  await call('POST', { body: { code: 'TT0002', question: 'two', id: 'qqq00002' } });
  const got = [];
  for (let i = 0; i < 4; i++) {
    const q = (await call('GET', { query: { code: 'TT0002', q: '1' } })).body.question;
    if (q) got.push(q.text);
  }
  assert.deepEqual(got, ['one', 'two']);
  // A retry after delivery must not re-deliver.
  await call('POST', { body: { code: 'TT0002', question: 'one', id: 'qqq00001' } });
  assert.equal((await call('GET', { query: { code: 'TT0002', q: '1' } })).body.question, null);
});

test('relay: pair-screen poll (no q=1) does not consume questions', async () => {
  await call('POST', { body: { code: 'TT0003', event: 'away', name: 'Sam', id: 'evt00001' } });
  assert.equal((await call('GET', { query: { code: 'TT0003' } })).body.question, null);
  const q = (await call('GET', { query: { code: 'TT0003', q: '1' } })).body.question;
  assert.equal(q.type, 'away');
  assert.equal(q.name, 'Sam');
});

test('relay: tvOnline reflects a recent TV poll; status checks do not count as the TV', async () => {
  await call('GET', { query: { code: 'TT0004', status: 'zzzz0000' } });
  assert.equal((await call('POST', { body: { code: 'TT0004', question: 'hi' } })).body.tvOnline, false);
  await call('GET', { query: { code: 'TT0004' } });
  assert.equal((await call('POST', { body: { code: 'TT0004', question: 'hi again' } })).body.tvOnline, true);
});

test('relay: bad input and unsupported methods', async () => {
  assert.equal((await call('POST', { body: { code: 'no!' } })).status, 400);
  assert.equal((await call('POST', { body: { code: 'TT0005', videoUrl: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await call('PUT', {})).status, 405);
  assert.equal((await call('OPTIONS', {})).status, 204);
});
