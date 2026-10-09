import type { TierKey } from './types';
import type { LiveSeat } from '@/hooks/useLiveTable';

export type RlVariant = 'european' | 'american';
export type RlBetType =
  | 'straight' | 'split' | 'street' | 'corner' | 'line' | 'dozen' | 'column'
  | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high';

export interface RlBet {
  id: string;
  user_id: string;
  username: string;
  bet_type: RlBetType;
  selection: string;
  numbers: number[];
  amount: number;
  won: boolean | null;
  payout: number;
}

export interface RlState {
  server_now: string;
  rules: { bet_seconds: number; spin_seconds: number; next_round_seconds: number; max_total_multiplier: number };
  table: {
    id: string; name: string; tier: TierKey; tier_label: string; variant: RlVariant;
    min_bet: number; max_bet: number; min_bankroll: number; max_seats: number;
    is_private: boolean; status: string; invite_code: string | null;
  };
  seats: LiveSeat[];
  round: {
    id: string; round_no: number; phase: 'betting' | 'spinning' | 'settled';
    phase_ends_at: string | null; result: number | null; settled_at: string | null;
  } | null;
  bets: RlBet[];
  recent: number[];
  stats: {
    spins: number;
    hot: { n: number; hits: number }[];
    cold: { n: number; hits: number }[];
    red: number; black: number; zero: number;
  };
}

/** Pocket 37 is "00". */
export const pocketLabel = (n: number) => (n === 37 ? '00' : String(n));

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const pocketColor = (n: number): 'red' | 'black' | 'green' =>
  n === 0 || n === 37 ? 'green' : RED.has(n) ? 'red' : 'black';

export const WHEEL_ORDER: Record<RlVariant, number[]> = {
  european: [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26],
  american: [0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1, 37, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2],
};

/** Payout "to 1" for a bet covering n numbers (stake comes back too). */
export const payoutToOne = (n: number) => 36 / n - 1;

export const BET_INFO: Record<RlBetType, { name: string; covers: string; pays: string }> = {
  straight: { name: 'Straight up', covers: 'One number', pays: '35 to 1' },
  split: { name: 'Split', covers: 'Two touching numbers', pays: '17 to 1' },
  street: { name: 'Street', covers: 'A row of three', pays: '11 to 1' },
  corner: { name: 'Corner', covers: 'Four numbers that meet', pays: '8 to 1' },
  line: { name: 'Line (six line)', covers: 'Two rows of three', pays: '5 to 1' },
  dozen: { name: 'Dozen', covers: '1–12, 13–24 or 25–36', pays: '2 to 1' },
  column: { name: 'Column', covers: 'A column of twelve', pays: '2 to 1' },
  red: { name: 'Red', covers: 'All 18 red numbers', pays: '1 to 1' },
  black: { name: 'Black', covers: 'All 18 black numbers', pays: '1 to 1' },
  odd: { name: 'Odd', covers: '18 odd numbers', pays: '1 to 1' },
  even: { name: 'Even', covers: '18 even numbers', pays: '1 to 1' },
  low: { name: '1 to 18', covers: 'Low numbers', pays: '1 to 1' },
  high: { name: '19 to 36', covers: 'High numbers', pays: '1 to 1' },
};

export const betKey = (type: string, selection: string) => `${type}:${selection}`;

// -----------------------------------------------------------------------------
// Board model. Coordinates are in "cell units" for the horizontal layout:
// zero column (1 wide) · 12 number columns · "2 to 1" column → 14 × 4.5.
// Rows: 0 = top (3, 6, …, 36), 1 = middle, 2 = bottom (1, 4, …, 34);
// dozens at y 3–3.75, outside bets at y 3.75–4.5.
// -----------------------------------------------------------------------------
export const BOARD_W = 14;
export const BOARD_H = 4.5;

export interface Zone {
  key: string;
  type: RlBetType;
  selection: string;
  numbers: number[];
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Visible box (numbers, zeros, outside bets) vs. an invisible hit area on a line or corner. */
  kind: 'cell' | 'edge';
}

const T = 0.26; // thickness of edge hit areas

const n = (r: number, c: number) => 3 * c + 3 - r;
const range = (a: number, b: number, step = 1) => Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => a + i * step);

