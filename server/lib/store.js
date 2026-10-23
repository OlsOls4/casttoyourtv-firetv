// Shared key/value store for the pairing relay.
//
// On Vercel this is the Vercel Runtime Cache (`getCache()` from @vercel/functions): a regional
// cache shared by every function instance in the region, included on the free Hobby plan and
// needing no extra account. Before this, the relay kept state in a per-instance Map, so a phone
// and a TV that hit different instances never met (round-2 tester: 8/20 casts delivered under
// load). Outside Vercel (tests, `node`), or if the package is missing, it falls back to an
// in-process Map with the same async API.
//
// The Runtime Cache is non-durable (entries can be evicted) and has no atomic ops, so relay.js
// gives every key a single writer (see there) and the sender retries until the TV acknowledges.

const NS = 'cttv-relay';

function memoryStore() {
  const m = globalThis.__cttvMem || (globalThis.__cttvMem = new Map());
  return {
    kind: 'memory',
    async get(k) {
      const v = m.get(k);
      if (!v) return null;
      if (v.exp < Date.now()) { m.delete(k); return null; }
      return v.val;
    },
    async set(k, val, { ttl = 900 } = {}) { m.set(k, { val: JSON.parse(JSON.stringify(val)), exp: Date.now() + ttl * 1000 }); },
    async delete(k) { m.delete(k); },
  };
}

let vf = null;
try { vf = require('@vercel/functions'); } catch { vf = null; }

function runtimeCacheAvailable() {
  if (process.env.RELAY_STORE === 'memory') return false;
  if (!vf || typeof vf.getCache !== 'function') return false;
  const ctx = globalThis[Symbol.for('@vercel/request-context')]?.get?.() ?? {};
  return !!ctx.cache || !!(process.env.RUNTIME_CACHE_ENDPOINT && process.env.RUNTIME_CACHE_HEADERS);
}

// Resolved per request: the request context that carries the cache only exists inside a request.
function getStore() {
  if (!runtimeCacheAvailable()) return memoryStore();
  const c = vf.getCache({ namespace: NS });
  const mem = memoryStore();
  return {
    kind: 'vercel-runtime-cache',
    async get(k) {
      try { const v = await c.get(k); return v === undefined ? null : v; } catch { return mem.get(k); }
    },
    async set(k, val, opts = {}) {
      try { await c.set(k, val, { ttl: opts.ttl || 900 }); } catch { await mem.set(k, val, opts); }
    },
    async delete(k) { try { await c.delete(k); } catch { await mem.delete(k); } },
  };
}

module.exports = { getStore, memoryStore };
