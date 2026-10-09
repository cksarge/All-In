import { cn } from '@/components/ui/cn';
import { useNow } from '@/hooks/useNow';

/** Thin bar that drains as the current timer runs out. */
export function PhaseBar({ endsAt, totalSeconds, offsetMs }: { endsAt: string; totalSeconds: number; offsetMs: number }) {
  const now = useNow(200, offsetMs);
  const frac = Math.max(0, Math.min(1, (new Date(endsAt).getTime() - now) / (totalSeconds * 1000)));
  return (
    <div className="h-1 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
      <div
        className={cn('h-full rounded-full transition-[width] duration-200 ease-linear', frac > 0.25 ? 'bg-gold-400' : 'bg-ruby-400')}
        style={{ width: `${frac * 100}%` }}
      />
    </div>
  );
}
