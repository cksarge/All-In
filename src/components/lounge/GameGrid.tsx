import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { GameIcon } from '@/components/ui/GameIcon';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { CATEGORIES, gameHref, gameMode, modeLabel, type CategoryKey } from '@/lib/games';
import { supabase } from '@/lib/supabase';
import type { GameRow } from '@/lib/types';
import { useSettings } from '@/stores/settingsStore';

type Filter = 'all' | CategoryKey;

const MODE_TAG = {
  tables: { text: 'Live', className: 'bg-felt-600/60 text-felt-300' },
  room: { text: 'Live', className: 'bg-felt-600/60 text-felt-300' },
  solo: { text: 'Solo', className: 'bg-white/[0.07] text-cream/75' },
  tournament: { text: 'Tournament', className: 'bg-gold-500/20 text-gold-200' },
} as const;

function GameCard({ g, jackpot, index }: { g: GameRow; jackpot: number | undefined; index: number }) {
  const tag = MODE_TAG[gameMode(g)];
  const starred = useSettings((s) => s.favourites.includes(g.key));
  const toggleFavourite = useSettings((s) => s.toggleFavourite);
  return (
    <motion.li
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className="surface group relative flex gap-4 p-4 transition hover:border-gold-500/30"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-white/[0.07] bg-gradient-to-br from-felt-800 to-ink-900">
        <GameIcon gameKey={g.key} className="h-9 w-9" />
      </div>
      {g.released && (
        <button
          type="button"
          aria-pressed={starred}
          aria-label={starred ? `Remove ${g.name} from your favourites` : `Add ${g.name} to your favourites`}
          onClick={() => toggleFavourite(g.key)}
          className={cn('absolute right-2 top-2 z-10 rounded-lg p-1.5 text-lg leading-none transition hover:bg-white/[0.08]', starred ? 'text-gold-300' : 'text-white/25 hover:text-white/60')}
        >
          {starred ? '★' : '☆'}
        </button>
      )}
      <div className="min-w-0 pr-6">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-display text-lg font-bold leading-tight text-ivory">{g.name}</h4>
          {g.released ? (
            <span className={cn('rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider', tag.className)}>{tag.text}</span>
          ) : (
            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">
              Opening soon
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">{g.tagline}</p>
        {g.released && jackpot !== undefined && (
          <p className="mt-1.5 text-sm text-gold-200">
            Jackpot now <ChipAmount value={jackpot} className="font-bold" iconClassName="h-4 w-4" color="gold" />
          </p>
        )}
        {/* The tag already says "Solo"; only add a line when there is more to say. */}
        {modeLabel(g) !== 'Solo' && <p className="mt-1.5 text-xs text-subtle">{modeLabel(g)}</p>}
        {g.released && (
          <Link
            to={gameHref(g)}
            className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-gold-300 after:absolute after:inset-0 hover:underline"
          >
            {gameMode(g) === 'tournament' ? 'See tournaments →' : g.multiplayer ? 'Find a table →' : 'Play now →'}
          </Link>
        )}
      </div>
    </motion.li>
  );
}

/** Every game, grouped into the four sections of the lounge. */
export function GameGrid() {
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [jackpots, setJackpots] = useState<Record<string, number>>({});

  const load = async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('games')
      .select('key, name, category, tagline, multiplayer, max_seats, sort_order, released')
      .order('sort_order');
    if (err) setError(friendlyError(err));
    else setGames((data ?? []) as GameRow[]);
    // The jackpot is a nice-to-have on the card: ignore errors (e.g. before 10_slots.sql is run).
    const { data: pots } = await supabase.from('jackpots').select('game_key, amount');
    if (pots) setJackpots(Object.fromEntries(pots.map((p) => [p.game_key as string, p.amount as number])));
  };

  useEffect(() => {
    void load();
  }, []);

  const sections = useMemo(
    () =>
      CATEGORIES.filter((c) => filter === 'all' || c.key === filter).map((c) => ({
        ...c,
        games: (games ?? []).filter((g) => g.category === c.key),
      })),
    [games, filter],
  );
  const favourites = useSettings((s) => s.favourites);
  const recent = useSettings((s) => s.recentGames);
  const byKey = new Map((games ?? []).map((g) => [g.key, g]));
  const shelf = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((g): g is GameRow => Boolean(g && g.released));
  const count = (key: CategoryKey) => (games ?? []).filter((g) => g.category === key).length;

  return (
    <section aria-labelledby="games-title" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="games-title" className="font-display text-2xl font-bold text-ivory sm:text-3xl">
            The games
          </h2>
          <p className="mt-1 text-sm text-muted">
            <span className="font-semibold text-felt-300">Live</span> games are played with other people.{' '}
            <span className="font-semibold text-cream/80">Solo</span> games are just you and the house.
          </p>
        </div>
        <div role="tablist" aria-label="Filter games" className="flex flex-wrap gap-1.5">
          {[{ key: 'all' as const, label: 'All games' }, ...CATEGORIES].map((f) => (
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
              {f.key === 'all' ? f.label : f.label.replace(' games', '')}
              {games && f.key !== 'all' && <span className="ml-1.5 text-xs opacity-60">{count(f.key)}</span>}
            </button>
          ))}
        </div>
      </div>

      {games && (shelf(recent).length > 0 || shelf(favourites).length > 0) && (
        <div className="mt-5 space-y-2">
          {[
            { label: 'Jump back in', list: shelf(recent).slice(0, 5) },
            { label: 'Your favourites', list: shelf(favourites) },
          ]
            .filter((r) => r.list.length > 0)
            .map((r) => (
              <div key={r.label} className="flex flex-wrap items-center gap-2" role="group" aria-label={r.label}>
                <span className="w-full text-xs font-semibold uppercase tracking-[0.18em] text-gold-400 sm:w-32">{r.label}</span>
                {r.list.map((g) => (
                  <Link key={g.key} to={gameHref(g)} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-950/40 py-1 pl-1.5 pr-3 text-sm font-medium text-cream hover:border-gold-500/50 hover:text-ivory">
                    <GameIcon gameKey={g.key} className="h-6 w-6" />
                    {g.name}
                  </Link>
                ))}
              </div>
            ))}
        </div>
      )}

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
      ) : games.length === 0 ? (
        <div className="surface mt-6">
          <EmptyState title="No games here yet" message="Check back soon." />
        </div>
      ) : (
        sections.map((s) => (
          <section key={s.key} aria-labelledby={`games-${s.key}`} className="mt-8">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 id={`games-${s.key}`} className="font-display text-xl font-bold text-gold-200">
                {s.label}
              </h3>
              <p className="text-sm text-muted">{s.blurb}</p>
              <span className="ml-auto text-xs text-subtle">
                {s.games.length} game{s.games.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="gold-rule mt-2 opacity-50" />
            <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {s.games.map((g, i) => (
                <GameCard key={g.key} g={g} jackpot={jackpots[g.key]} index={i} />
              ))}
            </ul>
          </section>
        ))
      )}
    </section>
  );
}
