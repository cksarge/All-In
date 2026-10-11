import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/components/ui/cn';
import { chipsFor, maxRows, reelCount, symbolArt, SYMBOLS, type Scene, type SlotConfig } from '@/lib/slots';
import { SlotSymbol } from './SlotSymbol';

const LINE_COLORS = ['#f0d688', '#f08b95', '#8fb0f0', '#5cc392', '#c9a4f5', '#f7c873'];

/** A blurred strip of symbols rushing past while a reel spins. Decoration only. */
function SpinStrip({ game, rows, seed }: { game: string; rows: number; seed: number }) {
  const syms = useMemo(() => {
    const pool = Object.keys(SYMBOLS[game] ?? {});
    const half = Array.from({ length: rows }, (_, i) => pool[(seed * 7 + i * 3 + seed * i) % pool.length]);
    return [...half, ...half];
  }, [game, rows, seed]);
  return (
    <div className="absolute inset-x-0 top-0 flex h-[200%] animate-reel flex-col blur-[1.5px]">
      {syms.map((s, i) => (
        <div key={i} className="min-h-0 flex-1 p-[4%]">
          <SlotSymbol game={game} sym={s} />
        </div>
      ))}
    </div>
  );
}

/**
 * The reels. Shows one scene of a round: the grid, which cells won, the winning
 * paylines, pearls in hold-and-win, and falling gems in a cascade.
 */
export function SlotReels({
  game,
  cfg,
  scene,
  landed,
  spinning,
  bet,
}: {
  game: string;
  cfg: SlotConfig;
  scene: Scene;
  /** The scene has finished arriving, so wins can be shown. */
  landed: boolean;
  /** Per reel: still spinning. */
  spinning: boolean[];
  bet: number;
}) {
  const rows = maxRows(cfg);
  const reels = reelCount(cfg);
  const hl = useMemo(() => new Set(landed ? scene.hl : []), [landed, scene.hl]);
  const fresh = useMemo(() => new Set(scene.fresh ?? []), [scene.fresh]);
  const pearlSym = cfg.hold?.symbol;
  const showLines = landed && cfg.line_defs ? scene.lines : [];

  return (
    <div className="relative">
      <div className="grid gap-[1.5%]" style={{ gridTemplateColumns: `repeat(${reels}, minmax(0, 1fr))` }}>
        {Array.from({ length: reels }).map((_, c) => {
          const reel = scene.grid[c] ?? [];
          return (
            <div
              key={c}
              className="relative overflow-hidden rounded-lg bg-ink-950/70 ring-1 ring-inset ring-white/[0.06]"
              style={{ aspectRatio: `1 / ${rows}` }}
            >
              {spinning[c] ? (
                <SpinStrip game={game} rows={rows} seed={c + 1} />
              ) : (
                <div className="flex h-full flex-col">
                  {reel.map((sym, r) => {
                    const cell = c * rows + r;
                    const key = `${c}-${r}`;
                    const pearl = scene.pearls?.[c * 3 + r] ?? 0;
                    const isPearl = Boolean(pearlSym) && (scene.holdMode ? pearl > 0 : sym === pearlSym);
                    const empty = scene.holdMode && !isPearl;
                    const won = hl.has(key);
                    const fall = scene.enter === 'drop' ? (scene.shift?.[c]?.[r] ?? 0) : 0;
                    const initial =
                      scene.enter === 'spin'
                        ? { y: '-35%', opacity: 0.4 }
                        : fall > 0
                          ? { y: `${-fall * 100}%`, opacity: 0.9 }
                          : scene.enter === 'hold' && fresh.has(cell)
                            ? { scale: 0, opacity: 0 }
                            : false;
                    return (
                      <motion.div
                        key={`${scene.id}-${key}`}
                        initial={initial}
                        animate={{ y: 0, scale: 1, opacity: 1 }}
                        transition={
                          fall > 0
                            ? { duration: 0.28 + fall * 0.05, ease: [0.3, 0, 0.6, 1.25] }
                            : { type: 'spring', stiffness: 420, damping: 22 }
                        }
                        className={cn(
                          'min-h-0 flex-1 p-[4%] transition-opacity duration-300',
                          hl.size > 0 && !won && 'opacity-35',
                          won && 'relative z-10',
                        )}
                      >
                        <div
                          className={cn(
                            'h-full w-full rounded-[14%]',
                            won && 'animate-slot-win shadow-[0_0_0_2px_#f0d688,0_0_18px_rgba(240,214,136,0.55)]',
                          )}
                        >
                          {empty ? (
                            <div className="h-full w-full rounded-[14%] border border-dashed border-white/10 bg-ink-950/60" />
                          ) : (
                            <SlotSymbol
                              game={game}
                              sym={isPearl && pearlSym ? pearlSym : sym}
                              pearlChips={isPearl && pearl > 0 ? chipsFor(bet, pearl) : null}
                              bigPearl={pearl >= 2500}
                            />
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Paylines. Lucky Sevens always shows its single line. */}
      {(cfg.kind === 'classic' || showLines.length > 0) && (
        <svg
          viewBox={`0 0 ${reels} ${rows}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          {cfg.kind === 'classic' && (
            <line
              x1="0"
              x2={reels}
              y1={rows / 2}
              y2={rows / 2}
              stroke={landed && scene.hl.length ? '#f0d688' : 'rgba(240,214,136,0.3)'}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {showLines.map((l, i) => (
            <polyline
              key={l}
              points={(cfg.line_defs?.[l] ?? []).map((row, c) => `${c + 0.5},${row + 0.5}`).join(' ')}
              fill="none"
              stroke={LINE_COLORS[i % LINE_COLORS.length]}
              strokeOpacity="0.85"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
    </div>
  );
}

/** Screen-reader description of what's on the reels. */
export function describeGrid(game: string, scene: Scene): string {
  return scene.grid.map((reel, c) => `Reel ${c + 1}: ${reel.map((s) => symbolArt(game, s).label).join(', ')}`).join('. ');
}
