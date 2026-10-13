import { cardName } from './cards';
import { suggestHolds } from './vpHint';

/**
 * Practice drills. Everything here runs in the browser: no chips are bet, nothing is
 * sent to the server and nothing is won. Each drill deals a made-up situation and
 * knows the right answer and why.
 * Cards are 0..51 as everywhere: rank = c % 13 (0 = ace … 12 = king), suit = c / 13.
 */
export interface Choice {
  key: string;
  label: string;
}
export interface Question {
  /** What is asked, in a sentence. */
  prompt: string;
  /** Cards to show, in labelled groups. */
  groups: { label: string; cards: number[] }[];
  /** A line of extra facts under the cards (the point, the pot…). */
  facts?: string;
  choices: Choice[];
  answer: string;
  why: string;
  /** Video poker only: the answer is a set of holds, not one of the choices. */
  holds?: boolean[];
}

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(xs: readonly T[]): T => xs[rnd(xs.length)];
const rank = (c: number) => c % 13;
const suit = (c: number) => Math.floor(c / 13);
/** A card of this rank (0 = ace) in a random suit. */
const ofRank = (r: number) => r + 13 * rnd(4);

export function shuffled(): number[] {
  const d = Array.from({ length: 52 }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// ---------------------------------------------------------------------------
// Blackjack: basic strategy for the tables here (six decks, the dealer stands on
// soft 17, double on any two cards and after a split, surrender allowed).
// ---------------------------------------------------------------------------
const bjPoints = (c: number) => (rank(c) === 0 ? 11 : Math.min(rank(c) + 1, 10));

export function bjTotal(cards: number[]): { total: number; soft: boolean } {
  let total = cards.reduce((n, c) => n + bjPoints(c), 0);
  let aces = cards.filter((c) => rank(c) === 0).length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

const BJ_LABEL: Record<string, string> = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' };

export function bjBest(cards: [number, number], up: number): { move: string; why: string } {
  const d = bjPoints(up); // 2..10, 11 = ace
  const weak = d >= 2 && d <= 6;
  const [a, b] = cards.map(bjPoints);
  const { total, soft } = bjTotal(cards);
  const upName = d === 11 ? 'an ace' : `a ${d}`;

  if (a === b && rank(cards[0]) === rank(cards[1])) {
    if (a === 11) return { move: 'split', why: 'Always split aces: two hands starting with 11 beat one soft 12.' };
    if (a === 8) return { move: 'split', why: 'Always split eights: 16 is the worst hand there is, and two hands starting with 8 are far better.' };
    if (a === 10) return { move: 'stand', why: 'Never split tens: 20 is too good to break up.' };
    if (a === 9) {
      return [7, 10, 11].includes(d)
        ? { move: 'stand', why: `18 is ahead of ${upName} often enough. Split nines against 2 to 6, 8 and 9 only.` }
        : { move: 'split', why: 'Split nines against 2 to 6, 8 and 9: two hands starting with 9 do better than standing on 18 there.' };
    }
    if (a === 7) return d <= 7 ? { move: 'split', why: 'Split sevens against 2 to 7.' } : { move: 'hit', why: 'Sevens are only split against 2 to 7. Against a strong card, hit the 14.' };
    if (a === 6) return weak ? { move: 'split', why: 'Split sixes when the dealer shows 2 to 6.' } : { move: 'hit', why: 'Sixes are only split against 2 to 6. Otherwise hit the 12.' };
    if (a === 4) return d === 5 || d === 6 ? { move: 'split', why: 'Split fours only against 5 and 6, the dealer’s weakest cards.' } : { move: 'hit', why: 'Fours are only split against 5 and 6. Otherwise just hit the 8.' };
    if (a === 2 || a === 3) return d <= 7 ? { move: 'split', why: 'Split twos and threes against 2 to 7.' } : { move: 'hit', why: 'Twos and threes are only split against 2 to 7.' };
    // a pair of fives is played as a hard 10
  }

  if (soft) {
    if (total >= 19) return { move: 'stand', why: `Soft ${total} is already a strong hand: stand.` };
    if (total === 18) {
      if (d >= 3 && d <= 6) return { move: 'double', why: 'Soft 18 against 3 to 6: double. You cannot bust, and the dealer is in trouble.' };
      if (d === 2 || d === 7 || d === 8) return { move: 'stand', why: 'Soft 18 against 2, 7 or 8: stand.' };
      return { move: 'hit', why: `Soft 18 is behind against ${upName}: hit, you cannot bust.` };
    }
    if (total === 17) return d >= 3 && d <= 6 ? { move: 'double', why: 'Soft 17 against 3 to 6: double.' } : { move: 'hit', why: 'Never stand on soft 17: hit (double only against 3 to 6).' };
    if (total >= 15) return d >= 4 && d <= 6 ? { move: 'double', why: `Soft ${total} against 4 to 6: double.` } : { move: 'hit', why: `Soft ${total}: hit (double only against 4 to 6).` };
    return d === 5 || d === 6 ? { move: 'double', why: `Soft ${total} against 5 or 6: double.` } : { move: 'hit', why: `Soft ${total}: hit (double only against 5 and 6).` };
  }

  if (total >= 17) return { move: 'stand', why: `Always stand on hard ${total}.` };
  if (total === 16 && d >= 9) return { move: 'surrender', why: 'Hard 16 against 9, 10 or an ace loses so often that giving up half the bet is the better deal.' };
  if (total === 15 && d === 10) return { move: 'surrender', why: 'Hard 15 against a 10: surrender.' };
  if (total >= 13) return weak ? { move: 'stand', why: `Hard ${total} against 2 to 6: stand and let the dealer bust.` } : { move: 'hit', why: `Hard ${total} against ${upName}: the dealer probably has a made hand, so hit.` };
  if (total === 12) return d >= 4 && d <= 6 ? { move: 'stand', why: 'Hard 12 against 4 to 6: stand.' } : { move: 'hit', why: 'Hard 12: hit, except against 4 to 6.' };
  if (total === 11) return d === 11 ? { move: 'hit', why: 'With the dealer standing on soft 17, 11 against an ace is a hit, not a double.' } : { move: 'double', why: 'Double 11 against anything but an ace.' };
  if (total === 10) return d <= 9 ? { move: 'double', why: 'Double 10 against 2 to 9.' } : { move: 'hit', why: 'Against a 10 or an ace, just hit the 10.' };
  if (total === 9) return d >= 3 && d <= 6 ? { move: 'double', why: 'Double 9 against 3 to 6.' } : { move: 'hit', why: 'Hit 9 (double only against 3 to 6).' };
  return { move: 'hit', why: `Hard ${total} cannot bust: hit.` };
}

export function blackjackQuestion(): Question {
  let cards: [number, number];
  const kind = rnd(10);
  if (kind < 3) {
    const r = rnd(13);
    cards = [r, r + 13 * (1 + rnd(3))];
  } else if (kind < 6) {
    cards = [ofRank(0), ofRank(1 + rnd(8))]; // ace with 2 to 9
  } else {
    do {
      cards = [rnd(52), rnd(52)];
    } while (cards[0] === cards[1] || bjTotal(cards).total === 21 || bjTotal(cards).total < 8 || bjTotal(cards).soft);
  }
  let up: number;
  do {
    up = rnd(52);
  } while (cards.includes(up));
  const best = bjBest(cards, up);
  const { total, soft } = bjTotal(cards);
  const pair = rank(cards[0]) === rank(cards[1]);
  return {
    prompt: 'What is the best play?',
    groups: [
      { label: 'Dealer shows', cards: [up] },
      { label: `Your hand · ${pair ? 'a pair' : `${soft ? 'soft' : 'hard'} ${total}`}`, cards },
    ],
    choices: ['hit', 'stand', 'double', ...(pair ? ['split'] : []), 'surrender'].map((k) => ({ key: k, label: BJ_LABEL[k] })),
    answer: best.move,
    why: best.why,
  };
}

// ---------------------------------------------------------------------------
// Poker hands (five-card high poker), for the showdown drill and video poker.
// ---------------------------------------------------------------------------
const high = (c: number) => (rank(c) === 0 ? 14 : rank(c) + 1);
const HAND = ['high card', 'a pair', 'two pair', 'three of a kind', 'a straight', 'a flush', 'a full house', 'four of a kind', 'a straight flush'];

function score5(cs: number[]): number[] {
  const r = cs.map(high).sort((x, y) => y - x);
  const flush = cs.every((c) => suit(c) === suit(cs[0]));
  let straight = 0;
  if (new Set(r).size === 5) {
    if (r[0] - r[4] === 4) straight = r[0];
    else if (r[0] === 14 && r[1] === 5) straight = 5;
  }
  const counts = new Map<number, number>();
  r.forEach((x) => counts.set(x, (counts.get(x) ?? 0) + 1));
  const g = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0]);
  const ranks = g.map((x) => x[0]);
  if (straight && flush) return [8, straight];
  if (g[0][1] === 4) return [7, ...ranks];
  if (g[0][1] === 3 && g[1][1] === 2) return [6, ...ranks];
  if (flush) return [5, ...r];
  if (straight) return [4, straight];
  if (g[0][1] === 3) return [3, ...ranks];
  if (g[0][1] === 2 && g[1][1] === 2) return [2, ...ranks];
  if (g[0][1] === 2) return [1, ...ranks];
  return [0, ...r];
}
const cmp = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
};

