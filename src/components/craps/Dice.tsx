import { motion } from 'framer-motion';
import { cn } from '@/components/ui/cn';

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[28, 28], [50, 50], [72, 72]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

export function Die({ value, className, red = true }: { value: number; className?: string; red?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={cn('h-12 w-12 drop-shadow-[0_6px_10px_rgba(0,0,0,0.6)]', className)} role="img" aria-label={`Die showing ${value}`}>
      <rect x="4" y="4" width="92" height="92" rx="18" fill={red ? '#b3202e' : '#f4ead2'} stroke={red ? '#e25a68' : '#d4af37'} strokeWidth="2" />
      <rect x="10" y="10" width="80" height="40" rx="14" fill="#fff" opacity="0.12" />
      {PIPS[value]?.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="8.5" fill={red ? '#fbf7ee' : '#141816'} />
      ))}
    </svg>
  );
}

/** Two dice that tumble whenever `rollKey` changes. */
export function DicePair({ dice, rollKey }: { dice: [number, number] | null; rollKey: number }) {
  if (!dice) {
    return (
      <div className="flex gap-3 opacity-40" aria-label="No roll yet">
        <Die value={6} />
        <Die value={5} />
      </div>
    );
  }
  return (
    <div className="flex gap-3" aria-live="polite" aria-label={`Rolled ${dice[0]} and ${dice[1]}, total ${dice[0] + dice[1]}`}>
      {dice.map((v, i) => (
        <motion.div
          key={`${rollKey}-${i}`}
          initial={{ x: -120 - i * 30, y: -30, rotate: -540 - i * 90, opacity: 0 }}
          animate={{ x: 0, y: 0, rotate: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 140, damping: 14, delay: i * 0.05 }}
        >
          <Die value={v} />
        </motion.div>
      ))}
    </div>
  );
}
