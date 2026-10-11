import type { LiveSeat, LiveTableState } from '@/hooks/useLiveTable';
import type { TierKey } from './types';
import { formatChips } from './format';

export type PkFamily = 'board' | 'stud' | 'draw';
export type PkLimit = 'nl' | 'pl' | 'fl';
export type PkAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface PkConfig {
  family: PkFamily;
  hole: number;
  limit: PkLimit;
  omaha: boolean;
  hilo: boolean;
  streets: string[];
  turn_seconds: number;
  draw_seconds: number;
  next_hand_seconds: number;
  showdown_seconds: number;
  max_draw: number;
}

export interface PkStakes {
  small_blind?: number;
  big_blind?: number;
  ante?: number;
  bring_in?: number;
  small_bet?: number;
  big_bet?: number;
  min_stack: number;
  max_stack: number;
}

export interface PkSeat extends LiveSeat {
  stack: number;
}

export interface PkPotWinner {
  seat_no: number;
  amount: number;
  kind: 'all' | 'high' | 'low';
  hand: string | null;
}

export interface PkPot {
  amount: number;
  eligible?: number[];
  winners: PkPotWinner[];
}

export interface PkHand {
  id: string;
  hand_no: number;
  street: number;
  street_name: string;
  phase: 'betting' | 'drawing' | 'settled';
  phase_ends_at: string | null;
  button_seat: number | null;
  sb_seat: number | null;
  bb_seat: number | null;
  bring_in_seat: number | null;
  board: number[];
  turn_seat: number | null;
  current_bet: number;
  /** Chips in the middle from earlier streets (this street's bets sit in front of players). */
  pot: number;
  total_pot: number;
  showdown: boolean;
  pots: PkPot[] | null;
  settled_at: string | null;
}

export interface PkPlayer {
  seat_no: number;
  user_id: string;
  username: string;
  status: 'active' | 'folded' | 'allin';
  stack_start: number;
  street_bet: number;
  committed: number;
  last_action: string | null;
  up_cards: number[];
  card_count: number;
  drew: number | null;
  shown_cards: number[] | null;
  hand_name: string | null;
  low_name: string | null;
  best_cards: number[] | null;
  won: number;
}

export interface PkOptions {
  to_call: number;
  can_check: boolean;
  can_call: boolean;
  /** Calling puts you all in. */
  call_is_all_in: boolean;
  can_raise: boolean;
  is_bet: boolean;
  min_to: number;
  max_to: number;
  all_in_to: number;
}

export interface PkMe {
  stack: number;
  pending_topup: number;
  in_hand: boolean;
  seat_no: number | null;
  hole: number[] | null;
  hand_name?: string | null;
  low_name?: string | null;
  best_cards?: number[] | null;
  options?: PkOptions;
  can_draw?: boolean;
}

export interface PkState extends LiveTableState {
  config: PkConfig;
  table: {
    id: string;
    name: string;
    game_key: string;
    tier: TierKey;
    tier_label: string;
    max_seats: number;
    is_private: boolean;
    status: string;
    invite_code: string | null;
    stakes: PkStakes;
    /** A tournament table: the chips on it are a score, not wallet chips. */
    play_money?: boolean;
  };
  seats: PkSeat[];
  hand: PkHand | null;
  players: PkPlayer[];
  me: PkMe | null;
  recent: { hand_no: number; board: number[]; winners: { username: string; won: number; hand: string | null }[] | null }[];
}

export interface PkHistoryHand {
  hand_no: number;
  game_key: string;
  played_at: string;
  board: number[];
  my_cards: number[] | null;
  my_committed: number;
  my_won: number;
  my_status: PkPlayer['status'];
  my_hand: string | null;
  pots: PkPot[] | null;
  showdown: boolean;
  players: {
    seat_no: number;
    username: string;
    status: PkPlayer['status'];
    committed: number;
    won: number;
    shown_cards: number[] | null;
    up_cards: number[];
    hand_name: string | null;
    low_name: string | null;
  }[];
}

export const POKER_GAMES: Record<string, { short: string; limit: string }> = {
  poker_holdem: { short: "Hold'em", limit: 'No limit' },
  poker_omaha: { short: 'Omaha', limit: 'Pot limit' },
  poker_omaha_hilo: { short: 'Omaha Hi-Lo', limit: 'Pot limit' },
  poker_stud: { short: 'Seven-Card Stud', limit: 'Fixed limit' },
  poker_draw: { short: 'Five-Card Draw', limit: 'No limit' },
};

