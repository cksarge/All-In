import type { TierKey } from './types';
import type { LiveSeat } from '@/hooks/useLiveTable';

export type CrBetType =
  | 'pass' | 'dont_pass' | 'come' | 'dont_come' | 'place' | 'hard' | 'field'
  | 'any7' | 'any_craps' | 'two' | 'three' | 'eleven' | 'twelve';

export interface CrBet {
  id: string;
  user_id: string;
  username: string;
  bet_type: CrBetType;
  number: number | null;
  amount: number;
  odds: number;
  payout: number;
  last_win_roll: number | null;
}

export interface CrResult {
  id: string;
  user_id: string;
  bet_type: CrBetType;
  number: number | null;
  amount: number;
  odds: number;
  status: 'active' | 'won' | 'lost' | 'push' | 'returned';
  payout: number;
}

export interface CrRoll {
  roll_no: number;
  d1: number;
  d2: number;
  total: number;
  outcome: 'natural' | 'craps' | 'point_set' | 'point_made' | 'seven_out' | 'roll';
}

export interface CrState {
  server_now: string;
  rules: { roll_seconds: number; min_roll_gap_seconds: number; max_odds_multiple: number };
  table: {
    id: string; name: string; tier: TierKey; tier_label: string;
    min_bet: number; max_bet: number; min_bankroll: number; max_seats: number;
    is_private: boolean; status: string; invite_code: string | null;
  };
  seats: LiveSeat[];
  state: {
    point: number | null;
    shooter_user: string | null;
    roll_no: number;
    phase: 'idle' | 'betting';
    phase_ends_at: string | null;
    last_dice: [number, number] | null;
    last_roll_at: string | null;
  };
  bets: CrBet[];
  last_results: CrResult[];
  recent: CrRoll[];
}

export const BET_LABEL: Record<CrBetType, string> = {
  pass: 'Pass Line',
  dont_pass: "Don't Pass",
  come: 'Come',
  dont_come: "Don't Come",
  place: 'Place',
  hard: 'Hard',
  field: 'Field',
  any7: 'Any 7',
  any_craps: 'Any Craps',
  two: 'Snake Eyes (2)',
  three: 'Ace-Deuce (3)',
  eleven: 'Yo (11)',
  twelve: 'Boxcars (12)',
};

export const PAYS: Record<string, string> = {
  pass: '1 to 1',
  dont_pass: '1 to 1',
  come: '1 to 1',
  dont_come: '1 to 1',
  'place-4': '9 to 5', 'place-10': '9 to 5', 'place-5': '7 to 5', 'place-9': '7 to 5', 'place-6': '7 to 6', 'place-8': '7 to 6',
  'hard-4': '7 to 1', 'hard-10': '7 to 1', 'hard-6': '9 to 1', 'hard-8': '9 to 1',
  field: '1 to 1 (2 pays 2:1, 12 pays 3:1)',
  any7: '4 to 1',
  any_craps: '7 to 1',
  two: '30 to 1',
  three: '15 to 1',
  eleven: '15 to 1',
  twelve: '30 to 1',
};

/** Bets shown in beginner mode. */
export const BEGINNER = new Set(['pass', 'dont_pass', 'field', 'place-6', 'place-8']);

export const spotKey = (type: CrBetType, number: number | null) => (number === null ? type : `${type}-${number}`);

/** Winnings for a place bet hit (mirrors the server). */
export function placeWin(n: number, amount: number) {
  if (n === 4 || n === 10) return Math.floor((amount * 9) / 5);
  if (n === 5 || n === 9) return Math.floor((amount * 7) / 5);
  return Math.floor((amount * 7) / 6);
}

export function outcomeText(r: CrRoll): string {
  switch (r.outcome) {
    case 'natural':
      return r.total === 7 ? 'Seven, front line winner!' : 'Yo-leven! Winner!';
    case 'craps':
      return r.total === 2 ? 'Snake eyes. Craps!' : r.total === 3 ? 'Ace-deuce. Craps!' : 'Boxcars. Craps!';
    case 'point_set':
      return `The point is ${r.total}`;
    case 'point_made':
      return `${r.total}! Point made, winner!`;
    case 'seven_out':
      return 'Seven out. Dice pass';
    default:
      return `${r.total}${r.d1 === r.d2 && [4, 6, 8, 10].includes(r.total) ? ' the hard way' : ''}`;
  }
}

/** Can this bet be taken down right now? (Mirrors cr_remove_bet.) */
export function removable(b: CrBet, point: number | null) {
  return (
    ['place', 'hard', 'field', 'any7', 'any_craps', 'two', 'three', 'eleven', 'twelve'].includes(b.bet_type) ||
    (['pass', 'dont_pass'].includes(b.bet_type) && point === null) ||
    (['come', 'dont_come'].includes(b.bet_type) && b.number === null)
  );
}

/** Can odds be added to this bet right now? (Mirrors cr_add_odds.) */
export function oddsAllowed(b: CrBet, point: number | null) {
  return (
    (['pass', 'dont_pass'].includes(b.bet_type) && point !== null) ||
    (['come', 'dont_come'].includes(b.bet_type) && b.number !== null)
  );
}
