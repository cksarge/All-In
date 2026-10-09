import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChipBurst } from '@/components/economy/ChipBurst';
import { GameHistoryModal } from '@/components/table/GameHistoryModal';
import { PhaseBar } from '@/components/table/PhaseBar';
import { PlayerStrip } from '@/components/table/PlayerStrip';
import { ReactionBar } from '@/components/table/ReactionBar';
import { TableHeader } from '@/components/table/TableHeader';
import { chipColorFor } from '@/components/table/ChipStack';
import { useSecondsLeft } from '@/components/table/TimerRing';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { useLiveTable } from '@/hooks/useLiveTable';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { chipDenominations } from '@/lib/blackjack';
import { formatChipsCompact } from '@/lib/format';
import { pocketColor, pocketLabel, type RlState, type Zone } from '@/lib/roulette';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { RouletteBoard } from './RouletteBoard';
import { RouletteRulesModal } from './RouletteInfo';
import { RouletteWheel } from './RouletteWheel';

const LANDING_MS = 3000;

function NumberBall({ n, size = 'md' }: { n: number; size?: 'sm' | 'md' | 'lg' }) {
  const c = pocketColor(n);
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-display font-bold tabular-nums text-ivory',
        c === 'red' ? 'bg-ruby-600' : c === 'black' ? 'bg-ink-950 ring-1 ring-white/20' : 'bg-felt-500',
        size === 'sm' ? 'h-7 w-7 text-xs' : size === 'md' ? 'h-9 w-9 text-sm' : 'h-16 w-16 text-3xl',
      )}
    >
      {pocketLabel(n)}
    </span>
  );
}

