import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { chipColorFor } from '@/components/table/ChipStack';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { cn } from '@/components/ui/cn';
import { formatChipsCompact } from '@/lib/format';
import {
  BET_INFO,
  BOARD_H,
  BOARD_W,
  betKey,
  buildZones,
  pocketColor,
  pocketLabel,
  toVertical,
  type RlBet,
  type RlVariant,
  type Zone,
} from '@/lib/roulette';

/**
 * The betting layout. Every bet is a button positioned on a 14 × 4.5 grid
 * (rotated for phones). Thin invisible buttons sit on the lines between numbers
 * for splits, corners, streets and lines; hovering any spot highlights the
 * numbers it covers.
 */
export function RouletteBoard({
  variant,
  bets,
  userId,
  vertical,
  disabled,
  winning,
  onBet,
}: {
  variant: RlVariant;
  bets: RlBet[];
  userId: string | undefined;
  vertical: boolean;
  disabled: boolean;
  winning: number | null;
  onBet: (zone: Zone) => void;
}) {
  const zones = useMemo(() => buildZones(variant), [variant]);
  const [hover, setHover] = useState<Zone | null>(null);
  const covered = new Set(hover?.numbers ?? []);

  // Chips per spot: mine and everyone else's.
  const totals = useMemo(() => {
    const m = new Map<string, { mine: number; others: number }>();
    for (const b of bets) {
      const k = betKey(b.bet_type, b.selection);
      const t = m.get(k) ?? { mine: 0, others: 0 };
      if (b.user_id === userId) t.mine += b.amount;
      else t.others += b.amount;
      m.set(k, t);
    }
    return m;
  }, [bets, userId]);

  const W = vertical ? BOARD_H : BOARD_W;
  const H = vertical ? BOARD_W : BOARD_H;
  const place = (z: Zone) => {
    const p = vertical ? toVertical(z) : z;
    return { left: `${(p.x / W) * 100}%`, top: `${(p.y / H) * 100}%`, width: `${(p.w / W) * 100}%`, height: `${(p.h / H) * 100}%` };
  };

  return (
    <div
      className="relative w-full select-none rounded-xl border-2 border-gold-500/40 bg-felt-800 shadow-inner"
      style={{ aspectRatio: `${W} / ${H}` }}
      role="group"
      aria-label="Roulette betting layout"
      onMouseLeave={() => setHover(null)}
    >
      {zones.map((z) => {
        const t = totals.get(z.key);
        const isNumber = z.type === 'straight';
        const pocket = isNumber ? z.numbers[0] : null;
        const lit = z.kind === 'cell' && (isNumber ? covered.has(pocket!) : hover?.key === z.key);
        const won = winning !== null && z.kind === 'cell' && isNumber && pocket === winning;
        const info = BET_INFO[z.type];
        return (
          <button
            key={z.key}
            type="button"
            disabled={disabled}
            tabIndex={z.kind === 'edge' ? -1 : 0}
            onClick={() => onBet(z)}
            onMouseEnter={() => setHover(z)}
            onFocus={() => setHover(z)}
            aria-label={`${z.label}. Pays ${info.pays}.${t?.mine ? ` Your bet: ${t.mine}.` : ''}`}
            className={cn(
              'absolute flex items-center justify-center transition-colors disabled:cursor-not-allowed',
              z.kind === 'edge' ? 'z-20 rounded-full hover:bg-gold-300/40' : 'z-10 border border-gold-500/30',
              z.kind === 'cell' && isNumber && pocketColor(pocket!) === 'red' && 'bg-ruby-700/90',
              z.kind === 'cell' && isNumber && pocketColor(pocket!) === 'black' && 'bg-ink-900/90',
              z.kind === 'cell' && isNumber && pocketColor(pocket!) === 'green' && 'bg-felt-600',
              z.kind === 'cell' && !isNumber && 'bg-felt-700/40 hover:bg-felt-600/60',
              lit && 'ring-2 ring-inset ring-gold-300 brightness-125',
              won && 'animate-pulse ring-4 ring-inset ring-gold-300',
            )}
            style={place(z)}
          >
            {z.kind === 'cell' && (
              <span
                className={cn(
                  'pointer-events-none font-display font-bold text-ivory',
                  isNumber ? 'text-[min(3.2vw,1rem)]' : 'text-[min(2.2vw,0.7rem)] uppercase tracking-wider',
                  vertical && isNumber && 'text-[min(4.2vw,1rem)]',
                )}
              >
                {isNumber ? (
                  pocketLabel(pocket!)
                ) : z.type === 'red' ? (
                  <span className="inline-block h-3 w-3 rotate-45 bg-ruby-500" aria-hidden="true" />
                ) : z.type === 'black' ? (
                  <span className="inline-block h-3 w-3 rotate-45 bg-ink-950 ring-1 ring-white/40" aria-hidden="true" />
                ) : z.type === 'column' ? (
                  '2:1'
                ) : z.type === 'dozen' ? (
                  `${['1st', '2nd', '3rd'][Number(z.selection) - 1]} 12`
                ) : (
                  z.label
                )}
              </span>
            )}
            {t && (
              <motion.span
                initial={{ scale: 0.4, y: -8, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                className="pointer-events-none absolute left-1/2 top-1/2 z-30 flex -translate-x-1/2 -translate-y-1/2 items-center"
              >
                <span className="relative flex h-6 w-6 items-center justify-center">
                  <ChipIcon className="absolute h-6 w-6 drop-shadow" color={chipColorFor(t.mine || t.others)} />
                  <span className="relative rounded bg-ink-950/80 px-0.5 text-[0.55rem] font-bold leading-tight text-ivory">
                    {formatChipsCompact(t.mine || t.others)}
                  </span>
                </span>
                {t.mine > 0 && t.others > 0 && (
                  <span className="absolute -right-2 -top-1 h-2.5 w-2.5 rounded-full bg-sapphire-300 ring-1 ring-ink-950" title="Other players also bet here" />
                )}
                {t.mine === 0 && (
                  <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-sapphire-300 ring-1 ring-ink-950" title="Another player's bet" />
                )}
              </motion.span>
            )}
          </button>
        );
      })}
    </div>
  );
}
