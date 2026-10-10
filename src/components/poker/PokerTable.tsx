import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { ChipBurst } from '@/components/economy/ChipBurst';
import { ChipStack } from '@/components/table/ChipStack';
import { PhaseBar } from '@/components/table/PhaseBar';
import { ReactionBar } from '@/components/table/ReactionBar';
import { TableHeader } from '@/components/table/TableHeader';
import { useSecondsLeft } from '@/components/table/TimerRing';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useNow } from '@/hooks/useNow';
import { usePokerTable } from '@/hooks/usePokerTable';
import { formatChips } from '@/lib/format';
import { POKER_GAMES, seatLayout, stakesLabel, type PkAction, type PkHand, type PkState } from '@/lib/poker';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { BringChipsModal } from './BringChipsModal';
import { BettingControls, DrawControls } from './PokerActions';
import { PokerHistoryModal, PokerRulesModal } from './PokerInfo';
import { PokerSeat } from './PokerSeat';

export function PokerTable({ tableId }: { tableId: string }) {
  const navigate = useNavigate();
  const t = usePokerTable(tableId);
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
  const options = viewHand && viewHand.phase === 'betting' && viewHand.turn_seat === myPlayer?.seat_no ? me?.options : undefined;
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
  const act = (a: PkAction, amount?: number) => void run(a, () => t.act(a, amount), a === 'fold' || a === 'check' ? 'click' : 'chip');

  // Seated with nothing in front of you: offer to bring chips (once per visit).
  const prompted = useRef(false);
  const needsChips = Boolean(mySeat && me && me.stack + me.pending_topup === 0 && !me.in_hand);
  useEffect(() => {
    if (needsChips && !prompted.current) {
      prompted.current = true;
      setBringOpen(true);
    }
  }, [needsChips]);

  // ---- Sounds and celebrations ------------------------------------------------
  const cardCount = (viewHand?.board.length ?? 0) + players.reduce((n, p) => n + p.card_count + (p.shown_cards ? 1 : 0), 0);
  const prevCards = useRef(cardCount);
  useEffect(() => {
    if (cardCount > prevCards.current) playSound('card');
    prevCards.current = cardCount;
  }, [cardCount]);

  const betTotal = players.reduce((n, p) => n + p.committed, 0);
  const prevBets = useRef(betTotal);
  useEffect(() => {
    if (betTotal > prevBets.current) playSound('chip');
    prevBets.current = betTotal;
  }, [betTotal]);

  const myTurnKey = options ? `${viewHand?.id}-${viewHand?.street}-${viewHand?.current_bet}` : null;
  useEffect(() => {
    if (myTurnKey) playSound('turn');
  }, [myTurnKey]);

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
  const game = table.game_key;
  const seatsByNo = new Map(state.seats.map((s) => [s.seat_no, s]));
  const playersBySeat = new Map(players.map((p) => [p.seat_no, p]));
  const reactionsByUser = new Map(t.reactions.map((r) => [r.user_id, r]));
  const layout = seatLayout(table.max_seats, mySeat?.seat_no ?? 1);
  const status = statusLine(state, viewHand, userId);
  const sittingOut = mySeat?.status === 'sitting_out';
  const atTable = (me?.stack ?? 0) + (me?.pending_topup ?? 0);
  const canTopUp = Boolean(mySeat && me && atTable < stakes.max_stack);
  const showBoard = config.family === 'board' || (viewHand?.board.length ?? 0) > 0;
  const phaseSeconds = viewHand?.phase === 'drawing' ? config.draw_seconds : viewHand?.phase === 'settled' ? (viewHand.showdown ? config.showdown_seconds : config.next_hand_seconds) : config.turn_seconds;

  const leaveTable = async () => {
    if (mySeat) {
      const err = await t.leave();
      if (err) {
        toast.error(err);
        return;
      }
      void useWallet.getState().fetchStatus();
    }
    navigate(`/lobby?game=${game}`);
  };
  const toggleSitOut = () =>
    void run('sitout', async () => {
      const err = await t.sitOut(!sittingOut);
      if (!err && sittingOut) return t.advance(); // back in: deal if a hand is due
      return err;
    });

  return (
    <div className="mx-auto max-w-6xl px-3 pb-44 pt-4 sm:px-4 sm:pb-10">
      <TableHeader
        table={{ ...table, min_bet: 0, max_bet: 0, variant: POKER_GAMES[game]?.limit ?? null }}
        stakes={stakesLabel(game, stakes)}
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
              {atTable === 0 ? 'Bring chips' : 'Top up'}
            </Button>
          )
        }
      />

      {/* Felt */}
      <section
        aria-label={`${POKER_GAMES[game]?.short ?? 'Poker'} table`}
        className="relative mx-auto mt-4 aspect-[3/4] w-full max-w-5xl sm:aspect-[16/9]"
      >
        <div className="felt absolute inset-x-[9%] inset-y-[7%] rounded-[50%] border-[10px] border-[#3a2412] shadow-[inset_0_0_80px_rgba(0,0,0,0.55),0_30px_60px_-30px_rgba(0,0,0,0.9)] sm:inset-x-[7%] sm:inset-y-[9%]" />

        {/* Centre: pot, board, status */}
        <div className="pointer-events-none absolute inset-x-[18%] inset-y-[25%] flex flex-col items-center justify-center gap-2 sm:inset-y-[24%]">
          {viewHand && viewHand.pot > 0 && (
            <div className="rounded-full bg-ink-950/70 px-3 py-1 text-xs font-semibold text-gold-200 sm:text-sm">
              Pot <ChipAmount value={viewHand.pot} iconClassName="h-3.5 w-3.5" />
            </div>
          )}
          {showBoard && <Board hand={viewHand} compact={compact} winning={winningCards(state, viewHand)} />}
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.25em] text-felt-300/80">
            {viewHand ? `${viewHand.phase === 'settled' ? 'Showdown' : viewHand.phase === 'drawing' ? 'The draw' : viewHand.street_name} · Hand #${viewHand.hand_no}` : POKER_GAMES[game]?.short}
          </p>
          <div className="relative flex flex-col items-center gap-1.5">
            <AnimatePresence mode="wait">
              <motion.div
                key={status.key}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex flex-col items-center gap-1.5"
              >
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
                {status.timed && viewHand?.phase_ends_at && (
                  <PhaseBar endsAt={viewHand.phase_ends_at} totalSeconds={phaseSeconds} offsetMs={offsetMs} />
                )}
              </motion.div>
            </AnimatePresence>
            <AnimatePresence>{burst > 0 && <ChipBurst key={burst} count={18} />}</AnimatePresence>
          </div>
        </div>

        {/* Bets in front of players */}
        {layout.map((pos) => {
          const p = playersBySeat.get(pos.seatNo);
          if (!p || p.street_bet <= 0 || viewHand?.phase === 'settled') return null;
          return (
            <div
              key={`bet-${pos.seatNo}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${compact ? 50 + (pos.betX - 50) * 0.85 : pos.betX}%`, top: `${pos.betY}%` }}
            >
              <ChipStack amount={p.street_bet} label={`${p.username} has ${formatChips(p.street_bet)} play chips in`} />
            </div>
          );
        })}

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
          const player = playersBySeat.get(pos.seatNo);
          // A player who left mid-hand keeps their spot until the hand ends.
          const shownPlayer = player && (!seat || seat.user_id === player.user_id) ? player : undefined;
          const isMe = (seat?.user_id ?? shownPlayer?.user_id) === userId;
          return (
            <PokerSeat
              key={pos.seatNo}
              seatNo={pos.seatNo}
              seat={seat}
              player={shownPlayer}
              hand={viewHand}
              config={config}
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
          {mySeat && <ReactionBar onSend={t.sendReaction} />}
          {me?.hole && viewHand && myPlayer && myPlayer.status !== 'folded' && (me.hand_name || me.low_name) && (
            <p className="text-xs text-cream/75">
              You: <strong className="text-gold-200">{me.hand_name}</strong>
              {me.low_name && <span className="text-cream/60"> · {me.low_name}</span>}
            </p>
          )}

          {!mySeat ? (
            <p className="flex-1 text-sm text-cream/80">
              You&apos;re watching. {state.seats.length < table.max_seats ? 'Pick an open seat to play.' : 'This table is full.'}
            </p>
          ) : me?.can_draw && me.hole && viewHand?.phase === 'drawing' ? (
            <DrawControls
              key={viewHand.id}
              hole={me.hole}
              maxDraw={config.max_draw}
              busy={busy === 'draw'}
              onDraw={(cards) => void run('draw', () => t.draw(cards), 'card')}
            />
          ) : options && viewHand ? (
            <BettingControls hand={viewHand} options={options} config={config} busy={busy} onAct={act} compact={compact} />
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
            <p className="flex-1 text-sm text-cream/80">{waitingLine(state, viewHand, userId)}</p>
          )}
        </div>
      </section>

      <BringChipsModal
        open={bringOpen}
        onClose={() => setBringOpen(false)}
        stakes={stakes}
        stack={me?.stack ?? 0}
        pending={me?.pending_topup ?? 0}
        inHand={Boolean(me?.in_hand)}
        balance={balance}
        onConfirm={(amount) => run('bring', () => t.bringChips(amount), 'chip')}
      />
      <PokerRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} game={game} config={config} stakes={stakes} />
      <PokerHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} tableId={tableId} />
    </div>
  );
}

