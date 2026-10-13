import { parseCard } from './poker';

/**
 * "Learn to play": step-by-step walkthroughs of the big games, on the Practice page.
 * Like the drills, they run entirely in the browser: nothing is bet and nothing is won.
 * A step explains one idea, shows a made-up table, and may ask the learner to make the
 * move themselves before going on. The rules described are the rules of the games here.
 */
export interface LessonChoice {
  label: string;
  right?: boolean;
  /** Shown after picking it: why it is right, or why not. */
  why: string;
}
export interface LessonScene {
  /** Cards in labelled groups; null is a card lying face down. */
  groups?: { label: string; cards: (number | null)[] }[];
  dice?: [number, number];
  /** A roulette pocket. */
  pocket?: { n: string; colour: 'red' | 'black' | 'green' };
  /** Small labelled facts under the table: the point, the pot, a bet… */
  facts?: [string, string][];
}
export interface LessonStep {
  title: string;
  /** One paragraph per entry. */
  text: string[];
  scene?: LessonScene;
  ask?: { prompt: string; choices: LessonChoice[] };
}
export interface Lesson {
  key: string;
  name: string;
  /** The catalogue game its icon comes from. */
  icon: string;
  blurb: string;
  minutes: number;
  steps: LessonStep[];
  /** Where to go afterwards. */
  play: { to: string; label: string };
  drill?: { to: string; label: string };
}

/** 'As Kd ??' -> cards (?? = face down). */
const c = (codes: string): (number | null)[] => codes.split(' ').map((x) => (x === '??' ? null : parseCard(x)));

