import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { ASK_CHIPS, AskMode, AskResult, askTheTv } from './ask';
import { COLORS, fmtTime } from './config';
import { Cue, cuesUpTo } from './subtitles';
import { Focusable, useS } from './ui';

export const PANEL_W = 760;

type Props = { cues: Cue[]; t: number; title: string; since?: number };

// Side panel opened while paused. Answers come from an LLM that only sees subtitle cues up to `t`.
export function AskPanel({ cues, t, title, since }: Props) {
  const S = useS();
  const slide = useRef(new Animated.Value(1)).current;
  const [busy, setBusy] = useState<AskMode | null>(null);
  const [result, setResult] = useState<(AskResult & { mode: AskMode }) | null>(null);
  const known = cuesUpTo(cues, t).length;

  useEffect(() => {
    Animated.timing(slide, { toValue: 0, duration: 260, useNativeDriver: false }).start();
  }, [slide]);

  const ask = async (mode: AskMode) => {
    setBusy(mode);
    setResult(null);
    const r = await askTheTv(mode, cues, t, title, since);
    setResult({ ...r, mode });
    setBusy(null);
  };

  const chipLabel = (m: AskMode) => ASK_CHIPS.find(c => c.mode === m)?.label || '';
  const sourceLabel = (r: AskResult) =>
    r.source === 'gemini' ? 'Gemini' : r.source === 'groq' ? 'Groq · Llama' : r.source === 'offline' ? 'Offline mode' : r.source;

  return (
    <Animated.View
      style={{
        position: 'absolute', top: 0, bottom: 0, right: 0, width: S(PANEL_W),
        backgroundColor: 'rgba(11,15,26,0.94)', borderLeftWidth: S(2), borderLeftColor: 'rgba(255,255,255,0.08)',
        paddingHorizontal: S(48), paddingTop: S(48),
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, S(PANEL_W)] }) }],
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: COLORS.accent, fontSize: S(40), marginRight: S(14) }}>✦</Text>
        <Text style={{ color: COLORS.ink, fontSize: S(44), fontWeight: '800' }}>Ask the TV</Text>
        <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ paddingHorizontal: S(12), paddingVertical: S(4), borderRadius: S(8), borderWidth: S(2), borderColor: COLORS.dim, marginRight: S(10) }}>
            <Text style={{ color: COLORS.mute, fontSize: S(18), fontWeight: '700' }}>BACK</Text>
          </View>
          <Text style={{ color: COLORS.mute, fontSize: S(22) }}>resume</Text>
        </View>
      </View>
      <Text style={{ color: COLORS.mute, fontSize: S(24), marginTop: S(10), lineHeight: S(34) }}>
        Paused at {fmtTime(t)} · knows {known} line{known === 1 ? '' : 's'} so far · no spoilers
      </Text>

      <View style={{ marginTop: S(26) }}>
        {ASK_CHIPS.map((c, i) => (
          <Focusable key={c.mode} variant="chip" icon={c.icon} label={c.label} preferred={i === 0} onPress={() => ask(c.mode)} testID={`ask-${c.mode}`} />
        ))}
      </View>

      <View style={{ marginTop: S(8), flex: 1, marginBottom: S(40) }}>
        {busy ? (
          <View style={{ backgroundColor: COLORS.card, borderRadius: S(24), padding: S(30) }}>
            <Text style={{ color: COLORS.accent, fontSize: S(24), fontWeight: '700' }}>{chipLabel(busy).toUpperCase()}</Text>
            <Text style={{ color: COLORS.mute, fontSize: S(30), marginTop: S(14) }}>Thinking about the last {known} lines…</Text>
          </View>
        ) : result ? (
          <View style={{ backgroundColor: COLORS.card, borderRadius: S(24), paddingHorizontal: S(26), paddingVertical: S(22), borderWidth: S(2), borderColor: 'rgba(255,181,71,0.25)' }}>
            <Text style={{ color: COLORS.accent, fontSize: S(24), fontWeight: '700' }}>{chipLabel(result.mode).toUpperCase()}</Text>
            <Text style={{ color: COLORS.ink, fontSize: S(27), lineHeight: S(37), marginTop: S(10) }} numberOfLines={9}>
              {result.answer}
            </Text>
            <Text style={{ color: COLORS.dim, fontSize: S(19), marginTop: S(12) }}>
              {sourceLabel(result)} · {(result.ms / 1000).toFixed(1)}s · from {result.cuesUsed} subtitle lines up to {fmtTime(t)}
            </Text>
          </View>
        ) : (
          <Text style={{ color: COLORS.dim, fontSize: S(26), lineHeight: S(36) }}>Pick a question with ▲▼ and press Select.</Text>
        )}
      </View>

    </Animated.View>
  );
}