/** The shared cards, with empty slots still to come. New cards fly in one after another. */
function Board({ hand, compact, winning }: { hand: PkHand | null; compact: boolean; winning: number[] | null }) {
  const board = hand?.board ?? [];
  const seen = useRef<{ id: string | null; count: number }>({ id: null, count: 0 });
  if (seen.current.id !== (hand?.id ?? null)) seen.current = { id: hand?.id ?? null, count: 0 };
  const before = seen.current.count;
  useEffect(() => {
    seen.current.count = board.length;
  });
  const size = compact ? 'sm' : 'md';
  return (
    <div className="flex gap-1 sm:gap-1.5" aria-label={board.length ? `Board: ${board.length} cards` : 'No board cards yet'}>
      {Array.from({ length: Math.max(5, board.length) }).map((_, i) =>
        i < board.length ? (
          <PlayingCard
            key={`${hand?.id}-${i}`}
            card={board[i]}
            size={size}
            delay={i >= before ? (i - before) * 0.35 : 0}
            highlight={Boolean(winning?.includes(board[i]))}
            dim={Boolean(winning?.length) && !winning!.includes(board[i])}
          />
        ) : (
          <div
            key={i}
            className={cn('rounded-lg border-2 border-dashed border-white/10', compact ? 'h-[3.6rem] w-[2.6rem]' : 'h-[4.9rem] w-[3.5rem]')}
            aria-hidden="true"
          />
        ),
      )}
    </div>
  );
}

