import { Link } from 'react-router-dom';
import { ChipAmount, PlayChipsBadge } from '@/components/ui/ChipAmount';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { Skeleton } from '@/components/ui/States';
import { useWallet } from '@/stores/walletStore';

export function BalanceCard() {
  const status = useWallet((s) => s.status);
  return (
    <section aria-labelledby="balance-title" className="felt relative overflow-hidden rounded-2xl border border-felt-400/25 p-6 sm:p-7">
      <ChipIcon className="absolute -right-8 -top-8 h-40 w-40 opacity-15" color="gold" />
      <div className="relative flex flex-wrap items-center gap-2">
        <h2 id="balance-title" className="text-sm font-semibold uppercase tracking-[0.18em] text-felt-300">
          Your chips
        </h2>
        <PlayChipsBadge />
      </div>
      <div className="relative mt-3">
        {status ? (
          <ChipAmount
            value={status.balance}
            className="font-display text-4xl font-bold text-ivory sm:text-5xl"
            iconClassName="h-9 w-9 sm:h-11 sm:w-11"
          />
        ) : (
          <Skeleton className="h-12 w-56" />
        )}
      </div>
      <div className="relative mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-cream/75">
        <span>
          Peak balance:{' '}
          {status ? <ChipAmount value={status.peak_balance} className="font-semibold text-cream" iconClassName="h-4 w-4" /> : '…'}
        </span>
        <Link to="/how-chips-work" className="font-medium text-gold-300 hover:underline">
          How chips work
        </Link>
      </div>
    </section>
  );
}
