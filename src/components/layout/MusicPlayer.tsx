import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { LOUNGE_TRACK } from '@/lib/music';
import { useSettings } from '@/stores/settingsStore';

/**
 * Background music: one track, looped, in the lounge only (the user's choice). It stops when you
 * leave the lounge for a game or another page and picks up where it left off when you come back.
 * Browsers only allow sound after the visitor has clicked or pressed a key, so if the lounge is the
 * first thing opened, that first gesture starts it.
 */
export function MusicPlayer() {
  const musicOn = useSettings((s) => s.musicOn);
  const volume = useSettings((s) => s.musicVolume);
  const inLounge = useLocation().pathname === '/lounge';
  const audio = useRef<HTMLAudioElement>(null);
  const wanted = useRef(false);
  wanted.current = musicOn && inLounge;

  // Play exactly when it should be heard: switched on, in the lounge, tab in view.
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
  }, [musicOn, inLounge]);

  useEffect(() => {
    if (audio.current) audio.current.volume = Math.min(1, Math.max(0, volume / 100));
  }, [volume]);

  if (!LOUNGE_TRACK) return null;
  return <audio ref={audio} src={LOUNGE_TRACK} loop preload="none" aria-hidden="true" className="hidden" />;
}
