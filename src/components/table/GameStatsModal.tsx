import { useEffect, useState } from 'react';
import { InfoModal } from '@/components/table/InfoModal';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { formatChips, formatRelativeTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/authStore';

interface Stats {
  rounds_played: number;
  rounds_won: number;
  rounds_lost: number;
  rounds_pushed: number;
  total_wagered: number;
  total_returned: number;
  biggest_win: number;
  last_played_at: string | null;
}

/** Your own numbers at one game: rounds, how they went, chips in and out, your best win. */
export function GameStatsModal({ open, onClose, game, name }: { open: boolean; onClose: () => void; game: string; name?: string }) {
  const userId = useAuth((s) => s.user?.id);
  const [stats, setStats] = useState<Stats | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!userId) return;
    setError(null);
    const { data, error: err } = await supabase
      .from('player_game_stats')
      .select('rounds_played, rounds_won, rounds_lost, rounds_pushed, total_wagered, total_returned, biggest_win, last_played_at')
      .eq('user_id', userId)
      .eq('game_key', game)
      .maybeSingle();
    if (err) setError(friendlyError(err));
    else setStats((data as Stats | null) ?? null);
  };
  useEffect(() => {
    if (open) void load();
  }, [open, game]); // eslint-disable-line react-hooks/exhaustive-deps

  const net = stats ? stats.total_returned - stats.total_wagered : 0;
  const rate = stats && stats.rounds_played > 0 ? Math.round((stats.rounds_won / stats.rounds_played) * 100) : 0;
  const back = stats && stats.total_wagered > 0 ? ((stats.total_returned / stats.total_wagered) * 100).toFixed(1) : null;
  const Cell = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="rounded-xl border border-white/[0.07] bg-ink-950/40 p-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-ivory">{children}</p>
    </div>
  );

  return (
    <InfoModal open={open} onClose={onClose} title={name ? `Your stats: ${name}` : 'Your stats'}>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : stats === undefined ? (
        <LoadingState label="Counting…" />
      ) : stats === null || stats.rounds_played === 0 ? (
        <EmptyState title="No rounds yet" message="Play a round here and your numbers will show up." />
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Cell label="Rounds">{formatChips(stats.rounds_played)}</Cell>
            <Cell label="Won">{rate}%</Cell>
            <Cell label="Biggest win">
              <ChipAmount value={stats.biggest_win} iconClassName="h-4 w-4" />
            </Cell>
            <Cell label="Chips bet">
              <ChipAmount value={stats.total_wagered} compact iconClassName="h-4 w-4" />
            </Cell>
            <Cell label="Chips back">
              <ChipAmount value={stats.total_returned} compact iconClassName="h-4 w-4" />
            </Cell>
            <Cell label="Overall">
              <ChipAmount value={net} signed compact className={cn(net > 0 ? 'text-felt-300' : net < 0 ? 'text-ruby-300' : '')} iconClassName="h-4 w-4" />
            </Cell>
          </div>
          <p className="mt-3 text-xs text-muted">
            {formatChips(stats.rounds_won)} won · {formatChips(stats.rounds_lost)} lost · {formatChips(stats.rounds_pushed)} pushed
            {back && ` · ${back}% of what you bet has come back`}
            {stats.last_played_at && ` · last played ${formatRelativeTime(stats.last_played_at)}`}
          </p>
        </>
      )}
    </InfoModal>
  );
}
