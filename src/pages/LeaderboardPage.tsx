import { SectionNav } from '@/components/layout/SectionNav';
import { useEffect, useState } from 'react';
import { PlayerLine } from '@/components/progress/bits';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import type { PlayerCard } from '@/lib/progress';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/authStore';

const BOARDS = [
  { key: 'level', label: 'Level', blurb: 'Most experience earned.' },
  { key: 'chips', label: 'Chips', blurb: 'The biggest stacks right now.' },
  { key: 'biggest_win', label: 'Biggest win', blurb: 'The most won in a single round.' },
  { key: 'week', label: 'This week', blurb: 'Net chips won since Monday (UTC), for everyone who has played.' },
] as const;
type Board = (typeof BOARDS)[number]['key'];

interface Row extends PlayerCard {
  rank: number;
  value: number;
}
interface Data {
  /** Which scope these rows are for (the toggle can be ahead of the data while it loads). */
  friends: boolean;
  rows: Row[];
  me: { rank: number; value: number } | null;
}

function Value({ board, value }: { board: Board; value: number }) {
  if (board === 'level') return <span className="tabular-nums text-cream/85">{value.toLocaleString('en-US')} XP</span>;
  return <ChipAmount value={value} signed={board === 'week'} className={cn('font-semibold', board === 'week' && value < 0 ? 'text-ruby-300' : 'text-gold-200')} iconClassName="h-4 w-4" />;
}

export default function LeaderboardPage() {
  const userId = useAuth((s) => s.user?.id);
  const [board, setBoard] = useState<Board>('level');
  const [friends, setFriends] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const { data: d, error: err } = await supabase.rpc('leaderboard', { p_board: board, p_friends: friends });
    if (err) setError(friendlyError(err));
    else setData(d as Data);
  };
  useEffect(() => {
    setData(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, friends]);

  const pill = (active: boolean) =>
    cn(
      'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
      active ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:border-white/20 hover:text-ivory',
    );
  const meta = BOARDS.find((b) => b.key === board)!;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      <SectionNav />
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">The standings</p>
      <h1 className="font-display text-4xl font-bold text-ivory">Leaderboards</h1>

      <div role="tablist" aria-label="Board" className="mt-6 flex flex-wrap gap-1.5">
        {BOARDS.map((b) => (
          <button key={b.key} role="tab" aria-selected={board === b.key} onClick={() => setBoard(b.key)} className={pill(board === b.key)}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{meta.blurb}</p>
        <div role="radiogroup" aria-label="Who to show" className="flex gap-1.5">
          <button role="radio" aria-checked={!friends} onClick={() => setFriends(false)} className={pill(!friends)}>
            Everyone
          </button>
          <button role="radio" aria-checked={friends} onClick={() => setFriends(true)} className={pill(friends)}>
            Friends
          </button>
        </div>
      </div>

      <div className="surface mt-5">
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : !data ? (
          <LoadingState label="Counting chips…" />
        ) : data.rows.length === 0 ? (
          <EmptyState title="Nobody here yet" message={board === 'week' ? 'Nobody has played this week. Be the first.' : 'Play a round to get on the board.'} />
        ) : (
          <ol className="divide-y divide-white/[0.06]">
            {data.rows.map((r) => (
              <li key={r.user_id} className={cn('flex items-center gap-3 px-4 py-3', r.user_id === userId && 'bg-gold-500/[0.07]')}>
                <span
                  className={cn(
                    'w-8 shrink-0 text-center font-display text-lg font-bold tabular-nums',
                    r.rank === 1 ? 'text-gold-300' : r.rank <= 3 ? 'text-cream' : 'text-subtle',
                  )}
                  aria-label={`Rank ${r.rank}`}
                >
                  {r.rank}
                </span>
                <span className="min-w-0 flex-1">
                  <PlayerLine username={r.username} level={r.level} loadout={r.loadout} me={r.user_id === userId} />
                </span>
                <span className="shrink-0 text-sm">
                  <Value board={board} value={r.value} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {data && (
        <p className="mt-3 text-center text-sm text-muted">
          {data.me ? (
            <>
              You are <strong className="text-ivory">#{data.me.rank}</strong>
              {data.friends ? ' among your friends' : ''}.
            </>
          ) : (
            "You're not on this board yet."
          )}
        </p>
      )}
    </div>
  );
}
