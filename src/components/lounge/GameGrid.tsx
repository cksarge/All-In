import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { GameIcon } from '@/components/ui/GameIcon';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { GameRow } from '@/lib/types';

const FILTERS = [
  { key: 'all', label: 'All games' },
  { key: 'table', label: 'Table' },
  { key: 'poker', label: 'Poker' },
  { key: 'slots', label: 'Slots' },
  { key: 'specialty', label: 'Specialty' },
] as const;

type Filter = (typeof FILTERS)[number]['key'];

export function GameGrid() {
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('games')
      .select('key, name, category, tagline, multiplayer, max_seats, sort_order, released')
      .order('sort_order');
    if (err) setError(friendlyError(err));
    else setGames((data ?? []) as GameRow[]);
  };

  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(
    () => (games ?? []).filter((g) => filter === 'all' || g.category === filter),
    [games, filter],
  );

  return (
    <section aria-labelledby="games-title" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="games-title" className="font-display text-2xl font-bold text-ivory sm:text-3xl">
            The games
          </h2>
          <p className="mt-1 text-sm text-muted">Tables are being set up now. New games open as they’re ready.</p>
        </div>
        <div role="tablist" aria-label="Filter games" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                filter === f.key
                  ? 'border-gold-500/60 bg-gold-500/15 text-gold-200'
                  : 'border-white/10 text-cream/75 hover:border-white/20 hover:text-ivory',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="surface mt-6">
          <ErrorState title="Couldn't load the games" message={error} onRetry={() => void load()} />
        </div>
      ) : games === null ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="surface mt-6">
          <EmptyState title="No games here yet" message="Check back soon." />
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((g, i) => (
            <motion.li
              key={g.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.4) }}
              className="surface group relative flex gap-4 p-5 transition hover:border-gold-500/30"
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-gradient-to-br from-felt-800 to-ink-900">
                <GameIcon gameKey={g.key} />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-bold text-ivory">{g.name}</h3>
                  {g.released ? (
                    <span className="rounded-full bg-felt-600/60 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-felt-300">
                      Open
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
                      Opening soon
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted">{g.tagline}</p>
                <p className="mt-2 text-xs text-subtle">
                  {g.multiplayer ? `Multiplayer · up to ${g.max_seats} seats` : 'Solo play'}
                </p>
                {g.released && (
                  <Link
                    to={g.multiplayer ? `/lobby?game=${g.key}` : `/play/${g.key}`}
                    className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-gold-300 after:absolute after:inset-0 hover:underline"
                  >
                    Play now →
                  </Link>
                )}
              </div>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