/** Cards that make the winning hand(s), for highlighting at showdown. */
function winningCards(state: PkState, hand: PkHand | null): number[] | null {
  if (!hand || hand.phase !== 'settled' || !hand.showdown) return null;
  const winners = new Set((hand.pots ?? []).flatMap((p) => p.winners.map((w) => w.seat_no)));
  const cards = state.players.filter((p) => winners.has(p.seat_no)).flatMap((p) => p.best_cards ?? []);
  return cards.length ? cards : null;
}

/** What the centre line says. `key` changes only when the situation changes (that's when it animates). */
function statusLine(
  state: PkState,
  hand: PkHand | null,
  userId: string | undefined,
): { key: string; label: string; timed: boolean; highlight?: boolean; win?: boolean } {
  const name = (seat: number | null) => state.players.find((p) => p.seat_no === seat)?.username ?? 'A player';
  const ready = state.seats.filter((s) => s.status === 'active' && s.connected && s.stack > 0).length;
  const me = state.seats.find((s) => s.user_id === userId);
  if (!hand) {
    if (me && state.me && state.me.stack + state.me.pending_topup === 0) return { key: 'bring', label: 'Bring chips to play', timed: false, highlight: true };
    if (me?.status === 'sitting_out') return { key: 'out', label: "You're sitting out", timed: false };
    if (ready < 2) return { key: 'wait', label: state.seats.length ? 'Waiting for another player…' : 'Table open: take a seat', timed: false };
    return { key: 'deal', label: 'Shuffling up…', timed: false };
  }
  if (hand.phase === 'betting') {
    const mine = state.players.find((p) => p.seat_no === hand.turn_seat)?.user_id === userId;
    return mine
      ? { key: `turn-${hand.id}-${hand.street}-${hand.turn_seat}`, label: 'Your turn', timed: true, highlight: true }
      : { key: `turn-${hand.id}-${hand.street}-${hand.turn_seat}`, label: `${name(hand.turn_seat)} to act`, timed: true };
  }
  if (hand.phase === 'drawing') {
    const meDrawing = state.me?.can_draw;
    return { key: `draw-${hand.id}-${meDrawing}`, label: meDrawing ? 'Choose cards to swap' : 'Players are drawing', timed: true, highlight: meDrawing };
  }
  // Settled: who won what.
  const totals = new Map<number, { amount: number; hands: string[] }>();
  for (const pot of hand.pots ?? []) {
    for (const w of pot.winners) {
      const e = totals.get(w.seat_no) ?? { amount: 0, hands: [] };
      e.amount += w.amount;
      if (w.hand && !e.hands.includes(w.hand)) e.hands.push(w.hand);
      totals.set(w.seat_no, e);
    }
  }
  const parts = [...totals.entries()].map(([seat, e]) => {
    const who = state.players.find((p) => p.seat_no === seat);
    const label = who?.user_id === userId ? 'You win' : `${who?.username ?? 'A player'} wins`;
    return `${label} ${formatChips(e.amount)}${hand.showdown && e.hands.length ? ` · ${e.hands.join(' / ')}` : ''}`;
  });
  const iWon = [...totals.keys()].some((s) => state.players.find((p) => p.seat_no === s)?.user_id === userId);
  return { key: `won-${hand.id}`, label: parts.join(' · ') || 'Hand over', timed: false, win: iWon };
}

function waitingLine(state: PkState, hand: PkHand | null, userId: string | undefined): string {
  const mine = state.players.find((p) => p.user_id === userId);
  if (hand && hand.phase !== 'settled') {
    if (!mine) return 'You’ll be dealt in next hand.';
    if (mine.status === 'folded') return 'You folded. Next hand soon.';
    if (mine.status === 'allin') return 'You’re all in. Good luck!';
    if (hand.phase === 'drawing') return 'Waiting for the others to draw…';
    return 'Waiting for your turn…';
  }
  if (hand?.phase === 'settled') return 'Next hand in a moment.';
  return 'Waiting for another player with chips…';
}