export function RouletteTable({ tableId }: { tableId: string }) {
  const navigate = useNavigate();
  const t = useLiveTable<RlState>({
    tableId,
    stateFn: 'rl_state',
    advanceFn: 'rl_advance',
    realtimeTables: ['rl_rounds', 'rl_bets'],
    getDeadline: (s) => ({ at: s.round?.phase_ends_at, advance: Boolean(s.round && s.round.phase !== 'settled') }),
  });
  const { state, error, offsetMs, mySeat, userId, call } = t;
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const vertical = useMediaQuery('(max-width: 767px)');
  const [chip, setChip] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [banner, setBanner] = useState<{ id: string; paid: number; staked: number } | null>(null);
  const [burst, setBurst] = useState(0);

  const round = state?.round ?? null;
  const secondsLeft = useSecondsLeft(round?.phase_ends_at, offsetMs);
  const nextReady = !round || (round.phase === 'settled' && (secondsLeft ?? 0) <= 0);
  const canBet = Boolean(mySeat) && (nextReady || round?.phase === 'betting');
  const boardBets = useMemo(() => (state && round && !nextReady ? state.bets : []), [state, round, nextReady]);
  const myBets = boardBets.filter((b) => b.user_id === userId);
  const myTotal = myBets.reduce((n, b) => n + b.amount, 0);

  // Did we watch this round spin? If not (page opened later), show the result without animating.
  const spunRounds = useRef(new Set<string>());
  if (round?.phase === 'spinning') spunRounds.current.add(round.id);
  const animateLanding = round ? spunRounds.current.has(round.id) : false;
  const [landedRound, setLandedRound] = useState<string | null>(null);

  // Default chip = table minimum.
  useEffect(() => {
    if (state && chip === null) setChip(state.table.min_bet);
  }, [state, chip]);

  // Spin start sound.
  const prevPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (round?.phase === 'spinning' && prevPhase.current === 'betting') playSound('whoosh');
    prevPhase.current = round?.phase;
  }, [round?.phase]);

  // After the ball lands: result banner, sounds, chip burst.
  useEffect(() => {
    if (!round || round.phase !== 'settled' || round.result === null || landedRound === round.id) return;
    const delay = animateLanding ? LANDING_MS : 0;
    const id = window.setTimeout(() => {
      setLandedRound(round.id);
      void useWallet.getState().fetchStatus();
      const mine = state?.bets.filter((b) => b.user_id === userId) ?? [];
      if (mine.length === 0) return;
      const paid = mine.reduce((n, b) => n + b.payout, 0);
      const staked = mine.reduce((n, b) => n + b.amount, 0);
      setBanner({ id: round.id, paid, staked });
      if (paid > 0) {
        playSound('win');
        setBurst((b) => b + 1);
      } else {
        playSound('lose');
      }
    }, delay);
    return () => window.clearTimeout(id);
  }, [round, animateLanding, landedRound, state?.bets, userId]);

  const bannerId = banner?.id;
  useEffect(() => {
    if (!bannerId) return;
    const id = window.setTimeout(() => setBanner(null), 3200);
    return () => window.clearTimeout(id);
  }, [bannerId]);

  const run = async (key: string, fn: () => Promise<string | null>, sound: 'chip' | 'click' = 'click') => {
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
    void useWallet.getState().fetchStatus();
  };

  const onBet = (z: Zone) => {
    if (!mySeat) {
      toast.info('Take a seat to bet', 'Use “Take a seat” above the layout.');
      return;
    }
    if (!canBet) {
      toast.info('No more bets', 'Wait for the next spin.');
      return;
    }
    if (!chip) return;
    void run('bet', () => call('rl_place_bet', { p_type: z.type, p_selection: z.selection, p_amount: chip }), 'chip');
  };

  const leave = async () => {
    if (mySeat) {
      const err = await t.leave();
      if (err) return toast.error(err);
    }
    navigate('/lobby?game=roulette');
  };

  if (error && !state) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Couldn't open this table" message={error} />
          <div className="flex justify-center pb-6">
            <Button variant="outline" size="sm" onClick={() => navigate('/lobby?game=roulette')}>
              Back to the lobby
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!state) return <FullPageLoader label="Taking you to the wheel…" />;

  const table = state.table;
  const spinning = round?.phase === 'spinning';
  const showResult = round?.phase === 'settled' && round.result !== null && (landedRound === round.id || !animateLanding);
  const denoms = chipDenominations(table.min_bet, table.max_bet);
  const stakes = new Map<string, number>();
  for (const b of boardBets) stakes.set(b.user_id, (stakes.get(b.user_id) ?? 0) + b.amount);

  const status = (() => {
    if (!round || nextReady) return { key: 'open', label: mySeat ? 'Place your bets' : 'Waiting for bets', timed: false };
    if (round.phase === 'betting') return { key: `bet-${round.id}`, label: 'Bets close in', timed: true };
    if (round.phase === 'spinning') return { key: `spin-${round.id}`, label: 'No more bets!', timed: false };
    return { key: `res-${round.id}-${showResult}`, label: showResult ? 'Next spin in' : 'The ball is landing…', timed: showResult };
  })();
  const phaseSeconds =
    round?.phase === 'betting' ? state.rules.bet_seconds : round?.phase === 'settled' ? state.rules.next_round_seconds : 0;

  return (
    <div className="mx-auto max-w-6xl px-3 pb-40 pt-4 sm:px-4 md:pb-10">
      <TableHeader
        table={table}
        watchers={t.watchers}
        connected={t.connected}
        mySeat={mySeat}
        onLeave={() => void leave()}
        onRules={() => setRulesOpen(true)}
        onHistory={() => setHistoryOpen(true)}
        onSitOut={() => mySeat && void run('sitout', () => t.sitOut(mySeat.status !== 'sitting_out'))}
      />

      <div className="mt-4">
        <PlayerStrip
          seats={state.seats}
          maxSeats={table.max_seats}
          userId={userId}
          reactions={t.reactions}
          canSit={!mySeat}
          onSit={() => void run('sit', () => t.sit(), 'chip')}
          stakes={stakes}
        />
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,300px)_1fr]">
        {/* Wheel, status, recent numbers */}
        <section aria-label="Wheel" className="felt flex flex-col items-center gap-4 rounded-3xl border-[8px] border-[#3a2412] p-4">
          <RouletteWheel
            variant={table.variant}
            spinning={spinning}
            result={round?.phase === 'settled' ? round.result : null}
            instant={!animateLanding}
            size={vertical ? 180 : 250}
          />
          <div className="relative flex min-h-16 flex-col items-center justify-center gap-1.5" aria-live="polite">
            <AnimatePresence mode="wait">
              {banner ? (
                <motion.div
                  key={`banner-${banner.id}`}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                  className={cn(
                    'rounded-full px-5 py-2 font-display text-lg font-bold shadow-xl',
                    banner.paid > 0 ? 'bg-gradient-to-r from-gold-300 to-gold-500 text-ink-950' : 'bg-ink-700 text-ivory',
                  )}
                  role="status"
                >
                  {banner.paid > 0 ? (
                    <>
                      You win <ChipAmount value={banner.paid} className="ml-1 align-middle" iconClassName="h-5 w-5" />
                    </>
                  ) : (
                    'No win this spin'
                  )}
                </motion.div>
              ) : (
                <motion.div key={status.key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-1.5">
                  {showResult && round?.result != null && (
                    <div className="flex items-center gap-2">
                      <NumberBall n={round.result} size="lg" />
                      <span className="text-sm font-semibold capitalize text-cream">{pocketColor(round.result)}</span>
                    </div>
                  )}
                  <p className="rounded-full bg-ink-950/60 px-4 py-1.5 text-sm font-medium text-gold-200">
                    {status.label}
                    {status.timed && secondsLeft !== null && (
                      <>
                        {' · '}
                        <span className="inline-block min-w-[2.2ch] text-left tabular-nums">{secondsLeft}s</span>
                      </>
                    )}
                  </p>
                  {status.timed && round?.phase_ends_at && phaseSeconds > 0 && (
                    <PhaseBar endsAt={round.phase_ends_at} totalSeconds={phaseSeconds} offsetMs={offsetMs} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>{burst > 0 && <ChipBurst key={burst} count={16} />}</AnimatePresence>
          </div>

          <div className="w-full">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-felt-300/80">Last numbers</p>
            {state.recent.length === 0 ? (
              <p className="mt-1 text-xs text-cream/60">No spins yet at this table.</p>
            ) : (
              <div className="scrollbar-thin mt-1.5 flex gap-1 overflow-x-auto pb-1">
                {state.recent.map((n, i) => (
                  <NumberBall key={i} n={n} size="sm" />
                ))}
              </div>
            )}
          </div>
          {state.stats.spins > 0 && (
            <div className="grid w-full grid-cols-2 gap-3 text-xs">
              <div>
                <p className="font-semibold uppercase tracking-wider text-gold-300">Hot</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {state.stats.hot.map((h) => (
                    <span key={h.n} title={`${h.hits} times in the last ${state.stats.spins} spins`}>
                      <NumberBall n={h.n} size="sm" />
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider text-sapphire-300">Cold</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {state.stats.cold.map((h) => (
                    <span key={h.n} title={`${h.hits} times in the last ${state.stats.spins} spins`}>
                      <NumberBall n={h.n} size="sm" />
                    </span>
                  ))}
                </div>
              </div>
              <p className="col-span-2 text-cream/60">
                Last {state.stats.spins}: <span className="text-ruby-300">{state.stats.red} red</span> ·{' '}
                <span className="text-cream">{state.stats.black} black</span> ·{' '}
                <span className="text-felt-300">{state.stats.zero} zero</span>
              </p>
            </div>
          )}
        </section>

        {/* Layout */}
        <section aria-label="Betting layout" className="flex flex-col gap-3">
          <div className={cn('mx-auto w-full', vertical && 'max-w-[17rem]')}>
            <RouletteBoard
              variant={table.variant}
              bets={boardBets}
              userId={userId}
              vertical={vertical}
              disabled={busy === 'bet'}
              winning={showResult ? round!.result : null}
              onBet={onBet}
            />
          </div>
        </section>
      </div>

      {/* Controls */}
      <section
        aria-label="Your controls"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-900/95 px-3 py-3 backdrop-blur md:static md:mt-5 md:rounded-2xl md:border md:bg-ink-800/80 md:px-5 md:py-4"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          {mySeat && <ReactionBar onSend={t.sendReaction} />}
          {!mySeat ? (
            <p className="flex-1 text-sm text-cream/80">You&apos;re watching. Take a seat to place bets.</p>
          ) : (
            <>
              <div className="flex gap-1.5" role="radiogroup" aria-label="Chip value">
                {denoms.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={chip === d}
                    onClick={() => {
                      setChip(d);
                      playSound('chip');
                    }}
                    disabled={d > balance}
                    className={cn(
                      'relative flex h-11 w-11 items-center justify-center rounded-full transition disabled:opacity-40',
                      chip === d ? '-translate-y-1 ring-2 ring-gold-300 ring-offset-2 ring-offset-ink-900' : 'hover:-translate-y-0.5',
                    )}
                    aria-label={`${d} chip`}
                  >
                    <ChipIcon className="absolute inset-0 h-11 w-11" color={chipColorFor(d)} />
                    <span className="relative rounded bg-ink-950/75 px-1 text-[0.6rem] font-bold text-ivory">{formatChipsCompact(d)}</span>
                  </button>
                ))}
              </div>
              <div className="text-sm text-cream/85">
                Your bets: <ChipAmount value={myTotal} className="font-bold text-ivory" iconClassName="h-4 w-4" />
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" disabled={!canBet || myBets.length === 0} onClick={() => void run('undo', () => call('rl_undo_bet', { p_all: false }))}>
                  Undo
                </Button>
                <Button size="sm" variant="ghost" disabled={!canBet || myBets.length === 0} onClick={() => void run('clear', () => call('rl_undo_bet', { p_all: true }))}>
                  Clear
                </Button>
                <Button size="sm" variant="felt" disabled={!canBet || myBets.length > 0} loading={busy === 'rebet'} onClick={() => void run('rebet', () => call('rl_rebet'), 'chip')}>
                  Rebet
                </Button>
              </div>
            </>
          )}
        </div>
      </section>

      <RouletteRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} variant={table.variant} />
      <GameHistoryModal<{ result?: number; bets?: { type: string; selection: string; amount: number; payout: number }[] }>
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        game="roulette"
        title="Spin history"
        renderRow={(r) => (
          <div className="flex items-center gap-2">
            {typeof r.summary.result === 'number' && <NumberBall n={r.summary.result} size="sm" />}
            <span className="truncate text-sm text-cream/85">
              {(r.summary.bets ?? []).length} bet{(r.summary.bets ?? []).length === 1 ? '' : 's'}
            </span>
          </div>
        )}
      />
    </div>
  );
}
