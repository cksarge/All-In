import type { TierKey } from './types';

/** A grid is a list of reels (columns); each reel lists its symbols from top to bottom. */
export type Grid = string[][];

export interface LineWin {
  line: number;
  sym: string;
  n: number;
  units: number;
}
export interface WaysWin {
  sym: string;
  n: number;
  ways: number;
  units: number;
}
export interface LineSpin {
  grid: Grid;
  wins: LineWin[];
  units: number;
  scatters?: number;
  scatter_units?: number;
  /** Dragon Pearls: prize on each cell (reel * 3 + row), 0 for none. */
  pearls?: number[];
  awarded?: number;
  /** Haunted Manor: the grid as it landed, before ghosts turned cells wild. */
  before?: Grid;
  /** Haunted Manor: the cells the ghosts took (reel * 3 + row). */
  haunted?: number[];
  /** Haunted Manor, midnight spins: the multiplier this spin was played at. */
  mult?: number;
}
export interface WaysSpin {
  grid: Grid;
  wins: WaysWin[];
  units: number;
  scatters: number;
  awarded?: number;
}
export interface ClusterStep {
  grid: Grid;
  /** cells are numbered column * rows + row */
  clusters: { sym: string; cells: number[]; units: number }[];
  mult: number;
  units: number;
}

/** What the server played, start to finish. `units` are hundredths of the bet. */
export type SlotResult =
  | { kind: 'classic'; grid: Grid; wins: { name: string; units: number }[]; units: number }
  | {
      kind: 'lines';
      base: LineSpin;
      free?: LineSpin[];
      hold?: { steps: { cell: number; value: number }[][]; pearls: number[]; grand: boolean; units: number };
      units: number;
    }
  | { kind: 'ways'; base: WaysSpin; free?: WaysSpin[]; units: number }
  | { kind: 'cluster'; steps: ClusterStep[]; grid: Grid; units: number };

export interface SpinResponse {
  round_id: string;
  game: string;
  bet: number;
  tier: TierKey;
  win: number;
  jackpot_won: number;
  jackpot: number | null;
  balance: number;
  result: SlotResult;
}

export interface SlotConfig {
  kind: 'classic' | 'lines' | 'ways' | 'cluster';
  rtp: number;
  reels?: number;
  rows?: number;
  cols?: number;
  lines?: number;
  line_defs?: number[][];
  wild?: string;
  scatter?: string;
  min?: number;
  sizes?: number[];
  mults?: number[];
  pays: Record<string, number | number[] | Record<string, number>>;
  scatter_pays?: Record<string, number>;
  free?: { trigger: number; spins: number; mult?: number; mult_step?: number; mult_max?: number; height?: number; max: number };
  /** Haunted Manor: ghosts may turn cells wild (how often stays on the server). */
  haunt?: Record<string, never>;
  hold?: { symbol: string; trigger: number; respins: number; grand: number; values: number[] };
  jackpot?: { symbol: string; seed: number; feed_bp: number; odds: number };
}

export interface SlotJackpot {
  amount: number;
  seed: number;
  last_winner: string | null;
  last_amount: number | null;
  last_won_at: string | null;
}

export interface SlotInfo {
  game: string;
  name: string;
  released: boolean;
  /** A seasonal machine: the month it is open, as "2026-10". */
  season?: string | null;
  config: SlotConfig;
  bets: number[];
  tiers: { tier: TierKey; label: string; min_bet: number; max_bet: number; min_bankroll: number }[];
  jackpot: SlotJackpot | null;
}

/** Chips for a win of `units` hundredths of the bet. Always a whole number (see 10_slots.sql). */
export const chipsFor = (bet: number, units: number) => Math.round((bet * units) / 100);

/** "×2.5" style multiple of the bet. */
export const timesBet = (units: number) => `×${Number((units / 100).toFixed(2))}`;

// ---------------------------------------------------------------------------
// Look and feel
// ---------------------------------------------------------------------------
export interface SymbolArt {
  label: string;
  /** Emoji drawn large in the tile. */
  glyph?: string;
  /** Short text drawn instead of a glyph (card ranks, 7, WILD…). */
  text?: string;
  /** Custom drawing. */
  art?: 'bar1' | 'bar2' | 'bar3' | 'gem' | 'pearl' | 'pyramid' | 'blank' | 'ghost' | 'pumpkin';
  /** Tile background (CSS). */
  bg: string;
  /** Text / gem colour. */
  fg?: string;
}