export function isPokerGame(key: string | null | undefined) {
  return Boolean(key && key.startsWith('poker_'));
}

/** "Blinds 5/10" · "Blinds 2.5K/5K · Ante 500" · "Limit 10/20 · Ante 2". Never a currency sign. */
export function stakesLabel(game: string, p: Partial<PkStakes> | null | undefined): string {
  if (!p) return '';
  const ante = p.ante ? ` · Ante ${formatChips(p.ante)}` : '';
  if (game === 'poker_stud') return `Limit ${formatChips(p.small_bet ?? 0)}/${formatChips(p.big_bet ?? 0)}${ante}`;
  return `Blinds ${formatChips(p.small_blind ?? 0)}/${formatChips(p.big_blind ?? 0)}${ante}`;
}

/** "Bring 200–1,000" */
export function stackRangeLabel(p: Partial<PkStakes> | null | undefined): string {
  if (!p?.min_stack) return '';
  return `Bring ${formatChips(p.min_stack)}–${formatChips(p.max_stack ?? 0)}`;
}

/**
 * Where each seat sits around the oval, as percentages of the felt. Your own seat
 * (or seat 1 when watching) is at the bottom centre; play moves clockwise.
 */
export function seatLayout(maxSeats: number, anchorSeat: number) {
  return Array.from({ length: maxSeats }, (_, i) => {
    const seatNo = i + 1;
    const pos = (seatNo - anchorSeat + maxSeats) % maxSeats;
    const angle = Math.PI / 2 + (pos * 2 * Math.PI) / maxSeats;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      seatNo,
      x: 50 + 44 * cos,
      y: 50 + 42 * sin,
      // Bets sit between the player and the pot.
      betX: 50 + 27 * cos,
      betY: 50 + 25 * sin,
      // Dealer button just beside the bet.
      buttonX: 50 + 31 * cos + 6 * Math.cos(angle + Math.PI / 2),
      buttonY: 50 + 29 * sin + 6 * Math.sin(angle + Math.PI / 2),
      top: sin < -0.3,
    };
  });
}

/** Raise-to amount for a fraction of the pot, clamped to what's allowed. */
export function potFractionTo(hand: PkHand, options: PkOptions, frac: number) {
  const potAfterCall = hand.total_pot + options.to_call;
  const to = hand.current_bet + Math.round(potAfterCall * frac);
  return Math.max(options.min_to, Math.min(options.max_to, to));
}

export const HAND_RANKINGS: { name: string; example: string; text: string }[] = [
  { name: 'Royal flush', example: 'As Ks Qs Js Ts', text: 'A, K, Q, J, 10, all the same suit.' },
  { name: 'Straight flush', example: '9h 8h 7h 6h 5h', text: 'Five in a row, all the same suit.' },
  { name: 'Four of a kind', example: '7s 7h 7d 7c Kd', text: 'Four cards of the same rank.' },
  { name: 'Full house', example: 'Ks Kh Kd 4c 4s', text: 'Three of a kind plus a pair.' },
  { name: 'Flush', example: 'As 9s 7s 4s 2s', text: 'Any five of the same suit.' },
  { name: 'Straight', example: '9d 8c 7h 6s 5d', text: 'Five in a row. Ace can be high (A-K-Q-J-10) or low (5-4-3-2-A).' },
  { name: 'Three of a kind', example: 'Qs Qh Qd 9c 2s', text: 'Three cards of the same rank.' },
  { name: 'Two pair', example: 'Js Jh 4d 4c As', text: 'Two different pairs.' },
  { name: 'Pair', example: 'Ts Th 8d 4c 2s', text: 'Two cards of the same rank.' },
  { name: 'High card', example: 'As Jh 8d 4c 2s', text: 'None of the above: the highest card plays.' },
];

/** 'As' -> card number (rank = c % 13 with A = 0, suit = c / 13 in ♠ ♥ ♦ ♣ order). */
export function parseCard(code: string): number {
  const rank = 'A23456789TJQK'.indexOf(code.slice(0, -1));
  const suit = 'shdc'.indexOf(code.slice(-1));
  return suit * 13 + rank;
}