export function buildZones(variant: RlVariant): Zone[] {
  const zones: Zone[] = [];
  const cell = (z: Omit<Zone, 'key' | 'kind'>) => zones.push({ ...z, key: betKey(z.type, z.selection), kind: 'cell' });
  const edge = (z: Omit<Zone, 'key' | 'kind'>) => zones.push({ ...z, key: betKey(z.type, z.selection), kind: 'edge' });

  // Zero(s)
  if (variant === 'american') {
    cell({ type: 'straight', selection: '00', numbers: [37], label: 'Straight 00', x: 0, y: 0, w: 1, h: 1.5 });
    cell({ type: 'straight', selection: '0', numbers: [0], label: 'Straight 0', x: 0, y: 1.5, w: 1, h: 1.5 });
  } else {
    cell({ type: 'straight', selection: '0', numbers: [0], label: 'Straight 0', x: 0, y: 0, w: 1, h: 3 });
  }

  // Numbers
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 3; r++) {
      cell({ type: 'straight', selection: String(n(r, c)), numbers: [n(r, c)], label: `Straight ${n(r, c)}`, x: 1 + c, y: r, w: 1, h: 1 });
    }
  }

  // Columns ("2 to 1")
  for (let r = 0; r < 3; r++) {
    const col = 3 - r;
    cell({ type: 'column', selection: String(col), numbers: range(col, 36, 3), label: `Column ${col}`, x: 13, y: r, w: 1, h: 1 });
  }

  // Dozens
  for (let d = 1; d <= 3; d++) {
    cell({ type: 'dozen', selection: String(d), numbers: range((d - 1) * 12 + 1, d * 12), label: `Dozen ${(d - 1) * 12 + 1} to ${d * 12}`, x: 1 + (d - 1) * 4, y: 3, w: 4, h: 0.75 });
  }

  // Outside even-money bets
  const outside: [RlBetType, string, (k: number) => boolean][] = [
    ['low', '1 to 18', (k) => k <= 18],
    ['even', 'Even', (k) => k % 2 === 0],
    ['red', 'Red', (k) => pocketColor(k) === 'red'],
    ['black', 'Black', (k) => pocketColor(k) === 'black'],
    ['odd', 'Odd', (k) => k % 2 === 1],
    ['high', '19 to 36', (k) => k >= 19],
  ];
  outside.forEach(([type, label, f], i) =>
    cell({ type, selection: '', numbers: range(1, 36).filter(f), label, x: 1 + i * 2, y: 3.75, w: 2, h: 0.75 }),
  );

  // Edges: splits, corners, streets, lines (drawn on top of the cells)
  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 3; r++) {
      const a = n(r, c);
      if (c < 11) {
        const b = n(r, c + 1);
        edge({ type: 'split', selection: `${a}-${b}`, numbers: [a, b], label: `Split ${a} and ${b}`, x: 2 + c - T / 2, y: r + 0.2, w: T, h: 0.6 });
      }
      if (r < 2) {
        const b = n(r + 1, c);
        edge({ type: 'split', selection: `${b}-${a}`, numbers: [b, a], label: `Split ${b} and ${a}`, x: 1 + c + 0.2, y: r + 1 - T / 2, w: 0.6, h: T });
      }
      if (r < 2 && c < 11) {
        const lo = n(r + 1, c);
        edge({ type: 'corner', selection: String(lo), numbers: [lo, lo + 1, lo + 3, lo + 4], label: `Corner ${lo}, ${lo + 1}, ${lo + 3}, ${lo + 4}`, x: 2 + c - T / 2, y: r + 1 - T / 2, w: T, h: T });
      }
    }
    const first = 3 * c + 1;
    edge({ type: 'street', selection: String(first), numbers: [first, first + 1, first + 2], label: `Street ${first} to ${first + 2}`, x: 1 + c + 0.2, y: 3 - T / 2, w: 0.6, h: T });
    if (c < 11) {
      edge({ type: 'line', selection: String(first), numbers: range(first, first + 5), label: `Line ${first} to ${first + 5}`, x: 2 + c - T / 2, y: 3 - T / 2, w: T, h: T });
    }
  }

  // Zero splits
  if (variant === 'american') {
    edge({ type: 'split', selection: '3-00', numbers: [3, 37], label: 'Split 00 and 3', x: 1 - T / 2, y: 0.2, w: T, h: 0.6 });
    edge({ type: 'split', selection: '2-00', numbers: [2, 37], label: 'Split 00 and 2', x: 1 - T / 2, y: 1.05, w: T, h: 0.4 });
    edge({ type: 'split', selection: '0-2', numbers: [0, 2], label: 'Split 0 and 2', x: 1 - T / 2, y: 1.55, w: T, h: 0.4 });
    edge({ type: 'split', selection: '0-1', numbers: [0, 1], label: 'Split 0 and 1', x: 1 - T / 2, y: 2.2, w: T, h: 0.6 });
    edge({ type: 'split', selection: '0-00', numbers: [0, 37], label: 'Split 0 and 00', x: 0.2, y: 1.5 - T / 2, w: 0.6, h: T });
  } else {
    for (let r = 0; r < 3; r++) {
      const k = 3 - r;
      edge({ type: 'split', selection: `0-${k}`, numbers: [0, k], label: `Split 0 and ${k}`, x: 1 - T / 2, y: r + 0.2, w: T, h: 0.6 });
    }
  }
  return zones;
}

/** Rotate the board for phones: zero at the top, outside bets down the left. */
export function toVertical(z: { x: number; y: number; w: number; h: number }) {
  return { x: BOARD_H - (z.y + z.h), y: z.x, w: z.h, h: z.w };
}
