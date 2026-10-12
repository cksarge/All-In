import type { PlayerCard } from './progress';

/** Clubs (17_clubs_records.sql). The emblem is one of a fixed set; the name and tag are the only typed text. */
export const EMBLEMS: Record<string, string> = {
  spade: '♠️',
  heart: '♥️',
  diamond: '♦️',
  club: '♣️',
  crown: '👑',
  dice: '🎲',
  star: '⭐',
  fire: '🔥',
  clover: '🍀',
  rocket: '🚀',
  shield: '🛡️',
  gem: '💎',
};

export interface ClubSummary {
  id: string;
  name: string;
  tag: string;
  emblem: string;
  is_open: boolean;
  /** Whether members other than the owner may see the invite code. */
  code_visible?: boolean;
  members: number;
  /** Rounds its members have played this week. */
  week_rounds: number;
}

export interface ClubMember extends PlayerCard {
  role: 'owner' | 'officer' | 'member';
  joined_at: string;
  week_rounds: number;
  week_net: number;
  table: { id: string; name: string; game_key: string } | null;
}

export interface ClubState extends ClubSummary {
  my_role: ClubMember['role'] | null;
  /** The id of the club you are in, if any (it may be a different one). */
  my_club: string | null;
  invite_code: string | null;
  roster: ClubMember[];
}

export interface ProfileExtras {
  club: { id: string; name: string; tag: string; emblem: string } | null;
  records: {
    peak_balance: number;
    best_multiple: number;
    best_streak: number;
    tournaments: number;
    tournament_wins: number;
    missions: number;
    season_rewards: number;
    favourite: { name: string; rounds: number } | null;
    best_games: { name: string; biggest_win: number }[];
    poker_hands_won: number;
  };
  versus: { hands_me: number; hands_them: number; tourney_me: number; tourney_them: number } | null;
  rivals: (PlayerCard & { won: number; lost: number })[] | null;
}

export interface BigWin {
  id: number;
  username: string;
  kind: 'round' | 'tournament';
  game_key: string;
  game: string | null;
  amount: number;
  multiple: number | null;
  at: string;
}
