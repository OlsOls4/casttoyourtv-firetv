// "Ask the TV" core: spoiler-free prompt building, LLM calls (Groq -> Gemini) and a
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
    'Be concise and warm; plain text only, no markdown headings. The answer is read from a sofa, 3 metres away: keep it under 45 words.' +
    (replyLang && replyLang !== 'en' && LANG_NAMES[replyLang] && mode !== 'translate' ? ` Write the whole answer in ${LANG_NAMES[replyLang]}.` : '');
  const user =
    `Title: ${title || 'Unknown'}\nViewer position: ${fmt(t)}\n\nDialogue so far (subtitles):\n${transcript || '(no dialogue yet)'}\n\nTask: ${tasks[mode] || tasks.miss}`;
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
      model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
      temperature: 0.3,
      max_tokens: 220,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!r.ok) throw new Error(`groq ${r.status}`);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('groq empty');
  return { text, model: j.model || 'groq' };
}

async function callGemini(system, user, signal) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('no GEMINI_API_KEY');
  const models = (process.env.GEMINI_MODEL || 'gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-flash-latest').split(',');
  let last = 'gemini: no model';
  for (const model of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 400},
      }),
    });
    if (!r.ok) {
      last = `gemini ${model} ${r.status} ${(await r.text()).slice(0, 160).replace(/\s+/g, ' ')}`;
      if (r.status === 404 || r.status === 400) continue;
      throw new Error(last);
    }
    const j = await r.json();
    const text = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('').trim();
    if (!text) { last = `gemini ${model} empty`; continue; }
    return { text, model };
  }
  throw new Error(last);
}

async function answer(body) {
  const mode = MODES[body.mode] ? body.mode : 'miss';
  const t = Number(body.t) || 0;
  const question = cleanQuestion(body.question);
  if (mode === 'ask' && !question) return { mode, label: MODES.ask, answer: 'Ask me something about what you have watched so far.', source: 'none', cuesUsed: 0 };
  const since = body.since === undefined || body.since === null || body.since === '' ? NaN : Number(body.since);
  const replyLang = LANG_NAMES[body.replyLang] ? body.replyLang : 'en';
  const input = { mode, title: body.title, t, cues: body.cues, since, lang: body.lang, question, name: body.name, replyLang };
  const { system, user, used, window } = buildPrompt(input);
  const base = { mode, label: MODES[mode], question: question || undefined, position: fmt(t), cuesUsed: used, window: window.length };
  if (body.offline) return { ...base, answer: offlineAnswer(input), source: 'offline' };
  // Nothing was said while they were away: answer deterministically, no model call needed.
  if (mode === 'missed' && !window.length) return { ...base, answer: offlineAnswer(input), source: 'rule' };
  for (const [name, fn] of [['groq', callGroq], ['gemini', callGemini]]) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), name === 'gemini' ? 9000 : 6000);
    try {
      const out = await fn(system, user, ctl.signal);
      return { ...base, answer: out.text, source: name, model: out.model };
    } catch (e) {
      base[`${name}Error`] = String(e.message || e);
    } finally {
      clearTimeout(timer);
    }
  }
  return { ...base, answer: offlineAnswer(input), source: 'offline' };
}

module.exports = { answer, buildPrompt, offlineAnswer, spoilerSafe, windowFor, cleanName, MODES, LANG_NAMES, fmt };
