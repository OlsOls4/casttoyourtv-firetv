const { cors } = require('../lib/http');
module.exports = (req, res) => {
  cors(res);
  res.status(200).json({ ok: true, service: 'casttoyourtv-firetv', groq: !!process.env.GROQ_API_KEY, gemini: !!process.env.GEMINI_API_KEY, time: new Date().toISOString() });
};
