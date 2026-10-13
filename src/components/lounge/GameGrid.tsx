import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { GameIcon } from '@/components/ui/GameIcon';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { CATEGORIES, gameHref, gameMode, modeLabel, type CategoryKey, inSeason, seasonLabel } from '@/lib/games';
import { supabase } from '@/lib/supabase';
import type { GameRow } from '@/lib/types';
import { useSettings } from '@/stores/settingsStore';

type Filter = 'all' | CategoryKey;
type Kind = 'any' | 'live' | 'solo' | 'tournament' | 'favourites';
const KINDS: { key: Kind; label: string }[] = [
  { key: 'any', label: 'Live and solo' },
  { key: 'live', label: 'Live only' },
  { key: 'solo', label: 'Solo only' },
  { key: 'tournament', label: 'Tournaments' },
  { key: 'favourites', label: 'My favourites' },
];

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
          {g.season && (
            <span className="rounded-full bg-[#ffb057]/15 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[#ffb057]">This month only</span>
          )}
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
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('any');

  const load = async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('games')
      .select('*')
      .order('sort_order');
    if (err) setError(friendlyError(err));
    else setGames(((data ?? []) as GameRow[]).filter(inSeason));
    // The jackpot is a nice-to-have on the card: ignore errors (e.g. before 10_slots.sql is run).
    const { data: pots } = await supabase.from('jackpots').select('game_key, amount');
    if (pots) setJackpots(Object.fromEntries(pots.map((p) => [p.game_key as string, p.amount as number])));
  };

  useEffect(() => {
    void load();
  }, []);

  const favourites = useSettings((s) => s.favourites);
  const q = query.trim().toLowerCase();
  const narrowed = q !== '' || kind !== 'any';
  const sections = useMemo(() => {
    const matches = (g: GameRow) => {
      const mode = gameMode(g);
      if (kind === 'live' && mode !== 'tables' && mode !== 'room') return false;
      if (kind === 'solo' && mode !== 'solo') return false;
      if (kind === 'tournament' && mode !== 'tournament') return false;
      if (kind === 'favourites' && !favourites.includes(g.key)) return false;
      // Every word typed must appear in the name or the tagline.
      return q === '' || q.split(/\s+/).every((w) => `${g.name} ${g.tagline}`.toLowerCase().includes(w));
    };
    return CATEGORIES.filter((c) => filter === 'all' || c.key === filter)
      .map((c) => ({ ...c, games: (games ?? []).filter((g) => g.category === c.key && matches(g)) }))
      .filter((c) => !narrowed || c.games.length > 0);
  }, [games, filter, q, kind, favourites, narrowed]);
  const recent = useSettings((s) => s.recentGames);
  const byKey = new Map((games ?? []).map((g) => [g.key, g]));
  const shelf = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((g): g is GameRow => Boolean(g && g.released));
  const seasonal = (games ?? []).find((g) => g.season && g.released);
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
      </div>

      {/* One toolbar: search, what kind of game, then the sections. */}
      <div className="surface mt-4 flex flex-wrap items-center gap-2 p-2.5">
        <label className="sr-only" htmlFor="game-search">
          Search the games
        </label>
        <div className="relative min-w-0 flex-1 basis-48 sm:max-w-xs">
          <input
            id="game-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the games…"
            autoComplete="off"
            className="h-9 w-full rounded-lg border border-white/10 bg-ink-950/60 pl-9 pr-3 text-sm text-ivory placeholder:text-subtle"
          />
          <svg viewBox="0 0 20 20" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="9" cy="9" r="5.5" />
            <path d="M13.5 13.5L17 17" />
          </svg>
        </div>
        <label className="sr-only" htmlFor="game-kind">
          Kind of game
        </label>
        <select
          id="game-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className={cn(
            'h-9 rounded-lg border bg-ink-950/60 px-2.5 text-sm',
            kind === 'any' ? 'border-white/10 text-cream/80' : 'border-gold-500/60 text-gold-200',
          )}
        >
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
        {narrowed && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setKind('any');
            }}
            className="px-1 text-xs font-semibold text-gold-300 hover:underline"
          >
            Clear
          </button>
        )}
        <div role="tablist" aria-label="Section" className="flex flex-wrap gap-1.5 lg:ml-auto">
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

      {seasonal && !narrowed && (
        <Link
          to={gameHref(seasonal)}
          className="group relative mt-5 flex items-center gap-4 overflow-hidden rounded-2xl border border-[#ffb057]/40 p-4 transition hover:border-[#ffb057]/80 sm:p-5"
          style={{ background: 'linear-gradient(110deg, #2b1247, #130a24 60%, #3a1a08)' }}
        >
          <span aria-hidden="true" className="haunt-bob text-4xl sm:text-5xl">👻</span>
          <span className="min-w-0">
            <span className="block text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-[#ffb057]">
              Seasonal game · {seasonLabel(seasonal.season ?? '')} only
            </span>
            <span className="mt-0.5 block font-display text-xl font-bold text-ivory sm:text-2xl">{seasonal.name}</span>
            <span className="mt-0.5 block text-sm text-cream/75">{seasonal.tagline}</span>
          </span>
          <span className="ml-auto hidden shrink-0 text-sm font-semibold text-[#ffb057] group-hover:underline sm:block">Play now →</span>
          <span aria-hidden="true" className="haunt-flicker absolute right-3 top-2 text-lg sm:hidden">🎃</span>
        </Link>
      )}

      {games && !narrowed && (shelf(recent).length > 0 || shelf(favourites).length > 0) && (
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
      ) : sections.length === 0 ? (
        <div className="surface mt-6">
          <EmptyState title="No games match" message="Try a different word, or clear the search." />
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
