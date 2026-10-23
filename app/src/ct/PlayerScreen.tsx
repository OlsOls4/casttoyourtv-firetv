import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Image, Text, TouchableOpacity, View } from 'react-native';
import { BackHandler, HWEvent, useComponentInstance, useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { AskPanel, PANEL_W, PhoneQuestion } from './AskPanel';
import { CttvMediaControls } from './mediaControls';
import { API_BASE, Cast, COLORS, fmtTime, langName } from './config';
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
  // "Who's asking": the language of the last viewer who cast or asked (drives the Translate chip).
  const [houseLang, setHouseLang] = useState(cast.viewer?.lang || 'en');
  // "Stepping out": when each viewer left, so "I'm back" can recap exactly the stretch they missed.
  const awaySince = useRef<Record<string, number>>({});
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backArmed = useRef(0);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background');

  const tRef = useRef(cast.startAt || 0);
  const pausedRef = useRef(false);
  const clockMode = useRef(false); // subtitle clock when the decoder isn't advancing (e.g. emulator without video)
  const lastAdvance = useRef(Date.now());
  const lastVideoT = useRef(-1);
  const title = cast.title || 'Now playing';
  const componentInstance = useComponentInstance();
  const lastToggle = useRef(0);

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
          console.info(`[CTTV] subtitle fetch failed: ${String(e)}`);
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
            console.info(`[CTTV] seek failed ${String(e)}`);
          }
        });
        let firstPlay = true;
        v.addEventListener('playing', () => {
          if (firstPlay) {
            firstPlay = false;
            console.info(`[CTTV] decoder playing at ${Number(v.currentTime || 0).toFixed(1)}s`);
          }
          setState(pausedRef.current ? 'paused' : 'playing');
        });
        v.addEventListener('error', () => {
          console.info('[CTTV] video error -> subtitle clock');
          clockMode.current = true;
          setState('clock');
        });
        // Vega Media Controls: system transport / Alexa drive this player (KeplerMediaControlHandler).
        try {
          await v.setMediaControlFocus(componentInstance, new CttvMediaControls({
            play: () => (askOpenRef.current ? closeAsk() : resume()),
            pause: () => pause(),
            toggle: () => togglePlay('media control'),
            seekTo: (s: number) => seek(s - tRef.current),
            seekBy: (d: number) => seek(d),
          }));
          console.info('[CTTV] media controls: setMediaControlFocus OK (KeplerMediaControlHandler registered)');
        } catch (e) {
          console.info(`[CTTV] media controls unavailable: ${String(e)}`);
        }
        v.autoplay = true;
        v.src = cast.videoUrl;
        console.info(`[CTTV] playing ${cast.videoUrl} from ${cast.startAt || 0}s`);
      } catch (e) {
        console.info(`[CTTV] player init failed: ${String(e)}`);
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
      console.info(`[CTTV] deinit ${String(e)}`);
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
          console.info('[CTTV] decoder not advancing -> subtitle clock');
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

  const showToast = (msg: string, ms = 4500) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  };

  // One toggle per press, whether it arrives as a key event or through Vega Media Controls.
  const togglePlay = (via: string) => {
    const now = Date.now();
    if (now - lastToggle.current < 500) return;
    lastToggle.current = now;
    console.info(`[CTTV] play/pause via ${via} -> ${pausedRef.current ? 'play' : 'pause'}`);
    (pausedRef.current ? resume : pause)();
  };

  const openAsk = () => {
    if (askOpenRef.current) return;
    askOpenRef.current = true;
    pause();
    setAskOpen(true);
    console.info(`[CTTV] Ask the TV opened at ${fmtTime(tRef.current)}`);
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

  // Phone -> TV while watching (through the relay): free questions, "Stepping out", "I'm back", who's watching.
  const onPhoneItem = (item: any) => {
    const name = String(item.name || '').trim();
    const who = name || 'Someone';
    const key = name.toLowerCase() || '_';
    if (item.lang) setHouseLang(item.lang);
    const type = item.type || (item.text ? 'ask' : '');
    if (type === 'viewer') {
      console.info(`[CTTV] viewer ${who} (${item.lang || 'en'})`);
      showToast(`${who} is watching · answers in ${langName(item.lang)}`);
    } else if (type === 'away') {
      awaySince.current[key] = tRef.current;
      console.info(`[CTTV] ${who} stepped out at ${fmtTime(tRef.current)}`);
      showToast(`${who} stepped out at ${fmtTime(tRef.current)} · I'll catch ${name ? name : 'them'} up`, 8000);
    } else if (type === 'back') {
      const since = awaySince.current[key] ?? Math.max(0, tRef.current - 90);
      delete awaySince.current[key];
      console.info(`[CTTV] ${who} is back: recap ${fmtTime(since)} -> ${fmtTime(tRef.current)}`);
      openAsk();
      setPhoneQ({ id: item.id, kind: 'missed', name, lang: item.lang, since });
    } else if (item.text) {
      console.info(`[CTTV] phone question from ${who} [${item.lang || 'en'}] (${item.via}): ${item.text}`);
      openAsk();
      setPhoneQ({ id: item.id, kind: 'ask', text: item.text, via: item.via, name, lang: item.lang });
    }
  };
  useEffect(() => {
    if (!cast.code || !appActive) return; // no polling while the app is in the background
    let alive = true;
    const id = setInterval(async () => {
      try {
        const r = await fetch(`${API_BASE}/api/relay?code=${cast.code}&q=1`);
        const j = await r.json();
        if (alive && j && j.question) onPhoneItem(j.question);
      } catch (e) {}
    }, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast.code, appActive]);

  // App lifecycle: pause and stop polling in the background; on return, poll again but stay paused.
  useEffect(() => {
    let sub: { remove: () => void } | null = null;
    try {
      sub = AppState.addEventListener('change', (next: AppStateStatus) => {
        const active = next === 'active';
        console.info(`[CTTV] lifecycle ${next}${active ? ' -> polling resumed (still paused)' : ' -> paused, polling stopped'}`);
        if (!active) pause();
        setAppActive(active);
      });
      console.info(`[CTTV] lifecycle listener on (${AppState.currentState})`);
    } catch (e) {
      console.info(`[CTTV] AppState unavailable: ${String(e)}`);
    }
    return () => sub?.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useTVEventHandler((evt: HWEvent) => {
    if (!evt || evt.eventKeyAction !== 0) return;
    const k = evt.eventType;
    if (askOpen) return;
    if (k === 'menu') openAsk();
    else if (k === 'playpause' || k === 'playPause') togglePlay('remote key');
    else if (k === 'left' || k === 'rewind') seek(-10);
    else if (k === 'right' || k === 'fastforward') seek(10);
  });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (askOpen) {
        closeAsk();
      } else if (Date.now() - backArmed.current < 4000) {
        console.info('[CTTV] back twice -> exit player');
        onExit();
      } else {
        // A stray Back shouldn't lose the film: ask for a second press.
        backArmed.current = Date.now();
        showToast('Press Back again to exit', 4000);
      }
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

      {toast ? (
        <View style={{ position: 'absolute', top: S(56), right: rightInset + S(80), maxWidth: S(820), backgroundColor: 'rgba(20,26,43,0.94)', borderRadius: S(20), borderWidth: S(2), borderColor: 'rgba(255,181,71,0.45)', paddingHorizontal: S(28), paddingVertical: S(16) }}>
          <Text style={{ color: COLORS.ink, fontSize: S(28), fontWeight: '700' }}>{toast}</Text>
        </View>
      ) : null}

      {askOpen ? <AskPanel cues={cues} t={t} title={title} phoneQuestion={phoneQ} householdLang={houseLang} /> : null}
    </View>
  );
}
