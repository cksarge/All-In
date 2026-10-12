import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CardFan } from '@/components/cards/PlayingCard';
import { ChipBurst } from '@/components/economy/ChipBurst';
import { BringChipsModal } from '@/components/poker/BringChipsModal';
import { PokerSeat } from '@/components/poker/PokerSeat';
import { InfoModal } from '@/components/table/InfoModal';
import { PhaseBar } from '@/components/table/PhaseBar';
import { ReactionBar } from '@/components/table/ReactionBar';
import { TableHeader } from '@/components/table/TableHeader';
import { useSecondsLeft } from '@/components/table/TimerRing';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { EmptyState, ErrorState, FullPageLoader, LoadingState } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { useLiveTable, type LiveSeat, type LiveTableState } from '@/hooks/useLiveTable';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useNow } from '@/hooks/useNow';
import { friendlyError } from '@/lib/errors';
import { formatChips, formatRelativeTime } from '@/lib/format';
import { parseCard, seatLayout, type PkConfig, type PkHand, type PkPlayer, type PkStakes } from '@/lib/poker';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import type { TierKey } from '@/lib/types';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface TpConfig {
  turn_seconds: number;
  next_hand_seconds: number;
  showdown_seconds: number;
  /** The stake can rise to this many boots. */
  max_stake: number;
  /** At this many boots in the pot, everyone still in shows. */
  pot_limit: number;
}
interface TpHand {
  id: string;
  hand_no: number;
  phase: 'betting' | 'settled';
  phase_ends_at: string | null;
  button_seat: number | null;
  turn_seat: number | null;
  boot: number;
  /** What a blind player puts in to stay; a seen player puts in twice this. */
  stake: number;
  pot: number;
  pot_limit: number;
  showdown: boolean;
  winners: { seat_no: number; amount: number; hand: string | null }[] | null;
}
interface TpPlayer {
  seat_no: number;
  user_id: string;
  username: string;
  status: 'active' | 'folded';
  seen: boolean;
  committed: number;
  last_bet: number;
  last_action: string | null;
  card_count: number;
  shown_cards: number[] | null;
  hand_name: string | null;
  won: number;
}
interface TpOptions {
  bet: number;
  raise: number | null;
  show_cost: number;
  can_bet: boolean;
  can_raise: boolean;
  can_show: boolean;
  /** Not enough chips to cover a bet: only a show or a pack is left. */
  short: boolean;
}
interface TpState extends LiveTableState {
  config: TpConfig;
  table: {
    id: string;
    name: string;
    game_key: string;
    tier: TierKey;
    tier_label: string;
    max_seats: number;
    is_private: boolean;
    status: string;
    invite_code: string | null;
    stakes: PkStakes & { boot: number };
  };
  seats: (LiveSeat & { stack: number })[];
  hand: TpHand | null;
  players: TpPlayer[];
  me: {
    stack: number;
    in_hand: boolean;
    seat_no: number | null;
    seen: boolean;
    can_see: boolean;
    hole: number[] | null;
    hand_name: string | null;
    options: TpOptions | null;
  } | null;
}
type TpAction = 'see' | 'pack' | 'bet' | 'raise' | 'show';

