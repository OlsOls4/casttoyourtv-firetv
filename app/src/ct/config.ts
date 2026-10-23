import { BUILD } from './buildConfig';

export const API_BASE = 'https://casttoyourtv-firetv.vercel.app';
export const SENDER_URL = `${API_BASE}/s/`;

export type Cast = {
  videoUrl: string;
  subtitleUrl?: string;
  title?: string;
  startAt?: number;
  posterUrl?: string;
  source?: 'phone' | 'demo';
  code?: string; // pairing code, so the phone can keep asking questions during playback
  viewer?: Viewer; // who cast it (name + language), from the phone page
};

export type Viewer = { name?: string; lang?: string };

// Languages the phone page offers ("Who's watching?").
export const LANG_NAMES: Record<string, string> = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', pl: 'Polish', hi: 'Hindi', ja: 'Japanese', it: 'Italian', pt: 'Portuguese',
};
export const langName = (l?: string) => LANG_NAMES[l || 'en'] || 'English';
// Translate into the household's language; when that is English, fall back to Spanish (labelled on the chip).
export const translateTarget = (l?: string) => (l && l !== 'en' && LANG_NAMES[l] ? l : 'es');

export const DEMO_CAST: Cast = {
  videoUrl: `${API_BASE}/media/sintel-0-330-480p.mp4`,
  subtitleUrl: `${API_BASE}/media/sintel_en.srt`,
  title: 'Sintel',
  startAt: 100,
  posterUrl: `${API_BASE}/media/sintel-poster.jpg`,
  source: 'demo',
};

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function newPairCode(): string {
  if (BUILD.pairCode) return BUILD.pairCode;
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export const COLORS = {
  bg: '#0B0F1A',
  panel: '#121829',
  card: '#182036',
  ink: '#F4F1EA',
  mute: '#9AA3B8',
  dim: '#5D6680',
  accent: '#FFB547',
  accent2: '#FF7A59',
  violet: '#7C5CFF',
  ok: '#6EE7A8',
};

export function fmtTime(t: number): string {
  const s = Math.max(0, Math.floor(t || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
