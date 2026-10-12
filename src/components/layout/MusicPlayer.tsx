import { useEffect, useRef } from 'react';
import { shuffledOrder, TRACKS } from '@/lib/music';
import { useSettings } from '@/stores/settingsStore';

/**
 * Background music. Mounted once, above the routes, so it carries on between screens.
 * Plays every track in a random order, then shuffles again. Browsers only allow sound after
 * the visitor has clicked or pressed a key, so that first gesture starts it.
 */
export function MusicPlayer() {
  const musicOn = useSettings((s) => s.musicOn);
  const volume = useSettings((s) => s.musicVolume);
  const audio = useRef<HTMLAudioElement>(null);
  const queue = useRef<number[]>([]);
  const last = useRef(-1);
  const failures = useRef(0);
  const wanted = useRef(musicOn);
  wanted.current = musicOn;

  useEffect(() => {
    const el = audio.current;
    if (!el || TRACKS.length === 0) return;

    const play = () => {
      if (!wanted.current || document.hidden) return;
      // Blocked until the first click or key press: the listeners below try again then.
      void el.play().catch(() => undefined);
    };
    const next = () => {
      if (queue.current.length === 0) queue.current = shuffledOrder(TRACKS.length, last.current);
      const i = queue.current.shift()!;
      last.current = i;
      el.src = TRACKS[i];
      play();
    };
    const onEnded = () => {
      failures.current = 0;
      next();
    };
    // A file this browser can't play: move on, but give up if none of them work.
    const onError = () => {
      failures.current += 1;
      if (failures.current <= TRACKS.length) next();
    };
    const onGesture = () => {
      if (el.paused) play();
    };
    const onVisible = () => {
      if (document.hidden) el.pause();
      else play();
    };
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    window.addEventListener('pointerdown', onGesture);
    window.addEventListener('keydown', onGesture);
    document.addEventListener('visibilitychange', onVisible);
    next();
    return () => {
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      document.removeEventListener('visibilitychange', onVisible);
      el.pause();
    };
  }, []);

  // The Settings switch and the volume.
  useEffect(() => {
    const el = audio.current;
    if (!el || TRACKS.length === 0) return;
    el.volume = Math.min(1, Math.max(0, volume / 100));
    if (!musicOn) el.pause();
    else if (el.paused && !document.hidden) void el.play().catch(() => undefined);
  }, [musicOn, volume]);

  if (TRACKS.length === 0) return null;
  return <audio ref={audio} preload="none" aria-hidden="true" className="hidden" />;
}
