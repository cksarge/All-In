import type { TierKey } from '@/lib/types';
import { cn } from './cn';

const labels: Record<TierKey, string> = { low: 'Low', mid: 'Mid', high: 'High', vip: 'VIP' };

export function TierBadge({ tier, className }: { tier: TierKey; className?: string }) {
  return (
    <span
      className={cn(
        `tier-${tier}`,
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.14em]',
        tier === 'vip' ? 'text-gold-300' : 'text-ivory',
        className,
      )}
    >
      {tier === 'vip' && (
        <svg viewBox="0 0 20 20" className="h-3 w-3" aria-hidden="true">
          <path d="M2 6l4 3 4-6 4 6 4-3-2 10H4z" fill="currentColor" />
        </svg>
      )}
      {labels[tier]}
    </span>
  );
}
