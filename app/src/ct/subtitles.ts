// Minimal SRT + WebVTT parser (no dependencies). Cue times in seconds.
export type Cue = { s: number; e: number; text: string };

function toSec(ts: string): number {
  const m = ts.trim().replace(',', '.').match(/(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?/);
  if (!m) return NaN;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const ms = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
  return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + ms / 1000;
}

export function parseSubtitles(raw: string): Cue[] {
  const text = String(raw || '').replace(/^\uFEFF/, '').replace(/\r/g, '');
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.length);
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const s = toSec(a);
    const e = toSec((b || '').trim().split(/\s+/)[0]);
    const body = lines
      .slice(i + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]+\}/g, '')
      .trim();
    if (Number.isFinite(s) && Number.isFinite(e) && body) cues.push({ s, e, text: body });
  }
  return cues.sort((x, y) => x.s - y.s);
}

export function activeCue(cues: Cue[], t: number): Cue | undefined {
  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (c.s <= t) return t <= c.e ? c : undefined;
  }
  return undefined;
}

export function cuesUpTo(cues: Cue[], t: number): Cue[] {
  return cues.filter(c => c.s <= t);
}
