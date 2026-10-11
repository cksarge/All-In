/** First-visit guides: a few plain steps per game. The full rules stay behind each game's Rules button. */
export interface QuickStartGuide {
  title: string;
  steps: string[];
}

const SLOT: QuickStartGuide = {
  title: 'How this machine works',
  steps: [
    'Pick your bet with − and +, then press Spin.',
    'Wins are worked out by the server and played back on the reels. Skip jumps to the end.',
    'Open Rules for the paytable and the features of this machine.',
  ],
};

const POKER_TABLE = [
  'Bring chips from your wallet to the table. They go back to your wallet when you leave.',
  'On your turn you have 20 seconds: fold, check or call, or bet and raise.',
  'The best five-card hand at showdown wins the pot. Rules has the hand rankings.',
];

const GUIDES: Record<string, QuickStartGuide> = {
  blackjack: {
    title: 'Blackjack in a minute',
    steps: [
      'Place a bet before the timer runs out. Everyone at the table plays against the dealer.',
      'Get closer to 21 than the dealer without going over. Face cards are 10, an ace is 1 or 11.',
      'Hit takes a card, Stand keeps your hand, Double doubles your bet for exactly one more card.',
      'An ace with a ten-value card on the deal is blackjack and pays 3 to 2.',
    ],
  },
  roulette: {
    title: 'Roulette in a minute',
    steps: [
      'Choose a chip, then tap the layout to place bets while betting is open.',
      'A single number pays 35 to 1. Red or black, odd or even and high or low pay 1 to 1.',
      'Tap the line between numbers to cover two or four of them with one chip.',
      'When the timer ends the wheel spins, and every bet covering the number wins.',
    ],
  },
  craps: {
    title: 'Craps, step by step',
    steps: [
      'Start simple: put a chip on the Pass Line. That is a bet with the shooter.',
      'The first roll is the come-out roll. A 7 or 11 wins the Pass Line at once; 2, 3 or 12 loses.',
      'Any other number (4, 5, 6, 8, 9, 10) becomes the point. The puck turns ON and sits on it.',
      'Now the shooter keeps rolling. If the point comes up again before a 7, the Pass Line wins. A 7 first loses.',
      'Once there is a point you can add Odds behind your Pass Line bet. Odds pay the true odds, with no house edge.',
      'Everything else (Field, Place, Hardways, the centre bets) is optional. Rules explains each one.',
    ],
  },
  poker_holdem: { title: "Texas Hold'em in a minute", steps: ['You get two cards of your own. Five shared cards come in three steps: the flop, the turn and the river.', ...POKER_TABLE] },
  poker_omaha: { title: 'Omaha in a minute', steps: ['You get four cards and must use exactly two of them with exactly three from the board.', 'Pot limit: the most you can bet is the size of the pot.', ...POKER_TABLE.slice(0, 2)] },
  poker_omaha_hilo: { title: 'Omaha Hi-Lo in a minute', steps: ['Omaha, but the pot is split: half to the best high hand and half to the best low hand (five different cards of 8 or lower).', 'Use exactly two of your four cards for each. You may use different pairs for high and low.', ...POKER_TABLE.slice(0, 2)] },
  poker_stud: { title: 'Seven-Card Stud in a minute', steps: ['There is no shared board. Everyone gets seven cards of their own: three face down, four face up.', 'Everyone posts an ante. The lowest up card starts with a small forced bet called the bring-in.', 'Bets are fixed sizes: small on the first two rounds, big after that.', 'Make the best five-card hand from your seven.'] },
  poker_draw: { title: 'Five-Card Draw in a minute', steps: ['Everyone gets five cards face down, then there is a round of betting.', 'Then you may swap any of your cards for new ones, once.', 'One more round of betting, and the best hand wins.'] },
  baccarat: { title: 'Baccarat in a minute', steps: ['Bet on Player, Banker or a Tie. You are guessing which hand ends closer to 9.', 'Tens and faces count 0, and only the last digit of a total counts (7 + 8 = 5).', 'The cards are drawn by fixed rules. You make no decisions after betting.', 'Banker wins pay 1 to 1 less a 5% commission.'] },
  three_card_poker: { title: 'Three Card Poker in a minute', steps: ['Place an Ante. Pair Plus is an optional side bet on your own three cards.', 'Look at your cards, then Play (a second bet the size of the Ante) or Fold.', 'The dealer needs queen-high or better to qualify. If not, your Ante is paid and Play is returned.', 'With three cards a straight beats a flush.'] },
  pai_gow_poker: { title: 'Pai Gow Poker in a minute', steps: ['You get seven cards and split them into a five-card hand and a two-card hand.', 'The five-card hand must be the stronger of the two. "House way" sets them for you.', 'Win both hands to win, lose both to lose. One each is a push and your bet comes back.', 'The joker completes a straight or flush, otherwise it is an ace.'] },
  ultimate_holdem: { title: "Ultimate Texas Hold'em in a minute", steps: ['Bet the Ante and the Blind (equal amounts). You and the dealer each get two cards.', 'You can raise once: 4× before the flop, 2× after it, or 1× at the end. The earlier you raise, the more you can bet.', 'If you never raise you must fold at the end.', 'The dealer needs a pair or better to qualify.'] },
  casino_war: { title: 'Casino War in a minute', steps: ['One card each. The higher card wins, aces are high.', 'On a tie, go to War (double your bet) or surrender half of it.', 'The Tie side bet pays 10 to 1.'] },
  dragon_tiger: { title: 'Dragon Tiger in a minute', steps: ['One card to the Dragon, one to the Tiger. Bet on which is higher.', 'Aces are low here. A tie loses half of a Dragon or Tiger bet.', 'The Tie bet pays 11 to 1.'] },
  sic_bo: { title: 'Sic Bo in a minute', steps: ['Three dice are rolled. Bet on what they will show.', 'Small (4 to 10) and Big (11 to 17) pay 1 to 1, but lose to any triple.', 'Totals, pairs and triples pay more. Each spot shows what it pays.'] },
  money_wheel: { title: 'Big Six in a minute', steps: ['Bet on the symbol the wheel will stop on.', 'The number is the payout: 1 pays 1 to 1, 20 pays 20 to 1.', 'The rarer the symbol, the more it pays.'] },
  video_poker_jacks: { title: 'Video poker in a minute', steps: ['Press Deal for five cards.', 'Tap the cards you want to keep, then Draw to replace the rest.', 'You are paid from the table for your final hand. A pair of jacks or better returns your bet.'] },
  video_poker_deuces: { title: 'Deuces Wild in a minute', steps: ['Press Deal for five cards. Every 2 is wild.', 'Tap the cards you want to keep, then Draw to replace the rest.', 'Wilds make hands easier, so the lowest paying hand is three of a kind.'] },
  keno: { title: 'Keno in a minute', steps: ['Pick up to 10 numbers out of 80.', 'Twenty numbers are drawn. The more of yours that hit, the more you win.', 'The table shows the prize for every number of hits before you play.'] },
  plinko: { title: 'Plinko in a minute', steps: ['Choose the rows and the risk, then drop a ball.', 'Each peg knocks it left or right. Where it lands sets the multiple of your bet.', 'Higher risk means bigger prizes at the edges and smaller ones in the middle.'] },
  mines: { title: 'Mines in a minute', steps: ['Choose how many mines are hidden, then start.', 'Every safe tile you turn over raises your prize.', 'Press Collect to take it at any time. Hit a mine and the round is lost.'] },
  scratch_cards: { title: 'Scratch cards in a minute', steps: ['Choose a card. Each has its own price and top prize.', 'Scratch the panels, or reveal them all at once.', 'Match three of the same symbol to win its prize.'] },
  power_draw: { title: 'Power Draw in a minute', steps: ['Pick five numbers and one power ball, or use Quick pick.', 'Six balls are drawn. Prizes depend on how many of yours match.', 'Matching the power ball lifts every prize.'] },
  crash: { title: 'Crash in a minute', steps: ['Everyone plays the same round. Place your bet before it starts.', 'The multiplier climbs from ×1 until it crashes at a random moment.', 'Press Collect before the crash to win your bet times the multiplier. Wait too long and it is lost.'] },
  bingo: { title: 'Bingo in a minute', steps: ['Get up to four cards before the round starts.', 'Balls are called one at a time and your cards are marked for you.', 'Complete a line to win. The fewer calls it takes, the bigger the prize.'] },
  tournaments: {
    title: 'Tournaments in a minute',
    steps: [
      'Sit & Go: take a seat, and a knockout poker game starts the moment the table is full. Last player standing wins.',
      'Slot Showdown: everyone gets the same number of spins. The best score when the clock runs out takes the pot.',
      'Daily Freeroll: free to enter once a day, with prizes from the house.',
      'Tournament chips and points are only a score. Only your entry is ever at stake.',
    ],
  },
};

export function quickStartFor(key: string): QuickStartGuide | null {
  if (key.startsWith('slots_')) return SLOT;
  return GUIDES[key] ?? null;
}
