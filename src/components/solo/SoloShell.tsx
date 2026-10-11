import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameHistoryModal } from '@/components/table/GameHistoryModal';
import { chipColorFor, ChipStack } from '@/components/table/ChipStack';
import { InfoModal } from '@/components/table/InfoModal';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { TierBadge } from '@/components/ui/TierBadge';
import { cn } from '@/components/ui/cn';
import { chipDenominations } from '@/lib/blackjack';
import { formatChips, formatChipsCompact } from '@/lib/format';
import { historyLine, type SoloInfo, type SoloTier, type Spots } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import type { TierKey } from '@/lib/types';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

/** Loading and error screens shared by every solo game. */
export function SoloGate({ error, onRetry, label }: { error: string | null; onRetry: () => void; label: string }) {
  const navigate = useNavigate();
  if (!error) return <FullPageLoader label={label} />;
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <div className="surface">
        <ErrorState title="Couldn't open this game" message={error} onRetry={onRetry} />
        <div className="flex justify-center pb-6">
          <Button variant="outline" size="sm" onClick={() => navigate('/lounge')}>
            Back to the lounge
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Page frame for a solo game: header with rules and history, the felt, a status
 * line, and a controls bar that sticks to the bottom on phones.
 */
export function SoloShell({
  info,
  tier,
  status,
  rules,
  controls,
  children,
  wide,
}: {
  info: SoloInfo<unknown, unknown>;
  tier?: TierKey;
  /** Announced to screen readers when it changes. */
  status: ReactNode;
  rules: ReactNode;
  controls: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  const navigate = useNavigate();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className={cn('mx-auto px-3 pb-48 pt-4 sm:px-4 md:pb-10', wide ? 'max-w-5xl' : 'max-w-3xl')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="ghost" onClick={() => navigate('/lounge')}>
          ← Lounge
        </Button>
        <h1 className="font-display text-xl font-bold text-ivory sm:text-2xl">{info.name}</h1>
        {tier && <TierBadge tier={tier} />}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setRulesOpen(true)}>
            Rules
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
            History
          </Button>
        </div>
      </div>

      <section aria-label={`${info.name} table`} className="felt relative mt-4 rounded-3xl border border-gold-500/30 p-3 shadow-card sm:p-5">
        <p className="mb-3 min-h-6 text-center font-display text-base font-bold text-gold-200 sm:text-lg" aria-live="polite">
          {status}
        </p>
        {children}
      </section>

      <section
        aria-label="Your controls"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-900/95 px-3 py-3 backdrop-blur md:static md:mt-5 md:rounded-2xl md:border md:bg-ink-800/80 md:px-5 md:py-4"
      >
        <div className={cn('mx-auto flex flex-wrap items-center gap-3', wide ? 'max-w-5xl' : 'max-w-3xl')}>{controls}</div>
      </section>

      <InfoModal open={rulesOpen} onClose={() => setRulesOpen(false)} title={info.name}>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-cream/85">{rules}</div>
      </InfoModal>
      <GameHistoryModal<Record<string, unknown>>
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        game={info.game}
        renderRow={(r) => <p className="truncate text-sm text-cream/85">{historyLine(info.game, r.summary)}</p>}
      />
    </div>
  );
}

/** Low / Mid / High / VIP. A level is locked until the player has its minimum bankroll. */
export function TierPicker({
  tiers,
  value,
  onChange,
  disabled,
}: {
  tiers: SoloTier[];
  value: TierKey;
  onChange: (t: TierKey) => void;
  disabled?: boolean;
}) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  return (
    <div role="radiogroup" aria-label="Stake level" className="flex gap-1">
      {tiers.map((t) => {
        const locked = balance < t.min_bankroll;
        return (
          <button
            key={t.tier}
            type="button"
            role="radio"
            aria-checked={value === t.tier}
            disabled={disabled}
            title={`Bets ${formatChips(t.min_bet)} to ${formatChips(t.max_bet)}`}
            onClick={() => {
              if (locked) return toast.info(`${t.label} stakes are locked`, `You need ${formatChips(t.min_bankroll)} chips to play there.`);
              onChange(t.tier);
            }}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50',
              value === t.tier ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:text-ivory',
              locked && 'opacity-45',
            )}
          >
            {t.label}
            {locked && <span className="sr-only"> (locked)</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Chip values for a stake level. */
export function ChipRack({ tier, value, onChange, disabled }: { tier: SoloTier; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Chip value">
      {chipDenominations(tier.min_bet, tier.max_bet).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          aria-label={`${d} chip`}
          disabled={disabled || d > balance}
          onClick={() => {
            onChange(d);
            playSound('chip');
          }}
          className={cn(
            'relative flex h-11 w-11 items-center justify-center rounded-full transition disabled:opacity-40',
            value === d ? '-translate-y-1 ring-2 ring-gold-300 ring-offset-2 ring-offset-ink-900' : 'hover:-translate-y-0.5',
          )}
        >
          <ChipIcon className="absolute inset-0 h-11 w-11" color={chipColorFor(d)} />
          <span className="relative rounded bg-ink-950/75 px-1 text-[0.6rem] font-bold text-ivory">{formatChipsCompact(d)}</span>
        </button>
      ))}
    </div>
  );
}

/** A place on the felt to put chips. */
export function BetSpot({
  name,
  pays,
  amount,
  onClick,
  disabled,
  state,
  className,
  children,
}: {
  /** Accessible name, e.g. "Banker". */
  name: string;
  /** e.g. "1 to 1" */
  pays?: string;
  amount: number;
  onClick: () => void;
  disabled?: boolean;
  /** After the result: did this spot win? */
  state?: 'win' | 'lose' | null;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${name}.${pays ? ` Pays ${pays}.` : ''}${amount ? ` Your bet: ${amount}.` : ''}`}
      className={cn(
        'relative flex min-h-16 flex-col items-center justify-center rounded-xl border px-1.5 py-2 text-center transition',
        'border-gold-500/35 bg-felt-900/50 hover:bg-felt-700/60 disabled:cursor-default disabled:hover:bg-felt-900/50',
        state === 'win' && 'border-gold-300 bg-gold-500/20 shadow-glow-gold',
        state === 'lose' && 'opacity-45',
        className,
      )}
    >
      {children ?? <span className="text-sm font-bold leading-tight text-ivory">{name}</span>}
      {pays && <span className="mt-0.5 text-[0.65rem] leading-none text-gold-200/80">{pays}</span>}
      {amount > 0 && <ChipStack amount={amount} className="pointer-events-none absolute -right-1.5 -top-2 scale-90" />}
    </button>
  );
}

/** State and rules for putting chips on spots: one stake level, a chip value, and the bets. */
export function useSpotBets(tiers: SoloTier[]) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const [tierKey, setTierKey] = useState<TierKey>(tiers[0]?.tier ?? 'low');
  const tier = tiers.find((t) => t.tier === tierKey) ?? tiers[0];
  const [chip, setChip] = useState(tier.min_bet);
  const [bets, setBets] = useState<Spots>({});
  const [last, setLast] = useState<Spots | null>(null);
  const total = Object.values(bets).reduce((n, v) => n + v, 0);

  const add = (spot: string) => {
    const next = (bets[spot] ?? 0) + chip;
    if (next > tier.max_bet) return toast.info('Spot is full', `Each spot takes up to ${formatChips(tier.max_bet)} chips at ${tier.label} stakes.`);
    if (total + chip > balance) return toast.info('Not enough chips', 'Lower your bets, or pick up free chips in the lounge.');
    setBets({ ...bets, [spot]: next });
    playSound('chip');
  };
  const clear = () => setBets({});
  const changeTier = (t: TierKey) => {
    const nt = tiers.find((x) => x.tier === t);
    if (!nt) return;
    setTierKey(t);
    setChip(nt.min_bet);
    setBets({});
    setLast(null);
  };
  /** Call when a round is sent: remembers the bets for Rebet. */
  const remember = () => setLast(bets);
  const rebet = () => {
    if (!last) return;
    if (Object.values(last).reduce((n, v) => n + v, 0) > balance) return toast.info('Not enough chips to repeat that bet');
    setBets(last);
    playSound('chip');
  };
  return { tier, tierKey, changeTier, chip, setChip, bets, setBets, add, clear, total, last, remember, rebet, balance };
}

/** Clear / Rebet / the main action, shared by the games with betting spots. */
export function SpotControls({
  s,
  tiers,
  busy,
  action,
  onAction,
}: {
  s: ReturnType<typeof useSpotBets>;
  tiers: SoloTier[];
  busy: boolean;
  action: string;
  onAction: () => void;
}) {
  return (
    <>
      <TierPicker tiers={tiers} value={s.tierKey} onChange={s.changeTier} disabled={busy} />
      <ChipRack tier={s.tier} value={s.chip} onChange={s.setChip} disabled={busy} />
      <div className="text-sm text-cream/85">
        Bet <ChipAmount value={s.total} className="font-bold text-ivory" iconClassName="h-4 w-4" />
      </div>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" disabled={busy || s.total === 0} onClick={s.clear}>
          Clear
        </Button>
        <Button size="sm" variant="ghost" disabled={busy || !s.last || s.total > 0} onClick={s.rebet}>
          Rebet
        </Button>
        <Button className="min-w-28" disabled={s.total === 0} loading={busy} onClick={onAction}>
          {action}
        </Button>
      </div>
    </>
  );
}

/** "You win 200" / "Push" / "No win" line under the felt. */
export function Outcome({ staked, win }: { staked: number; win: number }) {
  return (
    <p className={cn('mt-3 text-center text-sm font-semibold', win > staked ? 'text-gold-200' : win === staked ? 'text-cream' : 'text-cream/70')}>
      {win > staked ? (
        <>
          You win <ChipAmount value={win - staked} className="font-bold" iconClassName="h-4 w-4" />
        </>
      ) : win === staked ? (
        'Push: your chips come back.'
      ) : win > 0 ? (
        <>
          <ChipAmount value={win} iconClassName="h-4 w-4" /> back from <ChipAmount value={staked} iconClassName="h-4 w-4" /> bet
        </>
      ) : (
        'No win this time.'
      )}
    </p>
  );
}

/** − bet + for games with one bet. */
export function BetStepper({ bets, index, onChange, disabled, tiers }: { bets: number[]; index: number; onChange: (i: number) => void; disabled?: boolean; tiers: SoloTier[] }) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const next = bets[index + 1];
  const nextTier = next ? tiers.find((t) => next >= t.min_bet && next <= t.max_bet) : undefined;
  const canRaise = Boolean(next) && next <= balance && !(nextTier && balance < nextTier.min_bankroll);
  const step = (d: number) => {
    onChange(index + d);
    playSound('chip');
  };
  return (
    <div className="flex items-center gap-2" role="group" aria-label="Bet">
      <Button size="sm" variant="outline" aria-label="Lower bet" disabled={disabled || index === 0} onClick={() => step(-1)}>
        −
      </Button>
      <div className="min-w-24 text-center">
        <p className="text-[0.65rem] uppercase tracking-wider text-muted">Bet</p>
        <ChipAmount value={bets[index]} className="font-bold text-ivory" iconClassName="h-4 w-4" />
      </div>
      <Button size="sm" variant="outline" aria-label="Raise bet" disabled={disabled || !canRaise} onClick={() => step(1)}>
        +
      </Button>
    </div>
  );
}
