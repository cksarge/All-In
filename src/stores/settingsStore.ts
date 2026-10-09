import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type MotionPreference = 'system' | 'reduce' | 'full';

interface SettingsState {
  soundOn: boolean;
  motion: MotionPreference;
  tourSeen: boolean;
  setSoundOn: (on: boolean) => void;
  toggleSound: () => void;
  setMotion: (m: MotionPreference) => void;
  setTourSeen: (seen: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      soundOn: true,
      motion: 'system',
      tourSeen: false,
      setSoundOn: (soundOn) => set({ soundOn }),
      toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),
      setMotion: (motion) => set({ motion }),
      setTourSeen: (tourSeen) => set({ tourSeen }),
    }),
    { name: 'allin-settings', version: 1 },
  ),
);

export function prefersReducedMotion(pref: MotionPreference): boolean {
  if (pref === 'reduce') return true;
  if (pref === 'full') return false;
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