const BLACKJACK: LessonStep[] = [
  {
    title: 'The aim',
    text: [
      'You play against the dealer, not the other players. Get a hand closer to 21 than the dealer’s without going over.',
      'Number cards count their number. Jacks, queens and kings count 10. An ace counts 1 or 11, whichever suits the hand.',
    ],
    scene: { groups: [{ label: 'A king and a seven: 17', cards: c('Ks 7d') }] },
  },
  {
    title: 'Soft hands',
    text: ['A hand with an ace counted as 11 is called “soft”, because it cannot bust on the next card: the ace just drops back to 1.'],
    scene: { groups: [{ label: 'Your hand', cards: c('Ah 6c') }] },
    ask: {
      prompt: 'What is an ace and a six worth?',
      choices: [
        { label: '7', why: 'It can be 7, but that is only half of it: the ace can also count 11.' },
        { label: '17', why: 'It can be 17, but it is not stuck there: the ace can also count 1.' },
        { label: '7 or 17', right: true, why: 'Right: a “soft 17”. Take a ten and it becomes 17 the hard way instead of busting.' },
      ],
    },
  },
  {
    title: 'The deal',
    text: [
      'Put chips on your spot before the cards come out. Everyone gets two cards face up. The dealer gets one face up and one face down.',
      'You only ever see one of the dealer’s cards while you decide. That card is the most useful thing on the table.',
    ],
    scene: {
      groups: [
        { label: 'Dealer', cards: c('6h ??') },
        { label: 'You', cards: c('6s 5d') },
      ],
      facts: [['Your bet', '100']],
    },
  },
  {
    title: 'Hit',
    text: ['“Hit” takes another card. “Stand” keeps what you have. You may hit as many times as you like, until you stand or go over 21.'],
    scene: {
      groups: [
        { label: 'Dealer', cards: c('6h ??') },
        { label: 'You: 11', cards: c('6s 5d') },
      ],
    },
    ask: {
      prompt: 'You have 11. What now?',
      choices: [
        { label: 'Hit', right: true, why: 'Yes. No single card can take 11 over 21, so another card can only help.' },
        { label: 'Stand', why: '11 almost never wins by itself, and no card can bust it. Take a card.' },
      ],
    },
  },
  {
    title: 'Stand',
    text: ['You drew a nine: 20. Only 21 beats it.'],
    scene: {
      groups: [
        { label: 'Dealer', cards: c('6h ??') },
        { label: 'You: 20', cards: c('6s 5d 9c') },
      ],
    },
    ask: {
      prompt: 'You have 20. What now?',
      choices: [
        { label: 'Hit', why: 'Only an ace would help; anything else busts a hand that is nearly unbeatable.' },
        { label: 'Stand', right: true, why: 'Right. 20 is a very strong hand: keep it.' },
      ],
    },
  },
  {
    title: 'The dealer’s turn',
    text: [
      'When every player has finished, the dealer turns the hidden card over and plays by fixed rules: draw on 16 or less, stand on 17 or more (here the dealer stands on soft 17 too). The dealer never chooses.',
      'Here the dealer had 16, had to draw, and went over 21. A win pays 1 to 1: your 100 comes back as 200.',
    ],
    scene: {
      groups: [
        { label: 'Dealer: 24, bust', cards: c('6h Td 8s') },
        { label: 'You: 20', cards: c('6s 5d 9c') },
      ],
      facts: [['Paid back', '200']],
    },
  },
  {
    title: 'Busting',
    text: [
      'Go over 21 and you “bust”: your bet is lost at once, even if the dealer busts afterwards. That one rule is the house’s whole advantage.',
      'So with a hand that could bust, look at the dealer’s card. A 2 to 6 is weak (the dealer will often bust), so stand and wait. A 7 or higher is strong, so you usually have to take the risk.',
    ],
    scene: {
      groups: [
        { label: 'Dealer', cards: c('5c ??') },
        { label: 'You: 13', cards: c('Td 3h') },
      ],
    },
    ask: {
      prompt: 'You have 13 and the dealer shows a 5.',
      choices: [
        { label: 'Hit', why: 'Any 9 or ten-card busts you, and the dealer’s 5 is weak: they bust often. Let them.' },
        { label: 'Stand', right: true, why: 'Right. With the dealer showing 2 to 6, stand on 13 or more and let the dealer take the risk.' },
      ],
    },
  },
  {
    title: 'Blackjack',
    text: [
      'An ace and a ten-card as your first two cards is a “blackjack”. It beats everything except a dealer blackjack, and it pays 3 to 2: a 100 bet wins 150.',
      'If you and the dealer end on the same total it is a “push”: your bet comes back, nothing more.',
    ],
    scene: { groups: [{ label: 'Blackjack', cards: c('As Kh') }], facts: [['Bet 100, paid back', '250']] },
  },
  {
    title: 'Double',
    text: ['On your first two cards you may “Double”: your bet doubles, and you get exactly one more card. Use it when you are likely to end with a strong hand.'],
    scene: {
      groups: [
        { label: 'Dealer', cards: c('6d ??') },
        { label: 'You: 11', cards: c('7c 4s') },
      ],
    },
    ask: {
      prompt: 'You have 11 against a 6. Best play?',
      choices: [
        { label: 'Hit', why: 'Not wrong, but you are a big favourite here: get more chips down.' },
        { label: 'Stand', why: '11 cannot bust and rarely wins by itself.' },
        { label: 'Double', right: true, why: 'Yes. Nearly a third of the cards make 21, and the dealer’s 6 is weak. This is the classic double.' },
      ],
    },
  },
  {
    title: 'Split',
    text: [
      'Two cards of the same rank can be “Split” into two hands, each with its own bet the size of the first. Each gets a new card and is played in turn.',
      'Two rules cover most of it: always split aces and eights, never split tens or fives.',
    ],
    scene: {
      groups: [
        { label: 'Dealer', cards: c('Th ??') },
        { label: 'You: 16', cards: c('8s 8d') },
      ],
    },
    ask: {
      prompt: 'A pair of eights against a ten.',
      choices: [
        { label: 'Stand', why: '16 loses to almost everything the dealer makes from a ten.' },
        { label: 'Hit', why: 'More than half the deck busts a 16.' },
        { label: 'Split', right: true, why: 'Right. 16 is the worst hand in the game; two hands that each start with 8 are much better.' },
      ],
    },
  },
  {
    title: 'Insurance and surrender',
    text: [
      '“Surrender”, on your first two cards, gives up the hand for half your bet. It is right only for the worst spots, like 16 against a ten.',
      'When the dealer shows an ace you are offered “Insurance”: a side bet of half your bet that the hidden card is a ten. It pays 2 to 1.',
    ],
    scene: {
      groups: [
        { label: 'Dealer', cards: c('Ac ??') },
        { label: 'You: 19', cards: c('Tc 9d') },
      ],
    },
    ask: {
      prompt: 'The dealer shows an ace. Take insurance?',
      choices: [
        { label: 'Yes', why: 'Fewer than a third of the cards are tens, and it only pays 2 to 1. Over time it loses chips.' },
        { label: 'No', right: true, why: 'Right. The hidden card is a ten less than a third of the time, so a 2 to 1 payout is a poor price. Skip it.' },
      ],
    },
  },
];

