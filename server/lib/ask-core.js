// "Ask the TV" core: spoiler-free prompt building, LLM calls (Groq -> Gemini) and a
// deterministic offline fallback. The model only ever sees subtitle cues whose start
// time is <= the viewer's current position, enforced here on the server.

const MODES = {
  miss: 'What did I miss?',
  recap: 'Recap last 5 min',
  explain: 'Explain this line',
  translate: 'Translate line',
  who: "Who's speaking?",
};

const LANG_NAMES = { es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', ja: 'Japanese', pl: 'Polish' };

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

function buildPrompt({ mode, title, t, cues, since, lang }) {
  const safe = spoilerSafe(cues, t);
  const win = windowFor(mode, safe, t, since);
  const transcript = safe.slice(-80).map(c => `[${fmt(c.s)}] ${c.text}`).join('\n');
  const focus = win.map(c => `[${fmt(c.s)}] ${c.text}`).join('\n');
  const langName = LANG_NAMES[lang] || 'Spanish';
  const tasks = {
    miss: `The viewer looked away. In 2 short sentences, tell them what happened in these recent lines:\n${focus}`,
    recap: `Give a 3-bullet recap (each bullet under 12 words) of the last five minutes, based on these lines:\n${focus}`,
    explain: `Explain the meaning and subtext of the latest line in 2 short sentences, using earlier dialogue for context:\n${focus}`,
    translate: `Translate the latest line into ${langName}. Reply with the translation on the first line, then one short note on nuance.\n${focus}`,
    who: `Say who is most likely speaking the latest line and to whom, in 1-2 sentences, citing the clue in the dialogue. If it is unclear, say so.\n${focus}`,
  };
  const system =
    'You are "Ask the TV", a helpful companion on a Fire TV. You answer questions about what the viewer is watching. ' +
    'STRICT RULES: use ONLY the subtitle lines provided (they end at the viewer\'s current position). ' +
    'Never reveal, hint at or guess anything that happens later, even if you recognise the film. ' +
    'Be concise and warm; plain text only, no markdown headings. The answer is read from a sofa, 3 metres away: keep it under 45 words.';
  const user =
    `Title: ${title || 'Unknown'}\nViewer position: ${fmt(t)}\n\nDialogue so far (subtitles):\n${transcript || '(no dialogue yet)'}\n\nTask: ${tasks[mode] || tasks.miss}`;
  return { system, user, used: safe.length, window: win };
}

function offlineAnswer({ mode, title, t, cues, since, lang }) {
  const safe = spoilerSafe(cues, t);
  const win = windowFor(mode, safe, t, since);
  const last = safe[safe.length - 1];
  const q = c => `“${c.text}”`;
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
  const input = { mode, title: body.title, t, cues: body.cues, since: Number(body.since), lang: body.lang };
  const { system, user, used, window } = buildPrompt(input);
  const base = { mode, label: MODES[mode], position: fmt(t), cuesUsed: used, window: window.length };
  if (body.offline) return { ...base, answer: offlineAnswer(input), source: 'offline' };
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

module.exports = { answer, buildPrompt, offlineAnswer, spoilerSafe, MODES, fmt };
