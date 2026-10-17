import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { BackHandler, HWEvent, useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { AskPanel, PANEL_W, PhoneQuestion } from './AskPanel';
import { API_BASE, Cast, COLORS, fmtTime } from './config';
import { SINTEL_SRT } from './sintelSubs';
import { activeCue, Cue, parseSubtitles } from './subtitles';
import { useS } from './ui';

type Props = { cast: Cast; onExit: () => void };
type PlayState = 'loading' | 'playing' | 'paused' | 'clock' | 'error';

export function PlayerScreen({ cast, onExit }: Props) {
  const S = useS();
  const video = useRef<VideoPlayer | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [subsInfo, setSubsInfo] = useState('loading subtitles');
  const [t, setT] = useState(cast.startAt || 0);
  const [duration, setDuration] = useState(0);
  const [state, setState] = useState<PlayState>('loading');
  const [askOpen, setAskOpen] = useState(false);
  const [hud, setHud] = useState(true);
  const [phoneQ, setPhoneQ] = useState<PhoneQuestion | null>(null);
  const askOpenRef = useRef(false);

  const tRef = useRef(cast.startAt || 0);
  const pausedRef = useRef(false);
  const clockMode = useRef(false); // subtitle clock when the decoder isn't advancing (e.g. emulator without video)
  const lastAdvance = useRef(Date.now());
  const lastVideoT = useRef(-1);
  const title = cast.title || 'Now playing';

  // ---- subtitles: fetch the URL, fall back to the bundled Sintel subtitles for the demo
  useEffect(() => {
    let alive = true;
    (async () => {
      if (cast.subtitleUrl) {
        try {
          const r = await fetch(cast.subtitleUrl);
          const parsed = parseSubtitles(await r.text());
          if (alive && parsed.length) {
            setCues(parsed);
            setSubsInfo(`${parsed.length} subtitle lines`);
            return;
          }
        } catch (e) {
          console.log(`[CTTV] subtitle fetch failed: ${String(e)}`);
        }
      }
      if (alive && (!cast.subtitleUrl || /sintel/i.test(cast.subtitleUrl))) {
        const parsed = parseSubtitles(SINTEL_SRT);
        setCues(parsed);
        setSubsInfo(`${parsed.length} subtitle lines (bundled)`);
      } else if (alive) setSubsInfo('no subtitles');
    })();
    return () => {
      alive = false;
    };
  }, [cast.subtitleUrl]);

  // ---- video surface lifecycle (Vega W3C Media API)
  const onSurfaceViewCreated = useCallback(
    async (surfaceHandle: string) => {
      try {
        const v = new VideoPlayer();
        video.current = v;
        await v.initialize();
        v.setSurfaceHandle(surfaceHandle);
        v.addEventListener('loadedmetadata', () => {
          try {
            if (cast.startAt) v.currentTime = cast.startAt;
            setDuration(Number(v.duration) || 0);
          } catch (e) {
            console.log(`[CTTV] seek failed ${String(e)}`);
          }
        });
        v.addEventListener('playing', () => setState(pausedRef.current ? 'paused' : 'playing'));
        v.addEventListener('error', () => {
          console.log('[CTTV] video error -> subtitle clock');
          clockMode.current = true;
          setState('clock');
        });
        v.autoplay = true;
        v.src = cast.videoUrl;
        console.log(`[CTTV] playing ${cast.videoUrl} from ${cast.startAt || 0}s`);
      } catch (e) {
        console.log(`[CTTV] player init failed: ${String(e)}`);
        clockMode.current = true;
        setState('clock');
      }
    },
    [cast.videoUrl, cast.startAt],
  );

  const onSurfaceViewDestroyed = useCallback(async (surfaceHandle: string) => {
    const v = video.current;
    video.current = null;
    try {
      v?.clearSurfaceHandle(surfaceHandle);
      await v?.deinitialize();
    } catch (e) {
      console.log(`[CTTV] deinit ${String(e)}`);
    }
  }, []);

  // ---- playback clock: follow the decoder; if it stalls, keep subtitles moving on a wall clock
  useEffect(() => {
    const id = setInterval(() => {
      const v = video.current;
      const now = Date.now();
      let vt = -1;
      try {
        vt = v ? Number(v.currentTime) : -1;
      } catch (e) {
        vt = -1;
      }
      if (!clockMode.current && vt > 0 && Math.abs(vt - lastVideoT.current) > 0.01) {
        lastVideoT.current = vt;
        lastAdvance.current = now;
        tRef.current = vt;
      } else if (!pausedRef.current) {
        if (!clockMode.current && now - lastAdvance.current > 9000) {
          console.log('[CTTV] decoder not advancing -> subtitle clock');
          clockMode.current = true;
          setState('clock');
        }
        if (clockMode.current) tRef.current += 0.25;
      } else {
        lastAdvance.current = now;
      }
      setT(tRef.current);
    }, 250);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setHud(false), 7000);
    return () => clearTimeout(id);
  }, []);

  const pause = () => {
    pausedRef.current = true;
    try {
      video.current?.pause();
    } catch (e) {}
    if (!clockMode.current) setState('paused');
  };
  const resume = () => {
    pausedRef.current = false;
    lastAdvance.current = Date.now();
    try {
      video.current?.play();
    } catch (e) {}
    if (!clockMode.current) setState('playing');
  };

  const openAsk = () => {
    if (askOpenRef.current) return;
    askOpenRef.current = true;
    pause();
    setAskOpen(true);
    console.log(`[CTTV] Ask the TV opened at ${fmtTime(tRef.current)}`);
  };
  const closeAsk = () => {
    askOpenRef.current = false;
    setPhoneQ(null);
    setAskOpen(false);
    resume();
  };
  const seek = (d: number) => {
    tRef.current = Math.max(0, tRef.current + d);
    try {
      if (video.current && !clockMode.current) video.current.currentTime = tRef.current;
    } catch (e) {}
    setHud(true);
    setTimeout(() => setHud(false), 3000);
  };

  // Questions asked from the phone (voice or typed) while watching: pause, open the panel, answer.
  useEffect(() => {
    if (!cast.code) return;
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/relay?code=${cast.code}&q=1`);
        const j = await r.json();
        if (alive && j && j.question && j.question.text) {
          console.log(`[CTTV] phone question (${j.question.via}): ${j.question.text}`);
          openAsk();
          setPhoneQ(j.question);
        }
      } catch (e) {}
    }, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast.code]);

  useTVEventHandler((evt: HWEvent) => {
    if (!evt || evt.eventKeyAction !== 0) return;
    const k = evt.eventType;
    if (askOpen) return;
    if (k === 'menu') openAsk();
    else if (k === 'playpause') (pausedRef.current ? resume : pause)();
    else if (k === 'left' || k === 'rewind') seek(-10);
    else if (k === 'right' || k === 'fastforward') seek(10);
  });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (askOpen) closeAsk();
      else onExit();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askOpen, onExit]);

  const cue = activeCue(cues, t);
  const showHud = hud || askOpen || pausedRef.current;
  const rightInset = askOpen ? S(PANEL_W) : 0;
  const stateLabel =
    state === 'playing' ? 'Playing' : state === 'paused' ? 'Paused' : state === 'clock' ? 'Subtitle clock' : state === 'error' ? 'Error' : 'Loading video…';

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {cast.posterUrl ? (
        <Image source={{ uri: cast.posterUrl }} resizeMode="cover" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0.9 }} />
      ) : null}
      <KeplerVideoSurfaceView
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        onSurfaceViewCreated={onSurfaceViewCreated}
        onSurfaceViewDestroyed={onSurfaceViewDestroyed}
      />

      {/* invisible focus target: Select on the remote opens Ask the TV */}
      {!askOpen ? (
        <TouchableOpacity hasTVPreferredFocus activeOpacity={1} onPress={openAsk} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} testID="ask-catcher">
          <View />
        </TouchableOpacity>
      ) : null}

      {/* top HUD */}
      {showHud ? (
        <View style={{ position: 'absolute', left: 0, right: rightInset, top: 0, paddingHorizontal: S(80), paddingTop: S(56), paddingBottom: S(40), backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ width: S(14), height: S(14), borderRadius: S(7), backgroundColor: COLORS.accent, marginRight: S(14) }} />
            <Text style={{ color: COLORS.mute, fontSize: S(24), fontWeight: '700', letterSpacing: S(2) }}>
              {cast.source === 'phone' ? 'CAST FROM YOUR PHONE' : 'DEMO FILM'}
            </Text>
          </View>
          <Text style={{ color: COLORS.ink, fontSize: S(56), fontWeight: '800', marginTop: S(10) }}>{title}</Text>
          {/sintel/i.test(cast.videoUrl + title) ? (
            <Text style={{ color: COLORS.mute, fontSize: S(20), marginTop: S(4) }}>Sintel © Blender Foundation | durian.blender.org · CC BY 3.0</Text>
          ) : null}
          {!askOpen ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: S(18) }}>
              <View style={{ paddingHorizontal: S(18), paddingVertical: S(8), borderRadius: S(24), backgroundColor: COLORS.accent, marginRight: S(16) }}>
                <Text style={{ color: '#14100A', fontSize: S(24), fontWeight: '800' }}>◉ SELECT</Text>
              </View>
              <Text style={{ color: COLORS.ink, fontSize: S(28) }}>Ask the TV about what you've seen</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* subtitles overlay (parsed cues, rendered by the app) */}
      {cue ? (
        <View style={{ position: 'absolute', left: S(80), right: rightInset + S(80), bottom: showHud ? S(150) : S(90), alignItems: 'center' }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.62)', borderRadius: S(14), paddingHorizontal: S(28), paddingVertical: S(12) }}>
            <Text style={{ color: '#FFFFFF', fontSize: S(46), fontWeight: '600', textAlign: 'center', lineHeight: S(60) }}>{cue.text}</Text>
          </View>
        </View>
      ) : null}

      {/* bottom bar: progress + state */}
      {showHud ? (
        <View style={{ position: 'absolute', left: S(80), right: rightInset + S(80), bottom: S(56) }}>
          <View style={{ height: S(8), borderRadius: S(4), backgroundColor: 'rgba(255,255,255,0.18)' }}>
            <View style={{ height: S(8), borderRadius: S(4), backgroundColor: COLORS.accent, width: `${Math.min(100, (t / (duration || 330)) * 100)}%` }} />
          </View>
          <View style={{ flexDirection: 'row', marginTop: S(12) }}>
            <Text style={{ color: COLORS.ink, fontSize: S(24), fontWeight: '700' }}>{fmtTime(t)}</Text>
            <Text style={{ color: COLORS.mute, fontSize: S(24) }}>{`  /  ${fmtTime(duration || 330)}   ·   ${stateLabel}   ·   ${subsInfo}`}</Text>
          </View>
        </View>
      ) : null}

      {askOpen ? <AskPanel cues={cues} t={t} title={title} phoneQuestion={phoneQ} /> : null}
    </View>
  );
}