const HOLDEM: LessonStep[] = [
  {
    title: 'The aim',
    text: [
      'Everyone gets two cards of their own. Five more are dealt face up in the middle for everyone to share. Make the best five-card hand out of those seven.',
      'You win the pot in one of two ways: show the best hand at the end, or bet so that everyone else folds.',
    ],
    scene: {
      groups: [
        { label: 'The board (shared)', cards: c('Kd 7s 2c 9s 4h') },
        { label: 'Your two cards', cards: c('As Ks') },
      ],
    },
  },
  {
    title: 'Which hand beats which',
    text: [
      'From the top: straight flush, four of a kind, full house (three and a pair), flush (five of one suit), straight (five in a row), three of a kind, two pair, one pair, high card.',
      'The rarer the hand, the higher it ranks. Suits are all equal.',
    ],
    scene: {
      groups: [
        { label: 'A flush', cards: c('Ah Jh 8h 5h 2h') },
        { label: 'A straight', cards: c('9c 8d 7s 6h 5c') },
      ],
    },
    ask: {
      prompt: 'Which one wins?',
      choices: [
        { label: 'The flush', right: true, why: 'Right. Five of one suit is harder to make than five in a row, so the flush wins.' },
        { label: 'The straight', why: 'The other way round: a flush is rarer, so it ranks above a straight.' },
      ],
    },
  },
  {
    title: 'The blinds',
    text: [
      'Before the cards, the two players to the left of the dealer button put in forced bets: the small blind and the big blind. That gives everyone something to play for.',
      'The button moves one seat each hand, so everyone pays the blinds in turn. At a table marked 10 / 20, the small blind is 10 and the big blind 20.',
    ],
    scene: { facts: [['Small blind', '10'], ['Big blind', '20'], ['Pot', '30']] },
  },
  {
    title: 'Before the flop',
    text: [
      'You get your two cards and the first round of betting starts. On your turn you can Fold (give up the hand), Call (match the bet) or Raise (make it more).',
      'Most hands are worth folding. Big pairs and two high cards, especially of the same suit, are the ones to play.',
    ],
    scene: { groups: [{ label: 'Your two cards', cards: c('As Ks') }], facts: [['To call', '20']] },
    ask: {
      prompt: 'Ace-king of spades. The bet to you is the big blind, 20.',
      choices: [
        { label: 'Fold', why: 'This is one of the best starting hands there is. Folding it gives the blinds away.' },
        { label: 'Call', why: 'Fine, but it lets everyone in cheaply. Strong hands do better against fewer players.' },
        { label: 'Raise', right: true, why: 'Yes. A raise builds the pot while you are likely ahead and pushes weaker hands out.' },
      ],
    },
  },
  {
    title: 'The flop',
    text: [
      'Three shared cards are turned over at once: the flop. Now you can see five of your seven cards. Another round of betting follows.',
      'If nobody has bet yet, you can Check: stay in without putting chips in. Once somebody bets, you must call, raise or fold.',
    ],
    scene: {
      groups: [
        { label: 'The flop', cards: c('Kd 7s 2c') },
        { label: 'You: a pair of kings', cards: c('As Ks') },
      ],
      facts: [['Pot', '130']],
    },
    ask: {
      prompt: 'You have the top pair with the best side card. Nobody has bet.',
      choices: [
        { label: 'Fold', why: 'You never need to fold when nobody has bet: checking is free.' },
        { label: 'Check', why: 'Allowed, and free, but you probably have the best hand. Make worse hands pay to keep going.' },
        { label: 'Bet', right: true, why: 'Right. With a strong hand, bet: hands like a king with a worse side card will call.' },
      ],
    },
  },
  {
    title: 'The turn and the river',
    text: [
      'A fourth shared card (the turn) and then a fifth (the river) follow, each with its own round of betting. That makes four rounds in all.',
      'In No-Limit Hold’em you may bet any amount up to everything in front of you: “all in”. A player who is all in can only win as much from each opponent as they put in themselves; the rest goes in a side pot.',
    ],
    scene: {
      groups: [
        { label: 'The board', cards: c('Kd 7s 2c 9s 4h') },
        { label: 'You', cards: c('As Ks') },
      ],
      facts: [['Pot', '610']],
    },
  },
  {
    title: 'The showdown',
    text: [
      'If two or more players are left after the last bet, the cards are shown and the best five-card hand takes the pot.',
      'When two players have the same pair, the next highest card (the “kicker”) decides.',
    ],
    scene: {
      groups: [
        { label: 'The board', cards: c('Kd 7s 2c 9s 4h') },
        { label: 'You', cards: c('As Ks') },
        { label: 'Opponent', cards: c('Kh Qd') },
      ],
    },
    ask: {
      prompt: 'You both have a pair of kings. Who wins?',
      choices: [
        { label: 'You', right: true, why: 'Right. Kings with an ace beats kings with a queen: your kicker plays.' },
        { label: 'The opponent', why: 'Their side card is a queen; yours is an ace, which is higher.' },
        { label: 'It is split', why: 'It would be if your best five cards were the same. Here your ace beats their queen.' },
      ],
    },
  },
  {
    title: 'Playing the board',
    text: [
      'You do not have to use both of your cards, or either of them. If the five shared cards are the best hand anyone can make, everyone left “plays the board” and the pot is split.',
    ],
    scene: {
      groups: [
        { label: 'The board: a straight', cards: c('Ts Jd Qh Kc Ad') },
        { label: 'You', cards: c('7c 7d') },
        { label: 'Opponent', cards: c('9h 9s') },
      ],
    },
    ask: {
      prompt: 'Who wins this one?',
      choices: [
        { label: 'You', why: 'Your sevens do not make a better five-card hand than the ace-high straight on the board.' },
        { label: 'The opponent', why: 'Their nines do not beat the straight on the board either.' },
        { label: 'It is split', right: true, why: 'Right. Both of you play the ace-high straight on the board, so you share the pot.' },
      ],
    },
  },
  {
    title: 'At the tables here',
    text: [
      'When you sit down you choose how many chips to bring to the table (“Bring chips”); between hands you can “Top up”. Chips you bring go back to your balance when you leave.',
      'You have 20 seconds to act. If the clock runs out you check when that is free and fold when it is not. The other poker games here (Omaha, Stud, Draw and more) use the same hand rankings with different deals.',
    ],
  },
];

