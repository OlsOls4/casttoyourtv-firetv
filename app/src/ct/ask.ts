// "Ask the TV" client: spoiler-free (only cues up to `t` are sent) with an offline fallback
// so the experience never dead-ends when the network is unavailable.
import { API_BASE, fmtTime } from './config';
import { BUILD } from './buildConfig';
import { Cue, cuesUpTo } from './subtitles';

export type AskMode = 'miss' | 'recap' | 'explain' | 'translate' | 'who';
export const ASK_CHIPS: { mode: AskMode; label: string; icon: string }[] = [
  { mode: 'miss', label: 'What did I miss?', icon: '⟲' },
  { mode: 'recap', label: 'Recap last 5 min', icon: '≡' },
  { mode: 'explain', label: 'Explain this line', icon: '?' },
  { mode: 'translate', label: 'Translate line', icon: 'あ' },
  { mode: 'who', label: "Who's speaking?", icon: '◉' },
];

export type AskResult = { answer: string; source: string; model?: string; ms: number; cuesUsed: number };

const q = (c: Cue) => `“${c.text.replace(/\s+/g, ' ')}”`;

export function offlineAnswer(mode: AskMode, cues: Cue[], t: number): string {
  const safe = cuesUpTo(cues, t);
  const last = safe[safe.length - 1];
  if (!last) return 'No one has spoken yet, so there is nothing to miss. Enjoy the opening!';
  switch (mode) {
    case 'miss': {
      const w = safe.filter(c => c.s >= t - 90);
      const pick = (w.length ? w : safe).slice(-3);
      return `Since ${fmtTime(pick[0].s)}: ` + pick.map(q).join(' then ') + '.';
    }
    case 'recap': {
      const w = safe.filter(c => c.s >= t - 300).slice(-4);
      return w.length ? w.map(c => `• ${fmtTime(c.s)}  ${q(c)}`).join('\n') : 'A quiet stretch: no dialogue in the last five minutes.';
    }
    case 'explain':
      return `${q(last)} (at ${fmtTime(last.s)}) answers ${safe.length > 1 ? q(safe[safe.length - 2]) : 'the opening scene'}.`;
    case 'translate':
      return `${q(last)}\nTranslation needs a connection: you're offline.`;
    case 'who':
      return `${q(last)} is part of the conversation on screen now. Speaker detection needs a connection.`;
  }
  return q(last);
}

function tidy(s: string): string {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .trim();
}

export async function askTheTv(mode: AskMode, cues: Cue[], t: number, title: string, since?: number): Promise<AskResult> {
  const t0 = Date.now();
  const safe = cuesUpTo(cues, t);
  if (BUILD.offlineAsk) {
    return { answer: offlineAnswer(mode, cues, t), source: 'offline', ms: Date.now() - t0, cuesUsed: safe.length };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(`${API_BASE}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode, t, title, since, lang: 'es', cues: safe.map(c => ({ s: c.s, e: c.e, text: c.text })) }),
      signal: ctl.signal,
    });
    const j = await r.json();
    console.log(`[CTTV] ask ${mode} -> ${j.source} ${j.model || ''} ${Date.now() - t0}ms`);
    return { answer: tidy(j.answer), source: j.source || 'server', model: j.model, ms: Date.now() - t0, cuesUsed: safe.length };
  } catch (e) {
    console.log(`[CTTV] ask ${mode} offline fallback: ${String(e)}`);
    return { answer: offlineAnswer(mode, cues, t), source: 'offline', ms: Date.now() - t0, cuesUsed: safe.length };
  } finally {
    clearTimeout(timer);
  }
}
