/**
 * Quick chat. There is no typed chat anywhere on the site: players pick from these.
 *
 * A phrase travels as its POSITION in `PHRASES`, so this list is append-only:
 * add new phrases at the end, never reorder or delete. The menus below are just
 * views of it (a phrase is looked up by its text), so those can be rearranged freely.
 */
export const PHRASES = [
  // The original eight (positions 0 to 7).
  'Good luck!', 'Nice hand!', 'Well played', 'Unlucky!', 'Thanks!', 'Wow!', 'Hit me!', 'Be right back',
  // Hello and goodbye
  'Hello!', 'Hi everyone', 'Have fun!', 'Welcome!', 'Good game', "You're welcome", 'Goodbye!', 'See you next time', "I'm back",
  'One more round', 'Last hand for me', 'Good morning', 'Good evening', 'Good night',
  // Reactions
  'So close!', 'What a card!', 'No way!', 'Ouch', 'Lucky!', 'I knew it', 'Great call', 'Nice one', 'Brutal', 'Here we go',
  "Let's go!", 'Fingers crossed', 'My bad', 'Oops', 'Good idea', 'Take your time', 'No rush', 'Your turn!', 'Sorry, slow connection',
  'Congratulations!', 'Nice win!', 'Yes!', 'No', 'Maybe', 'Ha ha', 'Unbelievable',
  // Table talk
  "I'm on a roll", "I'm due a win", 'The table is hot', 'The table is cold', 'Feeling lucky', 'Not my night', "Can't catch a break",
  'That was fun', "Who's winning?", 'Nice table', 'Anyone else nervous?', 'All in!', 'Playing it safe', 'Going big this time',
  // Blackjack
  "I'll stand", 'Doubling down', 'Splitting these', "Dealer's going to bust", 'Come on, bust!', 'Blackjack!', 'Give me a ten',
  'Show me an ace', 'Twenty-one!', 'Dealer always has it', 'Should I hit?', 'No insurance for me', 'Nice double', 'Dealer has twenty, I bet',
  // Roulette
  'Red!', 'Black!', 'Come on, green', 'Always bet on black', "My number's coming", 'So close to my number', 'Zero again?!',
  'Spreading my chips', 'All on one number', 'Let it spin', 'No more bets', 'Lucky seven', 'Odd or even?', 'That was my number last spin',
  // Craps
  'Come on, seven!', 'No seven!', 'Hot shooter!', 'Nice roll!', 'New shooter', 'Hit the point', 'Pass line all day', 'Hard way!',
  'Yo eleven!', 'Snake eyes', 'Boxcars', 'Blow on the dice', 'Roll them!', 'Press it', 'Keep rolling', 'Seven out',
  // Poker
  'I call', 'I raise', 'I fold', 'Check', 'Nice bluff', 'I had it', 'Show me', 'You had me beat', 'Good fold', 'Tough spot',
  'On a draw', 'Need one card', 'Rivered!', 'Nice read', 'Thinking...', "That's a big bet", 'Good laydown', 'Bad beat', 'Was that a bluff?',
  'I never bluff', 'Pot odds', 'Nice river',
  // Tournaments
  'Blinds are going up', 'Final table!', 'Heads-up', 'Good run', 'Short stack here', 'Chip leader', 'Good luck at the final table',
  // Clubs
  'Does anyone want to play a tournament?', 'Sit & Go, anyone?', "Who's up for the Main Event?", "Let's all enter the Daily Freeroll",
  'Slot Showdown in a few minutes', 'Who wants to play poker?', 'Blackjack table, anyone?', 'Roulette, anyone?', 'Craps, anyone?',
  'Join my table', "I'll invite you", 'Send me an invite', 'Anyone online?', "Who's on tonight?", 'Hello, club', 'Great week, everyone',
  "Let's climb the leaderboard", 'We are top of the board!', 'Welcome to the club!', 'Thanks for the invite', "I'm heading to the lobby",
  'Back later', 'Mission time', 'Almost done with the season', 'A new season is here!', 'Count me in', 'Not tonight', 'Maybe later',
  'Great idea', 'Same time tomorrow?', 'Starting in five minutes', 'Starting now', 'I need one more for a table', "I'm in a game, one moment",
] as const;

export type ChatContext = 'blackjack' | 'roulette' | 'craps' | 'poker' | 'club';
export interface PhraseGroup {
  key: string;
  label: string;
  /** Positions in PHRASES. */
  items: number[];
}

const at = (text: string) => (PHRASES as readonly string[]).indexOf(text);
const group = (key: string, label: string, texts: string[]): PhraseGroup => ({ key, label, items: texts.map(at).filter((i) => i >= 0) });

