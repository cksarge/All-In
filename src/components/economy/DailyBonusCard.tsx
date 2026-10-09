import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { Skeleton } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { useNow } from '@/hooks/useNow';
import { formatDuration } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { ChipBurst } from './ChipBurst';

export function DailyBonusCard() {
  const { status, claiming, claimDaily, clockOffsetMs, fetchStatus } = useWallet();
  const now = useNow(1000, clockOffsetMs);
  const [burst, setBurst] = useState(0);
  const daily = status?.daily;

  const onClaim = async () => {
    const res = await claimDaily();
    if (res.ok) {
      playSound('coins');
      setBurst((b) => b + 1);
      toast.success(
        `Daily bonus collected`,
        `+${res.result.amount.toLocaleString()} play chips · Day ${res.result.streak} streak (${res.result.multiplier}x)`,
      );
    } else {
      playSound('error');
      toast.error("Couldn't collect the bonus", res.error);
    }
  };

  const mults = daily?.multipliers ?? [];
  const msLeft = daily ? new Date(daily.next_available_at).getTime() - now : 0;
  const readyByClock = Boolean(daily && !daily.available && msLeft <= 0);

  // When the countdown reaches zero, ask the server (it decides, not the clock).
  useEffect(() => {
    if (readyByClock) void fetchStatus();
  }, [readyByClock, fetchStatus]);

  return (
    <section aria-labelledby="daily-title" className="surface relative p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="daily-title" className="font-display text-xl font-bold text-ivory">
            Daily bonus
          </h2>
          <p className="mt-1 text-sm text-muted">Free every day. Come back daily to build your streak multiplier.</p>
        </div>
        {daily && daily.streak > 0 && (
          <span className="rounded-full border border-ruby-400/40 bg-ruby-900/50 px-3 py-1 text-xs font-semibold text-ruby-300">
            {daily.streak}-day streak
          </span>
        )}
      </div>

      {!daily ? (
        <div className="mt-5 space-y-3">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-11 w-40" />
        </div>
      ) : (
        <>
          <ol className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-2" aria-label="Streak progress">
            {mults.map((m, i) => {
              const day = i + 1;
              const isLast = day === mults.length;
              const done = day <= daily.streak;
              const isNext = !done && (day === daily.next_day || (isLast && daily.next_day > mults.length));
              return (
                <li
                  key={day}
                  className={cn(
                    'flex flex-col items-center rounded-xl border px-1 py-2 text-center transition',
                    done && 'border-felt-400/40 bg-felt-800/60',
                    isNext && daily.available && 'border-gold-400/70 bg-gold-500/15 shadow-[0_0_20px_-6px_rgba(212,175,55,0.7)]',
                    isNext && !daily.available && 'border-gold-500/30 bg-transparent',
                    !done && !isNext && 'border-white/[0.07] bg-ink-950/40',
                  )}
                  aria-label={`Day ${day}${isLast ? ' and beyond' : ''}: ${m}x${done ? ', collected' : ''}`}
                >
                  <span className="text-[0.62rem] font-semibold uppercase tracking-wider text-muted" aria-hidden="true">
                    <span className="hidden sm:inline">Day </span>
                    {day}
                    {isLast ? '+' : ''}
                  </span>
                  <span aria-hidden="true" className={cn('mt-0.5 text-xs font-bold xs:text-sm sm:text-base', done ? 'text-felt-300' : isNext ? 'text-gold-300' : 'text-cream/70')}>
                    {m}x
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="relative mt-5 flex flex-wrap items-center justify-between gap-4">
            <div className="text-sm text-cream/85">
              {daily.available ? 'Today’s bonus:' : 'Tomorrow’s bonus:'}{' '}
              <ChipAmount value={daily.next_amount} className="font-bold text-gold-200" />{' '}
              <span className="text-muted">
                (Day {daily.next_day}, {daily.next_multiplier}x)
              </span>
            </div>
            <div className="relative">
              <AnimatePresence>{burst > 0 && <ChipBurst key={burst} />}</AnimatePresence>
              {daily.available ? (
                <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                  <Button onClick={onClaim} loading={claiming === 'daily'}>
                    Collect bonus
                  </Button>
                </motion.div>
              ) : (
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wider text-muted">Next bonus in</p>
                  <p className="font-display text-xl font-bold tabular-nums text-ivory" aria-live="off">
                    {readyByClock ? 'Any moment…' : formatDuration(msLeft)}
                  </p>
                </div>
              )}
            </div>
          </div>
          <p className="mt-3 text-xs text-subtle">Resets daily at 00:00 UTC. Missing a day resets your streak.</p>
        </>
      )}
    </section>
  );
}
