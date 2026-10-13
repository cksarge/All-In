import type { GameRow } from './types';

/** The four sections of the lounge, in display order. */
export const CATEGORIES = [
  { key: 'table', label: 'Table games', blurb: 'Cards, dice and wheels on the felt.' },
  { key: 'poker', label: 'Poker', blurb: 'Against other players, or heads-up against the dealer.' },
  { key: 'slots', label: 'Slots', blurb: 'Six machines, one shared jackpot, and a seasonal machine that changes with the month.' },
  { key: 'specialty', label: 'Specialty', blurb: 'Video poker, number draws and quick instant games.' },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]['key'];

/** This month as the database writes a season: "2026-10" (UTC). */
export const currentSeason = () => new Date().toISOString().slice(0, 7);

/** A seasonal game is only listed (and only playable: the server checks) during its month. */
export const inSeason = (g: Pick<GameRow, 'season'>) => !g.season || g.season === currentSeason();

/** "October 2026" for "2026-10". */
export const seasonLabel = (key: string) =>
  new Date(`${key}-15T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Solo-style games that are really one room shared by everyone (no tables or seats). */
const LIVE_ROOMS = new Set(['crash', 'bingo', 'horse_racing']);

/** Catalogue entries that are really the tournaments page. */
const TOURNAMENTS = new Set(['sng_poker', 'slot_showdown']);

/** How a game is played: at tables with seats, in one shared live room, on your own, or as a tournament. */
export type GameMode = 'tables' | 'room' | 'solo' | 'tournament';

export function gameMode(g: Pick<GameRow, 'key' | 'multiplayer'>): GameMode {
  return TOURNAMENTS.has(g.key) ? 'tournament' : g.multiplayer ? 'tables' : LIVE_ROOMS.has(g.key) ? 'room' : 'solo';
}

/** Where "Play" goes: the lobby's table list for table games, the game itself otherwise. */
export function gameHref(g: Pick<GameRow, 'key' | 'multiplayer'>): string {
  if (TOURNAMENTS.has(g.key)) return '/tournaments';
  return g.multiplayer ? `/lobby?game=${g.key}` : `/play/${g.key}`;
}

export function modeLabel(g: Pick<GameRow, 'key' | 'multiplayer' | 'max_seats' | 'category'>): string {
  const mode = gameMode(g);
  if (mode === 'tables') return `Live tables · up to ${g.max_seats} seats`;
  if (mode === 'room') return 'Live room · everyone plays the same round';
  if (mode === 'tournament') return g.key === 'sng_poker' ? 'Tournament · 2, 3 or 6 players' : 'Tournament · new round every 15 minutes';
  return g.category === 'poker' ? 'Solo · against the dealer' : 'Solo';
}
