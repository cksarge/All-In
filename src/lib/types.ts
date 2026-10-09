export interface Profile {
  id: string;
  username: string;
  created_at: string;
  onboarded_at: string | null;
}

export interface EconomyStatus {
  server_now: string;
  balance: number;
  peak_balance: number;
  chips_in_play: number;
  daily: {
    available: boolean;
    streak: number;
    next_day: number;
    next_amount: number;
    next_multiplier: number;
    next_available_at: string;
    last_claim: string | null;
    base: number;
    multipliers: number[];
  };
  refill: {
    available: boolean;
    below_threshold: boolean;
    threshold: number;
    refill_to: number;
    cooldown_seconds: number;
    available_at: string;
    last_refill_at: string | null;
  };
}

export interface LedgerEntry {
  id: number;
  delta: number;
  balance_after: number;
  reason: string;
  game: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface GameRow {
  key: string;
  name: string;
  category: 'table' | 'poker' | 'slots' | 'specialty';
  tagline: string;
  multiplayer: boolean;
  max_seats: number;
  sort_order: number;
  released: boolean;
}

export type TierKey = 'low' | 'mid' | 'high' | 'vip';

export interface StakeTier {
  game_key: string;
  tier: TierKey;
  tier_rank: number;
  label: string;
  min_bet: number;
  max_bet: number;
  min_bankroll: number;
  params: Record<string, number>;
}

export interface EconomyConfig {
  starting_chips: number;
  daily_base: number;
  daily_multipliers: number[];
  refill_threshold: number;
  refill_to: number;
  refill_cooldown: string;
}
