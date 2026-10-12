import { formatChips } from './format';
import type { CosmeticKind } from './progress';
import { ordinal } from './tournaments';

/** Missions, seasons and the inbox (16_missions_seasons.sql). */
export interface Mission {
  period: 'daily' | 'weekly';
  slot: number;
  key: string;
  kind: 'rounds' | 'wins' | 'wager' | 'category' | 'games' | 'multiple' | 'net' | 'tourney';
  param: string | null;
  goal: number;
  progress: number;
  chips: number;
  xp: number;
  points: number;
  done: boolean;
  claimed: boolean;
}

export interface SeasonTier {
  tier: number;
  points: number;
  chips: number;
  cosmetic: string | null;
  reward: { key: string; kind: CosmeticKind; name: string; look: Record<string, string> | null } | null;
}

export interface Season {
  key: string;
  name: string;
  blurb: string;
  accent: string;
  ends_at: string;
  points: number;
  claimed_tier: number;
  tiers: SeasonTier[];
}

export interface MissionsState {
  server_now: string;
  daily_ends_at: string;
  weekly_ends_at: string;
  missions: Mission[];
  to_collect: number;
  season: Season | null;
}

export interface InboxItem {
  id: number;
  kind: string;
  data: Record<string, unknown>;
  at: string;
  read: boolean;
}

const CATEGORY: Record<string, string> = { slots: 'slot spins', table: 'rounds of table games', poker: 'hands of poker', specialty: 'rounds of specialty games' };

/** A mission in words, e.g. "Win 8 rounds". */
export function missionText(m: Pick<Mission, 'kind' | 'param' | 'goal'>): string {
  const n = formatChips(m.goal);
  switch (m.kind) {
    case 'rounds':
      return `Play ${n} rounds of anything`;
    case 'wins':
      return `Win ${n} rounds`;
    case 'wager':
      return `Bet ${n} chips in total`;
    case 'category':
      return `Play ${n} ${CATEGORY[m.param ?? ''] ?? 'rounds'}`;
    case 'games':
      return `Play ${n} different games`;
    case 'multiple':
      return `Win ${m.param}× your bet or more in one round`;
    case 'net':
      return `Win ${n} chips in total`;
    case 'tourney':
      return `Finish ${n} tournaments`;
    default:
      return 'Mission';
  }
}

/** How many season tiers are reached but not yet collected. */
export const seasonReady = (s: Season | null) => (s ? s.tiers.filter((t) => t.tier > s.claimed_tier && t.points <= s.points).length : 0);

export const KIND_NAME: Record<CosmeticKind, string> = { avatar: 'Avatar', frame: 'Frame', title: 'Title', card_back: 'Card back', felt: 'Table felt' };

/** A notification in words, with where tapping it goes. */
export function inboxText(n: InboxItem): { title: string; body?: string; to?: string; action?: string } {
  const d = n.data;
  const from = typeof d.from === 'string' ? d.from : 'A player';
  switch (n.kind) {
    case 'friend_request':
      return { title: `${from} sent you a friend request`, to: '/friends', action: 'Answer' };
    case 'friend_accepted':
      return { title: `${from} accepted your friend request`, to: `/profile/${from}`, action: 'See profile' };
    case 'table_invite':
      return {
        title: `${from} invited you to their table`,
        body: `${String(d.game_name ?? 'A game')} · ${String(d.table_name ?? '')}`,
        to: typeof d.code === 'string' ? `/join/${d.code}` : `/table/${String(d.table_id)}`,
        action: 'Join',
      };
    case 'tournament_result': {
      const place = Number(d.place);
      const prize = Number(d.prize ?? 0);
      const what = d.kind === 'sng' ? 'Sit & Go' : d.kind === 'freeroll' ? 'Daily Freeroll' : 'Slot Showdown';
      return {
        title: `${what}: you finished ${ordinal(place)} of ${String(d.players)}`,
        body: prize > 0 ? `You won ${formatChips(prize)} chips.` : undefined,
        to: '/tournaments',
        action: 'Tournaments',
      };
    }
    case 'achievement':
      return { title: `Achievement unlocked: ${String(d.name ?? '')}`, to: '/profile', action: 'See it' };
    case 'season_start':
      return { title: `A new season has begun: ${String(d.season ?? '')}`, body: 'Finish missions to earn its rewards before the month ends.', to: '/missions', action: 'See the season' };
    case 'season_rewards':
      return {
        title: `${String(d.season ?? 'Last season')} has ended`,
        body: `The rewards you had reached were added: ${formatChips(Number(d.chips ?? 0))} chips${Number(d.items) > 0 ? ` and ${String(d.items)} item${Number(d.items) === 1 ? '' : 's'}` : ''}.`,
        to: '/locker',
        action: 'Open locker',
      };
    case 'chips_adjusted':
      return { title: 'A moderator changed your chip balance', body: `${Number(d.delta) > 0 ? '+' : ''}${formatChips(Number(d.delta ?? 0))} chips.` };
    default:
      return { title: 'Notification' };
  }
}
