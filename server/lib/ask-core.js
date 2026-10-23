// "Ask the TV" core: spoiler-free prompt building, LLM calls (Gemini -> Groq gpt-oss) and a
// deterministic offline fallback. The model only ever sees subtitle cues whose start
// time is <= the viewer's current position, enforced here on the server.

const MODES = {
  miss: 'What did I miss?',
  recap: 'Recap last 5 min',
  explain: 'Explain this line',
  translate: 'Translate line',
  who: "Who's speaking?",
  ask: 'Your question',
  missed: 'While you were away',
};

const LANG_NAMES = { en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', pl: 'Polish', hi: 'Hindi' };

function cleanName(n) {
  return String(n || '').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function fmt(t) {
  t = Math.max(0, Math.floor(t || 0));
  const m = Math.floor(t / 60), s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function clean(text) {
  return String(text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// Keep only cues that have already started: nothing after `t` reaches the model.
function spoilerSafe(cues, t) {
  return (Array.isArray(cues) ? cues : [])
    .filter(c => c && typeof c === 'object')
    .map(c => ({ s: Number(c.s ?? c.start ?? 0), e: Number(c.e ?? c.end ?? 0), text: clean(c.text) }))
    .filter(c => Number.isFinite(c.s) && c.s <= t && c.text)
    .sort((a, b) => a.s - b.s)
    .slice(-400);
}

function windowFor(mode, cues, t, since) {
  if (mode === 'missed') {
    // Exactly the stretch the viewer was away for: cues that started between `since` and `t`.
    const from = Number.isFinite(since) ? Math.min(since, t) : t - 90;
    return cues.filter(c => c.s >= from && c.s <= t);
  }
  if (mode === 'miss') {
    const from = Number.isFinite(since) && since < t ? since : t - 90;
    const w = cues.filter(c => c.s >= from);
    return w.length ? w : cues.slice(-4);
  }
  if (mode === 'recap') return cues.filter(c => c.s >= t - 300);
  if (mode === 'explain' || mode === 'translate') return cues.slice(-1);
  if (mode === 'who') return cues.slice(-8);
  return cues.slice(-10);
}

function cleanQuestion(q) {
  return clean(q).replace(/["“”]/g, "'").slice(0, 200);
}

function buildPrompt({ mode, title, t, cues, since, lang, question, name, replyLang }) {
  const safe = spoilerSafe(cues, t);
  const win = windowFor(mode, safe, t, since);
  const who = cleanName(name);
  const from = Number.isFinite(since) ? Math.min(since, t) : t - 90;
  const transcript = safe.slice(-80).map(c => `[${fmt(c.s)}] ${c.text}`).join('\n');
  const focus = win.map(c => `[${fmt(c.s)}] ${c.text}`).join('\n');
  const langName = LANG_NAMES[lang] || 'Spanish';
  const tasks = {
    miss: `The viewer looked away. In 2 short sentences, tell them what happened in these recent lines:\n${focus}`,
    recap: `Give a 3-bullet recap (each bullet under 12 words) of the last five minutes, based on these lines:\n${focus}`,
    explain: `Explain the meaning and subtext of the latest line in 2 short sentences, using earlier dialogue for context:\n${focus}`,
    translate: `Translate the latest line into ${langName}. Reply with the translation on the first line, then one short note on nuance.\n${focus}`,
    ask: `${who ? `The viewer ${who}` : 'The viewer'} asked, from their phone: "${cleanQuestion(question)}". Answer ${who ? who : 'them'} directly in 1-3 short sentences using only the dialogue so far. If the dialogue doesn't answer it yet, say so honestly and don't guess what happens next.`,
    missed: `${who || 'A viewer'} stepped out at ${fmt(from)} and is back at ${fmt(t)}. Welcome them back and, in 2-3 short sentences, tell them what happened in exactly the lines they missed (below). Do not repeat anything from before ${fmt(from)} and never go past ${fmt(t)}.\n${focus || '(no dialogue while they were away)'}`,
    who: `Say who is most likely speaking the latest line and to whom, in 1-2 sentences, citing the clue in the dialogue. If it is unclear, say so.\n${focus}`,
  };
  const system =
    'You are "Ask the TV", a helpful companion on a Fire TV. You answer questions about what the viewer is watching. ' +
    'STRICT RULES: use ONLY the subtitle lines provided (they end at the viewer\'s current position). ' +
    'Never reveal, hint at or guess anything that happens later, even if you recognise the film. ' +
    'You do not know which film this is: do not use any outside knowledge of any film, book, game or story, ' +
    'and do not describe images, settings or events that the dialogue does not state. ' +
    'If the dialogue provided does not answer the question, say so in one sentence and add nothing else. ' +
    "Don't assume anyone's gender, name or who is speaking unless the dialogue states it. " +
    'Be concise and warm; plain text only, no markdown headings. The answer is read from a sofa, 3 metres away: keep it under 45 words.' +
    (replyLang && replyLang !== 'en' && LANG_NAMES[replyLang] && mode !== 'translate' ? ` Write the whole answer in ${LANG_NAMES[replyLang]}.` : '');
  const user =
    // The title is deliberately NOT sent: with it, models recap the film from memory (round-2 tester).
    `Viewer position: ${fmt(t)}\n\nDialogue so far (subtitles):\n${transcript || '(no dialogue yet)'}\n\nTask: ${tasks[mode] || tasks.miss}`;
  return { system, user, used: safe.length, window: win };
}

function offlineAnswer({ mode, title, t, cues, since, lang, question, name }) {
  const safe = spoilerSafe(cues, t);
  const win = windowFor(mode, safe, t, since);
  const last = safe[safe.length - 1];
  const q = c => `“${c.text}”`;
  if (mode === 'missed') {
    const who = cleanName(name);
    const from = Number.isFinite(since) ? Math.min(since, t) : t - 90;
    if (!win.length) return `Welcome back${who ? ', ' + who : ''}! Nobody spoke between ${fmt(from)} and ${fmt(t)}, so you haven't missed any dialogue.`;
    return `Welcome back${who ? ', ' + who : ''}! While you were away (${fmt(from)} to ${fmt(t)}): ` + win.slice(-3).map(q).join(' then ') + '.';
  }
  if (!safe.length) return 'No one has spoken yet, so there is nothing to miss. Enjoy the opening!';
  switch (mode) {
    case 'miss':
      return `Since ${fmt(win[0].s)}: ` + win.slice(-3).map(q).join(' then ') + '.';
    case 'recap':
      return win.length
        ? 'Last 5 minutes:\n' + win.slice(-4).map(c => `• ${fmt(c.s)} ${q(c)}`).join('\n')
        : 'Quiet stretch: no dialogue in the last five minutes.';
    case 'explain':
      return `${q(last)} is said at ${fmt(last.s)}. It follows ${safe.length > 1 ? q(safe[safe.length - 2]) : 'the opening'}, so it reacts to that moment.`;
    case 'translate':
      return `${q(last)}\n(offline mode: translation needs a connection)`;
    case 'ask':
      return `You asked “${cleanQuestion(question)}”. I need a connection to answer free questions. The latest line was ${q(last)} at ${fmt(last.s)}.`;
    case 'who':
      return `The line ${q(last)} comes from the conversation on screen right now. Speaker detection needs a connection.`;
    default:
      return q(last);
  }
}

async function callGroq(system, user, signal) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('no GROQ_API_KEY');
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
      temperature: 0.3,
      max_tokens: 700,
      reasoning_effort: 'low',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!r.ok) throw new Error(`groq ${r.status} ${(await r.text()).slice(0, 140).replace(/\s+/g, ' ')}`);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('groq empty');
  return { text, model: j.model || 'groq' };
}

const GEMINI_PER_MODEL_MS = Number(process.env.GEMINI_PER_MODEL_MS) || 1400;
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS) || 3500;
const HEDGE_MS = Number(process.env.ASK_HEDGE_MS) || 900; // Groq starts if Gemini hasn't answered by then
const TOTAL_MS = Number(process.env.ASK_TOTAL_MS) || 4500;

// Tries several Gemini models, each with its own short timeout (GEMINI_PER_MODEL_MS), and moves on when one is
// missing, rate-limited, overloaded (429/5xx) or slow, so a busy model never stalls the TV.
async function callGemini(system, user, signal, budgetMs = 9000, perModelMs = GEMINI_PER_MODEL_MS) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('no GEMINI_API_KEY');
  const models = (process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-flash-latest').split(',').map(m => m.trim()).filter(Boolean);
  const t0 = Date.now();
  const errs = [];
  for (const model of models) {
    const left = budgetMs - (Date.now() - t0);
    if (left < 500 || signal?.aborted) break;
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener?.('abort', onAbort);
    const timer = setTimeout(() => ctl.abort(), Math.min(perModelMs, left));
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 400 },
        }),
      });
      if (!r.ok) {
        errs.push(`${model} ${r.status}`);
        continue; // 400/404 (unknown model), 429 (rate limit), 5xx (overloaded): try the next model
      }
      const j = await r.json();
      const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
      if (!text) { errs.push(`${model} empty`); continue; }
      return { text, model };
    } catch (e) {
      errs.push(`${model} ${e.name === 'AbortError' ? 'timeout' : String(e.message || e)}`);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }
  throw new Error('gemini: ' + (errs.join('; ') || 'no model'));
}

