import { cn } from '@/components/ui/cn';
import { ChipIcon } from '@/components/ui/ChipIcon';

export const NO_REAL_MONEY_FOOTER = 'Free to play. No real money. No purchases. Chips have no cash value.';

/** The core statement, used on the landing page, sign-up form and elsewhere. */
export function NoRealMoneyNotice({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border border-gold-500/30 bg-gold-500/[0.07] text-left',
        compact ? 'px-3.5 py-3' : 'px-4 py-3.5',
        className,
      )}
    >
      <ChipIcon className={compact ? 'mt-0.5 h-5 w-5' : 'mt-0.5 h-6 w-6'} color="gold" />
      <p className={cn('leading-relaxed text-cream/90', compact ? 'text-xs' : 'text-sm')}>
        <strong className="font-semibold text-gold-200">All In is 100% free.</strong> You play with play chips only.
        There is no gambling, no purchases, and no real money, ever. Chips have no cash value and can&apos;t be
        exchanged for anything.
      </p>
    </div>
  );
}