const CRAPS: LessonStep[] = [
  {
    title: 'The idea',
    text: [
      'One player, the shooter, rolls two dice, and everyone bets on what the dice will do. You can bet whether or not you are the shooter.',
      'The total is what matters. Seven is the most likely total (six ways out of 36), which is why the whole game turns on it.',
    ],
    scene: { dice: [3, 4] },
  },
  {
    title: 'The pass line and the come-out roll',
    text: [
      'The main bet is the Pass Line. A round starts with the “come-out” roll.',
      'On the come-out, 7 or 11 wins the pass line at once. 2, 3 or 12 (“craps”) loses it at once. Anything else becomes the “point”.',
    ],
    scene: { dice: [5, 6], facts: [['Your bet', 'Pass line'], ['Roll', 'Come-out']] },
    ask: {
      prompt: 'The come-out roll is 11. Your pass line bet…',
      choices: [
        { label: 'Wins', right: true, why: 'Right: 7 and 11 on the come-out win the pass line, 1 to 1.' },
        { label: 'Loses', why: 'Only 2, 3 and 12 lose on the come-out.' },
        { label: 'Stays', why: 'It would stay if a point were set, but 11 is an instant winner.' },
      ],
    },
  },
  {
    title: 'The point',
    text: [
      'Say the come-out is a 6. Six is now the point, and the puck on the table is turned to ON.',
      'From here the pass line wants one thing: a 6 before a 7. Every other total means nothing to it.',
    ],
    scene: { dice: [4, 5], facts: [['The point', '6'], ['This roll', '9']] },
    ask: {
      prompt: 'The point is 6 and the shooter rolls 9. Your pass line bet…',
      choices: [
        { label: 'Wins', why: 'Only the point itself, 6, wins it now.' },
        { label: 'Loses', why: 'Only a 7 loses it now.' },
        { label: 'Stays', right: true, why: 'Right. With a point on, only the point and 7 matter. The shooter rolls again.' },
      ],
    },
  },
  {
    title: 'Seven out',
    text: ['The shooter keeps rolling until the point or a seven comes up.'],
    scene: { dice: [2, 5], facts: [['The point', '6'], ['This roll', '7']] },
    ask: {
      prompt: 'The point is 6 and the shooter rolls 7.',
      choices: [
        { label: 'Pass line wins', why: 'A seven is a winner only on the come-out roll. With a point on it is the loser.' },
        { label: 'Pass line loses', right: true, why: 'Right: “seven out”. The round ends, and the dice move to the next player for a new come-out roll.' },
      ],
    },
  },
  {
    title: 'Don’t pass',
    text: [
      'Don’t Pass is the pass line turned around: you are betting against the shooter. On the come-out it wins on 2 or 3 and loses on 7 or 11; with a point on it wins on a 7 and loses on the point.',
      'The one exception: a 12 on the come-out is a stand-off for the don’t pass. Nothing is won or lost.',
    ],
    scene: { dice: [3, 4], facts: [['The point', '8'], ['Your bet', 'Don’t pass']] },
    ask: {
      prompt: 'The point is 8 and a 7 is rolled. Your don’t pass bet…',
      choices: [
        { label: 'Wins', right: true, why: 'Right. A seven before the point is exactly what the don’t pass is waiting for.' },
        { label: 'Loses', why: 'It loses when the point comes first. A seven wins it.' },
      ],
    },
  },
  {
    title: 'Odds: the best bet in the house',
    text: [
      'Once a point is set you can add an Odds bet behind your pass line bet, up to three times its size. It wins when the pass line does.',
      'It is paid at the true odds, so the house has no advantage on it at all: 2 to 1 on a point of 4 or 10, 3 to 2 on 5 or 9, 6 to 5 on 6 or 8.',
    ],
    scene: { dice: [4, 4], facts: [['The point', '8'], ['Pass line', '100'], ['Odds', '300']] },
    ask: {
      prompt: 'The shooter makes the point of 8. What do the 300 of odds win?',
      choices: [
        { label: '300', why: 'That would be 1 to 1. Odds on 6 and 8 pay better: 6 to 5.' },
        { label: '360', right: true, why: 'Right: 6 to 5, so 300 wins 360. The 100 on the pass line wins 100 as well.' },
        { label: '600', why: '2 to 1 is the price for a point of 4 or 10, which are harder to make.' },
      ],
    },
  },
  {
    title: 'Come and don’t come',
    text: [
      'A Come bet is a pass line bet you make while a point is already on. The next roll is its own come-out: 7 or 11 wins, 2, 3 or 12 loses, and any other number becomes that bet’s own point.',
      'Don’t Come is the don’t pass version. Both can take odds, just like the line bets.',
    ],
    scene: { dice: [2, 3], facts: [['Table point', '8'], ['You bet', 'Come'], ['This roll', '5']] },
    ask: {
      prompt: 'You bet Come and a 5 is rolled.',
      choices: [
        { label: 'It wins', why: 'Only 7 or 11 wins a come bet on its first roll.' },
        { label: 'It moves to the 5', right: true, why: 'Right. Five is now that bet’s own point: it wins if a 5 comes before a 7.' },
        { label: 'It loses', why: 'Only 2, 3 or 12 loses a come bet on its first roll.' },
      ],
    },
  },
  {
    title: 'Place bets and the field',
    text: [
      'A Place bet picks one number (4, 5, 6, 8, 9 or 10) and wins every time it is rolled before a 7. Six and eight are rolled most often.',
      'The Field is a one-roll bet: it wins on 2, 3, 4, 9, 10, 11 or 12 (here 2 pays double and 12 pays triple) and loses on 5, 6, 7 or 8.',
    ],
    scene: { dice: [3, 5], facts: [['Your bet', 'Field'], ['This roll', '8']] },
    ask: {
      prompt: 'You bet the field and an 8 is rolled.',
      choices: [
        { label: 'It wins', why: 'The field covers seven totals, but not the four most common ones: 5, 6, 7 and 8.' },
        { label: 'It loses', right: true, why: 'Right. 5, 6, 7 and 8 lose the field, and between them they come up nearly half the time.' },
      ],
    },
  },
  {
    title: 'Hardways and the centre bets',
    text: [
      'A Hardway bets that 4, 6, 8 or 10 will come as a pair (2-2, 3-3, 4-4, 5-5) before it comes any other way or a 7 is rolled. The one-roll bets in the centre (any seven, any craps, 2, 3, 11, 12) are decided by the very next roll.',
      'They pay well and are exciting, but the house takes a much bigger share of them. Starting out, the pass line with odds is all you need.',
    ],
    scene: { dice: [3, 3], facts: [['A hard six', '3 and 3']] },
  },
];