// Ask the providers as a hedged race: Gemini starts at once; Groq starts HEDGE_MS later (or as soon
// as Gemini fails). The first non-empty answer wins and the other request is aborted. `source`,
// `model` and `providerMs` always describe the provider whose text is returned.
function raceProviders(system, user, providers) {
  return new Promise(resolve => {
    const errors = {};
    const ctls = [];
    let pending = providers.length, done = false;
    const t0 = Date.now();
    const finish = out => { if (done) return; done = true; ctls.forEach(c => c.abort()); clearTimeout(cap); resolve({ ...out, errors }); };
    const cap = setTimeout(() => finish({ winner: null }), TOTAL_MS);
    const starters = providers.map(([name, fn, ms], idx) => {
      let started = false;
      const start = () => {
        if (started || done) return;
        started = true;
        const ctl = new AbortController();
        ctls.push(ctl);
        const timer = setTimeout(() => ctl.abort(), ms + 200);
        const s0 = Date.now();
        fn(system, user, ctl.signal, ms)
          .then(out => { if (out && out.text) finish({ winner: name, text: out.text, model: out.model, providerMs: Date.now() - s0, totalMs: Date.now() - t0 }); else throw new Error(`${name} empty`); })
          .catch(e => {
            if (!done) errors[name] = String((e && e.message) || e);
            // A failed provider lets the next one start straight away instead of waiting for the hedge.
            if (starters[idx + 1]) starters[idx + 1]();
            if (--pending === 0) finish({ winner: null });
          })
          .finally(() => clearTimeout(timer));
      };
      return start;
    });
    starters[0]();
    providers.forEach((p, idx) => { if (idx > 0) setTimeout(() => starters[idx](), HEDGE_MS * idx); });
  });
}