const tile = (a: string, b: string) => `linear-gradient(160deg, ${a}, ${b})`;
const RANK_BG = tile('#1c211f', '#0b0d0c');
const HIGH_BG = tile('#3a2c0a', '#141006');
const rank = (label: string, text: string, fg: string): SymbolArt => ({ label, text, fg, bg: RANK_BG });

const SHARED: Record<string, SymbolArt> = {
  A: rank('Ace', 'A', '#e25a68'),
  K: rank('King', 'K', '#8fb0f0'),
  Q: rank('Queen', 'Q', '#c9a4f5'),
  J: rank('Jack', 'J', '#5cc392'),
  WILD: { label: 'Wild', text: 'WILD', fg: '#0b0d0c', bg: tile('#f0d688', '#ad872b') },
  SEVEN: { label: 'Seven', text: '7', fg: '#e25a68', bg: HIGH_BG },
  BELL: { label: 'Bell', glyph: '🔔', bg: tile('#3d2f08', '#16110a') },
  CHERRY: { label: 'Cherry', glyph: '🍒', bg: tile('#3d0910', '#150608') },
  BLANK: { label: 'Blank', art: 'blank', bg: 'transparent' },
};

const gem = (label: string, fg: string): SymbolArt => ({ label, art: 'gem', fg, bg: tile('#191c2e', '#0b0c16') });

/** Per machine: its symbols from most to least valuable (also the paytable order). */
export const SYMBOLS: Record<string, Record<string, SymbolArt>> = {
  slots_classic: {
    SEVEN: SHARED.SEVEN,
    BAR3: { label: 'Triple bar', art: 'bar3', bg: HIGH_BG },
    BAR2: { label: 'Double bar', art: 'bar2', bg: HIGH_BG },
    BELL: SHARED.BELL,
    BAR1: { label: 'Bar', art: 'bar1', bg: HIGH_BG },
    CHERRY: SHARED.CHERRY,
    BLANK: SHARED.BLANK,
  },
  slots_paylines: {
    EYE: { label: 'Eye of Ra', glyph: '👁️', bg: tile('#0f3a5c', '#081a2b') },
    COBRA: { label: 'Cobra', glyph: '🐍', bg: tile('#0e4730', '#062417') },
    SCORPION: { label: 'Scorpion', glyph: '🦂', bg: tile('#5e2a0e', '#27110a') },
    URN: { label: 'Urn', glyph: '🏺', bg: tile('#4a3410', '#1d1408') },
    A: SHARED.A,
    K: SHARED.K,
    Q: SHARED.Q,
    J: SHARED.J,
    WILD: SHARED.WILD,
    SCATTER: { label: 'Pyramid (scatter)', art: 'pyramid', bg: tile('#5f4812', '#1f1706') },
  },
  slots_cascade: {
    DIAMOND: gem('Diamond', '#e8f4ff'),
    RUBY: gem('Ruby', '#e2364a'),
    EMERALD: gem('Emerald', '#2fb36f'),
    SAPPHIRE: gem('Sapphire', '#3f7be0'),
    AMETHYST: gem('Amethyst', '#a56be8'),
    TOPAZ: gem('Topaz', '#f0a53a'),
    QUARTZ: gem('Rose quartz', '#f08bb0'),
  },
  slots_ways: {
    BISON: { label: 'Bison', glyph: '🐃', bg: tile('#5e2a0e', '#27110a') },
    EAGLE: { label: 'Eagle', glyph: '🦅', bg: tile('#1b3a7a', '#0d1b3a') },
    WOLF: { label: 'Wolf', glyph: '🐺', bg: tile('#3a423e', '#141816') },
    HORSE: { label: 'Mustang', glyph: '🐎', bg: tile('#4a3410', '#1d1408') },
    CACTUS: { label: 'Cactus', glyph: '🌵', bg: tile('#0e4730', '#062417') },
    A: SHARED.A,
    K: SHARED.K,
    Q: SHARED.Q,
    J: SHARED.J,
    WILD: SHARED.WILD,
    SCATTER: { label: 'Campfire (scatter)', glyph: '🔥', bg: tile('#5f1a08', '#1f0a06') },
  },
  slots_holdwin: {
    DRAGON: { label: 'Dragon', glyph: '🐉', bg: tile('#5e0e18', '#22070b') },
    TIGER: { label: 'Tiger', glyph: '🐅', bg: tile('#5e2a0e', '#27110a') },
    KOI: { label: 'Koi', glyph: '🐠', bg: tile('#0f3a5c', '#081a2b') },
    LANTERN: { label: 'Lantern', glyph: '🏮', bg: tile('#4a1010', '#1d0808') },
    A: SHARED.A,
    K: SHARED.K,
    Q: SHARED.Q,
    WILD: SHARED.WILD,
    PEARL: { label: 'Pearl', art: 'pearl', bg: tile('#141816', '#060707') },
  },
  slots_progressive: {
    CROWN: { label: 'Crown (jackpot)', glyph: '👑', bg: tile('#86661c', '#2a2108') },
    DIAMOND: { label: 'Diamond', glyph: '💎', bg: tile('#1b3a7a', '#0d1b3a') },
    SEVEN: SHARED.SEVEN,
    BAR: { label: 'Bar', art: 'bar1', bg: HIGH_BG },
    BELL: SHARED.BELL,
    CLOVER: { label: 'Clover', glyph: '🍀', bg: tile('#0e4730', '#062417') },
    CHERRY: SHARED.CHERRY,
    WILD: SHARED.WILD,
  },
  slots_haunted: {
    VAMPIRE: { label: 'Vampire', glyph: '🧛', bg: tile('#5e0e18', '#1c0509') },
    WITCH: { label: 'Witch', glyph: '🧙', bg: tile('#2f1a5e', '#120a26') },
    SKULL: { label: 'Skull', glyph: '💀', bg: tile('#33383f', '#111418') },
    BAT: { label: 'Bat', glyph: '🦇', bg: tile('#1d2247', '#0a0c1c') },
    A: rank('Ace', 'A', '#ff8a3c'),
    K: rank('King', 'K', '#b78cff'),
    Q: rank('Queen', 'Q', '#7be0a0'),
    J: rank('Jack', 'J', '#8fb0f0'),
    WILD: { label: 'Ghost (wild)', art: 'ghost', bg: tile('#3b2a6e', '#150d2e') },
    SCATTER: { label: 'Jack-o\'-lantern (scatter)', art: 'pumpkin', bg: tile('#5f2a08', '#1f0d06') },
  },
};

