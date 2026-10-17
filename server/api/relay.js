// Pairing relay. The TV shows a 6-char code and polls; the phone/web sender posts a cast.
//   POST /api/relay {code, videoUrl, subtitleUrl?, title?, startAt?}   (sender)
//   GET  /api/relay?code=ABC123                                         (TV poll; consumes the cast)
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
    if (!okUrl(b.videoUrl)) return res.status(400).json({ ok: false, error: 'videoUrl must be http(s)' });
    if (b.subtitleUrl && !okUrl(b.subtitleUrl)) return res.status(400).json({ ok: false, error: 'bad subtitleUrl' });
    const cast = {
      videoUrl: b.videoUrl,
      subtitleUrl: b.subtitleUrl || '',
      title: String(b.title || '').slice(0, 120),
      startAt: Math.max(0, Number(b.startAt) || 0),
    };
    const prev = store.get(code) || {};
    store.set(code, { ts: Date.now(), cast, seenByTv: prev.seenByTv || 0 });
    return res.status(200).json({ ok: true, code, tvOnline: !!prev.seenByTv && Date.now() - prev.seenByTv < 10000 });
  }
  const code = String((req.query && req.query.code) || '').toUpperCase().trim();
  if (!CODE.test(code)) return res.status(400).json({ ok: false, error: 'bad code' });
  const entry = store.get(code) || { ts: Date.now() };
  entry.seenByTv = Date.now();
  const cast = entry.cast || null;
  if (cast) delete entry.cast;
  store.set(code, entry);
  return res.status(200).json({ ok: true, code, cast });
};
