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
  poker_shortdeck: { title: 'Short Deck in a minute', steps: ['Hold’em with no 2s, 3s, 4s or 5s in the deck.', 'A flush beats a full house here.', 'A-6-7-8-9 is the lowest straight.', ...POKER_TABLE.slice(0, 2)] },
  poker_razz: { title: 'Razz in a minute', steps: ['Seven cards each, like stud, but the LOWEST five-card hand wins.', 'Aces are low and straights and flushes don’t count: 5-4-3-2-A is the best hand.', 'Any hand without a pair beats any hand with one.', 'The highest up card starts the betting with a small forced bet.'] },
  poker_27: { title: '2-7 Triple Draw in a minute', steps: ['The worst ordinary poker hand wins: 7-5-4-3-2 is the best you can hold.', 'Aces are high, and straights and flushes count against you.', 'You get three draws to swap cards, with betting before the first and after each.', 'Bets are a fixed size.'] },
  poker_badugi: { title: 'Badugi in a minute', steps: ['Four cards each. Aim for four low cards of four different suits with no pair.', 'A-2-3-4 with one of each suit is the best hand.', 'Cards that share a suit or rank don’t all count. More counting cards always wins.', 'Three draws, with betting before the first and after each.'] },
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
  video_poker_bonus: { title: 'Bonus Poker in a minute', steps: ['Press Deal for five cards.', 'Tap the cards you want to keep, then Draw to replace the rest.', 'It plays like Jacks or Better, but four of a kind pays by rank: four aces most of all.'] },
  video_poker_double: { title: 'Double Bonus Poker in a minute', steps: ['Press Deal for five cards, keep what you like, then Draw.', 'Four aces pays 160 times your bet, and other fours pay more than usual.', 'To make up for it, two pair only returns your bet.'] },
  video_poker_joker: { title: 'Joker Poker in a minute', steps: ['Press Deal for five cards from a 53-card deck. The joker is wild.', 'Tap the cards you want to keep, then Draw to replace the rest.', 'The lowest paying hand is a pair of kings or aces.'] },
  caribbean_stud: { title: 'Caribbean Stud in a minute', steps: ['Place an Ante. You and the dealer each get five cards, with one of the dealer’s showing.', 'Fold, or Raise by twice your ante.', 'The dealer needs ace-king or better to play. If not, your ante wins and the raise comes back.', 'Beat a dealer who qualifies and the raise pays more the better your hand.'] },
  casino_holdem: { title: "Casino Hold'em in a minute", steps: ['Place an Ante. You get two cards and see the three-card flop.', 'Fold, or Call for twice your ante to see the last two cards.', 'Best five cards from your two and the board wins.', 'The dealer needs a pair of fours or better to play.'] },
  let_it_ride: { title: 'Let It Ride in a minute', steps: ['Three equal bets go down and you get three cards.', 'Twice you may take one bet back, or let it ride, before a shared card is turned.', 'Your three cards and the two shared ones make your hand.', 'Every bet left is paid for a pair of tens or better.'] },
  mississippi_stud: { title: 'Mississippi Stud in a minute', steps: ['Place an Ante and get two cards. Three shared cards are face down.', 'Before each one is turned, fold or bet 1, 2 or 3 times your ante.', 'A pair of jacks or better wins on every bet. Sixes to tens gets your bets back.', 'There is no dealer hand to beat.'] },
  four_card_poker: { title: 'Four Card Poker in a minute', steps: ['Place an Ante. You get five cards to make your best four-card hand.', 'Fold, or raise 1, 2 or 3 times your ante.', 'The dealer gets six cards, always plays, and loses ties to you.', 'With four cards, three of a kind beats a flush, and a flush beats a straight.'] },
  teen_patti: { title: 'Teen Patti in a minute', steps: ['Place an Ante. You and the dealer get three cards each.', 'Play (a second bet the size of your ante) or Fold.', 'Best to worst: trail (three of a kind), pure sequence, sequence, colour, pair, high card.', 'The dealer needs queen high or better to play.'] },
  spanish_21: { title: 'Spanish 21 in a minute', steps: ['Blackjack with the 10-spot cards taken out of the deck.', 'To make up for it, your 21 always wins and you can double on any number of cards.', '21s made with five or more cards, 6-7-8 or 7-7-7 pay a bonus.', 'You can surrender half your bet on your first two cards.'] },
  blackjack_switch: { title: 'Blackjack Switch in a minute', steps: ['You play two hands, so your bet goes down twice.', 'Before anything else you may Switch: the second cards of your two hands change places.', 'Blackjack pays even money here.', 'If the dealer ends on exactly 22, hands still standing push instead of winning.'] },
  free_bet_blackjack: { title: 'Free Bet Blackjack in a minute', steps: ['Blackjack where the house pays for some bets.', 'Doubling on a hard 9, 10 or 11 is free. So is splitting any pair except tens.', 'A free bet that wins is paid in full; one that loses costs you nothing extra.', 'If the dealer ends on exactly 22, hands still standing push instead of winning.'] },
  pontoon: { title: 'Pontoon in a minute', steps: ['Twist takes a card, Stick stands, Double adds a second bet for one more card.', 'Both dealer cards stay face down until you finish.', 'You can’t stick below 15, and the dealer wins ties.', 'A pontoon (ace and a ten) or five cards without going over 21 pays 2 to 1.'] },
  red_dog: { title: 'Red Dog in a minute', steps: ['Two cards are dealt. Will the third fall between them?', 'The closer together they are, the more a win pays.', 'Before the third card you can raise by doubling your bet.', 'Cards next to each other return your bet. A pair pays 11 to 1 if the third matches.'] },
  hi_lo: { title: 'Hi-Lo in a minute', steps: ['A card is turned. Guess whether the next is higher or lower.', 'Each right guess multiplies your prize. Riskier guesses multiply more.', 'Collect after any right guess, or keep going.', 'One wrong guess loses the bet. Aces are high, and the same rank loses.'] },
  andar_bahar: { title: 'Andar Bahar in a minute', steps: ['One card is turned face up: the joker.', 'Bet on Andar or Bahar.', 'Cards are dealt to each side in turn until one matches the joker’s rank. That side wins.', 'Andar gets the first card, so it pays a little less.'] },
  chuck_a_luck: { title: 'Chuck-a-Luck in a minute', steps: ['Three dice are rolled in a cage.', 'Bet on a number: it pays more the more dice show it.', 'Or bet on High, Low, the Field or any triple.', 'High and Low both lose when all three dice match.'] },
  keno: { title: 'Keno in a minute', steps: ['Pick up to 10 numbers out of 80.', 'Twenty numbers are drawn. The more of yours that hit, the more you win.', 'The table shows the prize for every number of hits before you play.'] },
  plinko: { title: 'Plinko in a minute', steps: ['Choose the rows and the risk, then drop a ball.', 'Each peg knocks it left or right. Where it lands sets the multiple of your bet.', 'Higher risk means bigger prizes at the edges and smaller ones in the middle.'] },
  mines: { title: 'Mines in a minute', steps: ['Choose how many mines are hidden, then start.', 'Every safe tile you turn over raises your prize.', 'Press Collect to take it at any time. Hit a mine and the round is lost.'] },
  scratch_cards: { title: 'Scratch cards in a minute', steps: ['Choose a card. Each has its own price and top prize.', 'Scratch the panels, or reveal them all at once.', 'Match three of the same symbol to win its prize.'] },
  power_draw: { title: 'Power Draw in a minute', steps: ['Pick five numbers and one power ball, or use Quick pick.', 'Six balls are drawn. Prizes depend on how many of yours match.', 'Matching the power ball lifts every prize.'] },
  horse_racing: { title: 'Horse racing in a minute', steps: ['Everyone watches the same race. You have 25 seconds to bet before it starts.', 'Tap Win next to a horse (it must come first) or Place (first or second, for a smaller price).', 'The price is what comes back per chip: 3.00× on 100 returns 300. Winnings are paid when the race ends.'] },
  teen_patti_live: { title: 'Teen Patti in a minute', steps: ['Everyone posts the boot and gets three cards face down. A trail (three of a kind) is the best hand.', 'You play blind until you press See cards. Blind players bet half of what seen players do.', 'On your turn: bet to stay in, raise to double the stake, or pack. With two players left, either can pay for a show.'] },
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
