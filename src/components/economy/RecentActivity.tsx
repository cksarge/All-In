import { ChipAmount } from '@/components/ui/ChipAmount';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { formatRelativeTime } from '@/lib/format';
import type { LedgerEntry } from '@/lib/types';
import { useWallet } from '@/stores/walletStore';

const REASONS: Record<string, string> = {
  signup_bonus: 'Welcome chips',
  daily_bonus: 'Daily bonus',
  refill: 'Free refill',
  bet: 'Bet placed',
  payout: 'Win',
  refund: 'Bet returned',
  push: 'Push',
  table_sit: 'Took a seat',
  table_leave: 'Left the table',
  jackpot: 'Jackpot win',
  achievement: 'Achievement reward',
};

export function describeLedger(e: LedgerEntry): string {
  const base = REASONS[e.reason] ?? e.reason.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  if (e.reason === 'daily_bonus' && typeof e.metadata?.streak === 'number') return `${base} · day ${e.metadata.streak}`;
  return base;
}

export function RecentActivity() {
  const { ledger, ledgerLoading, ledgerError, fetchLedger } = useWallet();
  return (
    <section aria-labelledby="activity-title" className="surface p-6">
      <h2 id="activity-title" className="font-display text-xl font-bold text-ivory">
        Recent chip activity
      </h2>
      {ledgerLoading && ledger.length === 0 ? (
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : ledgerError ? (
        <ErrorState message={ledgerError} onRetry={() => void fetchLedger()} />
      ) : ledger.length === 0 ? (
        <EmptyState title="No activity yet" message="Your chip history will appear here as you play." />
      ) : (
        <ul className="scrollbar-thin mt-3 max-h-80 divide-y divide-white/[0.05] overflow-y-auto pr-1">
          {ledger.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-cream">{describeLedger(e)}</p>
                <p className="text-xs text-subtle">{formatRelativeTime(e.created_at)}</p>
              </div>
              <ChipAmount
                value={e.delta}
                signed
                className={cn('shrink-0 text-sm font-semibold', e.delta > 0 ? 'text-felt-300' : 'text-ruby-300')}
                iconClassName="h-4 w-4"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
