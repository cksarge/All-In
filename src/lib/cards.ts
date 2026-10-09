/** Cards are numbers 0..51 from the server: rank = c % 13 (0 = Ace … 12 = King), suit = floor(c / 13). */
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;
export const SUITS = ['♠', '♥', '♦', '♣'] as const;
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const RANK_NAMES = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];

export function cardRank(c: number) {
  return RANKS[c % 13];
}
export function cardSuit(c: number) {
  return SUITS[Math.floor(c / 13) % 4];
}
export function isRed(c: number) {
  const s = Math.floor(c / 13) % 4;
  return s === 1 || s === 2;
}
export function cardName(c: number) {
  return `${RANK_NAMES[c % 13]} of ${SUIT_NAMES[Math.floor(c / 13) % 4]}`;
}
