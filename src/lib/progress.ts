/** Stage 7: XP, achievements, cosmetics, friends (13_progression.sql). */

export interface Loadout {
  avatar: string;
  frame: string;
  title: string;
  card_back: string;
  felt: string;
}
export const DEFAULT_LOADOUT: Loadout = {
  avatar: 'avatar_initial',
  frame: 'frame_none',
  title: 'title_newcomer',
  card_back: 'back_ruby',
  felt: 'felt_classic',
};

/** A player as shown in lists (leaderboards, friends, search). */
export interface PlayerCard {
  user_id: string;
  username: string;
  level: number;
  loadout: Loadout;
}

export type CosmeticKind = 'avatar' | 'frame' | 'title' | 'card_back' | 'felt';
export interface Cosmetic {
  key: string;
  kind: CosmeticKind;
  name: string;
  unlock_level: number | null;
  sort_order: number;
}
export interface Achievement {
  key: string;
  name: string;
  description: string;
  category: 'play' | 'wins' | 'games' | 'feats' | 'social';
  metric: string;
  goal: number;
  reward_chips: number;
  reward_xp: number;
  cosmetic_key: string | null;
  sort_order: number;
}
export interface MyProgress {
  xp: number;
  level: number;
  level_xp: number;
  next_level_xp: number | null;
  loadout: Loadout;
  owned: string[];
  achievements: { key: string; unlocked_at: string; claimed: boolean }[];
  metrics: Record<string, number>;
  unclaimed_chips: number;
  friend_requests: number;
}

export type Friendship = 'self' | 'none' | 'pending_out' | 'pending_in' | 'friends';

/** How far through the current level, 0 to 1. */
export function levelFraction(p: { xp: number; level_xp: number; next_level_xp: number | null }): number {
  if (p.next_level_xp === null) return 1;
  return Math.max(0, Math.min(1, (p.xp - p.level_xp) / (p.next_level_xp - p.level_xp)));
}

export const KIND_LABELS: Record<CosmeticKind, string> = {
  avatar: 'Avatars',
  frame: 'Frames',
  title: 'Titles',
  card_back: 'Card backs',
  felt: 'Table felts',
};
export const ACHIEVEMENT_GROUPS: { key: Achievement['category']; label: string }[] = [
  { key: 'play', label: 'Playing' },
  { key: 'wins', label: 'Winning' },
  { key: 'games', label: 'Around the lounge' },
  { key: 'feats', label: 'Feats' },
  { key: 'social', label: 'Friends' },
];

// ---------------------------------------------------------------------------
// What each cosmetic looks like. The database only knows the keys.
// ---------------------------------------------------------------------------
/** Emoji for an avatar; null = the player's initial. */
export const AVATAR_GLYPH: Record<string, string | null> = {
  avatar_initial: null,
  avatar_top_hat: '🎩',
  avatar_dice: '🎲',
  avatar_clover: '🍀',
  avatar_fox: '🦊',
  avatar_owl: '🦉',
  avatar_star: '⭐',
  avatar_crown: '🏆', // "Champion" (the key is older than the name): the crown itself is the developer's alone
  avatar_developer: '👑',
  avatar_dragon: '🐉',
  avatar_rocket: '🚀',
  avatar_joker: '🃏',
  avatar_fire: '🔥',
  avatar_diamond: '💎',
  avatar_whale: '🐋',
};

/** Ring around the avatar: a border colour, or a gradient for the fancy ones. */
export const FRAMES: Record<string, { color: string; gradient?: string; glow?: string }> = {
  frame_none: { color: 'rgba(255,255,255,0.25)' },
  frame_felt: { color: '#5cc392' },
  frame_ruby: { color: '#e25a68' },
  frame_sapphire: { color: '#8fb0f0' },
  frame_gold: { color: '#f0d688', glow: 'rgba(240,214,136,0.45)' },
  frame_royal: { color: '#c9a4f5', glow: 'rgba(201,164,245,0.45)' },
  frame_diamond: { color: '#e8f4ff', gradient: 'conic-gradient(#e8f4ff, #8fb0f0, #c9a4f5, #e8f4ff, #5cc392, #e8f4ff)', glow: 'rgba(232,244,255,0.5)' },
  frame_jackpot: { color: '#f0d688', gradient: 'conic-gradient(#f0d688, #c9303f, #f0d688, #ad872b, #f0d688)', glow: 'rgba(240,214,136,0.6)' },
};

/** Card backs: base colour and the colour of the lattice and border. */
export const CARD_BACKS: Record<string, { base: string; line: string }> = {
  back_ruby: { base: '#831422', line: '240,214,136' },
  back_sapphire: { base: '#1b3a7a', line: '143,176,240' },
  back_emerald: { base: '#0e4730', line: '92,195,146' },
  back_onyx: { base: '#141816', line: '212,175,55' },
  back_royal: { base: '#3d2470', line: '201,164,245' },
  back_diamond: { base: '#28506b', line: '232,244,255' },
};

/** Table felts: base colour and the soft light in the middle. */
export const FELTS: Record<string, { base: string; glow: string }> = {
  felt_classic: { base: '#0a3524', glow: '44 154 104' },
  felt_midnight: { base: '#0d1b3a', glow: '53 102 196' },
  felt_burgundy: { base: '#3d0910', glow: '168 28 44' },
  felt_charcoal: { base: '#141816', glow: '91 100 95' },
  felt_royal: { base: '#22123f', glow: '140 96 220' },
};
