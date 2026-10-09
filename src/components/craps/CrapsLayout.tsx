import { createContext, useContext, type ReactNode } from 'react';
import { chipColorFor } from '@/components/table/ChipStack';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { cn } from '@/components/ui/cn';
import { BEGINNER, BET_LABEL, PAYS, spotKey, type CrBet, type CrBetType } from '@/lib/craps';
import { formatChipsCompact } from '@/lib/format';

interface Spot {
  type: CrBetType;
  number: number | null;
}

/** Chips sitting on a spot: yours (big) and other players' (dot). */
function SpotChips({ mine, others }: { mine: number; others: number }) {
  if (!mine && !others) return null;
  const v = mine || others;
  return (
    <span className="pointer-events-none absolute right-1 top-1 flex items-center">
      <span className="relative flex h-6 w-6 items-center justify-center">
        <ChipIcon className="absolute h-6 w-6 drop-shadow" color={chipColorFor(v)} />
        <span className="relative rounded bg-ink-950/80 px-0.5 text-[0.55rem] font-bold text-ivory">{formatChipsCompact(v)}</span>
      </span>
      {others > 0 && <span className="ml-0.5 h-2 w-2 rounded-full bg-sapphire-300" title="Other players' chips" />}
    </span>
  );
}

interface LayoutCtx {
  beginner: boolean;
  allowed: (s: Spot) => string | null;
  onBet: (s: Spot) => void;
  sum: (pred: (b: CrBet) => boolean) => { mine: number; others: number };
}
const Ctx = createContext<LayoutCtx | null>(null);

function Area({
  spot,
  children,
  className,
  chips,
}: {
  spot: Spot;
  children: ReactNode;
  className?: string;
  chips?: { mine: number; others: number };
}) {
  const { beginner, allowed, onBet, sum } = useContext(Ctx)!;
  const k = spotKey(spot.type, spot.number);
  const hidden = beginner && !BEGINNER.has(k);
  const reason = hidden ? 'Turn off beginner mode to use this bet.' : allowed(spot);
  const c = chips ?? sum((b) => b.bet_type === spot.type && b.number === spot.number);
  return (
    <button
      type="button"
      onClick={() => !reason && onBet(spot)}
      aria-disabled={Boolean(reason)}
      title={reason ?? `Pays ${PAYS[k] ?? PAYS[spot.type]}`}
      aria-label={`${BET_LABEL[spot.type]}${spot.number ? ` ${spot.number}` : ''}. ${reason ?? `Pays ${PAYS[k] ?? PAYS[spot.type]}`}${c.mine ? `. Your chips: ${c.mine}` : ''}`}
      className={cn(
        'relative flex flex-col items-center justify-center rounded-lg border border-gold-500/40 px-1 py-2 text-center transition',
        reason ? 'cursor-not-allowed opacity-45' : 'hover:border-gold-300 hover:bg-white/[0.06]',
        hidden && 'opacity-25',
        beginner && !hidden && 'ring-1 ring-gold-400/70',
        className,
      )}
    >
      {children}
      <SpotChips {...c} />
    </button>
  );
}

/**
 * The craps layout, drawn as a grid of bet areas. `allowed(spot)` returns null
 * when a bet can be placed, or the reason it can't (shown as the tooltip).
 */