export const symbolArt = (game: string, sym: string): SymbolArt =>
  SYMBOLS[game]?.[sym] ?? { label: sym, text: sym.slice(0, 2), bg: RANK_BG, fg: '#ece5d6' };

export interface SlotTheme {
  /** Cabinet background (CSS). */
  cabinet: string;
  /** Accent colour for the frame and captions. */
  accent: string;
  tagline: string;
}

export const THEMES: Record<string, SlotTheme> = {
  slots_classic: {
    cabinet: 'linear-gradient(180deg, #5e0e18, #2a070c 55%, #140406)',
    accent: '#f0d688',
    tagline: 'Three reels, one line, no fuss.',
  },
  slots_paylines: {
    cabinet: 'linear-gradient(180deg, #4a3410, #1d1408 55%, #0d0a05)',
    accent: '#f0d688',
    tagline: '20 paylines, wilds and doubled free spins.',
  },
  slots_cascade: {
    cabinet: 'linear-gradient(180deg, #2a1f5c, #120e2b 55%, #080614)',
    accent: '#c9a4f5',
    tagline: 'Match 5 or more touching gems. Wins cascade.',
  },
  slots_ways: {
    cabinet: 'linear-gradient(180deg, #6b2f0e, #2b140a 55%, #130905)',
    accent: '#f7c873',
    tagline: 'Up to 3,125 ways to win as the reels grow.',
  },
  slots_holdwin: {
    cabinet: 'linear-gradient(180deg, #5e0e18, #1f0a12 55%, #0b0508)',
    accent: '#f0d688',
    tagline: 'Land six pearls to lock them and respin.',
  },
  slots_progressive: {
    cabinet: 'linear-gradient(180deg, #2a2108, #0d0b05 55%, #060504)',
    accent: '#f0d688',
    tagline: 'One jackpot, shared by everyone, growing with every spin.',
  },
  slots_haunted: {
    cabinet: 'linear-gradient(180deg, #2b1247, #130a24 55%, #07040f)',
    accent: '#ffb057',
    tagline: 'Ghosts turn symbols wild. At midnight, every win raises the multiplier.',
  },
};

export const CLASSIC_WINS: Record<string, string> = {
  SEVEN: 'Three sevens',
  BAR3: 'Three triple bars',
  BAR2: 'Three double bars',
  BELL: 'Three bells',
  BAR1: 'Three bars',
  ANYBAR: 'Any three bars',
  CHERRY3: 'Three cherries',
  CHERRY2: 'Two cherries',
  CHERRY1: 'One cherry',
};