const ROULETTE: LessonStep[] = [
  {
    title: 'The wheel',
    text: [
      'A ball is spun around a wheel and drops into one numbered pocket. You bet on where it will land.',
      'The European wheel has 37 pockets: 1 to 36, half red and half black, and a green 0. The American wheel adds a second green pocket, 00. Each table says which wheel it uses.',
    ],
    scene: { pocket: { n: '17', colour: 'black' } },
  },
  {
    title: 'A round',
    text: [
      'There are 20 seconds to place bets. Then “no more bets” is called, the ball spins, and every bet on the table is settled by the one number.',
      'You can make as many bets as you like in a round, in any mix.',
    ],
    scene: { facts: [['Betting', '20 seconds'], ['Then', 'the spin'], ['Then', 'results']] },
  },
  {
    title: 'Inside bets',
    text: [
      'Bets on the numbers themselves are “inside” bets. One number (straight up) pays 35 to 1. A chip on the line between two numbers (a split) pays 17 to 1.',
      'A row of three (a street) pays 11 to 1, four numbers that meet at a corner pay 8 to 1, and two rows together (a line, six numbers) pay 5 to 1.',
    ],
    scene: { facts: [['1 number', '35 to 1'], ['2 numbers', '17 to 1'], ['3 numbers', '11 to 1'], ['4 numbers', '8 to 1'], ['6 numbers', '5 to 1']] },
    ask: {
      prompt: 'The rule behind all of them: a win returns 36 chips for every number you covered. What does a corner (4 numbers) pay?',
      choices: [
        { label: '4 to 1', why: 'Four numbers share 36 chips: 9 each. That is your bet back plus 8.' },
        { label: '8 to 1', right: true, why: 'Right: 36 ÷ 4 = 9 chips back for each one bet, which is 8 to 1.' },
        { label: '9 to 1', why: 'Nine chips come back, but one of them is your own bet: the win is 8 to 1.' },
      ],
    },
  },
  {
    title: 'Outside bets',
    text: [
      'The boxes around the numbers are “outside” bets. Red or black, odd or even, and low (1 to 18) or high (19 to 36) each cover 18 numbers and pay 1 to 1.',
      'A dozen (1 to 12, 13 to 24, 25 to 36) or a column covers 12 numbers and pays 2 to 1.',
    ],
    scene: { pocket: { n: '21', colour: 'red' } },
    ask: {
      prompt: 'The ball lands on red 21. Which of these bets wins?',
      choices: [
        { label: 'Black', why: '21 is red.' },
        { label: 'Even', why: '21 is odd.' },
        { label: 'Low (1 to 18)', why: '21 is in the high half, 19 to 36.' },
        { label: 'Second dozen', right: true, why: 'Right: 21 is between 13 and 24. A dozen pays 2 to 1.' },
      ],
    },
  },
  {
    title: 'The zero',
    text: [
      'The green zero is neither red nor black, neither odd nor even, neither high nor low, and it is in no dozen or column.',
      'That is where the house gets its edge: the payouts are worked out as if there were 36 pockets, but there are 37 (or 38 on the American wheel).',
    ],
    scene: { pocket: { n: '0', colour: 'green' } },
    ask: {
      prompt: 'You bet on red and the ball lands on 0.',
      choices: [
        { label: 'The bet loses', right: true, why: 'Right. Zero beats every outside bet. Only bets that include the 0 itself win.' },
        { label: 'The bet is returned', why: 'Not here: on zero, every outside bet loses.' },
      ],
    },
  },
  {
    title: 'Which wheel?',
    text: [
      'Every bet on a wheel has the same house edge, because every payout follows the same rule. What changes it is the wheel.',
      'European, with one zero, keeps about 2.7% of what is bet over time. American, with two, keeps about 5.3%.',
    ],
    ask: {
      prompt: 'Which wheel gives you the better game?',
      choices: [
        { label: 'European', right: true, why: 'Right. One green pocket instead of two halves the house’s share. The payouts are the same.' },
        { label: 'American', why: 'The extra 00 pocket is one more way for every bet to lose, with no better payout to make up for it.' },
        { label: 'They are the same', why: 'The payouts are the same, but the American wheel has one more losing pocket.' },
      ],
    },
  },
  {
    title: 'At the tables here',
    text: [
      'Pick a chip, then tap the layout to place it; tap the edges between numbers for splits, streets and corners. “Rebet” puts your last bets back.',
      'A win label shows the amount paid back, your own bet included: 10 on a single number shows +360.',
    ],
  },
];