export function CrapsLayout({
  point,
  bets,
  userId,
  beginner,
  allowed,
  onBet,
}: {
  point: number | null;
  bets: CrBet[];
  userId: string | undefined;
  beginner: boolean;
  allowed: (s: Spot) => string | null;
  onBet: (s: Spot) => void;
}) {
  const sum = (pred: (b: CrBet) => boolean) => {
    let mine = 0;
    let others = 0;
    for (const b of bets) {
      if (!pred(b)) continue;
      if (b.user_id === userId) mine += b.amount + b.odds;
      else others += b.amount + b.odds;
    }
    return { mine, others };
  };

  const word = (n: number) => (n === 6 ? 'SIX' : n === 9 ? 'NINE' : String(n));

  return (
    <Ctx.Provider value={{ beginner, allowed, onBet, sum }}>
    <div className="grid gap-2 text-ivory">
      {/* Place numbers (with the point puck) */}
      <div className="grid grid-cols-6 gap-1.5">
        {[4, 5, 6, 8, 9, 10].map((n) => {
          const come = sum((b) => (b.bet_type === 'come' || b.bet_type === 'dont_come') && b.number === n);
          return (
            <Area key={n} spot={{ type: 'place', number: n }} className="min-h-20 bg-felt-700/50">
              {point === n && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full border-2 border-ink-950 bg-ivory px-1.5 text-[0.6rem] font-black text-ink-950 shadow">
                  ON
                </span>
              )}
              <span className="font-display text-lg font-black text-gold-200 sm:text-3xl">
                <span className="sm:hidden">{n}</span>
                <span className="hidden sm:inline">{word(n)}</span>
              </span>
              <span className="text-[0.55rem] leading-tight text-cream/70 sm:text-[0.6rem]">
                <span className="hidden sm:inline">Place </span>
                {PAYS[`place-${n}`]}
              </span>
              {(come.mine > 0 || come.others > 0) && (
                <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-sapphire-700/90 px-1 text-[0.55rem] font-bold text-sapphire-300" title="Come bets on this number">
                  C {formatChipsCompact(come.mine || come.others)}
                </span>
              )}
            </Area>
          );
        })}
      </div>

      <div className="grid gap-2 lg:grid-cols-[1fr_15rem]">
        <div className="grid gap-2">
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Area spot={{ type: 'come', number: null }} className="min-h-14 bg-felt-700/40" chips={sum((b) => b.bet_type === 'come' && b.number === null)}>
              <span className="font-display text-2xl font-black tracking-widest text-ivory">COME</span>
            </Area>
            <Area spot={{ type: 'dont_come', number: null }} className="bg-ink-900/40" chips={sum((b) => b.bet_type === 'dont_come' && b.number === null)}>
              <span className="text-xs font-bold leading-tight">DON&apos;T COME</span>
              <span className="text-[0.6rem] text-cream/60">Bar 12</span>
            </Area>
          </div>
          <Area spot={{ type: 'field', number: null }} className="min-h-14 bg-felt-700/40">
            <span className="font-display text-lg font-black tracking-wider text-gold-200">FIELD</span>
            <span className="text-xs font-semibold tracking-widest">
              <span className="rounded-full border border-gold-400 px-1">2</span> · 3 · 4 · 9 · 10 · 11 ·{' '}
              <span className="rounded-full border border-gold-400 px-1">12</span>
            </span>
            <span className="text-[0.6rem] text-cream/60">2 pays double · 12 pays triple</span>
          </Area>
          <Area spot={{ type: 'dont_pass', number: null }} className="bg-ink-900/40">
            <span className="text-sm font-bold tracking-widest">DON&apos;T PASS BAR</span>
            <span className="text-[0.6rem] text-cream/60">12 is a push</span>
          </Area>
          <Area spot={{ type: 'pass', number: null }} className="min-h-14 bg-felt-700/50">
            <span className="font-display text-2xl font-black tracking-[0.2em] text-ivory">PASS LINE</span>
          </Area>
        </div>

        {/* Center: hardways and propositions */}
        <div className="grid gap-1.5 rounded-xl border border-gold-500/30 bg-ink-950/30 p-2">
          <p className="text-center text-[0.6rem] font-semibold uppercase tracking-[0.25em] text-gold-300">One roll · Hardways</p>
          <Area spot={{ type: 'any7', number: null }} className="bg-ruby-800/50">
            <span className="text-sm font-bold">ANY SEVEN</span>
            <span className="text-[0.6rem] text-cream/70">4 to 1</span>
          </Area>
          <div className="grid grid-cols-2 gap-1.5">
            {[6, 10, 8, 4].map((n) => (
              <Area key={n} spot={{ type: 'hard', number: n }} className="bg-felt-800/60">
                <span className="text-xs font-bold">HARD {n}</span>
                <span className="text-[0.6rem] text-cream/70">{PAYS[`hard-${n}`]}</span>
              </Area>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {(
              [
                ['two', '2'],
                ['three', '3'],
                ['eleven', '11'],
                ['twelve', '12'],
              ] as [CrBetType, string][]
            ).map(([t, label]) => (
              <Area key={t} spot={{ type: t, number: null }} className="bg-felt-800/60">
                <span className="text-sm font-bold">{label}</span>
                <span className="text-[0.55rem] text-cream/70">{PAYS[t].replace(' to ', ':')}</span>
              </Area>
            ))}
          </div>
          <Area spot={{ type: 'any_craps', number: null }} className="bg-ruby-800/50">
            <span className="text-sm font-bold">ANY CRAPS</span>
            <span className="text-[0.6rem] text-cream/70">2, 3 or 12 · 7 to 1</span>
          </Area>
        </div>
      </div>
    </div>
    </Ctx.Provider>
  );
}
