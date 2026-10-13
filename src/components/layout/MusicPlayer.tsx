import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { gameTheme, HAS_MUSIC, PLAYLIST, shuffledOrder } from '@/lib/music';
import { useSettings } from '@/stores/settingsStore';

/**
 * Background music (the user's choice): the playlist in a random order on every screen, each track once
 * before any repeats, and a game's own theme looped while that game is open (Haunted Manor has one).
 * Mounted once, above the routes, so the music carries on without a break as you move between screens.
 * There are two players: the playlist is only paused while a theme plays, and picks up where it was.
 * Browsers only allow sound after the visitor has clicked or pressed a key, so that first gesture starts it.
 */
export function MusicPlayer() {
  const musicOn = useSettings((s) => s.musicOn);
  const volume = useSettings((s) => s.musicVolume);
  const { pathname } = useLocation();
  const theme = gameTheme(/^\/play\/([^/]+)/.exec(pathname)?.[1]);
  const list = useRef<HTMLAudioElement>(null);
  const game = useRef<HTMLAudioElement>(null);

  // The random order being played, and where we are in it.
  const order = useRef<number[]>([]);
  const [track, setTrack] = useState<number | null>(() => {
    order.current = shuffledOrder(null);
    return order.current.shift() ?? null;
  });
  const next = useCallback(() => {
    setTrack((was) => {
      if (order.current.length === 0) order.current = shuffledOrder(was);
      return order.current.shift() ?? null;
    });
  }, []);

  // Play exactly what should be heard: switched on, the tab in view, and the theme instead of the playlist
  // on a game that has one.
  const wanted = useRef({ musicOn, theme });
  wanted.current = { musicOn, theme };
  const sync = useCallback(() => {
    const on = wanted.current.musicOn && !document.hidden;
    const themed = Boolean(wanted.current.theme);
    const play = (el: HTMLAudioElement | null, yes: boolean) => {
      if (!el) return;
      if (yes) void el.play().catch(() => undefined);
      else el.pause();
    };
    play(list.current, on && !themed);
    play(game.current, on && themed);
  }, []);

  useEffect(() => {
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
  }, [sync, musicOn, theme, track]);

  // A game's theme starts from its beginning each time the game is opened.
  useEffect(() => {
    if (theme && game.current) game.current.currentTime = 0;
  }, [theme]);

  useEffect(() => {
    const v = Math.min(1, Math.max(0, volume / 100));
    if (list.current) list.current.volume = v;
    if (game.current) game.current.volume = v;
  }, [volume, theme, track]);

  if (!HAS_MUSIC) return null;
  return (
    <>
      {track !== null && (
        <audio
          ref={list}
          src={PLAYLIST[track]}
          // One track in the playlist: just loop it. Otherwise move on when it ends (a file that fails is skipped).
          loop={PLAYLIST.length === 1}
          onEnded={next}
          onError={PLAYLIST.length > 1 ? next : undefined}
          preload="none"
          aria-hidden="true"
          className="hidden"
        />
      )}
      {theme && <audio ref={game} src={theme} loop preload="none" aria-hidden="true" className="hidden" />}
    </>
  );
}