/** The best five of any number of cards: its score (higher wins), its cards and its name. */
export function bestFive(cards: number[]): { score: number[]; cards: number[]; name: string } {
  let best: { score: number[]; cards: number[] } | null = null;
  const walk = (start: number, acc: number[]) => {
    if (acc.length === 5) {
      const s = score5(acc);
      if (!best || cmp(s, best.score) > 0) best = { score: s, cards: acc };
      return;
    }
    for (let i = start; i < cards.length; i++) walk(i + 1, [...acc, cards[i]]);
  };
  walk(0, []);
  const b = best as unknown as { score: number[]; cards: number[] };
  return { ...b, name: b.score[0] === 8 && b.score[1] === 14 ? 'a royal flush' : HAND[b.score[0]] };
}

export function showdownQuestion(): Question {
  // Keep dealing until at least one player has a pair or better, so most questions are worth a look.
  for (;;) {
    const d = shuffled();
    const board = d.slice(0, 5);
    const a = d.slice(5, 7);
    const b = d.slice(7, 9);
    const ha = bestFive([...board, ...a]);
    const hb = bestFive([...board, ...b]);
    if (Math.max(ha.score[0], hb.score[0]) < 1 || (ha.score[0] === 0 && hb.score[0] === 0)) continue;
    const c = cmp(ha.score, hb.score);
    const answer = c > 0 ? 'a' : c < 0 ? 'b' : 'split';
    const same = ha.score[0] === hb.score[0];
    const show = (h: { cards: number[]; name: string }) => `${h.name} (${h.cards.map(cardName).join(' ')})`;
    return {
      prompt: 'Texas Hold’em showdown: who wins the pot?',
      groups: [
        { label: 'Board', cards: board },
        { label: 'Player A', cards: a },
        { label: 'Player B', cards: b },
      ],
      choices: [
        { key: 'a', label: 'Player A' },
        { key: 'b', label: 'Player B' },
        { key: 'split', label: 'Split pot' },
      ],
      answer,
      why:
        answer === 'split'
          ? `Both players’ best five cards are the same: ${show(ha)}. Suits never break a tie, so the pot is split.`
          : `Player A has ${show(ha)}; Player B has ${show(hb)}. ${same ? 'The same kind of hand, so the higher cards decide it.' : ''} Each player uses the best five of their seven cards.`,
    };
  }
}

