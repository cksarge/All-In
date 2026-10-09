import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ChipAmount, PlayChipsBadge } from '@/components/ui/ChipAmount';
import { Skeleton } from '@/components/ui/States';
import { formatSigned } from '@/lib/format';
import { useWallet } from '@/stores/walletStore';

/** Live chip balance with the "Play chips" badge. Flashes +/- on change. */
export function BalancePill() {
  const balance = useWallet((s) => s.status?.balance);
  const prev = useRef<number | undefined>(undefined);
  const [delta, setDelta] = useState<{ id: number; value: number } | null>(null);

  useEffect(() => {
    if (balance === undefined) return;
    if (prev.current !== undefined && balance !== prev.current) {
      setDelta({ id: Date.now(), value: balance - prev.current });
    }
    prev.current = balance;
  }, [balance]);

  return (
    <div className="relative flex items-center gap-1.5 rounded-xl border border-white/10 bg-ink-950/60 py-1.5 pl-2 pr-1.5 xs:gap-2 xs:pl-2.5 xs:pr-2">
      {balance === undefined ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        <ChipAmount value={balance} className="text-[0.95rem] font-semibold text-ivory" iconClassName="h-5 w-5" />
      )}
      <PlayChipsBadge className="whitespace-nowrap max-xs:px-1.5 max-xs:tracking-[0.06em]" />
      <AnimatePresence>
        {delta && (
          <motion.span
            key={delta.id}
            initial={{ opacity: 0, y: 0 }}
            animate={{ opacity: 1, y: 18 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            onAnimationComplete={() => window.setTimeout(() => setDelta(null), 900)}
            className={`pointer-events-none absolute right-2 top-full text-xs font-bold tabular-nums ${delta.value > 0 ? 'text-felt-300' : 'text-ruby-300'}`}
            aria-hidden="true"
          >
            {formatSigned(delta.value)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