const BACCARAT: LessonStep[] = [
  {
    title: 'The idea',
    text: [
      'Two hands are dealt: one called Player, one called Banker. You do not play either: you bet on which will finish closer to 9, or on a tie.',
      'Anyone can bet on either hand. The names are just names.',
    ],
    scene: {
      groups: [
        { label: 'Player', cards: c('4h 3s') },
        { label: 'Banker', cards: c('Kd 5c') },
      ],
    },
  },
  {
    title: 'Counting',
    text: ['Aces count 1, cards 2 to 9 count their number, and tens and face cards count 0. Add the cards and keep only the last digit: 15 is 5, 20 is 0.'],
    scene: { groups: [{ label: 'A hand', cards: c('7d 8c') }] },
    ask: {
      prompt: 'What is a seven and an eight worth?',
      choices: [
        { label: '15', why: 'In baccarat only the last digit counts.' },
        { label: '5', right: true, why: 'Right: 7 + 8 = 15, and only the last digit counts. Nobody can bust.' },
        { label: '0', why: 'It would be 0 if the total ended in 0, like a ten and a king.' },
      ],
    },
  },
  {
    title: 'Naturals and the third card',
    text: [
      'Each hand gets two cards. If either has 8 or 9 (a “natural”), that is the end: the higher hand wins.',
      'Otherwise the Player hand takes a third card on 0 to 5 and stands on 6 or 7. The Banker hand then draws or stands by a fixed table. It is all automatic: you never decide.',
    ],
    scene: {
      groups: [
        { label: 'Player: 9, a natural', cards: c('4c 5d') },
        { label: 'Banker: 6', cards: c('Jh 6s') },
      ],
    },
    ask: {
      prompt: 'Player has a natural 9, Banker has 6. What happens?',
      choices: [
        { label: 'Banker draws a card', why: 'A natural ends the hand at once. Nobody draws.' },
        { label: 'Player wins now', right: true, why: 'Right. An 8 or 9 on the first two cards stops everything, and 9 beats 6.' },
      ],
    },
  },
  {
    title: 'What the bets pay',
    text: [
      'Player pays 1 to 1. Banker pays 1 to 1 less a 5% commission, because the drawing rules make Banker win slightly more often. Tie pays 8 to 1; if it is a tie, bets on Player and Banker are returned.',
      'There are also two side bets, Player Pair and Banker Pair, that the hand’s first two cards will be a pair: 11 to 1.',
    ],
    scene: { facts: [['Player', '1 to 1'], ['Banker', '1 to 1, less 5%'], ['Tie', '8 to 1'], ['A pair', '11 to 1']] },
    ask: {
      prompt: 'You bet 100 on Banker and Banker wins. How much comes back?',
      choices: [
        { label: '200', why: 'That would be the full 1 to 1. Banker wins have 5% taken from the winnings.' },
        { label: '195', right: true, why: 'Right: your 100, plus 100 won, less 5 commission.' },
        { label: '190', why: 'The 5% comes off the 100 you won, not off the 200 in total.' },
      ],
    },
  },
  {
    title: 'Which bet?',
    text: [
      'Banker is the best bet on the table even after the commission, with Player just behind. The tie comes up less than one hand in ten, and 8 to 1 is a poor price for it.',
    ],
    ask: {
      prompt: 'Over a long session, which bet costs you the most?',
      choices: [
        { label: 'Banker', why: 'It is the cheapest bet: the house keeps only about 1% of it.' },
        { label: 'Player', why: 'Nearly as good as Banker: the house keeps a little over 1%.' },
        { label: 'Tie', right: true, why: 'Right. The house keeps about 14% of everything bet on the tie.' },
      ],
    },
  },
];

