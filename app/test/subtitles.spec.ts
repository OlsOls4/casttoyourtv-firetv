import { activeCue, cuesUpTo, parseSubtitles } from '../src/ct/subtitles';
import { offlineAnswer } from '../src/ct/ask';
import { SINTEL_SRT } from '../src/ct/sintelSubs';

describe('subtitles', () => {
  const cues = parseSubtitles(SINTEL_SRT);
  it('parses the bundled Sintel SRT', () => {
    expect(cues.length).toBe(26);
    expect(cues[0]).toEqual({ s: 107.25, e: 110.5, text: 'This blade has a dark past.' });
  });
  it('parses WebVTT with settings and tags', () => {
    const v = parseSubtitles('WEBVTT\n\n00:01.000 --> 00:02.500 align:center\n<v Bob>Hi <b>there</b>\n');
    expect(v).toEqual([{ s: 1, e: 2.5, text: 'Hi there' }]);
  });
  it('finds the active cue and never returns future cues', () => {
    expect(activeCue(cues, 108)?.text).toBe('This blade has a dark past.');
    expect(activeCue(cues, 111)).toBeUndefined();
    expect(cuesUpTo(cues, 150).every(c => c.s <= 150)).toBe(true);
  });
  it('offline answers only quote lines already seen', () => {
    const a = offlineAnswer('recap', cues, 150);
    expect(a).toContain('A dragon.');
    expect(a).not.toContain('Scales');
  });
  it('offline free question echoes the question and only seen lines', () => {
    const a = offlineAnswer('ask', cues, 150, 'Why a dragon?');
    expect(a).toContain('Why a dragon?');
    expect(a).toContain('A dragon.');
    expect(a).not.toContain('Scales');
  });
});
