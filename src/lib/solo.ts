import { useCallback, useEffect, useState } from 'react';
import { friendlyError } from './errors';
import { supabase } from './supabase';
import type { TierKey } from './types';
import { useWallet } from '@/stores/walletStore';

/** Solo games against the house (11_solo_games.sql). */
export interface SoloTier {
  tier: TierKey;
  label: string;
  min_bet: number;
  max_bet: number;
  min_bankroll: number;
}

export interface SoloInfo<C = Record<string, unknown>, R = Record<string, unknown>> {
  game: string;
  name: string;
  released: boolean;
  config: C;
  /** Bet steps for games with a single bet. */
  bets: number[];
  tiers: SoloTier[];
  /** A round waiting for the player's decision (two-step games). */
  round: (R & { round_id: string; tier: TierKey }) | null;
}

/** Bets on named spots, e.g. { player: 100, tie: 10 }. */
export type Spots = Record<string, number>;

export const spotTotal = (bets: Spots) => Object.values(bets).reduce((n, v) => n + v, 0);

/**
 * Loads a game's rules and any round in progress, and wraps its RPCs.
 * `infoFn`: 'solo_info' for the games in 11_solo_games.sql, 'more_info' for 12_more_games.sql,
 * 'game_info' for the dealer card games in 19_table_poker.sql.
 */
export function useSoloGame<C, R = Record<string, unknown>>(game: string, infoFn: 'solo_info' | 'more_info' | 'game_info' = 'solo_info') {
  const [info, setInfo] = useState<SoloInfo<C, R> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc(infoFn, { p_game: game });
    if (err) setError(friendlyError(err));
    else setInfo(data as SoloInfo<C, R>);
  }, [game, infoFn]);

  useEffect(() => {
    void load();
    return () => {
      // Leaving mid-reveal: the server has already settled, so just show the truth.
      useWallet.getState().setDisplayBalance(null);
      void useWallet.getState().fetchStatus();
    };
  }, [load]);

  /** Calls an RPC. Returns [result, null] or [null, friendly error]. */
  const call = useCallback(async <T,>(fn: string, args: Record<string, unknown>): Promise<[T, null] | [null, string]> => {
    const { data, error: err } = await supabase.rpc(fn, args);
    if (err) {
      void useWallet.getState().fetchStatus();
      return [null, friendlyError(err)];
    }
    return [data as T, null];
  }, []);

  return { info, error, load, call };
}

/**
 * The server pays the moment a round is sent, before the cards or dice are shown.
 * holdBalance() pins what the header shows; settleBalance() lets the real number through.
 */
export function holdBalance(shown: number) {
  useWallet.getState().setDisplayBalance(shown);
}
export function settleBalance(balance: number) {
  useWallet.setState((s) => ({ status: s.status ? { ...s.status, balance } : s.status, displayBalance: null }));
  void useWallet.getState().fetchStatus();
}

/** Lets the real balance show again without changing it (e.g. after a failed call). */
export function releaseBalance() {
  useWallet.getState().setDisplayBalance(null);
}

export const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export const HAND_NAMES: Record<string, string> = {
  high_card: 'High card',
  pair: 'Pair',
  two_pair: 'Two pair',
  three_kind: 'Three of a kind',
  straight: 'Straight',
  flush: 'Flush',
  full_house: 'Full house',
  four_kind: 'Four of a kind',
  straight_flush: 'Straight flush',
  royal_flush: 'Royal flush',
  five_aces: 'Five aces',
  jacks_or_better: 'Jacks or better',
  natural_royal: 'Natural royal flush',
  four_deuces: 'Four deuces',
  wild_royal: 'Wild royal flush',
  five_kind: 'Five of a kind',
  four_aces: 'Four aces',
  four_low: 'Four 2s, 3s or 4s',
  kings_or_better: 'Kings or better',
  tens_or_better: 'Tens or better',
  low_pair: 'A low pair',
  mid_pair: 'Pair of sixes to tens',
  pair_aces: 'Pair of aces',
  trail: 'Trail',
  pure_sequence: 'Pure sequence',
  sequence: 'Sequence',
  colour: 'Colour',
};