const VIDEO_POKER: LessonStep[] = [
  {
    title: 'The idea',
    text: [
      'It is five-card draw poker against a paytable, with nobody else at the table. You are dealt five cards, choose which to hold, and the rest are replaced once. The final hand is paid by the table.',
      'Unlike a slot machine, your choices matter: played well, Jacks or Better returns about 99.5% of what is bet.',
    ],
    scene: { groups: [{ label: 'The deal', cards: c('Js Jd 4c 7h 9s') }] },
  },
  {
    title: 'What pays',
    text: ['On Jacks or Better the smallest paying hand is a pair of jacks, queens, kings or aces. It returns your bet. A smaller pair pays nothing by itself.'],
    scene: {
      groups: [
        { label: 'Hand one', cards: c('9s 9d Kc 5h 2s') },
        { label: 'Hand two', cards: c('Qs Qd 8c 5h 2s') },
      ],
    },
    ask: {
      prompt: 'Which of these final hands pays?',
      choices: [
        { label: 'Hand one: a pair of nines', why: 'A pair has to be jacks or better to pay.' },
        { label: 'Hand two: a pair of queens', right: true, why: 'Right. Queens are “jacks or better”, so the bet is returned.' },
        { label: 'Both', why: 'Only pairs of jacks, queens, kings or aces pay.' },
      ],
    },
  },
  {
    title: 'Holding',
    text: ['Tap the cards you want to keep, then draw. The rest are thrown away and replaced from the same deck.'],
    scene: { groups: [{ label: 'The deal', cards: c('Js Jd 4c 7h 9s') }] },
    ask: {
      prompt: 'What do you hold?',
      choices: [
        { label: 'All five', why: 'That keeps a pair of jacks but throws away three chances to improve it.' },
        { label: 'The two jacks', right: true, why: 'Right. The pair already pays, and three new cards can turn it into two pair, three of a kind or better.' },
        { label: 'Nothing', why: 'You would be throwing away a hand that already pays.' },
      ],
    },
  },
  {
    title: 'The draw',
    text: [
      'Three new cards arrive. This time a third jack came: three of a kind, which pays 3 for 1.',
      'The big prize is the royal flush (ten to ace of one suit), at 800 for 1. It is rare, but the paytable is built around it.',
    ],
    scene: { groups: [{ label: 'After the draw: three jacks', cards: c('Js Jd Jh 3c 8d') }] },
  },
  {
    title: 'A made hand or a draw?',
    text: ['The hard choices are between something small you already have and a chance at something bigger.'],
    scene: { groups: [{ label: 'The deal', cards: c('Kh 9h 6h 2h Kc') }] },
    ask: {
      prompt: 'A pair of kings, or four hearts to a flush?',
      choices: [
        { label: 'Hold the two kings', right: true, why: 'Right. The kings pay now and can still improve. A flush draw only comes in about one time in five.' },
        { label: 'Hold the four hearts', why: 'The flush pays 6, but you miss it four times in five. The sure pair with room to improve is worth more.' },
      ],
    },
  },
  {
    title: 'When you have nothing',
    text: ['With no pair, keep what gives the best chance: four cards to a flush or an open straight, then high cards (jack or better), which can still make a paying pair.'],
    scene: { groups: [{ label: 'The deal', cards: c('Ah Jc 8d 5s 3h') }] },
    ask: {
      prompt: 'No pair. What do you hold?',
      choices: [
        { label: 'The ace and the jack', right: true, why: 'Right. Two high cards: pairing either one pays, and there are three new cards to do it with.' },
        { label: 'Nothing', why: 'You can do better: the ace and the jack can each make a paying pair.' },
        { label: 'The ace, eight and five', why: 'Low cards add nothing. Keep only what can make a paying hand.' },
      ],
    },
  },
  {
    title: 'On the machines here',
    text: [
      'Every video poker machine has a Hint button that suggests which cards to hold and says why. Use it while you learn.',
      'The other machines change the paytable: Deuces Wild makes every 2 wild, Bonus and Double Bonus pay more for four of a kind, and Joker Poker adds a wild joker.',
    ],
  },
];

