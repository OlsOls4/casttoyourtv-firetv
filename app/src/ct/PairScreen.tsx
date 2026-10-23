import React, { useEffect, useRef, useState } from 'react';
import { Animated, AppState, AppStateStatus, Text, View } from 'react-native';
import { API_BASE, Cast, COLORS, DEMO_CAST, newPairCode, SENDER_URL } from './config';
import { BUILD } from './buildConfig';
import { QRCode } from './QRCode';
import { Focusable, useS } from './ui';

type Props = { onCast: (c: Cast) => void };

export function PairScreen({ onCast }: Props) {
  const S = useS();
  const [code, setCode] = useState(newPairCode);
  const [online, setOnline] = useState<'checking' | 'online' | 'offline'>('checking');
  const pulse = useRef(new Animated.Value(0.35)).current;
  const url = `${SENDER_URL}?code=${code}`;
  const [active, setActive] = useState(AppState.currentState !== 'background');

  // Lifecycle: stop polling the relay while the app is in the background.
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    try {
      sub = AppState.addEventListener('change', (next: AppStateStatus) => {
        console.log(`[CTTV] lifecycle ${next} (pair screen)`);
        setActive(next === 'active');
      });
      console.log(`[CTTV] lifecycle listener on (${AppState.currentState})`);
    } catch (e) {
      console.log(`[CTTV] AppState unavailable: ${String(e)}`);
    }
    return () => sub?.remove();
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Poll the relay for a cast sent from the phone / web sender.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let fails = 0;
    const tick = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/relay?code=${code}`);
        const j = await r.json();
        if (!alive) return;
        setOnline('online');
        fails = 0;
        if (j && j.cast && j.cast.videoUrl) {
          console.log(`[CTTV] cast received for ${code}: ${j.cast.videoUrl}`);
          onCast({ ...j.cast, source: 'phone', code });
        }
      } catch (e) {
        fails++;
        if (alive && fails >= 2) setOnline('offline');
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [code, onCast, active]);

  const statusText =
    online === 'online' ? 'Waiting for your phone…' : online === 'offline' ? 'No internet: try the demo film' : 'Connecting…';

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.bg, overflow: 'hidden' }}>
      {/* soft background glows */}
      <View style={{ position: 'absolute', width: S(1100), height: S(1100), borderRadius: S(550), left: S(-380), top: S(-520), backgroundColor: 'rgba(124,92,255,0.18)' }} />
      <View style={{ position: 'absolute', width: S(900), height: S(900), borderRadius: S(450), right: S(-260), bottom: S(-560), backgroundColor: 'rgba(255,122,89,0.12)' }} />

      <View style={{ flex: 1, flexDirection: 'row', paddingHorizontal: S(120), paddingTop: S(96) }}>
        {/* Left: copy, code, actions */}
        <View style={{ flex: 1, paddingRight: S(80) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: S(20), height: S(20), borderRadius: S(10), backgroundColor: COLORS.accent, marginRight: S(16) }} />
            <Text style={{ color: COLORS.ink, fontSize: S(34), fontWeight: '700', letterSpacing: S(1) }}>Cast to Your TV</Text>
            <View style={{ marginLeft: S(18), paddingHorizontal: S(14), paddingVertical: S(4), borderRadius: S(10), backgroundColor: 'rgba(255,255,255,0.08)' }}>
              <Text style={{ color: COLORS.mute, fontSize: S(22), fontWeight: '600' }}>FIRE TV</Text>
            </View>
          </View>

          <Text style={{ color: COLORS.ink, fontSize: S(84), fontWeight: '800', marginTop: S(56), lineHeight: S(96) }}>
            Scan to cast.{'\n'}Then just ask.
          </Text>
          <Text style={{ color: COLORS.mute, fontSize: S(32), marginTop: S(24), lineHeight: S(46) }}>
            Send any video with subtitles from your phone. Pause and ask the TV what you missed — it only knows what you've already seen.
          </Text>

          <Text style={{ color: COLORS.dim, fontSize: S(24), fontWeight: '700', marginTop: S(56), letterSpacing: S(4) }}>TV CODE</Text>
          <View style={{ flexDirection: 'row', marginTop: S(16) }}>
            {code.split('').map((ch, i) => (
              <View key={i} style={{ width: S(96), height: S(120), marginRight: S(14), borderRadius: S(20), backgroundColor: COLORS.card, borderWidth: S(2), borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: COLORS.ink, fontSize: S(68), fontWeight: '800' }}>{ch}</Text>
              </View>
            ))}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: S(30) }}>
            <Animated.View style={{ width: S(16), height: S(16), borderRadius: S(8), marginRight: S(14), opacity: pulse,
              backgroundColor: online === 'offline' ? COLORS.accent2 : COLORS.ok }} />
            <Text style={{ color: COLORS.mute, fontSize: S(28) }}>{statusText}</Text>
          </View>

          <View style={{ flexDirection: 'row', marginTop: S(48) }}>
            <Focusable variant="primary" preferred icon="▶" label="Play the demo film" onPress={() => onCast({ ...DEMO_CAST, code })} testID="demo" />
            <View style={{ width: S(24) }} />
            <Focusable label="New code" icon="↻" onPress={() => setCode(BUILD.pairCode ? code : newPairCode())} testID="newcode" />
          </View>
        </View>

        {/* Right: QR card */}
        <View style={{ width: S(620), alignItems: 'center' }}>
          <View style={{ backgroundColor: '#FFFFFF', borderRadius: S(36), padding: S(40), alignItems: 'center' }}>
            <QRCode value={url} size={S(460)} />
          </View>
          <Text style={{ color: COLORS.ink, fontSize: S(30), fontWeight: '700', marginTop: S(32) }}>Point your phone camera here</Text>
          <Text style={{ color: COLORS.mute, fontSize: S(24), marginTop: S(10) }}>or open casttoyourtv-firetv.vercel.app/s</Text>
        </View>
      </View>

      {/* Bottom strip: the hook, as plain text (not pills) so nothing here looks focusable */}
      <View style={{ position: 'absolute', left: S(120), right: S(120), bottom: S(64), flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: COLORS.accent, fontSize: S(24), fontWeight: '800', marginRight: S(18) }}>✦</Text>
        <Text style={{ color: COLORS.mute, fontSize: S(24) }}>
          While watching, press <Text style={{ color: COLORS.ink, fontWeight: '800' }}>SELECT</Text> to ask: what did I miss? · recap · explain a line · translate · who's speaking? · or ask out loud from your phone
        </Text>
      </View>
    </View>
  );
}
