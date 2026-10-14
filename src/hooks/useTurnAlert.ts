import { useEffect } from 'react';
import { playSound } from '@/lib/sound';
import { useSettings } from '@/stores/settingsStore';

/**
 * It is your turn at a table and you are looking at another tab: the tab's title flashes until
 * you come back (or the turn passes), and the turn sound plays again after a while in case the
 * first one was missed. `turn` is a value that changes with every new turn, or null when it is
 * not yours. `ring` also plays the sound at once, for tables that have no turn sound of their own.
 */
export function useTurnAlert(turn: string | null, words = 'Your turn', ring = false) {
  const on = useSettings((s) => s.turnAlerts);
  useEffect(() => {
    if (!turn || !on) return;
    let flash: number | null = null;
    let remind: number | null = null;
    let title = '';
    const stop = () => {
      if (flash !== null) {
        window.clearInterval(flash);
        document.title = title;
      }
      if (remind !== null) window.clearTimeout(remind);
      flash = remind = null;
    };
    const start = () => {
      if (flash !== null || !document.hidden) return;
      title = document.title;
      let lit = true;
      document.title = `🔔 ${words}!`;
      flash = window.setInterval(() => {
        lit = !lit;
        document.title = lit ? `🔔 ${words}!` : title;
      }, 1000);
      remind = window.setTimeout(() => playSound('turn'), 8000);
    };
    const onVisibility = () => (document.hidden ? start() : stop());
    if (document.hidden) {
      if (ring) playSound('turn');
      start();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [turn, on, words, ring]);
}
