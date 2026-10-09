import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { CardFan } from '@/components/cards/PlayingCard';
import { ChipBurst } from '@/components/economy/ChipBurst';
import { ReactionBar } from '@/components/table/ReactionBar';
import { TableHeader } from '@/components/table/TableHeader';
import { PhaseBar } from '@/components/table/PhaseBar';
import { chipColorFor } from '@/components/table/ChipStack';
import { useSecondsLeft } from '@/components/table/TimerRing';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { useBlackjackTable } from '@/hooks/useBlackjackTable';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { availableActions, chipDenominations, type BjAction, type BjHand, type BjState } from '@/lib/blackjack';
import { formatChips, formatChipsCompact } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { useAuth } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { BlackjackHistoryModal, BlackjackRulesModal } from './BlackjackInfo';
import { SeatView } from './SeatView';

// Gentle arc for 5 seats on wider screens.
const ARC = ['sm:translate-y-0', 'sm:translate-y-6', 'sm:translate-y-9', 'sm:translate-y-6', 'sm:translate-y-0'];

export function BlackjackTable({ tableId }: { tableId: string }) {
  const navigate = useNavigate();
  const t = useBlackjackTable(tableId);
  const { state, error, offsetMs, mySeat } = t;
  const userId = useAuth((s) => s.user?.id);
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [draft, setDraft] = useState(0);
  const [burst, setBurst] = useState(0);
  const [banner, setBanner] = useState<{ id: string; net: number; paid: number; text: string } | null>(null);
  const lastBetKey = `allin-bj-lastbet-${tableId}`;

  const round = state?.round ?? null;
  const hands = state?.hands ?? [];
  const myHands = hands.filter((h) => h.user_id === userId);
  const myBetHand = round?.phase === 'betting' ? myHands.find((h) => h.hand_index === 0) : undefined;
  const turnHand = hands.find((h) => h.id === round?.turn_hand_id);
  const myTurnHand = round?.phase === 'playing' && turnHand?.user_id === userId ? turnHand : undefined;
  const myInsuranceOpen = round?.phase === 'insurance' && myHands.some((h) => h.hand_index === 0 && !h.insurance_decided);
  const secondsLeft = useSecondsLeft(round?.phase_ends_at, offsetMs);
  const nextRoundReady = !round || (round.phase === 'settled' && (secondsLeft ?? 0) <= 0);
  const canBet = Boolean(mySeat) && (nextRoundReady || round?.phase === 'betting');
  // Once the results pause is over, clear the old hand off the felt.
  const viewRound = round && !(round.phase === 'settled' && nextRoundReady) ? round : null;
  const viewHands = viewRound ? hands : [];

  // Keep the bet draft in sync with a bet the server already holds.
  const placedBet = myBetHand?.bet;
  useEffect(() => {
    if (placedBet) setDraft(placedBet);
  }, [placedBet]);
  const compact = useMediaQuery('(max-width: 639px)');

  const run = async (key: string, fn: () => Promise<string | null>, sound: 'chip' | 'card' | 'click' = 'click') => {
    if (busy) return;
    setBusy(key);
    const err = await fn();
    setBusy(null);
    if (err) {
      playSound('error');
      toast.error(err);
    } else {
      playSound(sound);
    }
    // Balance changes with bets; don't wait for the realtime echo.
    void useWallet.getState().fetchStatus();
  };

  const placeBet = () => {
    if (!state || draft <= 0) return;
    try {
      localStorage.setItem(lastBetKey, String(draft));
    } catch {
      /* ignore */
    }
    void run('bet', () => t.placeBet(draft), 'chip');
  };

  const act = (a: BjAction) => void run(a, () => t.act(a), a === 'stand' ? 'click' : 'card');

  // ---- Sounds and celebrations driven by state changes -------------------
  const cardCount = useMemo(
    () => hands.reduce((n, h) => n + h.cards.length, 0) + (round?.dealer_cards.length ?? 0),
    [hands, round?.dealer_cards.length],
  );
  const prevCards = useRef(cardCount);
  useEffect(() => {
    if (cardCount > prevCards.current) playSound('card');
    prevCards.current = cardCount;
  }, [cardCount]);

  const prevTurn = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (myTurnHand && prevTurn.current !== myTurnHand.id) playSound('turn');
    prevTurn.current = myTurnHand?.id;
  }, [myTurnHand]);

  const celebrated = useRef<string | null>(null);
  useEffect(() => {
    if (!round || round.phase !== 'settled' || celebrated.current === round.id) return;
    const mine = hands.filter((h) => h.user_id === userId && h.result);
    if (mine.length === 0) return;
    celebrated.current = round.id;
    void useWallet.getState().fetchStatus();
    const net = mine.reduce((n, h) => n + h.payout - h.bet - h.insurance, 0);
    const paid = mine.reduce((n, h) => n + h.payout, 0);
    const bj = mine.some((h) => h.result === 'blackjack');
    if (net > 0) {
      playSound('win');
      setBurst((b) => b + 1);
    } else if (net < 0) {
      playSound('lose');
    }
    setBanner({
      id: round.id,
      net,
      paid,
      text: bj ? 'Blackjack! You win' : net > 0 ? 'You win' : net < 0 ? 'Dealer wins' : 'Push · bet returned',
    });
  }, [round, hands, userId]);

  // The banner has its own timer, so state refreshes can't keep it on screen.
  const bannerId = banner?.id;
  useEffect(() => {
    if (!bannerId) return;
    const id = window.setTimeout(() => setBanner(null), 2800);
    return () => window.clearTimeout(id);
  }, [bannerId]);
  const showBanner = banner && banner.id === round?.id && round.phase === 'settled' ? banner : null;

  // ---- Keyboard shortcuts --------------------------------------------------
  const actions = myTurnHand ? availableActions(myTurnHand, myHands.length, balance) : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (actions) {
        const map: Record<string, BjAction> = { h: 'hit', s: 'stand', d: 'double', p: 'split', r: 'surrender' };
        if (map[k] && actions[map[k]]) {
          e.preventDefault();
          act(map[k]);
        }
      } else if (myInsuranceOpen && (k === 'y' || k === 'n')) {
        e.preventDefault();
        void run('ins', () => t.insurance(k === 'y'), 'chip');
      } else if (canBet && k === 'enter' && draft > 0 && el.tagName !== 'BUTTON') {
        e.preventDefault();
        placeBet();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

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

  const table = state.table;
  const seatsByNo = new Map(state.seats.map((s) => [s.seat_no, s]));
  const reactionsByUser = new Map(t.reactions.map((r) => [r.user_id, r]));
  const status = statusLine(state, userId, nextRoundReady);
  const phaseSeconds =
    round?.phase === 'betting' ? state.rules.bet_seconds
    : round?.phase === 'insurance' ? state.rules.insurance_seconds
    : round?.phase === 'playing' ? state.rules.turn_seconds
    : round?.phase === 'settled' ? state.rules.next_round_seconds
    : 0;
  const leaveTable = async () => {
    if (mySeat) {
      const err = await t.leave();
      if (err) {
        toast.error(err);
        return;
      }
    }
    navigate('/lobby?game=blackjack');
  };
  const denoms = chipDenominations(table.min_bet, table.max_bet);
  const maxDraft = Math.min(table.max_bet, balance + (myBetHand?.bet ?? 0));
  const myHand0 = myHands.find((h) => h.hand_index === 0);

  return (
    <div className="mx-auto max-w-6xl px-3 pb-36 pt-4 sm:px-4 sm:pb-10">
      <TableHeader
        table={table}
        watchers={t.watchers}
        connected={t.connected}
        mySeat={mySeat}
        onLeave={() => void leaveTable()}
        onRules={() => setRulesOpen(true)}
        onHistory={() => setHistoryOpen(true)}
        onSitOut={() => mySeat && void run('sitout', () => t.sitOut(mySeat.status !== 'sitting_out'))}
      />

      {/* Felt */}
      <section
        aria-label="Blackjack table"
        className="felt relative mt-4 rounded-[2.5rem] border-[10px] border-[#3a2412] px-2 pb-8 pt-5 shadow-[inset_0_0_80px_rgba(0,0,0,0.55),0_30px_60px_-30px_rgba(0,0,0,0.9)] sm:rounded-b-[10rem] sm:px-10 sm:pb-14 lg:rounded-b-[14rem] lg:px-16"
      >
        {/* Dealer */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.3em] text-felt-300/80">Dealer</p>
          <div className="flex min-h-[5rem] items-end">
            {viewRound && viewRound.dealer_cards.length > 0 ? (
              <CardFan cards={viewRound.dealer_cards} hidden={viewRound.hole_hidden ? 1 : 0} size="md" />
            ) : (
              <div className="h-[4.9rem] w-[3.5rem] rounded-lg border-2 border-dashed border-white/10" aria-hidden="true" />
            )}
          </div>
          {viewRound?.dealer_total != null && viewRound.dealer_cards.length > 0 && (
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums',
                viewRound.dealer_result === 'bust' ? 'bg-ruby-800 text-ruby-300' : viewRound.dealer_result === 'blackjack' ? 'bg-gold-500 text-ink-950' : 'bg-ink-950/80 text-ivory',
              )}
            >
              {viewRound.dealer_result === 'blackjack' ? 'Blackjack' : viewRound.dealer_result === 'bust' ? `Bust (${viewRound.dealer_total})` : viewRound.dealer_total}
              {viewRound.hole_hidden && ' + ?'}
            </span>
          )}
        </div>

        {/* Status line */}
        <div className="relative mx-auto mt-4 flex min-h-12 max-w-md flex-col items-center justify-center">
          <AnimatePresence mode="wait">
            {showBanner ? (
              <motion.div
                key={`banner-${showBanner.id}`}
                role="status"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 20 }}
                className={cn(
                  'rounded-full px-5 py-2 font-display text-lg font-bold shadow-xl',
                  showBanner.net > 0 ? 'bg-gradient-to-r from-gold-300 to-gold-500 text-ink-950' : showBanner.net < 0 ? 'bg-ruby-800 text-ivory' : 'bg-ink-700 text-ivory',
                )}
              >
                {showBanner.text}
                {showBanner.net > 0 && (
                  <ChipAmount value={showBanner.paid} className="ml-2 align-middle" iconClassName="h-5 w-5" />
                )}
              </motion.div>
            ) : (
              // Keyed by phase/turn only, so the seconds count down in place without re-animating.
              <motion.div
                key={status.key}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="flex flex-col items-center gap-1.5"
              >
                <p
                  className={cn('rounded-full bg-ink-950/60 px-4 py-1.5 text-sm font-medium', status.highlight ? 'text-gold-200' : 'text-cream/90')}
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
                {status.timed && round?.phase_ends_at && phaseSeconds > 0 && (
                  <PhaseBar endsAt={round.phase_ends_at} totalSeconds={phaseSeconds} offsetMs={offsetMs} />
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>{burst > 0 && <ChipBurst key={burst} count={18} />}</AnimatePresence>
        </div>

        {/* Seats */}
        <div className="mt-4 grid grid-cols-3 gap-x-1 gap-y-4 sm:grid-cols-5 sm:gap-2 [&>*]:min-w-0">
          {Array.from({ length: table.max_seats }).map((_, i) => {
            const seatNo = i + 1;
            const seat = seatsByNo.get(seatNo);
            return (
              <div key={seatNo} className={cn('transition-transform', ARC[i])}>
                <SeatView
                  seatNo={seatNo}
                  seat={seat}
                  hands={viewHands.filter((h) => h.seat_no === seatNo && (!seat || h.user_id === seat.user_id || h.result !== null))}
                  round={viewRound}
                  isMe={seat?.user_id === userId}
                  canSit={!mySeat}
                  onSit={() => void run(`sit-${seatNo}`, () => t.sit(seatNo), 'chip')}
                  reaction={seat ? reactionsByUser.get(seat.user_id) : undefined}
                  turnSeconds={state.rules.turn_seconds}
                  offsetMs={offsetMs}
                  compact={compact}
                />
              </div>
            );
          })}
        </div>
      </section>

      {/* Controls */}
      <section
        aria-label="Your controls"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-900/95 px-3 py-3 backdrop-blur sm:static sm:mt-5 sm:rounded-2xl sm:border sm:bg-ink-800/80 sm:px-5 sm:py-4"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          {mySeat && <ReactionBar onSend={t.sendReaction} />}

          {!mySeat ? (
            <p className="flex-1 text-sm text-cream/80">
              You&apos;re watching. {state.seats.length < table.max_seats ? 'Pick an open seat to play.' : 'This table is full.'}
            </p>
          ) : myTurnHand && actions ? (
            <div className="flex flex-1 flex-wrap items-center gap-2" role="group" aria-label="Your move">
              <span className="mr-1 text-sm text-gold-200">
                Your hand: <strong className="tabular-nums">{myTurnHand.soft && myTurnHand.total < 21 ? `soft ${myTurnHand.total}` : myTurnHand.total}</strong>
              </span>
              <ActionButton label="Hit" k="H" onClick={() => act('hit')} busy={busy === 'hit'} enabled={actions.hit} variant="gold" />
              <ActionButton label="Stand" k="S" onClick={() => act('stand')} busy={busy === 'stand'} enabled={actions.stand} variant="ruby" />
              <ActionButton label="Double" k="D" onClick={() => act('double')} busy={busy === 'double'} enabled={actions.double} />
              <ActionButton label="Split" k="P" onClick={() => act('split')} busy={busy === 'split'} enabled={actions.split} />
              <ActionButton label="Surrender" k="R" onClick={() => act('surrender')} busy={busy === 'surrender'} enabled={actions.surrender} />
            </div>
          ) : myInsuranceOpen && myHand0 ? (
            <div className="flex flex-1 flex-wrap items-center gap-2" role="group" aria-label="Insurance">
              <span className="text-sm text-cream/90">
                Insurance costs <ChipAmount value={Math.floor(myHand0.bet / 2)} className="font-semibold text-gold-200" iconClassName="h-4 w-4" />, pays 2:1 if the dealer has blackjack.
              </span>
              <Button size="sm" onClick={() => void run('ins', () => t.insurance(true), 'chip')} loading={busy === 'ins'} disabled={balance < Math.floor(myHand0.bet / 2)}>
                Take insurance (Y)
              </Button>
              <Button size="sm" variant="outline" onClick={() => void run('ins', () => t.insurance(false))}>
                No thanks (N)
              </Button>
            </div>
          ) : canBet ? (
            <div className="flex flex-1 flex-wrap items-center gap-2" role="group" aria-label="Place your bet">
              <div className="flex gap-1.5">
                {denoms.map((d) => (
                  <motion.button
                    key={d}
                    type="button"
                    whileTap={{ scale: 0.88, y: -4 }}
                    onClick={() => {
                      playSound('chip');
                      setDraft((v) => Math.min(maxDraft, Math.max(v, 0) + d));
                    }}
                    disabled={draft + d > maxDraft && draft >= maxDraft}
                    className="relative flex h-12 w-12 items-center justify-center rounded-full transition hover:-translate-y-0.5 disabled:opacity-40"
                    aria-label={`Add ${formatChips(d)} to your bet`}
                  >
                    <ChipIcon className="absolute inset-0 h-12 w-12" color={chipColorFor(d)} />
                    <span className="relative rounded bg-ink-950/75 px-1 text-[0.62rem] font-bold text-ivory">{formatChipsCompact(d)}</span>
                  </motion.button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <ChipAmount value={draft} className="min-w-16 text-base font-bold text-ivory" />
                <Button size="sm" variant="ghost" onClick={() => {
                  setDraft(0);
                  if (myBetHand) void run('clear', () => t.clearBet());
                }}>
                  Clear
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    let last = 0;
                    try {
                      last = Number(localStorage.getItem(lastBetKey) ?? 0);
                    } catch {
                      /* ignore */
                    }
                    if (last > 0) setDraft(Math.min(maxDraft, last));
                  }}
                >
                  Rebet
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDraft((v) => Math.min(maxDraft, v * 2))} disabled={draft === 0}>
                  ×2
                </Button>
              </div>
              <div className="ml-auto flex gap-2">
                {myBetHand && draft === myBetHand.bet ? (
                  <Button size="sm" variant="felt" onClick={() => void run('deal', () => t.dealNow(), 'card')} loading={busy === 'deal'}>
                    Deal now
                  </Button>
                ) : (
                  <Button onClick={placeBet} loading={busy === 'bet'} disabled={draft < table.min_bet}>
                    {myBetHand ? 'Update bet' : draft > 0 && draft < table.min_bet ? `Min ${formatChips(table.min_bet)}` : 'Place bet'}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="flex-1 text-sm text-cream/80">{waitingLine(state, userId)}</p>
          )}
        </div>
      </section>

      <BlackjackRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <BlackjackHistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} recent={state.recent} />
    </div>
  );
}

function ActionButton({
  label,
  k,
  onClick,
  busy,
  enabled,
  variant = 'felt',
}: {
  label: string;
  k: string;
  onClick: () => void;
  busy: boolean;
  enabled: boolean;
  variant?: 'gold' | 'felt' | 'ruby';
}) {
  return (
    <Button size="sm" variant={variant} onClick={onClick} loading={busy} disabled={!enabled} aria-keyshortcuts={k}>
      {label}
      <kbd className="ml-1 hidden rounded border border-current/30 px-1 text-[0.6rem] opacity-70 sm:inline">{k}</kbd>
    </Button>
  );
}

/**
 * What the status line says. `key` changes only when the phase or turn changes
 * (that's when it animates); the seconds are rendered separately.
 */
function statusLine(
  state: BjState,
  userId: string | undefined,
  nextRoundReady: boolean,
): { key: string; label: string; timed: boolean; highlight?: boolean } {
  const r = state.round;
  const seated = state.seats.some((s) => s.user_id === userId);
  if (!r || nextRoundReady) {
    return {
      key: `open-${seated}`,
      label: seated ? 'Place your bets' : state.seats.length ? 'Waiting for bets' : 'Table open: take a seat',
      timed: false,
      highlight: seated,
    };
  }
  if (r.phase === 'betting') return { key: `bet-${r.id}`, label: 'Bets close in', timed: true, highlight: true };
  if (r.phase === 'insurance') return { key: `ins-${r.id}`, label: 'Dealer shows an Ace · Insurance?', timed: true, highlight: true };
  if (r.phase === 'playing') {
    const h = state.hands.find((x) => x.id === r.turn_hand_id);
    if (h?.user_id === userId) return { key: `turn-${r.turn_hand_id}`, label: 'Your turn', timed: true, highlight: true };
    const name = state.seats.find((s) => s.user_id === h?.user_id)?.username ?? 'A player';
    return { key: `turn-${r.turn_hand_id}`, label: `${name} is playing`, timed: true };
  }
  const d =
    r.dealer_result === 'blackjack' ? 'Dealer has blackjack' : r.dealer_result === 'bust' ? 'Dealer busts!' : `Dealer stands on ${r.dealer_total}`;
  return { key: `settled-${r.id}`, label: `${d} · next hand in`, timed: true };
}

function waitingLine(state: BjState, userId: string | undefined): string {
  const r = state.round;
  if (r?.phase === 'playing') {
    const h: BjHand | undefined = state.hands.find((x) => x.id === r.turn_hand_id);
    if (h && h.user_id !== userId) return 'Waiting for the other players…';
  }
  if (r?.phase === 'insurance') return 'Waiting for insurance decisions…';
  if (r?.phase === 'settled') return 'Next hand opens in a moment.';
  if (r?.phase === 'betting') return 'Waiting for other players to bet.';
  return 'Waiting…';
}
