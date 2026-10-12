import { useEffect, useState } from 'react';
import { CardFan } from '@/components/cards/PlayingCard';
import { InfoModal, TabButtons } from '@/components/table/InfoModal';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { formatChips, formatRelativeTime } from '@/lib/format';
import { HAND_RANKINGS, parseCard, POKER_GAMES, type PkConfig, type PkHistoryHand, type PkStakes } from '@/lib/poker';
import { supabase } from '@/lib/supabase';

type Tab = 'play' | 'hands' | 'betting';

const HOW_TO: Record<string, string[]> = {
  poker_holdem: [
    'Everyone gets two private hole cards. Five shared cards are dealt face up in the middle: three on the flop, one on the turn and one on the river.',
    'Make the best five-card hand from any mix of your two cards and the five on the board.',
    'There is a round of betting before the flop and after each new card. The two players to the left of the dealer button post the small and big blinds.',
    'No limit: you can bet or raise any amount from the minimum up to everything in front of you.',
  ],
  poker_omaha: [
    'Everyone gets four hole cards. Five shared cards come out as in Hold’em: flop, turn and river.',
    'Your hand must use exactly two of your hole cards and exactly three from the board. Four hearts in your hand and one on the board is not a flush.',
    'Pot limit: the most you can raise is the size of the pot after you call.',
  ],
  poker_omaha_hilo: [
    'Played like Omaha (four hole cards, use exactly two plus three from the board), but the pot is split between the best high hand and the best low hand.',
    'A low hand is five different cards of 8 or lower. Aces count low, and straights and flushes don’t hurt a low, so A-2-3-4-5 (the wheel) is the best low.',
    'You can use different hole cards for your high and your low. If nobody makes a qualifying low, the best high hand wins the whole pot.',
    'Pot limit, like Omaha.',
  ],
  poker_stud: [
    'No shared cards and no blinds. Everyone puts in a small ante, then gets two cards face down and one face up (third street).',
    'The lowest card showing must bring it in with a small forced bet. Others can call it, or complete to a full small bet.',
    'Fourth, fifth and sixth streets are dealt face up; seventh street comes face down. Make the best five-card hand from your seven cards.',
    'From fourth street on, the best hand showing acts first.',
    'Fixed limit: bets and raises are one small bet on third and fourth streets and one big bet after that, with up to four bets a round.',
  ],
  poker_shortdeck: [
    'Hold’em with a 36-card deck: the 2s, 3s, 4s and 5s are taken out. Two hole cards, five shared cards, the same betting rounds.',
    'With fewer cards, flushes are harder to make than full houses, so here a flush BEATS a full house.',
    'The ace still plays low to make the smallest straight, which is A-6-7-8-9.',
    'Everything else ranks as usual. No limit betting.',
  ],
  poker_razz: [
    'Seven-card stud turned upside down: the LOWEST five-card hand wins the whole pot.',
    'Aces are low, and straights and flushes don’t count, so the best possible hand is 5-4-3-2-A. Any hand without a pair beats any hand with one.',
    'Hands are compared from their highest card down: 7-6-5-3-2 beats 8-4-3-2-A.',
    'The highest card showing brings it in. From fourth street on, the lowest hand showing acts first.',
    'Fixed limit, with antes, like Seven-Card Stud.',
  ],
  poker_27: [
    'Lowball draw: the WORST ordinary poker hand wins. Everyone gets five private cards.',
    'Aces are always high, and straights and flushes count against you. So the best hand is 7-5-4-3-2 in mixed suits, and A-2-3-4-5 is just an ace-high hand.',
    'There are four betting rounds with a draw between each: three chances to swap any number of your cards.',
    'Fixed limit: bets are the size of the big blind in the first two rounds and twice that in the last two.',
  ],
  poker_badugi: [
    'Everyone gets four private cards. You want four LOW cards of four DIFFERENT suits with no pair: that is a badugi.',
    'Aces are low, so the best hand is A-2-3-4 with one card of each suit.',
    'Cards that share a suit or a rank don’t all count: only one of them does. Any four-card badugi beats any three-card hand, which beats any two-card hand.',
    'Among hands with the same number of cards, compare from the highest card down: 6-4-3-A beats 7-3-2-A.',
    'Three draws, with a betting round before the first and after each. Fixed limit.',
  ],
  poker_draw: [
    'Everyone gets five private cards. After a round of betting, each player still in can swap up to five cards for new ones, once.',
    'Then there is a second round of betting and the best five-card hand wins.',
    'Blinds are posted as in Hold’em. No limit betting.',
  ],
};