export const WHEEL_LABELS: Record<string, string> = {
  x1: '1',
  x2: '2',
  x5: '5',
  x10: '10',
  x20: '20',
  joker: 'Joker',
  logo: 'All In',
};

/** One line for the history list. */
export function historyLine(game: string, s: Record<string, unknown>): string {
  const made = typeof s.made === 'string' ? HAND_NAMES[s.made] : null;
  switch (game) {
    case 'baccarat':
      return `${s.outcome === 'tie' ? 'Tie' : s.outcome === 'banker' ? 'Banker' : 'Player'} · ${s.player_total} to ${s.banker_total}`;
    case 'video_poker_jacks':
    case 'video_poker_deuces':
    case 'video_poker_bonus':
    case 'video_poker_double':
    case 'video_poker_joker':
      return made ?? 'No win';
    case 'three_card_poker':
      return `${made ?? 'Hand'} · ${
        { win: 'won', lose: 'lost', tie: 'tied', fold: 'folded', no_qualify: 'dealer did not qualify' }[String(s.outcome)] ?? ''
      }`;
    case 'pai_gow_poker':
      return { win: 'Won both hands', push: 'Push: one hand each', lose: 'Lost both hands' }[String(s.outcome)] ?? 'Hand';
    case 'sic_bo':
      return Array.isArray(s.dice) ? `Rolled ${s.dice.join(' · ')}` : 'Roll';
    case 'keno':
      return `${s.hits} of ${s.picks} hit`;
    case 'money_wheel':
      return `Landed on ${WHEEL_LABELS[String(s.symbol)] ?? s.symbol}`;
    case 'dragon_tiger':
      return s.outcome === 'tie' ? 'Tie' : `${s.outcome === 'dragon' ? 'Dragon' : 'Tiger'} wins`;
    case 'casino_war':
      return (
        { win: 'Won', lose: 'Lost', surrender: 'Tied and surrendered', war_win: 'Won the war', war_tie: 'Tied the war', war_lose: 'Lost the war' }[
          String(s.outcome)
        ] ?? 'Hand'
      );
    case 'caribbean_stud':
    case 'casino_holdem':
    case 'let_it_ride':
    case 'mississippi_stud':
    case 'four_card_poker':
    case 'teen_patti':
      return `${made ?? 'Hand'} · ${{ win: 'won', lose: 'lost', tie: 'tied', push: 'bets returned', fold: 'folded', no_qualify: 'dealer did not qualify' }[String(s.outcome)] ?? ''}`;
    case 'ultimate_holdem':
      return `${made ?? 'Hand'} · ${{ win: 'won', lose: 'lost', tie: 'tied', fold: 'folded' }[String(s.outcome)] ?? ''}`;
    case 'plinko':
      return `${s.rows} rows, ${s.risk} risk · ×${Number(s.units) / 100}`;
    case 'mines':
      return `${s.mines} mines · ${s.outcome === 'boom' ? `hit one after ${s.safe} safe` : `collected after ${s.safe} safe`}`;
    case 'scratch_cards':
      return `${{ clover: 'Lucky Clover', gold: 'Gold Rush', diamond: 'Diamond Mine' }[String(s.card)] ?? 'Card'} · ${Number(s.units) > 0 ? `×${Number(s.units) / 100}` : 'no match'}`;
    case 'power_draw':
      return `${s.hits} number${s.hits === 1 ? '' : 's'}${s.power_hit ? ' + power ball' : ''}`;
    case 'crash':
      return s.collected_at ? `Collected at ×${s.collected_at}` : 'Crashed before collecting';
    case 'bingo':
      return `${s.cards} card${s.cards === 1 ? '' : 's'} · ${s.line_at ? `line on call ${s.line_at}` : 'no line'}`;
    default:
      return 'Round';
  }
}