// Inputs that make a model call pointless or unsafe get a deterministic answer (source "rule").
function ruleAnswer(input, mode, safe, window, rawT, since) {
  if (rawT !== undefined && rawT !== null && rawT !== '' && !(Number.isFinite(Number(rawT)) && Number(rawT) >= 0)) {
    return "I couldn't tell where you are in the film, so I won't guess. Press play and ask me again.";
  }
  if (mode === 'missed' && Number.isFinite(since) && since > input.t) {
    const who = cleanName(input.name);
    return `Welcome back${who ? ', ' + who : ''}! You stepped out after the point the film is at now (${fmt(input.t)}), so you haven't missed anything.`;
  }
  if (mode === 'missed' && !window.length) return offlineAnswer(input);
  // Spoiler guard: no line spoken yet means there is nothing the model may use. Without dialogue a
  // model fills the gap from what it knows about the film, so it is never called.
  if (!safe.length) return offlineAnswer(input);
  if (mode === 'recap' && !window.length) return offlineAnswer(input);
  return null;
}

async function answer(body, deps = {}) {
  const mode = MODES[body.mode] ? body.mode : 'miss';
  const rawT = body.t;
  const t = Number.isFinite(Number(rawT)) && Number(rawT) >= 0 ? Number(rawT) : 0;
  const question = cleanQuestion(body.question);
  if (mode === 'ask' && !question) return { mode, label: MODES.ask, answer: 'Ask me something about what you have watched so far.', source: 'none', cuesUsed: 0 };
  const since = body.since === undefined || body.since === null || body.since === '' ? NaN : Number(body.since);
  const replyLang = LANG_NAMES[body.replyLang] ? body.replyLang : 'en';
  const input = { mode, title: body.title, t, cues: body.cues, since, lang: body.lang, question, name: body.name, replyLang };
  const { system, user, used, window } = buildPrompt(input);
  const base = { mode, label: MODES[mode], question: question || undefined, position: fmt(t), cuesUsed: used, window: window.length };
  const rule = ruleAnswer(input, mode, spoilerSafe(body.cues, t), window, rawT, since);
  if (rule) return { ...base, answer: rule, source: 'rule' };
  if (body.offline) return { ...base, answer: offlineAnswer(input), source: 'offline' };
  const providers = [['gemini', callGemini, 2 * GEMINI_PER_MODEL_MS], ['groq', callGroq, GROQ_TIMEOUT_MS]];
  const r = await (deps.race || raceProviders)(system, user, providers);
  for (const [k, v] of Object.entries(r.errors || {})) base[`${k}Error`] = v;
  if (r.winner) return { ...base, answer: r.text, source: r.winner, model: r.model, providerMs: r.providerMs };
  return { ...base, answer: offlineAnswer(input), source: 'offline' };
}

module.exports = { answer, raceProviders, ruleAnswer, buildPrompt, offlineAnswer, spoilerSafe, windowFor, cleanName, MODES, LANG_NAMES, fmt };
