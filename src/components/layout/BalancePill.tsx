import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { Skeleton } from '@/components/ui/States';
import { formatSigned } from '@/lib/format';
import { prefersReducedMotion, useSettings } from '@/stores/settingsStore';
import { useWallet } from '@/stores/walletStore';

/** Live chip balance in the top bar. Flashes +/- on change. (The user asked for the "Play chips" tag to go from here.) */
export function BalancePill() {
  const balance = useWallet((s) => (s.status ? (s.displayBalance ?? s.status.balance) : undefined));
  const prev = useRef<number | undefined>(undefined);
  const [delta, setDelta] = useState<{ id: number; value: number } | null>(null);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  // The number rolls to its new value instead of jumping.
  const [shown, setShown] = useState<number | undefined>(balance);
  const shownRef = useRef<number | undefined>(balance);
  useEffect(() => {
    const from = shownRef.current;
    if (balance === undefined || from === undefined || reduced || from === balance) {
      shownRef.current = balance;
      setShown(balance);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 450);
      const v = Math.round(from + (balance - from) * (1 - (1 - k) ** 3));
      shownRef.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [balance, reduced]);

  useEffect(() => {
    if (balance === undefined) return;
    if (prev.current !== undefined && balance !== prev.current) {
      setDelta({ id: Date.now(), value: balance - prev.current });
    }
    prev.current = balance;
  }, [balance]);

  return (
    <div className="relative flex items-center gap-1.5 rounded-xl border border-white/10 bg-ink-950/60 px-2.5 py-1.5 xs:gap-2 xs:px-3">
      {balance === undefined ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        <ChipAmount value={shown ?? balance} className="text-[0.95rem] font-semibold text-ivory" iconClassName="h-5 w-5" />
      )}
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