/** Rows shown per reel (the tallest a reel can get). */
export function maxRows(cfg: SlotConfig): number {
  if (cfg.kind === 'ways') return cfg.free?.height ?? 5;
  return cfg.rows ?? 3;
}
export const reelCount = (cfg: SlotConfig) => cfg.cols ?? cfg.reels ?? 5;

/** A random grid to show before the first spin. Decoration only: it never pays. */
export function idleGrid(game: string, cfg: SlotConfig): Grid {
  const pool = Object.keys(SYMBOLS[game] ?? {}).filter(
    (s) => s !== 'BLANK' && s !== cfg.scatter && s !== cfg.hold?.symbol && s !== cfg.jackpot?.symbol && s !== cfg.wild,
  );
  const rows = cfg.kind === 'ways' ? 3 : maxRows(cfg);
  // Neighbours always differ, so the idle screen never looks like a win.
  return Array.from({ length: reelCount(cfg) }, (_, c) =>
    Array.from({ length: rows }, (_, r) => pool[(c * 2 + r * 3) % pool.length]),
  );
}

// ---------------------------------------------------------------------------
// Turning a result into scenes to play back
// ---------------------------------------------------------------------------
export type SceneTone = 'base' | 'free' | 'hold' | 'cascade' | 'jackpot';
export type SceneFx = 'lightning' | 'ghosts' | 'midnight';

export interface Scene {
  id: string;
  grid: Grid;
  /** How this grid arrives: reels spin in, gems drop, pearls land, or it's already there. */
  enter: 'spin' | 'drop' | 'hold' | 'haunt' | 'none';
  /** Winning cells as "reel-row". */
  hl: string[];
  /** Winning paylines to draw. */
  lines: number[];
  /** Dragon Pearls: prize per cell (reel * 3 + row), 0 for none. */
  pearls?: number[];
  /** Hold-and-win board: only pearls are shown. */
  holdMode?: boolean;
  /** Cells that just landed (hold and win). */
  fresh?: number[];
  /** Haunted Manor: cells the ghosts turned wild (reel * 3 + row). */
  haunted?: number[];
  /** Haunted Manor, midnight spins: the multiplier in force, and what it becomes once this scene has landed. */
  mult?: number;
  multAfter?: number;
  /** A special effect to play as the scene lands. */
  fx?: SceneFx;
  /** Gem Cascade: how many rows each cell fell, per reel. */
  shift?: number[][];
  caption?: string;
  /** Short description of the win. */
  label?: string;
  banner?: { title: string; sub?: string; chips?: number };
  /** Units (hundredths of the bet) won in this scene. */
  units: number;
  /** Extra chips won in this scene on top of units (the jackpot). */
  bonusChips?: number;
  /** Chips won so far in the round, once this scene has landed. */
  won: number;
  /** How long to linger once it has landed. */
  ms: number;
  tone: SceneTone;
}

const key = (c: number, r: number) => `${c}-${r}`;
const cellsOf = (grid: Grid, sym: string | undefined) =>
  sym ? grid.flatMap((reel, c) => reel.map((s, r) => (s === sym ? key(c, r) : '')).filter(Boolean)) : [];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function lineParts(spin: LineSpin, cfg: SlotConfig, game: string) {
  const hl = new Set<string>();
  for (const w of spin.wins) {
    const def = cfg.line_defs?.[w.line] ?? [];
    for (let i = 0; i < w.n; i++) hl.add(key(i, def[i]));
  }
  if ((spin.scatter_units ?? 0) > 0) cellsOf(spin.grid, cfg.scatter).forEach((k) => hl.add(k));
  const best = [...spin.wins].sort((a, b) => b.units - a.units)[0];
  return {
    grid: spin.grid,
    hl: [...hl],
    lines: spin.wins.map((w) => w.line),
    pearls: spin.pearls,
    haunted: spin.haunted,
    label: best
      ? spin.wins.length > 1
        ? `${plural(spin.wins.length, 'winning line')}`
        : `${best.n} × ${symbolArt(game, best.sym).label} on line ${best.line + 1}`
      : (spin.scatter_units ?? 0) > 0
        ? `${spin.scatters} scatters`
        : undefined,
  };
}

