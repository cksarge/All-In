import { useEffect, useRef } from 'react';
import { MUSIC_TRACK } from '@/lib/music';
import { useSettings } from '@/stores/settingsStore';

/**
 * Background music: one track, looped, on every screen (the user's choice). Mounted once, above the
 * routes, so it carries on without a break as you move between screens.
 * Browsers only allow sound after the visitor has clicked or pressed a key, so that first gesture starts it.
 */
export function MusicPlayer() {
  const musicOn = useSettings((s) => s.musicOn);
  const volume = useSettings((s) => s.musicVolume);
  const audio = useRef<HTMLAudioElement>(null);
  const wanted = useRef(musicOn);
  wanted.current = musicOn;

  // Play exactly when it should be heard: switched on, and the tab in view.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const sync = () => {
      if (wanted.current && !document.hidden) void el.play().catch(() => undefined);
      else el.pause();
    };
    sync();
    // Blocked until the first click or key press: try again then. Also pause while the tab is hidden.
    window.addEventListener('pointerdown', sync);
    window.addEventListener('keydown', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('pointerdown', sync);
      window.removeEventListener('keydown', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [musicOn]);

  useEffect(() => {
    if (audio.current) audio.current.volume = Math.min(1, Math.max(0, volume / 100));
  }, [volume]);

  if (!MUSIC_TRACK) return null;
  return <audio ref={audio} src={MUSIC_TRACK} loop preload="none" aria-hidden="true" className="hidden" />;
}
