import { useEffect, useRef, useState } from 'react';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { formatChips, formatRelativeTime } from '@/lib/format';
import type { SlotJackpot } from '@/lib/slots';
import { supabase } from '@/lib/supabase';

/**
 * The live jackpot for a machine: starts from what slot_info returned and follows
 * Realtime changes. While `frozen` (your own spin is still being shown) it holds
 * its value so a win isn't given away early.
 */
export function useJackpot(game: string, initial: SlotJackpot | null, frozen: boolean): SlotJackpot | null {
  const [shown, setShown] = useState(initial);
  const latest = useRef(initial);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  // slot_info (re)loaded, or the machine told us the pot after our own spin.
  useEffect(() => {
    latest.current = initial;
    setShown(initial);
  }, [initial]);

  useEffect(() => {
    if (!initial) return;
    const channel = supabase
      .channel(`jackpot:${game}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jackpots', filter: `game_key=eq.${game}` }, (payload) => {
        latest.current = { ...latest.current, ...(payload.new as SlotJackpot) };
        if (!frozenRef.current) setShown(latest.current);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [game, Boolean(initial)]);

  useEffect(() => {
    if (!frozen) setShown(latest.current);
  }, [frozen]);

  return shown;
}

/** Counts smoothly from the old number to the new one. */
function useCountTo(value: number, ms = 700): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value) return;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const v = Math.round(start + (value - start) * (1 - Math.pow(1 - k, 3)));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

export function JackpotTicker({ jackpot }: { jackpot: SlotJackpot }) {
  const amount = useCountTo(jackpot.amount);
  return (
    <div className="tier-vip rounded-2xl border px-4 py-3 text-center">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-gold-300">Grand Jackpot</p>
      <p className="mt-0.5 flex items-center justify-center gap-2 font-display text-3xl font-black tabular-nums text-gold-200 sm:text-4xl">
        <ChipIcon className="h-7 w-7 sm:h-8 sm:w-8" color="gold" />
        <span aria-hidden="true">{formatChips(amount)}</span>
        <span className="sr-only">{formatChips(jackpot.amount)} play chips</span>
      </p>
      <p className="mt-1 text-xs text-cream/70">
        {jackpot.last_winner && jackpot.last_amount && jackpot.last_won_at
          ? `Last won by ${jackpot.last_winner}: ${formatChips(jackpot.last_amount)} chips, ${formatRelativeTime(jackpot.last_won_at)}`
          : 'Nobody has won it yet. It grows with every spin.'}
      </p>
    </div>
  );
}