export function PokerRulesModal({
  open,
  onClose,
  game,
  config,
  stakes,
}: {
  open: boolean;
  onClose: () => void;
  game: string;
  config: PkConfig;
  stakes: PkStakes;
}) {
  const [tab, setTab] = useState<Tab>('play');
  const info = POKER_GAMES[game];
  return (
    <InfoModal open={open} onClose={onClose} title={info?.short ?? 'Poker'}>
      <TabButtons
        tabs={[
          ['play', 'How to play'],
          ['hands', 'Hand rankings'],
          ['betting', 'Betting and timers'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'play' && (
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-cream/85">
          {(HOW_TO[game] ?? []).map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      )}
      {tab === 'hands' && (
        <ol className="mt-4 space-y-3">
          {HAND_RANKINGS.map((h, i) => (
            <li key={h.name} className="flex items-center gap-3">
              <span className="w-5 text-right text-xs text-muted">{i + 1}</span>
              <CardFan cards={h.example.split(' ').map(parseCard)} size="xs" overlap="-ml-2" still />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ivory">{h.name}</p>
                <p className="text-xs text-cream/70">{h.text}</p>
              </div>
            </li>
          ))}
          {config.hilo && (
            <li className="rounded-xl border border-white/10 p-3 text-xs text-cream/80">
              <strong className="text-ivory">Low hands (Hi-Lo):</strong> five different cards 8 or lower, compared from the highest card down.
              7-5-4-3-2 beats 8-4-3-2-A. The best is 5-4-3-2-A.
            </li>
          )}
        </ol>
      )}
      {tab === 'betting' && (
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-cream/85">
          <li>
            {config.family === 'stud'
              ? `Ante ${formatChips(stakes.ante ?? 0)}, bring-in ${formatChips(stakes.bring_in ?? 0)}, small bet ${formatChips(stakes.small_bet ?? 0)}, big bet ${formatChips(stakes.big_bet ?? 0)}.`
              : `Blinds ${formatChips(stakes.small_blind ?? 0)}/${formatChips(stakes.big_blind ?? 0)}${stakes.ante ? `, ante ${formatChips(stakes.ante)}` : ''}. The dealer button moves one seat after every hand.`}
          </li>
          <li>
            Bring {formatChips(stakes.min_stack)} to {formatChips(stakes.max_stack)} chips to sit in. Top up between hands any time; chips go back to your
            wallet when you leave.
          </li>
          <li>
            A raise must be at least as big as the last bet or raise. An all-in for less than that doesn’t let players who already acted raise again.
          </li>
          <li>
            If you’re all in, you can only win the chips you matched (the main pot). Extra bets between other players go into side pots. Ties split the
            pot; an odd chip goes to the first winner left of the button.
          </li>
          <li>
            You have {config.turn_seconds} seconds to act. If time runs out you check when you can, otherwise fold, and you’re sat out until you press
            “I’m back”. If you disconnect, the same happens straight away.
          </li>
          <li>Cards are shuffled and dealt on the server. Nobody, including other players, can see your hole cards until a showdown.</li>
        </ul>
      )}
    </InfoModal>
  );
}

/** Your recent hands at this table, with what was shown at showdown. */
export function PokerHistoryModal({ open, onClose, tableId }: { open: boolean; onClose: () => void; tableId: string }) {
  const [hands, setHands] = useState<PkHistoryHand[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('pk_hand_history', { p_table: tableId, p_limit: 20 });
    if (err) setError(friendlyError(err));
    else setHands((data ?? []) as PkHistoryHand[]);
  };
  useEffect(() => {
    if (open) void load();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <InfoModal open={open} onClose={onClose} title="Hand history">
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : hands === null ? (
        <LoadingState label="Loading hands…" />
      ) : hands.length === 0 ? (
        <EmptyState title="No hands yet" message="Hands you play at this table show up here." />
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.06]">
          {hands.map((h) => {
            const net = h.my_won - h.my_committed;
            return (
              <li key={h.hand_no} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ivory">
                    Hand #{h.hand_no}
                    <span className="ml-2 text-xs font-normal text-muted">{formatRelativeTime(h.played_at)}</span>
                  </p>
                  <ChipAmount
                    value={net}
                    signed
                    className={cn('text-sm font-semibold', net > 0 ? 'text-felt-300' : net < 0 ? 'text-ruby-300' : 'text-cream')}
                    iconClassName="h-4 w-4"
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4">
                  {h.my_cards && (
                    <div>
                      <p className="mb-1 text-[0.65rem] uppercase tracking-wider text-muted">You</p>
                      <CardFan cards={h.my_cards} size="xs" overlap="-ml-2" still />
                    </div>
                  )}
                  {h.board.length > 0 && (
                    <div>
                      <p className="mb-1 text-[0.65rem] uppercase tracking-wider text-muted">Board</p>
                      <CardFan cards={h.board} size="xs" overlap="-ml-1" still />
                    </div>
                  )}
                </div>
                <ul className="mt-2 space-y-1 text-xs text-cream/80">
                  {h.players
                    .filter((p) => p.won > 0 || p.shown_cards)
                    .map((p) => (
                      <li key={p.seat_no} className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ivory">{p.username}</span>
                        {p.shown_cards && <CardFan cards={p.shown_cards} size="xs" overlap="-ml-3" still />}
                        {p.hand_name && <span>{p.hand_name}</span>}
                        {p.low_name && <span className="text-cream/60">· {p.low_name}</span>}
                        {p.won > 0 && (
                          <span className="text-gold-200">
                            won <ChipAmount value={p.won} iconClassName="h-3 w-3" />
                          </span>
                        )}
                      </li>
                    ))}
                  {h.my_status === 'folded' && <li className="text-cream/55">You folded.</li>}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </InfoModal>
  );
}
