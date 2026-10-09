import { formatChips, formatChipsCompact, formatSigned } from '@/lib/format';
import { ChipIcon, type ChipColor } from './ChipIcon';
import { cn } from './cn';

/** "<chip icon> 12,345" with an accessible label ("12,345 play chips"). Never a currency sign. */
export function ChipAmount({
  value,
  className,
  iconClassName,
  color,
  compact,
  signed,
}: {
  value: number | null | undefined;
  className?: string;
  iconClassName?: string;
  color?: ChipColor;
  compact?: boolean;
  signed?: boolean;
}) {
  const text =
    value === null || value === undefined
      ? '—'
      : signed
        ? formatSigned(value)
        : compact
          ? formatChipsCompact(value)
          : formatChips(value);
  return (
    <span className={cn('inline-flex items-center gap-1.5 tabular-nums', className)}>
      <ChipIcon className={iconClassName ?? 'h-[1.1em] w-[1.1em]'} color={color} />
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{value === null || value === undefined ? 'unknown' : `${text} play chips`}</span>
    </span>
  );
}

export function PlayChipsBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5',
        'text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-gold-300',
        className,
      )}
      title="Play chips have no cash value. All In never uses real money."
    >
      Play chips
    </span>
  );
}
