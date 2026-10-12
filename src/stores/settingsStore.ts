import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MotionPreference = 'system' | 'reduce' | 'full';

interface SettingsState {
  soundOn: boolean;
  /** Background music (separate from the sound effects), and how loud: 0 to 100. */
  musicOn: boolean;
  musicVolume: number;
  setMusicOn: (on: boolean) => void;
  setMusicVolume: (v: number) => void;
  motion: MotionPreference;
  tourSeen: boolean;
  /** First-visit game guides: on or off, and which have been shown. */
  tipsOn: boolean;
  tipsSeen: Record<string, true>;
  /** Starred games, and the last few played, newest first. Kept on this device. */
  favourites: string[];
  recentGames: string[];
  toggleFavourite: (key: string) => void;
  noteGame: (key: string) => void;
  setSoundOn: (on: boolean) => void;
  toggleSound: () => void;
  setMotion: (m: MotionPreference) => void;
  setTourSeen: (seen: boolean) => void;
  setTipsOn: (on: boolean) => void;
  markTipSeen: (key: string) => void;
  resetTips: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      soundOn: true,
      musicOn: true,
      musicVolume: 30,
      setMusicOn: (musicOn) => set({ musicOn }),
      setMusicVolume: (musicVolume) => set({ musicVolume: Math.min(100, Math.max(0, Math.round(musicVolume))) }),
      motion: 'system',
      tourSeen: false,
      tipsOn: true,
      tipsSeen: {},
      favourites: [],
      recentGames: [],
      toggleFavourite: (key) => set((s) => ({ favourites: s.favourites.includes(key) ? s.favourites.filter((k) => k !== key) : [...s.favourites, key] })),
      noteGame: (key) => set((s) => (s.recentGames[0] === key ? s : { recentGames: [key, ...s.recentGames.filter((k) => k !== key)].slice(0, 6) })),
      setSoundOn: (soundOn) => set({ soundOn }),
      toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
      setMotion: (motion) => set({ motion }),
      setTourSeen: (tourSeen) => set({ tourSeen }),
      setTipsOn: (tipsOn) => set({ tipsOn }),
      markTipSeen: (key) => set((s) => ({ tipsSeen: { ...s.tipsSeen, [key]: true } })),
      resetTips: () => set({ tipsOn: true, tipsSeen: {} }),
    }),
    { name: 'allin-settings', version: 1 },
  ),
);

export function prefersReducedMotion(pref: MotionPreference): boolean {
  if (pref === 'reduce') return true;
  if (pref === 'full') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