function waysParts(spin: WaysSpin, cfg: SlotConfig) {
  const hl = new Set<string>();
  for (const w of spin.wins) {
    for (let c = 0; c < w.n; c++) {
      spin.grid[c].forEach((s, r) => {
        if (s === w.sym || (c > 0 && s === cfg.wild)) hl.add(key(c, r));
      });
    }
  }
  const ways = spin.wins.reduce((n, w) => n + w.ways, 0);
  return { grid: spin.grid, hl: [...hl], lines: [], label: ways ? `${plural(ways, 'winning way')}` : undefined };
}

/** How far each cell of the next grid fell after a cascade removed `step`'s clusters. */
function dropShift(step: ClusterStep, rows: number): number[][] {
  const gone = new Set(step.clusters.flatMap((c) => c.cells));
  return step.grid.map((reel, c) => {
    const kept = reel.map((_, r) => r).filter((r) => !gone.has(c * rows + r));
    const fresh = rows - kept.length;
    return Array.from({ length: rows }, (_, r) => (r < fresh ? fresh : r - kept[r - fresh]));
  });
}

export function buildScenes(res: SpinResponse, cfg: SlotConfig): Scene[] {
  const out: Scene[] = [];
  let total = 0;
  let bonus = 0;
  const push = (s: Partial<Scene> & Pick<Scene, 'grid'>) => {
    total += s.units ?? 0;
    bonus += s.bonusChips ?? 0;
    out.push({
      id: `${res.round_id}-${out.length}`,
      enter: 'spin',
      hl: [],
      lines: [],
      units: 0,
      tone: 'base',
      ms: (s.units ?? 0) > 0 ? 1300 : 450,
      ...s,
      won: chipsFor(res.bet, total) + bonus,
    });
  };
  const chips = (units: number) => chipsFor(res.bet, units);
  const r = res.result;

  const freeSpins = <T extends { units: number; awarded?: number; grid: Grid }>(
    base: Grid,
    spins: T[],
    parts: (s: T) => (Partial<Scene> & Pick<Scene, 'grid'>)[],
    sub: string,
    words: { name: string; one: string; done: string } = { name: 'Free Spins', one: 'Free spin', done: 'Free spins complete' },
  ) => {
    let count = cfg.free?.spins ?? spins.length;
    const first = (spins[0] as { mult?: number }).mult;
    push({
      grid: base,
      enter: 'none',
      hl: cellsOf(base, cfg.scatter),
      banner: { title: `${count} ${words.name}`, sub },
      tone: 'free',
      mult: first,
      multAfter: first,
      fx: first ? 'midnight' : undefined,
      ms: first ? 2300 : 1700,
    });
    let last: number | undefined = first;
    spins.forEach((f, i) => {
      const mult = (f as { mult?: number }).mult;
      const caption = `${words.one} ${i + 1} of ${count}${mult ? ` · wins ×${mult}` : ''}`;
      count += f.awarded ?? 0;
      const step = cfg.free?.mult_step ?? 0;
      const after = mult && f.units > 0 ? Math.min(mult + step, cfg.free?.mult_max ?? mult) : mult;
      last = after;
      const all = parts(f);
      all.forEach((p, k) => {
        const final = k === all.length - 1;
        push({
          ...p,
          units: final ? f.units : 0,
          tone: 'free',
          mult,
          multAfter: final ? after : mult,
          caption: p.caption ?? (f.awarded && final ? `${caption} · +${f.awarded} more!` : caption),
          ...(final && mult && f.units > 0 ? { ms: 1500 } : {}),
        });
      });
    });
    push({
      grid: spins[spins.length - 1].grid,
      enter: 'none',
      banner: { title: words.done, chips: chips(spins.reduce((n, f) => n + f.units, 0)) },
      tone: 'free',
      mult: last,
      multAfter: last,
      ms: 2000,
    });
  };

  /** One payline spin as scenes: two when ghosts took cells (the reels as they landed, then the haunting). */
  const lineScenes = (spin: LineSpin): (Partial<Scene> & Pick<Scene, 'grid'>)[] => {
    const final = lineParts(spin, cfg, res.game);
    if (!spin.before || !spin.haunted?.length) return [final];
    return [
      { grid: spin.before, caption: 'Something stirs in the manor…', fx: 'lightning', ms: 700 },
      { ...final, enter: 'haunt', fx: 'ghosts', caption: `${plural(spin.haunted.length, 'ghost')} turned wild!` },
    ];
  };

  if (r.kind === 'classic') {
    const w = r.wins[0];
    push({
      grid: r.grid,
      units: r.units,
      hl: w ? r.grid.map((_, c) => key(c, 1)) : [],
      label: w ? CLASSIC_WINS[w.name] : undefined,
    });
  } else if (r.kind === 'lines') {
    const jackpot = res.jackpot_won > 0;
    const baseScenes = lineScenes(r.base);
    baseScenes.forEach((p, k) => {
      const final = k === baseScenes.length - 1;
      push({ ...p, units: final ? r.base.units : 0, ms: !final ? (p.ms ?? 700) : jackpot ? 900 : r.base.units > 0 ? 1300 : baseScenes.length > 1 ? 900 : 450 });
    });
    if (jackpot) {
      push({
        grid: r.base.grid,
        enter: 'none',
        hl: r.base.grid.map((_, c) => key(c, 1)),
        banner: { title: 'Jackpot!', sub: 'The whole pot is yours.', chips: res.jackpot_won },
        bonusChips: res.jackpot_won,
        tone: 'jackpot',
        ms: 5200,
      });
    }
    if (r.hold && cfg.hold) {
      const respins = cfg.hold.respins;
      let pearls = r.base.pearls ?? [];
      let left = respins;
      push({
        grid: r.base.grid,
        enter: 'none',
        pearls,
        hl: cellsOf(r.base.grid, cfg.hold.symbol),
        banner: { title: 'Hold & Win', sub: `Pearls lock in place. ${respins} respins.` },
        tone: 'hold',
        ms: 1700,
      });
      push({ grid: r.base.grid, enter: 'none', holdMode: true, pearls, caption: `${plural(left, 'respin')} left`, tone: 'hold', ms: 700 });
      for (const landed of r.hold.steps) {
        pearls = [...pearls];
        landed.forEach((p) => (pearls[p.cell] = p.value));
        left = landed.length ? respins : left - 1;
        push({
          grid: r.base.grid,
          enter: 'hold',
          holdMode: true,
          pearls,
          fresh: landed.map((p) => p.cell),
          caption: landed.length ? `New pearl! Back to ${plural(left, 'respin')}` : `${plural(left, 'respin')} left`,
          tone: 'hold',
          ms: landed.length ? 950 : 600,
        });
      }
      push({
        grid: r.base.grid,
        enter: 'none',
        holdMode: true,
        pearls,
        units: r.hold.units,
        banner: {
          title: r.hold.grand ? 'Grand prize!' : 'Pearls pay',
          sub: r.hold.grand ? 'Every cell filled.' : undefined,
          chips: chips(r.hold.units),
        },
        tone: 'hold',
        ms: 2400,
      });
    }
    if (r.free?.length) {
      if (cfg.free?.mult_step) {
        freeSpins(r.base.grid, r.free, lineScenes, `Every win raises the multiplier, up to ×${cfg.free.mult_max}`, {
          name: 'Midnight Spins',
          one: 'Midnight spin',
          done: 'The clock strikes one',
        });
      } else {
        freeSpins(r.base.grid, r.free, (f) => [lineParts(f, cfg, res.game)], `All wins ×${cfg.free?.mult ?? 1}`);
      }
    }
  } else if (r.kind === 'ways') {
    push({ ...waysParts(r.base, cfg), units: r.base.units });
    if (r.free?.length) {
      freeSpins(r.base.grid, r.free, (f) => [waysParts(f, cfg)], 'Full-height reels: 3,125 ways');
    }
  } else {
    const rows = cfg.rows ?? 5;
    r.steps.forEach((st, i) => {
      push({
        grid: st.grid,
        enter: i === 0 ? 'spin' : 'drop',
        shift: i > 0 ? dropShift(r.steps[i - 1], rows) : undefined,
        hl: st.clusters.flatMap((c) => c.cells.map((n) => key(Math.floor(n / rows), n % rows))),
        units: st.units,
        caption: st.mult > 1 ? `Cascade ${i + 1} · wins ×${st.mult}` : undefined,
        label:
          st.clusters.length === 1
            ? `${st.clusters[0].cells.length} × ${symbolArt(res.game, st.clusters[0].sym).label}`
            : `${st.clusters.length} winning groups`,
        tone: 'cascade',
        ms: 1100,
      });
    });
    const last = r.steps[r.steps.length - 1];
    push({ grid: r.grid, enter: last ? 'drop' : 'spin', shift: last ? dropShift(last, rows) : undefined, tone: last ? 'cascade' : 'base', ms: 400 });
  }
  return out;
}

export const FEATURE_LABELS: Record<string, string> = {
  free: 'Free spins',
  hold: 'Hold & Win',
  cascade: 'Cascade',
  jackpot: 'Jackpot',
};
