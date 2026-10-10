import { useEffect, useState } from 'react';
import { InfoModal } from '@/components/table/InfoModal';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { formatChips } from '@/lib/format';
import type { PkStakes } from '@/lib/poker';

/**
 * Move play chips from your wallet to the poker table, or top up between hands.
 * Chips go back to your wallet when you leave the table.
 */
export function BringChipsModal({
  open,
  onClose,
  stakes,
  stack,
  pending,
  inHand,
  balance,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  stakes: PkStakes;
  stack: number;
  pending: number;
  inHand: boolean;
  balance: number;
  onConfirm: (amount: number) => Promise<boolean>;
}) {
  const fresh = stack + pending === 0 && !inHand;
  const min = fresh ? stakes.min_stack : 1;
  const max = Math.max(0, Math.min(stakes.max_stack - stack - pending, balance));
  const [amount, setAmount] = useState(max);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setAmount(Math.max(min, max));
  }, [open, min, max]);

  const valid = amount >= min && amount <= max;
  const presets = [
    ['Min', min],
    ['Half', Math.round((min + max) / 2)],
    ['Max', max],
  ] as const;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    const ok = await onConfirm(amount);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <InfoModal open={open} onClose={onClose} title={fresh ? 'Bring chips to the table' : 'Top up'}>
      <p className="mt-2 text-sm text-cream/85">
        {fresh
          ? `Chips you bring sit in front of you and go back to your wallet when you leave. This table takes ${formatChips(stakes.min_stack)} to ${formatChips(stakes.max_stack)}.`
          : `Add chips from your wallet, up to ${formatChips(stakes.max_stack)} in front of you.`}
        {inHand && ' You’re in a hand, so they’ll be added when it ends.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-cream/75">
        <span>
          Wallet <ChipAmount value={balance} className="font-semibold text-ivory" iconClassName="h-4 w-4" />
        </span>
        <span>
          At the table <ChipAmount value={stack + pending} className="font-semibold text-ivory" iconClassName="h-4 w-4" />
        </span>
      </div>

      {max < min ? (
        <p className="mt-5 rounded-xl border border-white/10 bg-ink-950/60 p-4 text-sm text-cream/85">
          {stack + pending >= stakes.max_stack
            ? 'You already have the most this table allows in front of you.'
            : `You need at least ${formatChips(min)} play chips in your wallet. Try a lower stake level, or check the Lounge for your daily bonus and free refills.`}
        </p>
      ) : (
        <form
          className="mt-5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="pk-bring" className="text-sm font-medium text-cream/90">
            Amount
          </label>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="range"
              min={min}
              max={max}
              step={1}
              value={Math.min(Math.max(amount, min), max)}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="h-2 flex-1 cursor-pointer accent-gold-400"
              aria-label="Amount to bring"
            />
            <input
              id="pk-bring"
              type="number"
              inputMode="numeric"
              min={min}
              max={max}
              value={Number.isFinite(amount) ? amount : ''}
              onChange={(e) => setAmount(Math.floor(Number(e.target.value)))}
              className="h-11 w-32 rounded-xl border border-white/10 bg-ink-950/60 px-3 text-right tabular-nums text-ivory focus:border-gold-500/70 focus:outline-none focus:ring-2 focus:ring-gold-500/20"
            />
          </div>
          <div className="mt-3 flex gap-2">
            {presets.map(([label, v]) => (
              <Button key={label} size="sm" variant="ghost" onClick={() => setAmount(v)}>
                {label}
              </Button>
            ))}
          </div>
          {!valid && (
            <p className="mt-2 text-sm text-ruby-300" role="alert">
              Choose between {formatChips(min)} and {formatChips(max)}.
            </p>
          )}
          <Button type="submit" block className="mt-5" loading={busy} disabled={!valid}>
            {fresh ? 'Bring' : 'Top up'} <ChipAmount value={valid ? amount : 0} iconClassName="h-4 w-4" />
          </Button>
        </form>
      )}
      <p className="mt-4 text-center text-xs text-subtle">Play chips only. No real money, no purchases.</p>
    </InfoModal>
  );
}
