const { cors } = require('../lib/http');
const { getStore } = require('../lib/store');
module.exports = (req, res) => {
  cors(res);
  res.status(200).json({ ok: true, service: 'casttoyourtv-firetv', groq: !!process.env.GROQ_API_KEY, gemini: !!process.env.GEMINI_API_KEY, relayStore: getStore().kind, time: new Date().toISOString() });
};