export const LESSONS: Lesson[] = [
  {
    key: 'blackjack',
    name: 'Blackjack',
    icon: 'blackjack',
    blurb: 'Card values, hit and stand, the dealer’s rules, doubling, splitting and insurance.',
    minutes: 5,
    steps: BLACKJACK,
    play: { to: '/lobby?game=blackjack', label: 'Blackjack tables' },
    drill: { to: '/practice/blackjack', label: 'Basic strategy drill' },
  },
  {
    key: 'holdem',
    name: 'Texas Hold’em',
    icon: 'poker_holdem',
    blurb: 'Hand rankings, blinds, the four betting rounds and the showdown.',
    minutes: 6,
    steps: HOLDEM,
    play: { to: '/lobby?game=poker_holdem', label: 'Hold’em tables' },
    drill: { to: '/practice/showdown', label: 'Who wins? drill' },
  },
  {
    key: 'craps',
    name: 'Craps',
    icon: 'craps',
    blurb: 'The come-out roll, the point, pass and don’t pass, odds, and the other bets.',
    minutes: 6,
    steps: CRAPS,
    play: { to: '/lobby?game=craps', label: 'Craps tables' },
    drill: { to: '/practice/craps', label: 'Craps bets drill' },
  },
  {
    key: 'roulette',
    name: 'Roulette',
    icon: 'roulette',
    blurb: 'The wheel, inside and outside bets, what each pays, and the zero.',
    minutes: 4,
    steps: ROULETTE,
    play: { to: '/lobby?game=roulette', label: 'Roulette tables' },
    drill: { to: '/practice/roulette', label: 'Payouts drill' },
  },
  {
    key: 'baccarat',
    name: 'Baccarat',
    icon: 'baccarat',
    blurb: 'Player, Banker and Tie, how hands are counted, and which bet is best.',
    minutes: 3,
    steps: BACCARAT,
    play: { to: '/play/baccarat', label: 'Baccarat' },
    drill: { to: '/practice/baccarat', label: 'Third card drill' },
  },
  {
    key: 'video-poker',
    name: 'Video poker',
    icon: 'video_poker_jacks',
    blurb: 'What pays, what to hold, and the choices between a sure thing and a draw.',
    minutes: 4,
    steps: VIDEO_POKER,
    play: { to: '/play/video_poker_jacks', label: 'Jacks or Better' },
    drill: { to: '/practice/video-poker', label: 'Holds drill' },
  },
];
