import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { AskMode, AskResult, askTheTv, chipsFor } from './ask';
import { COLORS, fmtTime, translateTarget } from './config';
import { Cue, cuesUpTo } from './subtitles';
import { Focusable, useS } from './ui';

export const PANEL_W = 760;

// Something that arrived from a phone through the relay: a free question, or "I'm back" (missed-stretch recap).
export type PhoneQuestion = { id: string; kind: 'ask' | 'missed'; text?: string; via?: string; name?: string; lang?: string; since?: number };
type Props = { cues: Cue[]; t: number; title: string; phoneQuestion?: PhoneQuestion | null; householdLang?: string };
type Shown = AskResult & { mode: AskMode; pq?: PhoneQuestion };

// Side panel opened while paused. Answers come from an LLM that only sees subtitle cues up to `t`.
// The answer card always belongs to the focused chip: moving focus clears a stale answer, and a phone
// answer is shown on its own card while the chip focus is drawn "quiet" (no chip looks selected).
export function AskPanel({ cues, t, title, phoneQuestion, householdLang }: Props) {
  const S = useS();
  const slide = useRef(new Animated.Value(1)).current;
  const [busy, setBusy] = useState<{ mode: AskMode; pq?: PhoneQuestion } | null>(null);
  const [result, setResult] = useState<Shown | null>(null);
  const [focusMode, setFocusMode] = useState<AskMode | null>(null);
  const [quiet, setQuiet] = useState(false);
  const focusRef = useRef<AskMode | null>(null);
  const req = useRef(0);
  const known = cuesUpTo(cues, t).length;
  const transLang = translateTarget(householdLang);
  const chips = chipsFor(t, transLang);

  useEffect(() => {
    // eslint-disable-next-line @amazon-devices/kepler/animated -- kept on the JS driver as verified in the CI runs on the VVD; switching drivers would change behaviour after submission
    Animated.timing(slide, { toValue: 0, duration: 260, useNativeDriver: false }).start();
  }, [slide]);

  const ask = async (mode: AskMode, pq?: PhoneQuestion) => {
    const id = ++req.current;
    setQuiet(!!pq);
    setBusy({ mode, pq });
    setResult(null);
    const r = await askTheTv(mode, cues, t, title, {
      since: pq?.since,
      question: pq?.text,
      name: pq?.name,
      replyLang: pq ? pq.lang || 'en' : 'en',
      lang: transLang,
    });
    if (id !== req.current) return; // focus moved on, or a newer question arrived: drop the stale answer
    setResult({ ...r, mode, pq });
    setBusy(null);
  };

  const onChipFocus = (mode: AskMode) => {
    const prev = focusRef.current;
    focusRef.current = mode;
    setFocusMode(mode);
    if (prev === null || prev === mode) return; // initial focus: keep whatever is showing
    setQuiet(false);
    req.current++;
    setBusy(null);
    setResult(null);
  };

  // Questions and "I'm back" arrive from the phone through the relay.
  useEffect(() => {
    if (phoneQuestion) ask(phoneQuestion.kind === 'missed' ? 'missed' : 'ask', phoneQuestion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneQuestion?.id]);

  const cardLabel = (m: AskMode, pq?: PhoneQuestion) => {
    const who = pq?.name ? pq.name.toUpperCase() : '';
    if (m === 'missed') return `⟲ WELCOME BACK${who ? ', ' + who : ''}`;
    if (m === 'ask') {
      if (who) return pq?.via === 'voice' ? `◉ ${who} ASKED OUT LOUD` : `◉ ${who} ASKED FROM THEIR PHONE`;
      return pq?.via === 'voice' ? '◉ ASKED OUT LOUD ON YOUR PHONE' : '◉ ASKED FROM YOUR PHONE';
    }
    return (chips.find(c => c.mode === m)?.label || '').toUpperCase();
  };
  const subLine = (m: AskMode, pq?: PhoneQuestion) =>
    m === 'missed' && pq ? `You missed ${fmtTime(pq.since ?? t)} → ${fmtTime(t)}` : pq?.text ? `“${pq.text}”` : '';
  const sourceLabel = (r: AskResult) =>
    r.source === 'gemini' ? 'Gemini' : r.source === 'groq' ? 'Groq · gpt-oss' : r.source === 'offline' ? 'Offline mode' : r.source === 'rule' ? 'No dialogue' : r.source;
  const footer = (r: Shown) =>
    r.mode === 'missed' && r.pq
      ? `${sourceLabel(r)} · ${(r.ms / 1000).toFixed(1)}s · only the ${r.cuesUsed} line${r.cuesUsed === 1 ? '' : 's'} between ${fmtTime(r.pq.since ?? t)} and ${fmtTime(t)}`
      : `${sourceLabel(r)} · ${(r.ms / 1000).toFixed(1)}s · from ${r.cuesUsed} subtitle lines up to ${fmtTime(t)}`;
  const focusedChip = chips.find(c => c.mode === focusMode);

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
        {chips.map((c, i) => (
          <Focusable
            key={c.mode} variant="chip" icon={c.icon} label={c.label} preferred={i === 0} quiet={quiet}
            onFocused={() => onChipFocus(c.mode)} onPress={() => ask(c.mode)} testID={`ask-${c.mode}`}
          />
        ))}
      </View>

      <View style={{ marginTop: S(8), flex: 1, marginBottom: S(40) }}>
        {busy ? (
          <View style={{ backgroundColor: COLORS.card, borderRadius: S(24), padding: S(30) }}>
            <Text style={{ color: COLORS.accent, fontSize: S(24), fontWeight: '700' }}>{cardLabel(busy.mode, busy.pq)}</Text>
            {subLine(busy.mode, busy.pq) ? <Text style={{ color: COLORS.ink, fontSize: S(28), fontStyle: 'italic', marginTop: S(8) }}>{subLine(busy.mode, busy.pq)}</Text> : null}
            <Text style={{ color: COLORS.mute, fontSize: S(30), marginTop: S(14) }}>
              {busy.mode === 'missed' ? 'Catching you up on the stretch you missed…' : `Thinking about the last ${known} lines…`}
            </Text>
          </View>
        ) : result ? (
          <View style={{ backgroundColor: COLORS.card, borderRadius: S(24), paddingHorizontal: S(26), paddingVertical: S(22), borderWidth: S(2), borderColor: result.pq ? 'rgba(110,231,168,0.35)' : 'rgba(255,181,71,0.25)' }}>
            <Text style={{ color: result.pq ? COLORS.ok : COLORS.accent, fontSize: S(24), fontWeight: '700' }}>{cardLabel(result.mode, result.pq)}</Text>
            {subLine(result.mode, result.pq) ? (
              <Text style={{ color: COLORS.mute, fontSize: S(26), fontStyle: 'italic', marginTop: S(8) }} numberOfLines={2}>{subLine(result.mode, result.pq)}</Text>
            ) : null}
            <Text style={{ color: COLORS.ink, fontSize: S(27), lineHeight: S(37), marginTop: S(10) }} numberOfLines={result.pq ? 7 : 9}>
              {result.answer}
            </Text>
            <Text style={{ color: COLORS.dim, fontSize: S(19), marginTop: S(12) }}>{footer(result)}</Text>
          </View>
        ) : (
          <Text style={{ color: COLORS.dim, fontSize: S(26), lineHeight: S(36) }}>
            {focusedChip && focusRef.current !== null && req.current > 0
              ? `Press SELECT to ask “${focusedChip.label}”.`
              : 'Pick a question with ▲▼ and press Select, or ask out loud from your phone.'}
          </Text>
        )}
      </View>
    </Animated.View>
  );
}
