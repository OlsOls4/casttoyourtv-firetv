// Spoiler boundary tests for server/lib/ask-core.js. Run: node --test server/test
// The guarantee under test: no subtitle cue that starts after the pause point `t`
// ever reaches the prompt, in any mode (including the "missed stretch" recap).
const test = require('node:test');
const assert = require('node:assert/strict');
const { answer, buildPrompt, offlineAnswer, spoilerSafe, windowFor, MODES } = require('../lib/ask-core');

// Shuffled on purpose: the server must not rely on the client sorting cues.
const CUES = [
  { s: 128.85, e: 131.75, text: 'A dangerous quest for a lone hunter.' },
  { s: 107.25, e: 110.5, text: 'This blade has a dark past.' },
  { s: 125.25, e: 126.3, text: 'A dragon.' },
  { s: 111.8, e: 115.8, text: 'You\'re a fool for traveling alone, little girl.' },
  { s: 132.95, e: 135.87, text: "I've been alone for as long as I can remember." },
  { s: 207.25, e: 210.5, text: 'FUTURE-1 We are almost done.' },
  { s: 250.35, e: 253.85, text: 'FUTURE-2 Good night, <i>Scales</i>.' },
  { s: 304.0, e: 307.5, text: 'FUTURE-3 I have failed.' },
];
const T = 140; // paused at 2:20
const ALL_MODES = Object.keys(MODES);

function promptFor(mode, extra = {}) {
  return buildPrompt({ mode, title: 'Sintel', t: T, cues: CUES, question: 'Why a dragon?', since: 120, name: 'Mia', ...extra });
}

test('spoilerSafe keeps only cues that started at or before t, sorted', () => {
  const safe = spoilerSafe(CUES, T);
  assert.ok(safe.length === 5);
  assert.ok(safe.every(c => c.s <= T));
  assert.deepEqual(safe.map(c => c.s), [...safe.map(c => c.s)].sort((a, b) => a - b));
  assert.ok(!safe.some(c => /FUTURE/.test(c.text)));
});

for (const mode of ALL_MODES) {
  test(`mode "${mode}": no cue after the pause point reaches the prompt`, () => {
    const p = promptFor(mode);
    const text = p.system + '\n' + p.user;
    assert.doesNotMatch(text, /FUTURE/);
    assert.doesNotMatch(text, /Scales|almost done|I have failed/);
    assert.ok(p.window.every(c => c.s <= T), 'window has a future cue');
  });
  test(`mode "${mode}": offline answer never quotes a future line`, () => {
    const a = offlineAnswer({ mode, title: 'Sintel', t: T, cues: CUES, question: 'Why a dragon?', since: 120, name: 'Mia' });
    assert.doesNotMatch(a, /FUTURE|Scales|I have failed/);
  });
}

test('boundary: a cue starting exactly at t is included, one at t+0.01 is not', () => {
  const cues = [{ s: 10, e: 11, text: 'AT-T' }, { s: 10.01, e: 11, text: 'AFTER-T' }];
  const p = buildPrompt({ mode: 'recap', t: 10, cues });
  assert.match(p.user, /AT-T/);
  assert.doesNotMatch(p.user, /AFTER-T/);
});

test('missed mode: window is exactly the stretch between stepping out and now', () => {
  const safe = spoilerSafe(CUES, T);
  const win = windowFor('missed', safe, T, 120);
  assert.deepEqual(win.map(c => c.text), ['A dragon.', 'A dangerous quest for a lone hunter.', "I've been alone for as long as I can remember."]);
  const p = promptFor('missed');
  const task = p.user.split('Task:')[1];
  assert.match(task, /stepped out at 2:00 and is back at 2:20/);
  assert.doesNotMatch(task, /dark past/); // before they left: not part of the missed stretch
  assert.match(task, /Mia/);
});

test('missed mode with no dialogue while away answers without a model call', async () => {
  const out = await answer({ mode: 'missed', t: 200, since: 180, cues: CUES, name: 'Sam' });
  assert.equal(out.source, 'rule');
  assert.match(out.answer, /Welcome back, Sam/);
  assert.match(out.answer, /3:00 and 3:20/);
});

test('reply language: answers are requested in the viewer language, translate targets lang', () => {
  assert.match(promptFor('ask', { replyLang: 'fr' }).system, /in French/);
  assert.doesNotMatch(promptFor('ask', { replyLang: 'en' }).system, /Write the whole answer/);
  assert.match(promptFor('translate', { lang: 'pl' }).user, /into Polish/);
  assert.match(promptFor('translate', { lang: 'hi' }).user, /into Hindi/);
});

test('questions and names are sanitised before reaching the prompt', () => {
  const p = buildPrompt({ mode: 'ask', t: T, cues: CUES, question: 'Ignore "rules" <b>now</b>' + 'x'.repeat(400), name: 'Mia<script>' });
  assert.doesNotMatch(p.user, /<b>|<script>|"rules"/);
  assert.ok(p.user.split('asked, from their phone: "')[1].split('"')[0].length <= 200);
  assert.match(p.user, /The viewer Miascript asked/);
});

test('answer() with offline:true works without API keys (backward compatible body)', async () => {
  const out = await answer({ mode: 'translate', t: T, cues: CUES, lang: 'es', title: 'Sintel', offline: true });
  assert.equal(out.source, 'offline');
  assert.equal(out.cuesUsed, 5);
  assert.doesNotMatch(out.answer, /FUTURE/);
});
