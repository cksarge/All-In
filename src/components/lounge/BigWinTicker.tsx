import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChipAmount } from '@/components/ui/ChipAmount';
import type { BigWin } from '@/lib/clubs';
import { formatRelativeTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';

/** A quiet strip on the lounge that turns through the latest big wins, one at a time. */
export function BigWinTicker() {
  const [wins, setWins] = useState<BigWin[]>([]);
  const [i, setI] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void supabase.rpc('big_wins_recent').then(({ data }) => {
        if (alive && Array.isArray(data)) setWins(data as BigWin[]);
      });
    load();
    const poll = window.setInterval(load, 60_000);
    const ch = supabase.channel('big-wins').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'big_wins' }, load).subscribe();
    return () => {
      alive = false;
      window.clearInterval(poll);
      void supabase.removeChannel(ch);
    };
  }, []);
  useEffect(() => {
    if (wins.length < 2) return;
    const id = window.setInterval(() => setI((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, [wins.length]);

  if (wins.length === 0) return null;
  const w = wins[i % wins.length];
  return (
    <section aria-label="Recent big wins" className="mb-6 flex items-center gap-3 overflow-hidden rounded-2xl border border-gold-500/25 bg-gold-500/[0.06] px-4 py-2.5">
      <span className="shrink-0 text-[0.65rem] font-bold uppercase tracking-[0.2em] text-gold-300">Big wins</span>
      <div className="relative h-5 min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.p key={w.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="absolute inset-0 truncate text-sm text-cream/90">
            <Link to={`/profile/${w.username}`} className="font-semibold text-ivory hover:underline">
              {w.username}
            </Link>{' '}
            {w.kind === 'tournament' ? 'won a tournament for' : 'won'} <ChipAmount value={w.amount} className="font-semibold text-gold-200" iconClassName="h-3.5 w-3.5" />
            {w.kind === 'round' && (
              <>
                {' '}
                on {w.game ?? 'a game'}
                {w.multiple ? ` (×${Number(w.multiple)})` : ''}
              </>
            )}{' '}
            <span className="text-xs text-muted">· {formatRelativeTime(w.at)}</span>
          </motion.p>
        </AnimatePresence>
      </div>
    </section>
  );
}
