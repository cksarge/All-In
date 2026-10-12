/**
 * A simple video poker guide: which cards to keep. It follows the usual priority
 * lists and is close to, but not exactly, perfect play. The server decides every
 * hand; this only suggests holds.
 * Cards are 0..51: rank = c % 13 (0 = ace, 1 = two, ... 12 = king), suit = c / 13.
 */
export interface Hint {
  holds: boolean[];
  why: string;
}

const PAT = new Set(['royal_flush', 'natural_royal', 'four_deuces', 'wild_royal', 'five_kind', 'straight_flush', 'four_kind', 'full_house', 'flush', 'straight']);
const rank = (c: number) => c % 13;
const suit = (c: number) => Math.floor(c / 13);
const ROYAL = new Set([9, 10, 11, 12, 0]);
const isHigh = (c: number) => rank(c) === 0 || rank(c) >= 10;
/** Ace counts as 1 or 14: the tighter of the two spans. */
function span(cards: number[]): number {
  const lo = cards.map((c) => rank(c) + 1);
  const hi = cards.map((c) => (rank(c) === 0 ? 14 : rank(c) + 1));
  return Math.min(Math.max(...lo) - Math.min(...lo), Math.max(...hi) - Math.min(...hi));
}
const distinct = (cards: number[]) => new Set(cards.map(rank)).size === cards.length;
const keep = (hand: number[], pick: number[], why: string): Hint => ({ holds: hand.map((c) => pick.includes(c)), why });

function subsets(cards: number[], size: number): number[][] {
  const out: number[][] = [];
  const walk = (start: number, acc: number[]) => {
    if (acc.length === size) return void out.push(acc);
    for (let i = start; i < cards.length; i++) walk(i + 1, [...acc, cards[i]]);
  };
  walk(0, []);
  return out;
}
const sameSuit = (cards: number[]) => cards.every((c) => suit(c) === suit(cards[0]));
const find = (cards: number[], size: number, test: (s: number[]) => boolean) => subsets(cards, size).find(test) ?? null;
function groups(cards: number[]): number[][] {
  const m = new Map<number, number[]>();
  for (const c of cards) m.set(rank(c), [...(m.get(rank(c)) ?? []), c]);
  return [...m.values()].sort((a, b) => b.length - a.length);
}

export function suggestHolds(hand: number[], game: string, made: string | null): Hint {
  return game === 'video_poker_deuces' ? deuces(hand, made) : jacks(hand, made);
}

function jacks(hand: number[], made: string | null): Hint {
  const g = groups(hand);
  const royal4 = find(hand, 4, (s) => sameSuit(s) && s.every((c) => ROYAL.has(rank(c))));
  if (made && PAT.has(made)) {
    if ((made === 'flush' || made === 'straight') && royal4) return keep(hand, royal4, 'Four to a royal flush is worth breaking a made hand for.');
    return keep(hand, made === 'four_kind' ? g[0] : hand, 'A made hand: keep it.');
  }
  if (royal4) return keep(hand, royal4, 'Four to a royal flush.');
  if (g[0].length === 3) return keep(hand, g[0], 'Three of a kind: draw two.');
  const sf4 = find(hand, 4, (s) => sameSuit(s) && distinct(s) && span(s) <= 4);
  if (sf4) return keep(hand, sf4, 'Four to a straight flush.');
  if (g[0].length === 2 && g[1].length === 2) return keep(hand, [...g[0], ...g[1]], 'Two pair: draw one for a full house.');
  if (g[0].length === 2 && isHigh(g[0][0])) return keep(hand, g[0], 'A paying pair: keep it and draw three.');
  const royal3 = find(hand, 3, (s) => sameSuit(s) && s.every((c) => ROYAL.has(rank(c))));
  if (royal3) return keep(hand, royal3, 'Three to a royal flush.');
  const flush4 = find(hand, 4, sameSuit);
  if (flush4) return keep(hand, flush4, 'Four to a flush.');
  if (g[0].length === 2) return keep(hand, g[0], 'A low pair still beats drawing five new cards.');
  const open4 = find(hand, 4, (s) => distinct(s) && Math.max(...s.map(rank)) - Math.min(...s.map(rank)) === 3 && !s.some((c) => rank(c) === 0));
  if (open4) return keep(hand, open4, 'Four to an open-ended straight.');
  const high = hand.filter(isHigh);
  const suitedHigh = find(high, 2, sameSuit);
  if (suitedHigh) return keep(hand, suitedHigh, 'Two high cards of the same suit.');
  const sf3 = find(hand, 3, (s) => sameSuit(s) && distinct(s) && span(s) <= 4);
  if (sf3) return keep(hand, sf3, 'Three to a straight flush.');
  if (high.length >= 2) {
    // With three or more, the two lowest leave the most straights open.
    const order = [...high].sort((a, b) => (rank(a) === 0 ? 13 : rank(a)) - (rank(b) === 0 ? 13 : rank(b)));
    return keep(hand, order.slice(0, 2), 'Two high cards: pair either one and you are paid.');
  }
  if (high.length === 1) return keep(hand, high, 'One high card: a pair of them pays.');
  return keep(hand, [], 'Nothing worth keeping: draw five new cards.');
}

