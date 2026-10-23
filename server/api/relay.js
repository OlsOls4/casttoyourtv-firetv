// Pairing relay. The TV shows a 6-char code and polls; the phone/web sender posts a cast.
//   POST /api/relay {code, videoUrl, subtitleUrl?, title?, startAt?, id?}   (sender)
//   POST /api/relay {code, question, via?, name?, lang?, id?}                (phone: ask the TV by voice/text)
//   POST /api/relay {code, event: 'away'|'back'|'viewer', name?, lang?, id?} (phone: stepping out / I'm back / who's watching)
//   GET  /api/relay?code=ABC123            (TV poll; takes the cast; with &q=1 also one question)
//   GET  /api/relay?code=ABC123&status=ID  (sender: has the TV picked up item ID yet? read-only)
//
// State lives in the Vercel Runtime Cache (lib/store.js), shared by all instances in the region.
// It has no atomic operations, so every key has exactly one kind of writer:
//   cast:CODE  written only by the sender's cast POST   {id, ts, cast}
//   q:CODE     written only by phone POSTs              [{id, type, ...}]  (append, deduped by id)
//   tv:CODE    written only by the TV's poll            {seen, castDone, qDone:[ids]}
// The TV never deletes what the phone wrote; it records what it has taken. So a phone write and a
// TV poll that land at the same moment can't erase each other. Clients may send their own `id`
// and retry with it until `status` says delivered; duplicates are dropped.
const { cors, readJson } = require('../lib/http');
const { getStore } = require('../lib/store');

const TTL = 15 * 60; // seconds
const CODE = /^[A-Z0-9]{4,8}$/;
const ID = /^[a-z0-9]{4,24}$/i;
const LANGS = new Set(['en', 'es', 'fr', 'de', 'pl', 'hi', 'ja', 'it', 'pt']);

function viewer(b) {
  const name = String(b.name || '').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  const lang = LANGS.has(String(b.lang || '')) ? String(b.lang) : 'en';
  return { name, lang };
}
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function okUrl(u) {
  try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; }
}
const online = tv => !!tv && !!tv.seen && Date.now() - tv.seen < 10000;

async function enqueue(store, code, item) {
  const [q, tv] = await Promise.all([store.get(`q:${code}`), store.get(`tv:${code}`)]);
  const done = new Set((tv && tv.qDone) || []);
  let list = (Array.isArray(q) ? q : []).filter(x => x && !done.has(x.id));
  if (!list.some(x => x.id === item.id)) list = list.concat([item]);
  await store.set(`q:${code}`, list.slice(-8), { ttl: TTL });
  return tv;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method not allowed' });
  const store = getStore();
  res.setHeader('x-relay-store', store.kind);

  if (req.method === 'POST') {
    const b = await readJson(req);
    const code = String(b.code || '').toUpperCase().trim();
    if (!CODE.test(code)) return res.status(400).json({ ok: false, error: 'bad code' });
    const id = ID.test(String(b.id || '')) ? String(b.id) : newId();
    if (b.event !== undefined && !b.videoUrl) {
      const type = ['away', 'back', 'viewer'].includes(b.event) ? b.event : null;
      if (!type) return res.status(400).json({ ok: false, error: 'bad event' });
      const tv = await enqueue(store, code, { id, type, ...viewer(b) });
      return res.status(200).json({ ok: true, code, id, queued: true, event: type, tvOnline: online(tv) });
    }
    if (b.question !== undefined && !b.videoUrl) {
      const text = String(b.question || '').replace(/\s+/g, ' ').trim().slice(0, 200);
      if (!text) return res.status(400).json({ ok: false, error: 'empty question' });
      const tv = await enqueue(store, code, { id, type: 'ask', text, via: b.via === 'voice' ? 'voice' : 'text', ...viewer(b) });
      return res.status(200).json({ ok: true, code, id, queued: true, tvOnline: online(tv) });
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
    const tv = await store.get(`tv:${code}`);
    if (!(tv && tv.castDone === id)) await store.set(`cast:${code}`, { id, ts: Date.now(), cast }, { ttl: TTL });
    return res.status(200).json({ ok: true, code, id, tvOnline: online(tv) });
  }

  const query = req.query || {};
  const code = String(query.code || '').toUpperCase().trim();
  if (!CODE.test(code)) return res.status(400).json({ ok: false, error: 'bad code' });

  // Sender asking whether its item arrived. Read-only: it never counts as the TV being online.
  if (query.status !== undefined) {
    const sid = String(query.status);
    const tv = await store.get(`tv:${code}`);
    const delivered = !!tv && (tv.castDone === sid || (tv.qDone || []).includes(sid));
    return res.status(200).json({ ok: true, code, id: sid, delivered, tvOnline: online(tv) });
  }

  const [tv0, c, q] = await Promise.all([
    store.get(`tv:${code}`),
    store.get(`cast:${code}`),
    query.q === '1' ? store.get(`q:${code}`) : Promise.resolve(null),
  ]);
  const tv = { seen: 0, castDone: null, qDone: [], ...(tv0 || {}) };
  const prevSeen = tv.seen;
  let cast = null;
  if (c && c.id && c.id !== tv.castDone) {
    cast = c.cast;
    tv.castDone = c.id;
  }
  // The player polls with &q=1 to take one queued question; the pair screen only takes casts.
  let question = null;
  if (Array.isArray(q)) {
    const next = q.find(x => x && x.id && !tv.qDone.includes(x.id));
    if (next) {
      question = next;
      tv.qDone = tv.qDone.concat([next.id]).slice(-32);
    }
  }
  tv.seen = Date.now();
  // Write only when something was taken, or to refresh the "TV online" stamp every few seconds.
  if (cast || question || tv.seen - prevSeen > 4000) await store.set(`tv:${code}`, tv, { ttl: TTL });
  return res.status(200).json({ ok: true, code, cast, question });
};
