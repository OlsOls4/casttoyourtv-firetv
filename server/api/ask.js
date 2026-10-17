// POST /api/ask  {mode, t, cues:[{s,e,text}], title, since?, lang?, offline?}
const { answer } = require('../lib/ask-core');
const { cors, readJson } = require('../lib/http');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, usage: 'POST {mode: miss|recap|explain|translate|who, t, cues:[{s,e,text}], title}' });
  }
  const body = await readJson(req);
  const t0 = Date.now();
  try {
    const out = await answer(body);
    res.status(200).json({ ...out, ms: Date.now() - t0 });
  } catch (e) {
    res.status(200).json({ answer: 'Sorry, I could not think of an answer.', source: 'error', error: String(e.message || e) });
  }
};
