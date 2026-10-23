// Pairing relay. The TV shows a 6-char code and polls; the phone/web sender posts a cast.
//   POST /api/relay {code, videoUrl, subtitleUrl?, title?, startAt?}   (sender)
//   POST /api/relay {code, question, via?, name?, lang?}                (phone: ask the TV by voice/text)
//   POST /api/relay {code, event: 'away'|'back'|'viewer', name?, lang?}  (phone: stepping out / I'm back / who's watching)
//   GET  /api/relay?code=ABC123                                         (TV poll; consumes the cast; with &q=1 also one question)
// State is kept in memory of the warm function instance (fine for a demo / low traffic;
// swap for Redis/KV in production).
const { cors, readJson } = require('../lib/http');

const store = globalThis.__castStore || (globalThis.__castStore = new Map());
const TTL = 15 * 60 * 1000;
const CODE = /^[A-Z0-9]{4,8}$/;

function gc() {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.ts > TTL) store.delete(k);
}
const LANGS = new Set(['en', 'es', 'fr', 'de', 'pl', 'hi', 'ja', 'it', 'pt']);
function viewer(b) {
  const name = String(b.name || '').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  const lang = LANGS.has(String(b.lang || '')) ? String(b.lang) : 'en';
  return { name, lang };
}
function enqueue(code, item) {
  const entry = store.get(code) || { ts: Date.now(), seenByTv: 0 };
  entry.ts = Date.now();
  entry.questions = (entry.questions || []).concat([{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...item }]).slice(-8);
  store.set(code, entry);
  return entry;
}
function okUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; }
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  gc();
  if (req.method === 'POST') {
    const b = await readJson(req);
    const code = String(b.code || '').toUpperCase().trim();
    if (!CODE.test(code)) return res.status(400).json({ ok: false, error: 'bad code' });
    if (b.event !== undefined && !b.videoUrl) {
      const type = ['away', 'back', 'viewer'].includes(b.event) ? b.event : null;
      if (!type) return res.status(400).json({ ok: false, error: 'bad event' });
      const entry = enqueue(code, { type, ...viewer(b) });
      return res.status(200).json({ ok: true, code, queued: true, event: type, tvOnline: !!entry.seenByTv && Date.now() - entry.seenByTv < 10000 });
    }
    if (b.question !== undefined && !b.videoUrl) {
      const text = String(b.question || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return res.status(400).json({ ok: false, error: 'empty question' });
      const entry = enqueue(code, { type: 'ask', text, via: b.via === 'voice' ? 'voice' : 'text', ...viewer(b) });
      return res.status(200).json({ ok: true, code, queued: true, tvOnline: !!entry.seenByTv && Date.now() - entry.seenByTv < 10000 });
    }
    if (!okUrl(b.videoUrl)) return res.status(400).json({ ok: false, error: 'videoUrl must be http(s)' });
    if (b.subtitleUrl && !okUrl(b.subtitleUrl)) return res.status(400).json({ ok: false, error: 'bad subtitleUrl' });
    const cast = {
      videoUrl: b.videoUrl,
      subtitleUrl: b.subtitleUrl || '',
      title: String(b.title || '').slice(0, 120),
      startAt: Math.max(0, Number(b.startAt) || 0),
      viewer: viewer(b),
    };
    const prev = store.get(code) || {};
    store.set(code, { ts: Date.now(), cast, seenByTv: prev.seenByTv || 0, questions: prev.questions || [] });
    return res.status(200).json({ ok: true, code, tvOnline: !!prev.seenByTv && Date.now() - prev.seenByTv < 10000 });
  }
  const code = String((req.query && req.query.code) || '').toUpperCase().trim();
  if (!CODE.test(code)) return res.status(400).json({ ok: false, error: 'bad code' });
  const entry = store.get(code) || { ts: Date.now() };
  entry.seenByTv = Date.now();
  const cast = entry.cast || null;
  if (cast) delete entry.cast;
  // The player polls with &q=1 to take one queued question; the pair screen only takes casts.
  const question = (req.query && req.query.q === '1' && entry.questions && entry.questions.shift()) || null;
  store.set(code, entry);
  return res.status(200).json({ ok: true, code, cast, question });
};