/** Pot odds: is calling worth it with one card to come? */
export function potOddsQuestion(): Question {
  const draws = [
    { outs: 4, name: 'an inside straight draw', hole: ['9', '8'], text: 'only one rank fills the straight: 4 cards' },
    { outs: 8, name: 'an open-ended straight draw', hole: ['9', '8'], text: 'two ranks fill the straight: 8 cards' },
    { outs: 9, name: 'a flush draw', hole: ['A', '7'], text: '13 of the suit less the 4 you can see: 9 cards' },
    { outs: 12, name: 'a flush draw with an inside straight draw', hole: ['J', '10'], text: '9 for the flush and 3 more for the straight: 12 cards' },
    { outs: 15, name: 'a flush draw with an open-ended straight draw', hole: ['J', '10'], text: '9 for the flush and 6 more for the straight: 15 cards' },
    { outs: 2, name: 'a small pair, needing three of a kind', hole: ['5', '5'], text: 'two cards of your rank are left: 2 cards' },
  ];
  for (;;) {
    const d = pick(draws);
    const pot = (4 + rnd(37)) * 50; // what is in the middle, their bet included
    const call = (1 + rnd(16)) * 50;
    if (call > pot) continue;
    const chance = d.outs / 46;
    const need = call / (pot + call);
    if (Math.abs(chance - need) < 0.035) continue; // too close to be a fair question
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    return {
      prompt: 'On the turn, with one card to come, your opponent bets. You only win if you hit. Call or fold?',
      groups: [],
      facts: `You have ${d.name} (${d.outs} cards help you). The pot is ${pot.toLocaleString('en-US')} chips including their bet, and it costs ${call.toLocaleString('en-US')} to call.`,
      choices: [
        { key: 'call', label: 'Call' },
        { key: 'fold', label: 'Fold' },
      ],
      answer: chance > need ? 'call' : 'fold',
      why: `You hit ${d.outs} times in 46 (${d.text}), about ${pct(chance)}. Calling ${call.toLocaleString('en-US')} to win a pot that would be ${(pot + call).toLocaleString('en-US')} needs you to win more than ${pct(need)} of the time. ${chance > need ? 'You win more often than that, so calling makes chips in the long run.' : 'You win less often than that, so calling loses chips in the long run.'}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Video poker (Jacks or Better): which cards to hold.
// ---------------------------------------------------------------------------
function vpMade(hand: number[]): string | null {
  const s = score5(hand);
  if (s[0] === 8) return s[1] === 14 ? 'royal_flush' : 'straight_flush';
  return [null, null, null, null, 'straight', 'flush', 'full_house', 'four_kind'][s[0]] ?? null;
}

export function videoPokerQuestion(): Question {
  const hand = shuffled().slice(0, 5);
  const hint = suggestHolds(hand, 'video_poker_jacks', vpMade(hand));
  return {
    prompt: 'Jacks or Better: tap the cards you would hold, then check.',
    groups: [{ label: 'Your five cards', cards: hand }],
    choices: [],
    answer: hint.holds.map((h) => (h ? '1' : '0')).join(''),
    holds: hint.holds,
    why: hint.holds.some(Boolean) ? hint.why : `${hint.why} (Hold nothing and draw five.)`,
  };
}

// ---------------------------------------------------------------------------
// Craps: what happens to a bet on this roll?
// ---------------------------------------------------------------------------
type CrapsResult = 'win' | 'lose' | 'stay';
interface CrapsBet {
  name: string;
  /** Only asked with a point on. */
  needsPoint?: boolean;
  /** What the bet does, and why, for a roll of d1 + d2 with this point (null = come-out roll). */
  rule: (sum: number, hard: boolean, point: number | null) => [CrapsResult, string];
}

const hardway = (n: number): CrapsBet => ({
  name: `Hard ${n} (${n / 2} and ${n / 2})`,
  needsPoint: true,
  rule: (sum, hard) =>
    sum === n && hard
      ? ['win', `${n} came the hard way, as a pair: the bet wins.`]
      : sum === n
        ? ['lose', `${n} came the easy way (not as a pair), which loses a hardway bet.`]
        : sum === 7
          ? ['lose', 'A seven loses every hardway bet.']
          : ['stay', `A hardway bet only moves on a 7 or on its own number. It stays for the next roll.`],
});
const place = (n: number): CrapsBet => ({
  name: `Place ${n}`,
  needsPoint: true,
  rule: (sum) =>
    sum === n ? ['win', `A place bet wins whenever its number is rolled before a 7.`] : sum === 7 ? ['lose', 'A seven loses every place bet.'] : ['stay', `A place bet only moves on its own number or a 7. It stays for the next roll.`],
});

const CRAPS_BETS: CrapsBet[] = [
  {
    name: 'Pass line',
    rule: (sum, _h, point) =>
      point === null
        ? sum === 7 || sum === 11
          ? ['win', 'On the come-out roll, 7 and 11 win the pass line.']
          : sum === 2 || sum === 3 || sum === 12
            ? ['lose', 'On the come-out roll, 2, 3 and 12 ("craps") lose the pass line.']
            : ['stay', `${sum} becomes the point. The bet stays until the point or a 7 is rolled.`]
        : sum === point
          ? ['win', 'The point was rolled again before a 7: the pass line wins.']
          : sum === 7
            ? ['lose', 'A seven before the point ("seven out") loses the pass line.']
            : ['stay', 'With a point on, only the point and 7 matter to the pass line.'],
  },
  {
    name: 'Don’t pass',
    rule: (sum, _h, point) =>
      point === null
        ? sum === 2 || sum === 3
          ? ['win', 'On the come-out roll, 2 and 3 win the don’t pass.']
          : sum === 7 || sum === 11
            ? ['lose', 'On the come-out roll, 7 and 11 lose the don’t pass.']
            : sum === 12
              ? ['stay', 'A 12 on the come-out roll is a stand-off for the don’t pass: nothing is won or lost.']
              : ['stay', `${sum} becomes the point. The don’t pass now wins on a 7 and loses on the point.`]
        : sum === 7
          ? ['win', 'A seven before the point wins the don’t pass.']
          : sum === point
            ? ['lose', 'The point was rolled before a 7: the don’t pass loses.']
            : ['stay', 'With a point on, only the point and 7 matter to the don’t pass.'],
  },
  {
    name: 'Field',
    rule: (sum) =>
      [2, 3, 4, 9, 10, 11, 12].includes(sum)
        ? ['win', 'The field wins on 2, 3, 4, 9, 10, 11 and 12 (2 and 12 pay extra).']
        : ['lose', 'The field is a one-roll bet: 5, 6, 7 and 8 lose it.'],
  },
  {
    name: 'Any seven',
    rule: (sum) => (sum === 7 ? ['win', 'Any seven is a one-roll bet that wins on a 7.'] : ['lose', 'Any seven is a one-roll bet: anything but a 7 loses it.']),
  },
  place(6),
  place(8),
  place(5),
  hardway(4),
  hardway(6),
  hardway(8),
  hardway(10),
];

export interface CrapsQuestion extends Question {
  dice: [number, number];
}

export function crapsQuestion(): CrapsQuestion {
  const bet = pick(CRAPS_BETS);
  const point = bet.needsPoint || rnd(5) < 3 ? pick([4, 5, 6, 8, 9, 10]) : null;
  // Half the time, pick a roll that matters to this bet, so "stays" is not nearly always right.
  let dice: [number, number] = [1 + rnd(6), 1 + rnd(6)];
  for (let i = 0; i < 12 && rnd(2) === 0 && bet.rule(dice[0] + dice[1], dice[0] === dice[1], point)[0] === 'stay'; i++) {
    dice = [1 + rnd(6), 1 + rnd(6)];
  }
  const [answer, why] = bet.rule(dice[0] + dice[1], dice[0] === dice[1], point);
  return {
    prompt: `You have a bet on ${bet.name}. What happens to it on this roll?`,
    groups: [],
    dice,
    facts: point === null ? 'Come-out roll: there is no point yet.' : `The point is ${point}.`,
    choices: [
      { key: 'win', label: 'It wins' },
      { key: 'lose', label: 'It loses' },
      { key: 'stay', label: 'Nothing: it stays' },
    ],
    answer,
    why: `The roll is ${dice[0] + dice[1]}. ${why}`,
  };
}

// ---------------------------------------------------------------------------
// Roulette: what does each kind of bet pay?
// ---------------------------------------------------------------------------
const ROULETTE = [
  { name: 'a straight-up bet (one number)', n: 1 },
  { name: 'a split (two numbers next to each other)', n: 2 },
  { name: 'a street (a row of three numbers)', n: 3 },
  { name: 'a corner (four numbers that meet)', n: 4 },
  { name: 'a line (two rows: six numbers)', n: 6 },
  { name: 'a dozen (1 to 12, 13 to 24 or 25 to 36)', n: 12 },
  { name: 'a column (twelve numbers)', n: 12 },
  { name: 'red or black', n: 18 },
  { name: 'odd or even', n: 18 },
  { name: 'high or low (1 to 18, 19 to 36)', n: 18 },
];

export function rouletteQuestion(): Question {
  const bet = pick(ROULETTE);
  const pays = 36 / bet.n - 1;
  const all = [35, 17, 11, 8, 5, 2, 1];
  const wrong = all.filter((x) => x !== pays).sort(() => Math.random() - 0.5).slice(0, 3);
  const stake = pick([10, 25, 50, 100]);
  return {
    prompt: `You win with ${bet.name}. What does it pay?`,
    groups: [],
    choices: [...wrong, pays].sort((x, y) => y - x).map((x) => ({ key: String(x), label: `${x} to 1` })),
    answer: String(pays),
    why: `It covers ${bet.n} number${bet.n === 1 ? '' : 's'}, and a win returns 36 chips for every ${bet.n} bet: ${pays} to 1 plus your bet back. A ${stake} chip bet would come back as ${(stake * (pays + 1)).toLocaleString('en-US')}.`,
  };
}

// ---------------------------------------------------------------------------
// Baccarat: does the Banker take a third card?
// ---------------------------------------------------------------------------
const bacPoints = (c: number) => (rank(c) >= 9 ? 0 : rank(c) + 1);
const bacTotal = (cs: number[]) => cs.reduce((n, c) => n + bacPoints(c), 0) % 10;

export function baccaratQuestion(): Question {
  for (;;) {
    const d = shuffled();
    const player = [d[0], d[2]];
    const banker = [d[1], d[3]];
    const p = bacTotal(player);
    const b = bacTotal(banker);
    if (p >= 8 || b >= 8) continue; // a natural: nobody draws, not much of a question
    const third = p <= 5 ? d[4] : null;
    const t = third === null ? null : bacPoints(third);
    let draws: boolean;
    let why: string;
    if (t === null) {
      draws = b <= 5;
      why = `The Player stood on ${p}, so the Banker plays like the Player would: draws on 0 to 5, stands on 6 or 7. The Banker has ${b}.`;
    } else if (b <= 2) {
      draws = true;
      why = `With 0, 1 or 2 the Banker always draws. The Banker has ${b}.`;
    } else if (b === 7) {
      draws = false;
      why = 'The Banker always stands on 7.';
    } else {
      const table: Record<number, [number[], string]> = {
        3: [[0, 1, 2, 3, 4, 5, 6, 7, 9], 'anything but an 8'],
        4: [[2, 3, 4, 5, 6, 7], '2 to 7'],
        5: [[4, 5, 6, 7], '4 to 7'],
        6: [[6, 7], '6 or 7'],
      };
      draws = table[b][0].includes(t);
      why = `With ${b}, the Banker draws only when the Player’s third card is ${table[b][1]}. It was worth ${t}.`;
    }
    return {
      prompt: 'Does the Banker take a third card?',
      groups: [
        { label: `Player · ${p}${third !== null ? ', then draws' : ', stands'}`, cards: third !== null ? [...player, third] : player },
        { label: `Banker · ${b}`, cards: banker },
      ],
      facts: 'Tens and face cards count 0, aces 1. Only the last digit of a total counts.',
      choices: [
        { key: 'draw', label: 'Banker draws' },
        { key: 'stand', label: 'Banker stands' },
      ],
      answer: draws ? 'draw' : 'stand',
      why,
    };
  }
}

// ---------------------------------------------------------------------------
// The list of drills
// ---------------------------------------------------------------------------
export interface Drill {
  key: string;
  name: string;
  /** The catalogue game its icon comes from. */
  icon: string;
  blurb: string;
  /** Where the real game is played. */
  play: { to: string; label: string };
  make: () => Question;
}

export const DRILLS: Drill[] = [
  {
    key: 'blackjack',
    name: 'Blackjack: basic strategy',
    icon: 'blackjack',
    blurb: 'A hand and a dealer card. Hit, stand, double, split or surrender?',
    play: { to: '/lobby?game=blackjack', label: 'Blackjack tables' },
    make: blackjackQuestion,
  },
  {
    key: 'video-poker',
    name: 'Video poker: what to hold',
    icon: 'video_poker_jacks',
    blurb: 'Five cards in Jacks or Better. Choose the cards worth keeping.',
    play: { to: '/play/video_poker_jacks', label: 'Jacks or Better' },
    make: videoPokerQuestion,
  },
  {
    key: 'showdown',
    name: 'Poker: who wins?',
    icon: 'poker_holdem',
    blurb: 'A Hold’em board and two hands. Read the showdown.',
    play: { to: '/lobby?game=poker_holdem', label: 'Hold’em tables' },
    make: showdownQuestion,
  },
  {
    key: 'pot-odds',
    name: 'Poker: call or fold?',
    icon: 'poker_omaha',
    blurb: 'A draw, a pot and a bet. Is the call worth its price?',
    play: { to: '/lobby?game=poker_holdem', label: 'Hold’em tables' },
    make: potOddsQuestion,
  },
  {
    key: 'craps',
    name: 'Craps: what happens to my bet?',
    icon: 'craps',
    blurb: 'A bet and a roll of the dice. Does it win, lose or stay?',
    play: { to: '/lobby?game=craps', label: 'Craps tables' },
    make: crapsQuestion,
  },
  {
    key: 'roulette',
    name: 'Roulette: what does it pay?',
    icon: 'roulette',
    blurb: 'Every bet on the layout and what a win returns.',
    play: { to: '/lobby?game=roulette', label: 'Roulette tables' },
    make: rouletteQuestion,
  },
  {
    key: 'baccarat',
    name: 'Baccarat: the third card',
    icon: 'baccarat',
    blurb: 'The drawing rules nobody remembers. Does the Banker draw?',
    play: { to: '/play/baccarat', label: 'Baccarat' },
    make: baccaratQuestion,
  },
];
