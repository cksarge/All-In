import type { TierKey } from './types';

export type BjPhase = 'betting' | 'insurance' | 'playing' | 'settled';
export type BjHandStatus = 'betting' | 'waiting' | 'playing' | 'stood' | 'busted' | 'blackjack' | 'surrendered';
export type BjResult = 'win' | 'lose' | 'push' | 'blackjack' | 'surrender';

export interface BjSeat {
  seat_no: number;
  user_id: string;
  username: string;
  status: 'active' | 'sitting_out';
  connected: boolean;
}

export interface BjHand {
  id: string;
  seat_no: number;
  user_id: string;
  hand_index: number;
  bet: number;
  insurance: number;
  insurance_decided: boolean;
  cards: number[];
  total: number;
  soft: boolean;
  status: BjHandStatus;
  doubled: boolean;
  from_split: boolean;
  result: BjResult | null;
  payout: number;
}

export interface BjRound {
  id: string;
  round_no: number;
  phase: BjPhase;
  phase_ends_at: string | null;
  turn_hand_id: string | null;
  dealer_cards: number[];
  dealer_total: number | null;
  dealer_result: 'blackjack' | 'bust' | 'stand' | null;
  settled_at: string | null;
  hole_hidden: boolean;
}

export interface BjState {
  server_now: string;
  rules: {
    decks: number;
    bet_seconds: number;
    insurance_seconds: number;
    turn_seconds: number;
    next_round_seconds: number;
    max_hands: number;
  };
  table: {
    id: string;
    name: string;
    tier: TierKey;
    tier_label: string;
    min_bet: number;
    max_bet: number;
    min_bankroll: number;
    max_seats: number;
    is_private: boolean;
    status: 'open' | 'closed';
    invite_code: string | null;
  };
  seats: BjSeat[];
  round: BjRound | null;
  hands: BjHand[];
  recent: { round_no: number; dealer_total: number; dealer_result: string }[];
}

export type BjAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender';

/** Value of a card for blackjack (Ace = 11 here; totals come from the server). */
export function bjCardValue(c: number) {
  const r = c % 13;
  if (r === 0) return 11;
  if (r >= 9) return 10;
  return r + 1;
}

/** Which actions to offer for a hand. The server re-checks every one of them. */
export function availableActions(hand: BjHand, myHandCount: number, balance: number): Record<BjAction, boolean> {
  const two = hand.cards.length === 2;
  const pair = two && bjCardValue(hand.cards[0]) === bjCardValue(hand.cards[1]);
  return {
    hit: true,
    stand: true,
    double: two && balance >= hand.bet,
    split: pair && myHandCount < 3 && balance >= hand.bet,
    surrender: two && !hand.from_split && myHandCount === 1,
  };
}

/** Chip denominations offered for a table's limits. */
export function chipDenominations(min: number, max: number): number[] {
  const all = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000];
  const inRange = all.filter((v) => v >= min && v <= max);
  if (inRange.length <= 5) return inRange;
  const n = inRange.length;
  return [inRange[0], inRange[1], inRange[Math.floor(n / 2)], inRange[n - 2], inRange[n - 1]];
}

export function handLabel(h: Pick<BjHand, 'total' | 'soft' | 'cards' | 'status'>) {
  if (h.status === 'blackjack') return 'Blackjack';
  if (h.status === 'busted') return `Bust (${h.total})`;
  if (h.soft && h.total < 21) return `Soft ${h.total}`;
  return String(h.total);
}

export const QUICK_PHRASES = [
  'Good luck!',
  'Nice hand!',
  'Well played',
  'Unlucky!',
  'Thanks!',
  'Wow!',
  'Hit me!',
  'Be right back',
] as const;

export const EMOTES = ['👏', '😂', '😮', '😎', '🎉', '🍀', '🔥', '😬'] as const;
