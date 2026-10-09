import { useEffect, useState, type ReactNode } from 'react';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { InfoModal } from './InfoModal';

export interface HistoryRow<S = Record<string, unknown>> {
  id: number;
  wagered: number;
  returned: number;
  net: number;
  outcome: 'win' | 'loss' | 'push';
  created_at: string;
  summary: S;
}

/** Your last rounds of a game (from game_history, own rows only via RLS). */
export function GameHistoryModal<S>({
  open,
  onClose,
  game,
  title = 'History',
  top,
  renderRow,
}: {
  open: boolean;
  onClose: () => void;
  game: string;
  title?: string;
  top?: ReactNode;
  renderRow: (row: HistoryRow<S>) => ReactNode;
}) {
  const [rows, setRows] = useState<HistoryRow<S>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const { data, error: err } = await supabase
      .from('game_history')
      .select('id, wagered, returned, net, outcome, created_at, summary')
      .eq('game_key', game)
      .order('id', { ascending: false })
      .limit(25);
    if (err) setError(friendlyError(err));
    else setRows(data as HistoryRow<S>[]);
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  return (
    <InfoModal open={open} onClose={onClose} title={title}>
      {top}
      <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-muted">Your recent results</p>
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : rows === null ? (
        <LoadingState label="Loading history…" />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing yet" message="Your results will show up here." />
      ) : (
        <ul className="mt-2 divide-y divide-white/[0.06]">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                {renderRow(r)}
                <p className="mt-1 text-xs text-subtle">
                  Bet <ChipAmount value={r.wagered} iconClassName="h-3 w-3" /> · Paid{' '}
                  <ChipAmount value={r.returned} iconClassName="h-3 w-3" /> · {formatRelativeTime(r.created_at)}
                </p>
              </div>
              <ChipAmount
                value={r.net}
                signed
                className={cn('shrink-0 text-sm font-semibold', r.net > 0 ? 'text-felt-300' : r.net < 0 ? 'text-ruby-300' : 'text-cream')}
                iconClassName="h-4 w-4"
              />
            </li>
          ))}
        </ul>
      )}
    </InfoModal>
  );
}
