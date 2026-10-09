import { motion } from 'framer-motion';
import { ChipIcon, type ChipColor } from '@/components/ui/ChipIcon';
import { formatChipsCompact } from '@/lib/format';
import { cn } from '@/components/ui/cn';

export function chipColorFor(amount: number): ChipColor {
  if (amount >= 25000) return 'onyx';
  if (amount >= 5000) return 'gold';
  if (amount >= 1000) return 'sapphire';
  if (amount >= 100) return 'felt';
  return 'ruby';
}

/** A small stack of chips with the amount, used for bets on the felt. */
export function ChipStack({ amount, className, label }: { amount: number; className?: string; label?: string }) {
  const n = Math.min(5, Math.max(1, Math.ceil(Math.log10(Math.max(amount, 1)))));
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0, y: 10 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      className={cn('flex flex-col items-center', className)}
      aria-label={label ?? `${amount.toLocaleString()} play chips bet`}
    >
      <div className="relative h-7 w-7" style={{ marginTop: (n - 1) * 3 }} aria-hidden="true">
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="absolute left-0" style={{ bottom: i * 3 }}>
            <ChipIcon className="h-7 w-7 drop-shadow" color={chipColorFor(amount)} />
          </div>
        ))}
      </div>
      <span className="mt-1 rounded-full bg-ink-950/80 px-1.5 text-[0.65rem] font-bold tabular-nums text-gold-200">
        {formatChipsCompact(amount)}
      </span>
    </motion.div>
  );
}
