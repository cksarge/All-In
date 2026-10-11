import type { GameRow } from './types';

/** The four sections of the lounge, in display order. */
export const CATEGORIES = [
  { key: 'table', label: 'Table games', blurb: 'Cards, dice and wheels on the felt.' },
  { key: 'poker', label: 'Poker', blurb: 'Against other players, or heads-up against the dealer.' },
  { key: 'slots', label: 'Slots', blurb: 'Six machines and one shared jackpot.' },
  { key: 'specialty', label: 'Specialty', blurb: 'Video poker, number draws and quick instant games.' },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

/** Solo-style games that are really one room shared by everyone (no tables or seats). */
const LIVE_ROOMS = new Set(['crash', 'bingo']);

/** How a game is played: at tables with seats, in one shared live room, or on your own. */
export type GameMode = 'tables' | 'room' | 'solo';

export function gameMode(g: Pick<GameRow, 'key' | 'multiplayer'>): GameMode {
  return g.multiplayer ? 'tables' : LIVE_ROOMS.has(g.key) ? 'room' : 'solo';
}

/** Where "Play" goes: the lobby's table list for table games, the game itself otherwise. */
export function gameHref(g: Pick<GameRow, 'key' | 'multiplayer'>): string {
  return g.multiplayer ? `/lobby?game=${g.key}` : `/play/${g.key}`;
}

export function modeLabel(g: Pick<GameRow, 'key' | 'multiplayer' | 'max_seats' | 'category'>): string {
  const mode = gameMode(g);
  if (mode === 'tables') return `Live tables · up to ${g.max_seats} seats`;
  if (mode === 'room') return 'Live room · everyone plays the same round';
  return g.category === 'poker' ? 'Solo · against the dealer' : 'Solo';
}
