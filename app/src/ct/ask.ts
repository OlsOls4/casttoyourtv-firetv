// "Ask the TV" client: spoiler-free (only cues up to `t` are sent) with an offline fallback
// so the experience never dead-ends when the network is unavailable.
import { API_BASE, fmtTime, langName } from './config';
import { BUILD } from './buildConfig';
import { Cue, cuesUpTo } from './subtitles';

export type AskMode = 'miss' | 'recap' | 'explain' | 'translate' | 'who' | 'ask' | 'missed';
export type AskChip = { mode: AskMode; label: string; icon: string };
export const ASK_CHIPS: AskChip[] = [
  { mode: 'miss', label: 'What did I miss?', icon: '⟲' },
  { mode: 'recap', label: 'Recap last 5 min', icon: '≡' },
  { mode: 'explain', label: 'Explain this line', icon: '?' },
  { mode: 'translate', label: 'Translate line', icon: 'あ' },
  { mode: 'who', label: "Who's speaking?", icon: '◉' },
];
// Honest labels: "Recap so far" before five minutes have played; Translate names its target language.
export function chipsFor(t: number, translateLang: string): AskChip[] {
  return ASK_CHIPS.map(c =>
    c.mode === 'recap' && t < 300 ? { ...c, label: 'Recap so far' } : c.mode === 'translate' ? { ...c, label: `Translate line → ${langName(translateLang)}` } : c,
  );
}
export type AskOpts = { since?: number; question?: string; lang?: string; replyLang?: string; name?: string };

export type AskResult = { answer: string; source: string; model?: string; ms: number; cuesUsed: number };

const q = (c: Cue) => `“${c.text.replace(/\s+/g, ' ')}”`;

export function offlineAnswer(mode: AskMode, cues: Cue[], t: number, question?: string, since?: number, name?: string): string {
  const safe = cuesUpTo(cues, t);
  const last = safe[safe.length - 1];
  if (mode === 'missed') {
    const from = Math.min(since ?? t - 90, t);
    const w = safe.filter(c => c.s >= from);
    const hi = `Welcome back${name ? ', ' + name : ''}!`;
    return w.length
      ? `${hi} While you were away (${fmtTime(from)} to ${fmtTime(t)}): ` + w.slice(-3).map(q).join(' then ') + '.'
      : `${hi} Nobody spoke between ${fmtTime(from)} and ${fmtTime(t)}.`;
  }
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
    case 'ask':
      return `You asked “${question || ''}”. Free questions need a connection. The latest line was ${q(last)} at ${fmtTime(last.s)}.`;
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

export async function askTheTv(mode: AskMode, cues: Cue[], t: number, title: string, opts: AskOpts = {}): Promise<AskResult> {
  const t0 = Date.now();
  const { since, question, name } = opts;
  const safe = cuesUpTo(cues, t);
  const used = mode === 'missed' ? safe.filter(c => c.s >= Math.min(since ?? t - 90, t)).length : safe.length;
  if (BUILD.offlineAsk) {
    return { answer: offlineAnswer(mode, cues, t, question, since, name), source: 'offline', ms: Date.now() - t0, cuesUsed: used };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(`${API_BASE}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode, t, title, since, question, name,
        lang: opts.lang || 'es', // translate target
        replyLang: opts.replyLang || 'en', // language to answer in (the asking viewer's)
        cues: safe.map(c => ({ s: c.s, e: c.e, text: c.text })),
      }),
      signal: ctl.signal,
    });
    const j = await r.json();
    console.log(`[CTTV] ask ${mode}${opts.replyLang && opts.replyLang !== 'en' ? ' [' + opts.replyLang + ']' : ''} -> ${j.source} ${j.model || ''} ${Date.now() - t0}ms, ${used} cues <= ${fmtTime(t)}`);
    return { answer: tidy(j.answer), source: j.source || 'server', model: j.model, ms: Date.now() - t0, cuesUsed: used };
  } catch (e) {
    console.log(`[CTTV] ask ${mode} offline fallback: ${String(e)}`);
    return { answer: offlineAnswer(mode, cues, t, question, since, name), source: 'offline', ms: Date.now() - t0, cuesUsed: used };
  } finally {
    clearTimeout(timer);
  }
}