const HELLO = group('hello', 'Hello', ['Hello!', 'Hi everyone', 'Good luck!', 'Have fun!', 'Welcome!', 'Thanks!', "You're welcome", 'Good game', 'Good morning', 'Good evening', 'Be right back', "I'm back", 'One more round', 'Last hand for me', 'See you next time', 'Goodbye!', 'Good night']);
const REACT = group('react', 'Reactions', ['Nice hand!', 'Well played', 'Nice one', 'Nice win!', 'Congratulations!', 'Great call', 'Wow!', 'No way!', 'Unbelievable', 'What a card!', 'So close!', 'Unlucky!', 'Ouch', 'Brutal', 'Lucky!', 'I knew it', 'Ha ha', 'Here we go', "Let's go!", 'Fingers crossed', 'Yes!', 'No', 'Maybe', 'Good idea', 'My bad', 'Oops', 'Your turn!', 'Take your time', 'No rush', 'Sorry, slow connection']);
const TALK = group('talk', 'Table talk', ["I'm on a roll", "I'm due a win", 'The table is hot', 'The table is cold', 'Feeling lucky', 'Not my night', "Can't catch a break", 'That was fun', "Who's winning?", 'Nice table', 'Anyone else nervous?', 'All in!', 'Playing it safe', 'Going big this time']);
const GAME: Record<Exclude<ChatContext, 'club'>, PhraseGroup[]> = {
  blackjack: [group('game', 'Blackjack', ['Hit me!', "I'll stand", 'Doubling down', 'Splitting these', 'Blackjack!', 'Twenty-one!', 'Give me a ten', 'Show me an ace', 'Should I hit?', 'Nice double', "Dealer's going to bust", 'Come on, bust!', 'Dealer always has it', 'Dealer has twenty, I bet', 'No insurance for me'])],
  roulette: [group('game', 'Roulette', ['Red!', 'Black!', 'Come on, green', 'Always bet on black', 'Odd or even?', "My number's coming", 'So close to my number', 'That was my number last spin', 'Zero again?!', 'Spreading my chips', 'All on one number', 'Lucky seven', 'Let it spin', 'No more bets'])],
  craps: [group('game', 'Craps', ['Come on, seven!', 'No seven!', 'Hot shooter!', 'Nice roll!', 'Keep rolling', 'New shooter', 'Hit the point', 'Pass line all day', 'Hard way!', 'Yo eleven!', 'Snake eyes', 'Boxcars', 'Blow on the dice', 'Roll them!', 'Press it', 'Seven out'])],
  poker: [
    group('game', 'Poker', ['I call', 'I raise', 'I fold', 'Check', 'All in!', 'Thinking...', 'Nice bluff', 'Was that a bluff?', 'I never bluff', 'I had it', 'Show me', 'You had me beat', 'Good fold', 'Good laydown', 'Nice read', 'Tough spot', "That's a big bet", 'Pot odds', 'On a draw', 'Need one card', 'Rivered!', 'Nice river', 'Bad beat']),
    group('tourney', 'Tournament', ['Blinds are going up', 'Short stack here', 'Chip leader', 'Heads-up', 'Final table!', 'Good luck at the final table', 'Good run']),
  ],
};
const CLUB = [
  group('plans', 'Plans', ['Does anyone want to play a tournament?', 'Sit & Go, anyone?', "Who's up for the Main Event?", "Let's all enter the Daily Freeroll", 'Slot Showdown in a few minutes', 'Who wants to play poker?', 'Blackjack table, anyone?', 'Roulette, anyone?', 'Craps, anyone?', 'I need one more for a table', 'Join my table', "I'll invite you", 'Send me an invite', 'Starting in five minutes', 'Starting now', 'Same time tomorrow?', 'Count me in', 'Not tonight', 'Maybe later', "I'm in a game, one moment", "I'm heading to the lobby"]),
  group('club', 'Club', ['Hello, club', 'Anyone online?', "Who's on tonight?", 'Welcome to the club!', 'Thanks for the invite', 'Great week, everyone', "Let's climb the leaderboard", 'We are top of the board!', 'Mission time', 'Almost done with the season', 'A new season is here!', 'Great idea', 'Back later']),
];

/** The phrase menus for a place: its own first, then the ones that fit anywhere. */
export function phraseGroups(context: ChatContext): PhraseGroup[] {
  return context === 'club' ? [...CLUB, HELLO, REACT] : [...GAME[context], REACT, HELLO, TALK];
}