export function TeenPattiTable({ tableId }: { tableId: string }) {
  const navigate = useNavigate();
  const t = useLiveTable<TpState>({
    tableId,
    stateFn: 'tpt_state',
    advanceFn: 'tpt_advance',
    realtimeTables: ['tpt_hands', 'tpt_players'],
    getDeadline: (s) => ({ at: s.hand?.phase_ends_at, advance: Boolean(s.hand) }),
  });
  const { state, error, offsetMs, mySeat, userId } = t;
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const compact = useMediaQuery('(max-width: 639px)');
  const now = useNow(500, offsetMs);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bringOpen, setBringOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);

  const hand = state?.hand ?? null;
  // A finished hand stays on the felt for its results pause (plus a moment for the next deal).
  const stale = hand?.phase === 'settled' && hand.phase_ends_at !== null && now > new Date(hand.phase_ends_at).getTime() + 3000;
  const viewHand = stale ? null : hand;
  const players = useMemo(() => (viewHand ? state?.players ?? [] : []), [viewHand, state?.players]);
  const me = state?.me ?? null;
  const myPlayer = players.find((p) => p.user_id === userId);
  const options = viewHand?.phase === 'betting' && viewHand.turn_seat === myPlayer?.seat_no ? me?.options ?? null : null;
  const secondsLeft = useSecondsLeft(viewHand?.phase_ends_at, offsetMs);

  const run = async (key: string, fn: () => Promise<string | null>, sound: 'chip' | 'card' | 'click' = 'click') => {
    if (busy) return false;
    setBusy(key);
    const err = await fn();
    setBusy(null);
    if (err) {
      playSound('error');
      toast.error(err);
    } else {
      playSound(sound);
    }
    void useWallet.getState().fetchStatus();
    return !err;
  };
  // "Sit out next hand": finish the hand you are in, then sit out by yourself.
  const [outNext, setOutNext] = useState(false);
  const handOver = !hand || hand.phase === 'settled';
  useEffect(() => {
    if (!outNext || !handOver || !mySeat || mySeat.status === 'sitting_out') return;
    setOutNext(false);
    void t.sitOut(true).then((err) => (err ? toast.error(err) : toast.info('You are sitting out', 'Press "I\'m back" when you want to be dealt in again.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outNext, handOver, mySeat?.status]);

  const act = (a: TpAction) => void run(a, () => t.call('tpt_action', { p_action: a }), a === 'see' ? 'card' : a === 'pack' ? 'click' : 'chip');

  // Seated with nothing in front of you: offer to bring chips (once per visit).
  const prompted = useRef(false);
  const needsChips = Boolean(mySeat && me && me.stack === 0 && !me.in_hand);
  useEffect(() => {
    if (needsChips && !prompted.current) {
      prompted.current = true;
      setBringOpen(true);
    }
  }, [needsChips]);

  // ---- Sounds and celebrations ------------------------------------------------
  const potTotal = viewHand?.pot ?? 0;
  const prevPot = useRef(potTotal);
  useEffect(() => {
    if (potTotal > prevPot.current) playSound('chip');
    prevPot.current = potTotal;
  }, [potTotal]);
  const handId = viewHand?.id;
  useEffect(() => {
    if (handId) playSound('card');
  }, [handId]);
  const myTurnKey = options ? `${viewHand?.id}-${viewHand?.pot}` : null;
  useEffect(() => {
    if (myTurnKey) playSound('turn');
  }, [myTurnKey]);
  useEffect(() => {
    if (myTurnKey && secondsLeft !== null && secondsLeft > 0 && secondsLeft <= 5) playSound('tick');
  }, [myTurnKey, secondsLeft]);
  const celebrated = useRef<string | null>(null);
  useEffect(() => {
    if (!hand || hand.phase !== 'settled' || celebrated.current === hand.id || !myPlayer) return;
    celebrated.current = hand.id;
    void useWallet.getState().fetchStatus();
    if (myPlayer.won > myPlayer.committed) {
      playSound('win');
      setBurst((b) => b + 1);
    } else if (hand.showdown && myPlayer.status !== 'folded') {
      playSound('lose');
    }
  }, [hand, myPlayer]);

  if (error && !state) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Couldn't open this table" message={error} />
          <div className="flex justify-center pb-6">
            <Button variant="outline" size="sm" onClick={() => navigate('/lobby')}>
              Back to the lobby
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!state) return <FullPageLoader label="Taking you to the table…" />;

  const { table, config } = state;
  const stakes = table.stakes;
  const seatsByNo = new Map(state.seats.map((s) => [s.seat_no, s]));
  const playersBySeat = new Map(players.map((p) => [p.seat_no, p]));
  const reactionsByUser = new Map(t.reactions.map((r) => [r.user_id, r]));
  const layout = seatLayout(table.max_seats, mySeat?.seat_no ?? 1);
  const status = statusLine(state, viewHand, userId);
  const sittingOut = mySeat?.status === 'sitting_out';
  const canTopUp = Boolean(mySeat && me && !me.in_hand && me.stack < stakes.max_stack);
  const phaseSeconds = viewHand?.phase === 'settled' ? (viewHand.showdown ? config.showdown_seconds : config.next_hand_seconds) : config.turn_seconds;
  // PokerSeat draws the seats: it only needs these few fields of a poker hand and config.
  const seatHand = viewHand ? ({ id: viewHand.id, phase: viewHand.phase, turn_seat: viewHand.turn_seat, phase_ends_at: viewHand.phase_ends_at } as unknown as PkHand) : null;
  const seatConfig = { family: 'draw', turn_seconds: config.turn_seconds } as unknown as PkConfig;

  const leaveTable = async () => {
    if (mySeat) {
      const err = await t.leave();
      if (err) return void toast.error(err);
      void useWallet.getState().fetchStatus();
    }
    navigate(`/lobby?game=${table.game_key}`);
  };
  const toggleSitOut = () =>
    void run('sitout', async () => {
      const err = await t.sitOut(!sittingOut);
      if (!err && sittingOut) return t.call('tpt_advance'); // back in: deal if a hand is due
      return err;
    });

  return (
    <div className="mx-auto max-w-6xl px-3 pb-44 pt-4 sm:px-4 sm:pb-10">
      <TableHeader
        table={{ ...table, min_bet: 0, max_bet: 0, variant: 'Blind or seen' }}
        stakes={`Boot ${formatChips(stakes.boot)}`}
        game={table.game_key}
        atStake={viewHand && viewHand.phase !== 'settled' && myPlayer && myPlayer.status !== 'folded' ? 'You are in this hand. Leaving packs it, and the chips you have put in stay in the pot.' : null}
        watchers={t.watchers}
        connected={t.connected}
        mySeat={mySeat}
        onLeave={() => void leaveTable()}
        onRules={() => setRulesOpen(true)}
        onHistory={() => setHistoryOpen(true)}
        onSitOut={toggleSitOut}
        extra={
          canTopUp && (
            <Button size="sm" variant="ghost" onClick={() => setBringOpen(true)}>
              {me?.stack === 0 ? 'Bring chips' : 'Top up'}
            </Button>
          )
        }
      />

      {/* Felt */}
      <section aria-label="Teen Patti table" className="relative mx-auto mt-4 aspect-[3/4] w-full max-w-5xl sm:aspect-[16/9]">
        <div className="felt absolute inset-x-[9%] inset-y-[7%] rounded-[50%] border-[10px] border-[#3a2412] shadow-[inset_0_0_80px_rgba(0,0,0,0.55),0_30px_60px_-30px_rgba(0,0,0,0.9)] sm:inset-x-[7%] sm:inset-y-[9%]" />

        {/* Centre: pot, stake, status */}
        <div className="pointer-events-none absolute inset-x-[18%] inset-y-[25%] flex flex-col items-center justify-center gap-2 sm:inset-y-[24%]">
          {viewHand && (
            <div className="rounded-full bg-ink-950/70 px-3 py-1 text-xs font-semibold text-gold-200 sm:text-sm">
              Pot <ChipAmount value={viewHand.pot} iconClassName="h-3.5 w-3.5" />
            </div>
          )}
          {viewHand?.phase === 'betting' && (
            <p className="text-center text-[0.7rem] text-cream/80 sm:text-xs">
              To stay in: blind <strong className="text-ivory">{formatChips(viewHand.stake)}</strong> · seen{' '}
              <strong className="text-ivory">{formatChips(viewHand.stake * 2)}</strong>
            </p>
          )}
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-felt-300/80">
            {viewHand ? `${viewHand.phase === 'settled' ? (viewHand.showdown ? 'Show' : 'Hand over') : 'Teen Patti'} · Hand #${viewHand.hand_no}` : 'Teen Patti'}
          </p>
          <div className="relative flex flex-col items-center gap-1.5">
            <AnimatePresence mode="wait">
              <motion.div key={status.key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="flex flex-col items-center gap-1.5">
                <p
                  className={cn(
                    'max-w-[16rem] rounded-2xl px-3 py-1.5 text-center text-xs font-medium sm:max-w-sm sm:text-sm',
                    status.win ? 'bg-gradient-to-r from-gold-300 to-gold-500 font-bold text-ink-950' : 'bg-ink-950/65',
                    !status.win && (status.highlight ? 'text-gold-200' : 'text-cream/90'),
                  )}
                  aria-live="polite"
                >
                  {status.label}
                  {status.timed && secondsLeft !== null && (
                    <>
                      {' · '}
                      <span className="inline-block min-w-[2.2ch] text-left tabular-nums" aria-hidden="true">
                        {secondsLeft}s
                      </span>
                    </>
                  )}
                </p>
                {status.timed && viewHand?.phase_ends_at && <PhaseBar endsAt={viewHand.phase_ends_at} totalSeconds={phaseSeconds} offsetMs={offsetMs} />}
              </motion.div>
            </AnimatePresence>
            <AnimatePresence>{burst > 0 && <ChipBurst key={burst} count={18} />}</AnimatePresence>
          </div>
        </div>

        {/* Dealer button */}
        {viewHand?.button_seat && (
          <motion.div
            layout
            className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-ink-300 bg-ivory text-[0.65rem] font-black text-ink-900 shadow"
            style={{
              left: `${compact ? 50 + (layout[viewHand.button_seat - 1].buttonX - 50) * 0.85 : layout[viewHand.button_seat - 1].buttonX}%`,
              top: `${layout[viewHand.button_seat - 1].buttonY}%`,
            }}
            title="Dealer button"
            aria-label={`Dealer button: seat ${viewHand.button_seat}`}
          >
            D
          </motion.div>
        )}

        {/* Seats */}
        {layout.map((pos) => {
          const seat = seatsByNo.get(pos.seatNo);
          const p = playersBySeat.get(pos.seatNo);
          // A player who left mid-hand keeps their spot until the hand ends.
          const shown = p && (!seat || seat.user_id === p.user_id) ? p : undefined;
          const isMe = (seat?.user_id ?? shown?.user_id) === userId;
          const asPoker: PkPlayer | undefined = shown && {
            seat_no: shown.seat_no,
            user_id: shown.user_id,
            username: shown.username,
            status: shown.status,
            stack_start: 0,
            street_bet: 0,
            committed: shown.committed,
            // Until they do something, the badge says how they are playing.
            last_action: shown.last_action ?? 'Blind',
            up_cards: [],
            card_count: shown.card_count,
            drew: null,
            shown_cards: shown.shown_cards,
            hand_name: shown.hand_name,
            low_name: null,
            best_cards: null,
            won: shown.won,
          };
          return (
            <PokerSeat
              key={pos.seatNo}
              seatNo={pos.seatNo}
              seat={seat}
              player={asPoker}
              hand={seatHand}
              config={seatConfig}
              isMe={isMe}
              myHole={isMe && viewHand ? me?.hole ?? null : null}
              myBest={null}
              canSit={!mySeat}
              onSit={() => void run(`sit-${pos.seatNo}`, () => t.sit(pos.seatNo), 'chip')}
              reaction={seat ? reactionsByUser.get(seat.user_id) : undefined}
              offsetMs={offsetMs}
              compact={compact}
              top={pos.top}
              style={{ left: `${compact ? 50 + (pos.x - 50) * 0.84 : pos.x}%`, top: `${pos.y}%` }}
            />
          );
        })}
      </section>

      {/* Controls */}
      <section
        aria-label="Your controls"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-900/95 px-3 py-3 backdrop-blur sm:static sm:mt-5 sm:rounded-2xl sm:border sm:bg-ink-800/80 sm:px-5 sm:py-4"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          {mySeat && <ReactionBar onSend={t.sendReaction} game="poker" channel={`table:${tableId}`} />}
          {mySeat && !sittingOut && (
            <button
              type="button"
              aria-pressed={outNext}
              onClick={() => {
                setOutNext(!outNext);
                playSound('click');
              }}
              title="Finish this hand, then sit out until you say you are back"
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-semibold transition',
                outNext ? 'border-gold-400 bg-gold-500/20 text-gold-100' : 'border-white/15 text-cream/80 hover:border-white/30',
              )}
            >
              {outNext ? '✓ ' : ''}Sit out next hand
            </button>
          )}
          {viewHand?.phase === 'betting' && myPlayer?.status === 'active' && (
            <p className="text-xs text-cream/75">
              {me?.hole ? (
                <>
                  You: <strong className="text-gold-200">{me.hand_name}</strong>
                </>
              ) : (
                <>
                  You&apos;re playing <strong className="text-gold-200">blind</strong>
                </>
              )}
            </p>
          )}

          {!mySeat ? (
            <p className="flex-1 text-sm text-cream/80">You’re watching. {state.seats.length < table.max_seats ? 'Pick an open seat to play.' : 'This table is full.'}</p>
          ) : options ? (
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2" role="group" aria-label="Your move">
              {options.short && <p className="mr-auto text-xs text-cream/75">You can’t cover a bet: show your cards with what you have left, or pack.</p>}
              {me?.can_see && (
                <Button size="sm" variant="outline" loading={busy === 'see'} onClick={() => act('see')}>
                  See cards
                </Button>
              )}
              <Button size="sm" variant="ruby" loading={busy === 'pack'} disabled={busy !== null} onClick={() => act('pack')}>
                Pack
              </Button>
              {options.can_show && (
                <Button size="sm" variant="outline" loading={busy === 'show'} disabled={busy !== null} onClick={() => act('show')}>
                  Show · {formatChips(options.show_cost)}
                </Button>
              )}
              {options.can_bet && (
                <Button size="sm" variant="felt" loading={busy === 'bet'} disabled={busy !== null} onClick={() => act('bet')}>
                  {me?.seen ? 'Chaal' : 'Blind'} · {formatChips(options.bet)}
                </Button>
              )}
              {options.can_raise && options.raise !== null && (
                <Button size="sm" loading={busy === 'raise'} disabled={busy !== null} onClick={() => act('raise')}>
                  Raise · {formatChips(options.raise)}
                </Button>
              )}
            </div>
          ) : needsChips ? (
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <p className="text-sm text-cream/85">Bring chips from your wallet to get dealt in.</p>
              <Button size="sm" onClick={() => setBringOpen(true)}>
                Bring chips
              </Button>
            </div>
          ) : sittingOut ? (
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <p className="text-sm text-cream/85">You&apos;re sitting out. You won&apos;t be dealt in.</p>
              <Button size="sm" variant="felt" onClick={toggleSitOut} loading={busy === 'sitout'}>
                I&apos;m back
              </Button>
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-sm text-cream/80">{waitingLine(state, viewHand, userId)}</p>
              {/* Not your turn: you may still look at your cards. */}
              {me?.can_see && viewHand?.phase === 'betting' && (
                <Button size="sm" variant="outline" loading={busy === 'see'} onClick={() => act('see')}>
                  See cards
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      <BringChipsModal
        open={bringOpen}
        onClose={() => setBringOpen(false)}
        stakes={stakes}
        stack={me?.stack ?? 0}
        pending={0}
        inHand={false}
        balance={balance}
        onConfirm={(amount) => run('bring', () => t.call('tpt_bring_chips', { p_amount: amount }), 'chip')}
      />
      <RulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} config={config} boot={stakes.boot} />
      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} tableId={tableId} />
    </div>
  );
}

/** What the centre line says. `key` changes only when the situation changes (that's when it animates). */
function statusLine(state: TpState, hand: TpHand | null, userId: string | undefined): { key: string; label: string; timed: boolean; highlight?: boolean; win?: boolean } {
  const boot = state.table.stakes.boot;
  const ready = state.seats.filter((s) => s.status === 'active' && s.connected && s.stack >= boot).length;
  const me = state.seats.find((s) => s.user_id === userId);
  if (!hand) {
    if (me && me.stack === 0) return { key: 'bring', label: 'Bring chips to play', timed: false, highlight: true };
    if (me?.status === 'sitting_out') return { key: 'out', label: "You're sitting out", timed: false };
    if (ready < 2) return { key: 'wait', label: state.seats.length ? 'Waiting for another player…' : 'Table open: take a seat', timed: false };
    return { key: 'deal', label: 'Shuffling up…', timed: false };
  }
  if (hand.phase === 'betting') {
    const who = state.players.find((p) => p.seat_no === hand.turn_seat);
    return who?.user_id === userId
      ? { key: `turn-${hand.id}-${hand.turn_seat}`, label: 'Your turn', timed: true, highlight: true }
      : { key: `turn-${hand.id}-${hand.turn_seat}`, label: `${who?.username ?? 'A player'} to act`, timed: true };
  }
  const parts = (hand.winners ?? []).map((w) => {
    const who = state.players.find((p) => p.seat_no === w.seat_no);
    return `${who?.user_id === userId ? 'You win' : `${who?.username ?? 'A player'} wins`} ${formatChips(w.amount)}${w.hand ? ` · ${w.hand}` : ''}`;
  });
  const iWon = (hand.winners ?? []).some((w) => state.players.find((p) => p.seat_no === w.seat_no)?.user_id === userId);
  return { key: `won-${hand.id}`, label: parts.join(' · ') || 'Hand over', timed: false, win: iWon };
}

function waitingLine(state: TpState, hand: TpHand | null, userId: string | undefined): string {
  const mine = state.players.find((p) => p.user_id === userId);
  if (hand && hand.phase !== 'settled') {
    if (!mine) return 'You’ll be dealt in next hand.';
    if (mine.status === 'folded') return 'You packed. Next hand soon.';
    return 'Waiting for your turn…';
  }
  if (hand?.phase === 'settled') return 'Next hand in a moment.';
  return 'Waiting for another player with chips…';
}

const RANKINGS: { name: string; example: string; text: string }[] = [
  { name: 'Trail', example: '7s 7h 7d', text: 'Three of a kind. Three aces is the best hand there is.' },
  { name: 'Pure sequence', example: 'Ah Kh Qh', text: 'Three in a row, all the same suit.' },
  { name: 'Sequence', example: '4s 5d 6c', text: 'Three in a row in mixed suits. A-K-Q is the best, then A-2-3.' },
  { name: 'Colour', example: '2h 9h Kh', text: 'Three of the same suit, not in a row.' },
  { name: 'Pair', example: 'Ks Kh 2d', text: 'Two cards of the same rank.' },
  { name: 'High card', example: 'As Qd 9c', text: 'None of the above: the highest card plays.' },
];

function RulesModal({ open, onClose, config, boot }: { open: boolean; onClose: () => void; config: TpConfig; boot: number }) {
  return (
    <InfoModal open={open} onClose={onClose} title="How to play Teen Patti">
      <div className="mt-3 space-y-3 text-sm text-cream/85">
        <p>
          Everyone puts in the <strong className="text-ivory">boot</strong> ({formatChips(boot)} here) and gets three cards face down. The best
          three-card hand wins the pot, or the last player left when everyone else has packed.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            You start <strong className="text-ivory">blind</strong>: you have not looked at your cards. Press <strong className="text-ivory">See cards</strong>{' '}
            whenever you like and you are <strong className="text-ivory">seen</strong> for the rest of the hand.
          </li>
          <li>
            On your turn, stay in by betting. A blind player bets the stake, a seen player twice the stake (a <em>chaal</em>). Playing blind is
            cheaper, which is the reward for not looking.
          </li>
          <li>
            <strong className="text-ivory">Raise</strong> doubles the stake for everyone after you, up to {config.max_stake} times the boot.
          </li>
          <li>
            <strong className="text-ivory">Pack</strong> gives up the hand and what you have put in.
          </li>
          <li>
            <strong className="text-ivory">Show</strong>: when only two players are left, either can pay one more bet to turn both hands over. If the
            hands are equal, the player who asked for the show loses.
          </li>
          <li>If the pot reaches {formatChips(boot * config.pot_limit)}, everyone still in shows and the best hand takes it (equal hands share).</li>
          <li>If you can’t cover a bet, you may put in what you have left and show; everyone still in then shows too.</li>
          <li>You have {config.turn_seconds} seconds to act. Running out packs your hand and sits you out.</li>
        </ul>
        <h3 className="pt-1 font-display text-base font-bold text-ivory">Hands, best first</h3>
        <ul className="space-y-2">
          {RANKINGS.map((r) => (
            <li key={r.name} className="flex items-center gap-3">
              <CardFan cards={r.example.split(' ').map(parseCard)} size="xs" overlap="-ml-2" still />
              <p>
                <strong className="text-ivory">{r.name}</strong>
                <span className="block text-xs text-cream/70">{r.text}</span>
              </p>
            </li>
          ))}
        </ul>
        <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
          Chips you bring to the table go back to your wallet when you leave. There is no side show at these tables. Play chips have no cash
          value.
        </p>
      </div>
    </InfoModal>
  );
}

interface HistoryHand {
  hand_no: number;
  played_at: string;
  showdown: boolean;
  my_cards: number[] | null;
  my_committed: number;
  my_won: number;
  my_status: 'active' | 'folded';
  players: { seat_no: number; username: string; status: string; seen: boolean; committed: number; won: number; shown_cards: number[] | null; hand_name: string | null }[];
}

/** Your recent hands at this table, with what was shown. */
function HistoryModal({ open, onClose, tableId }: { open: boolean; onClose: () => void; tableId: string }) {
  const [hands, setHands] = useState<HistoryHand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('tpt_hand_history', { p_table: tableId, p_limit: 20 });
    if (err) setError(friendlyError(err));
    else setHands((data ?? []) as HistoryHand[]);
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
                  <ChipAmount value={net} signed className={cn('text-sm font-semibold', net > 0 ? 'text-felt-300' : net < 0 ? 'text-ruby-300' : 'text-cream')} iconClassName="h-4 w-4" />
                </div>
                <div className="mt-2">
                  <p className="mb-1 text-[0.65rem] uppercase tracking-wider text-muted">You</p>
                  {h.my_cards ? <CardFan cards={h.my_cards} size="xs" overlap="-ml-2" still /> : <p className="text-xs text-cream/60">Played blind: you never looked.</p>}
                </div>
                <ul className="mt-2 space-y-1 text-xs text-cream/80">
                  {h.players
                    .filter((p) => p.won > 0 || p.shown_cards)
                    .map((p) => (
                      <li key={p.seat_no} className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ivory">{p.username}</span>
                        {p.shown_cards && <CardFan cards={p.shown_cards} size="xs" overlap="-ml-3" still />}
                        {p.hand_name && <span>{p.hand_name}</span>}
                        {p.won > 0 && (
                          <span className="text-gold-200">
                            won <ChipAmount value={p.won} iconClassName="h-3 w-3" />
                          </span>
                        )}
                      </li>
                    ))}
                  {h.my_status === 'folded' && <li className="text-cream/55">You packed.</li>}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </InfoModal>
  );
}