function deuces(hand: number[], made: string | null): Hint {
  const wild = hand.filter((c) => rank(c) === 1);
  const rest = hand.filter((c) => rank(c) !== 1);
  const g = rest.length ? groups(rest) : [[]];
  if (wild.length === 4) return keep(hand, wild, 'Four deuces: the second best hand there is.');
  if (made && PAT.has(made) && !(wild.length === 3 && made !== 'wild_royal' && made !== 'five_kind')) return keep(hand, hand, 'A made hand: keep it.');
  if (wild.length === 3) return keep(hand, wild, 'Three deuces: keep them and draw two.');
  const royalRest = (n: number) => find(rest, n, (s) => sameSuit(s) && s.every((c) => ROYAL.has(rank(c))));
  const sfRest = (n: number) => find(rest, n, (s) => sameSuit(s) && distinct(s) && span(s) <= 4);
  if (wild.length === 2) {
    const r = royalRest(2);
    if (r) return keep(hand, [...wild, ...r], 'Four to a wild royal flush.');
    if (g[0].length >= 2) return keep(hand, [...wild, ...g[0]], 'Four of a kind with the deuces.');
    return keep(hand, wild, 'Two deuces: keep them and draw three.');
  }
  if (wild.length === 1) {
    if (g[0].length === 2 && g[1]?.length === 2) return keep(hand, hand, 'A full house with the deuce.');
    const r = royalRest(3);
    if (r) return keep(hand, [...wild, ...r], 'Four to a wild royal flush.');
    if (g[0].length >= 2) return keep(hand, [...wild, ...g[0]], 'The deuce makes three of a kind or better.');
    const s = sfRest(3);
    if (s) return keep(hand, [...wild, ...s], 'Four to a straight flush with the deuce.');
    return keep(hand, wild, 'Keep the deuce and draw four.');
  }
  const r4 = royalRest(4);
  if (r4) return keep(hand, r4, 'Four to a natural royal flush.');
  if (g[0].length === 3) return keep(hand, g[0], 'Three of a kind: draw two.');
  const s4 = sfRest(4);
  if (s4) return keep(hand, s4, 'Four to a straight flush.');
  const r3 = royalRest(3);
  if (r3) return keep(hand, r3, 'Three to a royal flush.');
  if (g[0].length === 2) return keep(hand, g[0], g[1]?.length === 2 ? 'Keep one pair: a pair draws to three of a kind more often than two pair fill up.' : 'A pair: draw three.');
  const flush4 = find(rest, 4, sameSuit);
  if (flush4) return keep(hand, flush4, 'Four to a flush.');
  const open4 = find(rest, 4, (s) => distinct(s) && Math.max(...s.map(rank)) - Math.min(...s.map(rank)) === 3 && !s.some((c) => rank(c) === 0));
  if (open4) return keep(hand, open4, 'Four to an open-ended straight.');
  const s3 = sfRest(3);
  if (s3) return keep(hand, s3, 'Three to a straight flush.');
  return keep(hand, [], 'Nothing worth keeping: draw five and hope for a deuce.');
}
