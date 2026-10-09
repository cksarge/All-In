import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { Skeleton } from '@/components/ui/States';
import { useNow } from '@/hooks/useNow';
import { formatDuration } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

export function RefillCard() {
  const { status, claiming, claimRefill, clockOffsetMs, fetchStatus } = useWallet();
  const now = useNow(1000, clockOffsetMs);
  const refill = status?.refill;

  const onClaim = async () => {
    const res = await claimRefill();
    if (res.ok) {
      playSound('coins');
      toast.success('Free refill collected', `+${res.result.amount.toLocaleString()} play chips. Good luck out there!`);
    } else {
      playSound('error');
      toast.error("Couldn't collect the refill", res.error);
    }
  };

  const msLeft = refill ? new Date(refill.available_at).getTime() - now : 0;
  const hours = refill ? Math.round(refill.cooldown_seconds / 3600) : 0;

  return (
    <section aria-labelledby="refill-title" className="surface p-6">
      <h2 id="refill-title" className="font-display text-xl font-bold text-ivory">
        Free refill
      </h2>
      {!refill ? (
        <div className="mt-4 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : refill.available ? (
        <div className="mt-3 space-y-4">
          <p className="text-sm text-cream/85">
            Running low? Top back up to <ChipAmount value={refill.refill_to} className="font-semibold text-gold-200" /> for free.
          </p>
          <Button variant="felt" block onClick={onClaim} loading={claiming === 'refill'}>
            Collect free refill
          </Button>
        </div>
      ) : refill.below_threshold ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-cream/85">Your next free refill unlocks in</p>
          <p className="font-display text-2xl font-bold tabular-nums text-ivory">
            {msLeft > 0 ? (
              formatDuration(msLeft)
            ) : (
              <button type="button" className="text-gold-300 hover:underline" onClick={() => void fetchStatus()}>
                Ready. Tap to refresh
              </button>
            )}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Nobody gets stuck. If you drop below{' '}
          <ChipAmount value={refill.threshold} className="font-semibold text-cream" />, you can collect a free refill back up to{' '}
          <ChipAmount value={refill.refill_to} className="font-semibold text-cream" /> once every {hours} hours.
        </p>
      )}
    </section>
  );
}
