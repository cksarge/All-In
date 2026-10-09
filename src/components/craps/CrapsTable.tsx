import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChipBurst } from '@/components/economy/ChipBurst';
import { GameHistoryModal } from '@/components/table/GameHistoryModal';
import { InfoModal, TabButtons } from '@/components/table/InfoModal';
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
import { useNow } from '@/hooks/useNow';
import { chipDenominations } from '@/lib/blackjack';
import {
  BET_LABEL,
  oddsAllowed,
  outcomeText,
  placeWin,
  removable,
  type CrBetType,
  type CrState,
} from '@/lib/craps';
import { formatChipsCompact } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { CrapsLayout } from './CrapsLayout';
import { Die, DicePair } from './Dice';

const BEGINNER_KEY = 'allin-craps-beginner';

export function CrapsTable({ tableId }: { tableId: string }) {
  const navigate = useNavigate();
  const t = useLiveTable<CrState>({
    tableId,
    stateFn: 'cr_state',
    advanceFn: 'cr_advance',
    realtimeTables: ['cr_state', 'cr_bets', 'cr_rolls'],
    getDeadline: (s) => ({ at: s.state.phase === 'betting' ? s.state.phase_ends_at : null, advance: true }),
  });
  const { state, error, offsetMs, mySeat, userId, call } = t;
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const [chip, setChip] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [beginner, setBeginner] = useState(() => {
    try {
      return localStorage.getItem(BEGINNER_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const [banner, setBanner] = useState<{ roll: number; text: string; net: number } | null>(null);
  const [burst, setBurst] = useState(0);
  const now = useNow(500, offsetMs);
  const secondsLeft = useSecondsLeft(state?.state.phase === 'betting' ? state.state.phase_ends_at : null, offsetMs);

  useEffect(() => {
    if (state && chip === null) setChip(state.table.min_bet);
  }, [state, chip]);

  useEffect(() => {
    try {
      localStorage.setItem(BEGINNER_KEY, beginner ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [beginner]);

  // React to each new roll: sound, banner with what I won, chip burst.
  const seenRoll = useRef<number | null>(null);
  const rollNo = state?.state.roll_no ?? 0;
  useEffect(() => {
    if (!state) return;
    if (seenRoll.current === null) {
      seenRoll.current = rollNo; // page just opened: don't celebrate an old roll
      return;
    }
    if (rollNo === seenRoll.current) return;
    seenRoll.current = rollNo;
    const last = state.recent[0];
    if (!last) return;
    playSound('card');
    let won = 0;
    let lost = 0;
    for (const r of state.last_results) {
      if (r.user_id !== userId) continue;
      if (r.status === 'won' || r.status === 'push') won += r.payout;
      else if (r.status === 'lost') lost += r.amount + r.odds;
      else if (r.status === 'active' && r.bet_type === 'place' && r.number !== null) won += r.amount + placeWin(r.number, r.amount);
    }
    window.setTimeout(() => {
      setBanner({ roll: rollNo, text: outcomeText(last), net: won > 0 ? won : -lost });
      if (won > 0) {
        playSound('win');
        setBurst((b) => b + 1);
      } else if (lost > 0) {
        playSound('lose');
      }
      void useWallet.getState().fetchStatus();
    }, 700);
  }, [rollNo, state, userId]);

  const bannerRoll = banner?.roll;
  useEffect(() => {
    if (bannerRoll === undefined) return;
    const id = window.setTimeout(() => setBanner(null), 3200);
    return () => window.clearTimeout(id);
  }, [bannerRoll]);

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

  if (error && !state) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Couldn't open this table" message={error} />
          <div className="flex justify-center pb-6">
            <Button variant="outline" size="sm" onClick={() => navigate('/lobby?game=craps')}>
              Back to the lobby
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!state) return <FullPageLoader label="Heading to the craps table…" />;

  const table = state.table;
  const s = state.state;
  const point = s.point;
  const shooter = state.seats.find((x) => x.user_id === s.shooter_user);
  const iAmShooter = s.shooter_user === userId;
  const gapLeft = s.last_roll_at
    ? Math.max(0, state.rules.min_roll_gap_seconds * 1000 - (now - new Date(s.last_roll_at).getTime()))
    : 0;
  const canRoll = iAmShooter && s.phase === 'betting' && gapLeft <= 0;
  const myBets = state.bets.filter((b) => b.user_id === userId);
  const stakes = new Map<string, number>();
  for (const b of state.bets) stakes.set(b.user_id, (stakes.get(b.user_id) ?? 0) + b.amount + b.odds);
  const denoms = chipDenominations(table.min_bet, table.max_bet);

  const allowed = (spot: { type: CrBetType; number: number | null }): string | null => {
    if (!mySeat) return 'Take a seat to bet.';
    if ((spot.type === 'pass' || spot.type === 'dont_pass') && point !== null)
      return 'Line bets go down on the come-out roll. Try Come / Don’t Come.';
    if ((spot.type === 'come' || spot.type === 'dont_come') && point === null)
      return 'Come bets open once a point is set. Use Pass / Don’t Pass now.';
    return null;
  };

  const onBet = (spot: { type: CrBetType; number: number | null }) => {
    if (!chip) return;
    void run('bet', () => call('cr_place_bet', { p_type: spot.type, p_number: spot.number, p_amount: chip }), 'chip');
  };

  const leave = async () => {
    if (mySeat) {
      const err = await t.leave();
      if (err) return toast.error(err);
    }
    navigate('/lobby?game=craps');
  };

  const statusText =
    s.phase === 'idle'
      ? mySeat
        ? point === null
          ? 'Come-out roll: place a bet to get the dice moving'
          : 'Place a bet to keep the dice moving'
        : 'Waiting for bets'
      : iAmShooter
        ? 'You have the dice'
        : `${shooter?.username ?? 'The house'} is shooting`;

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
        extra={
          <label className="mr-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs text-cream/85 hover:bg-white/[0.05]">
            <input type="checkbox" checked={beginner} onChange={(e) => setBeginner(e.target.checked)} className="accent-gold-500" />
            Beginner mode
          </label>
        }
      />

      <div className="mt-4">
        <PlayerStrip
          seats={state.seats}
          maxSeats={table.max_seats}
          userId={userId}
          reactions={t.reactions}
          canSit={!mySeat}
          onSit={() => void run('sit', () => t.sit(), 'chip')}
          highlightUser={s.shooter_user}
          highlightLabel="🎲 Shooter"
          stakes={stakes}
        />
      </div>

      <section
        aria-label="Craps table"
        className="felt relative mt-4 rounded-[2rem] border-[10px] border-[#3a2412] p-3 shadow-[inset_0_0_80px_rgba(0,0,0,0.55)] sm:p-5"
      >
        {/* Dice and status */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <DicePair dice={s.last_dice} rollKey={s.roll_no} />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-felt-300/80">Point</p>
              {point === null ? (
                <span className="inline-flex items-center rounded-full border-2 border-ink-950 bg-ink-900 px-2.5 py-0.5 text-xs font-black text-cream">
                  OFF
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border-2 border-ink-950 bg-ivory px-2.5 py-0.5 text-xs font-black text-ink-950">
                  ON · {point}
                </span>
              )}
            </div>
          </div>

          <div className="relative flex min-h-12 flex-1 flex-col items-center justify-center gap-1.5 sm:items-end" aria-live="polite">
            <AnimatePresence mode="wait">
              {banner ? (
                <motion.div
                  key={`b-${banner.roll}`}
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className={cn(
                    'rounded-full px-4 py-1.5 font-display text-base font-bold shadow-xl',
                    banner.net > 0 ? 'bg-gradient-to-r from-gold-300 to-gold-500 text-ink-950' : banner.net < 0 ? 'bg-ruby-800 text-ivory' : 'bg-ink-700 text-ivory',
                  )}
                  role="status"
                >
                  {banner.text}
                  {banner.net > 0 && (
                    <>
                      {' · '}You win <ChipAmount value={banner.net} className="align-middle" iconClassName="h-4 w-4" />
                    </>
                  )}
                </motion.div>
              ) : (
                <motion.div key={`${s.phase}-${s.shooter_user}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-1.5 sm:items-end">
                  <p className="rounded-full bg-ink-950/60 px-4 py-1.5 text-sm font-medium text-gold-200">
                    {statusText}
                    {s.phase === 'betting' && secondsLeft !== null && (
                      <>
                        {' · '}auto-roll in <span className="inline-block min-w-[2.2ch] text-left tabular-nums">{secondsLeft}s</span>
                      </>
                    )}
                  </p>
                  {s.phase === 'betting' && s.phase_ends_at && (
                    <PhaseBar endsAt={s.phase_ends_at} totalSeconds={state.rules.roll_seconds} offsetMs={offsetMs} />
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence>{burst > 0 && <ChipBurst key={burst} count={16} />}</AnimatePresence>
          </div>

          {iAmShooter && (
            <Button size="lg" onClick={() => void run('roll', () => call('cr_roll'))} disabled={!canRoll} loading={busy === 'roll'}>
              🎲 {gapLeft > 0 ? 'Hold on…' : s.phase === 'idle' ? 'Bet to roll' : 'Roll the dice'}
            </Button>
          )}
        </div>

        <CrapsLayout point={point} bets={state.bets} userId={userId} beginner={beginner} allowed={allowed} onBet={onBet} />

        {/* Roll history */}
        {state.recent.length > 0 && (
          <div className="mt-4">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-felt-300/80">Last rolls</p>
            <div className="scrollbar-thin mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
              {state.recent.map((r) => (
                <span
                  key={r.roll_no}
                  title={outcomeText(r)}
                  className={cn(
                    'flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 text-xs font-bold tabular-nums',
                    r.outcome === 'seven_out' || r.outcome === 'craps' ? 'bg-ruby-700 text-ivory' : r.outcome === 'point_made' || r.outcome === 'natural' ? 'bg-gold-500 text-ink-950' : r.outcome === 'point_set' ? 'bg-ivory text-ink-950' : 'bg-ink-800 text-cream',
                  )}
                >
                  {r.total}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* My bets */}
      {myBets.length > 0 && (
        <section aria-label="Your bets" className="surface mt-4 p-4">
          <h2 className="font-display text-lg font-bold text-ivory">Your bets</h2>
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {myBets.map((b) => {
              const canOdds = oddsAllowed(b, point) && b.odds < b.amount * state.rules.max_odds_multiple;
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="min-w-32 font-medium text-ivory">
                    {BET_LABEL[b.bet_type]}
                    {b.number !== null && ` ${b.number}`}
                    {b.bet_type === 'come' && b.number === null && ' (in the box)'}
                  </span>
                  <ChipAmount value={b.amount} className="text-cream" iconClassName="h-4 w-4" />
                  {b.odds > 0 && (
                    <span className="text-xs text-gold-200">
                      + odds <ChipAmount value={b.odds} iconClassName="h-3 w-3" />
                    </span>
                  )}
                  {b.bet_type === 'place' && b.payout > 0 && (
                    <span className="text-xs text-felt-300">
                      won <ChipAmount value={b.payout} iconClassName="h-3 w-3" /> so far
                    </span>
                  )}
                  <span className="ml-auto flex gap-1.5">
                    {canOdds && chip && (
                      <Button size="sm" variant="felt" onClick={() => void run(`odds-${b.id}`, () => call('cr_add_odds', { p_bet: b.id, p_amount: Math.min(chip, b.amount * state.rules.max_odds_multiple - b.odds) }), 'chip')}>
                        + Odds
                      </Button>
                    )}
                    {removable(b, point) && (
                      <Button size="sm" variant="ghost" onClick={() => void run(`rm-${b.id}`, () => call('cr_remove_bet', { p_bet: b.id }))}>
                        Take down
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Controls */}
      <section
        aria-label="Your controls"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-900/95 px-3 py-3 backdrop-blur md:static md:mt-5 md:rounded-2xl md:border md:bg-ink-800/80 md:px-5 md:py-4"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          {mySeat && <ReactionBar onSend={t.sendReaction} />}
          {!mySeat ? (
            <p className="flex-1 text-sm text-cream/80">You&apos;re watching. Take a seat to bet and shoot.</p>
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
              <p className="text-xs text-muted">
                {beginner ? 'Beginner mode: Pass, Don’t Pass, Field and Place 6/8 are highlighted.' : 'Tap a spot to bet the selected chip.'}
              </p>
            </>
          )}
        </div>
      </section>

      <CrapsRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} />
      <GameHistoryModal<{ roll_no?: number; dice?: [number, number]; total?: number; bet?: string; bets?: { bet: string }[] }>
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        game="craps"
        title="Roll history"
        renderRow={(r) => (
          <div className="flex items-center gap-2">
            {r.summary.dice && (
              <span className="flex gap-1">
                <Die value={r.summary.dice[0]} className="h-6 w-6" />
                <Die value={r.summary.dice[1]} className="h-6 w-6" />
              </span>
            )}
            <span className="truncate text-sm text-cream/85">
              {r.summary.bets ? r.summary.bets.map((x) => BET_LABEL[x.bet as CrBetType] ?? x.bet).join(', ') : r.summary.bet ? `${BET_LABEL[r.summary.bet as CrBetType]} hit` : ''}
            </span>
          </div>
        )}
      />
    </div>
  );
}

function CrapsRulesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'how' | 'payouts'>('how');
  return (
    <InfoModal open={open} onClose={onClose} title="Craps">
      <TabButtons
        tabs={[
          ['how', 'How to play'],
          ['payouts', 'Payouts'],
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'how' ? (
        <div className="mt-5 space-y-3 text-sm leading-relaxed text-cream/85">
          <p>
            <strong className="text-ivory">New here?</strong> Keep <em>Beginner mode</em> on and bet the{' '}
            <strong className="text-gold-200">Pass Line</strong>. That&apos;s the classic craps bet.
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              <strong className="text-ivory">Come-out roll:</strong> 7 or 11 wins the Pass Line; 2, 3 or 12 (craps) loses it.
              Any other number becomes the <strong className="text-ivory">point</strong> (the puck turns ON).
            </li>
            <li>
              <strong className="text-ivory">Point rolls:</strong> roll the point again before a 7 and Pass wins. A 7 first is
              a <em>seven-out</em>: Pass loses and the dice move to the next player.
            </li>
            <li>Don&apos;t Pass is the opposite (12 on the come-out is a push).</li>
            <li>Come / Don&apos;t Come work like Pass / Don&apos;t Pass but start on any roll after the point is set.</li>
            <li>Odds: once your line or come bet has a number, add odds (up to 3×) that pay true odds with no house edge.</li>
            <li>Place bets and hardways are off on come-out rolls. Field and center bets last one roll.</li>
          </ol>
          <p className="text-xs text-muted">
            The shooter rolls when ready (at least 3 s apart so everyone can bet). If they wait, the server rolls
            automatically when the timer ends. Dice are always rolled by the server.
          </p>
        </div>
      ) : (
        <table className="mt-5 w-full text-left text-sm">
          <caption className="sr-only">Craps payouts</caption>
          <tbody className="divide-y divide-white/[0.06]">
            {[
              ['Pass / Don’t Pass / Come / Don’t Come', '1 to 1'],
              ['Odds on 4 or 10', '2 to 1 (lay: 1 to 2)'],
              ['Odds on 5 or 9', '3 to 2 (lay: 2 to 3)'],
              ['Odds on 6 or 8', '6 to 5 (lay: 5 to 6)'],
              ['Place 4 or 10', '9 to 5'],
              ['Place 5 or 9', '7 to 5'],
              ['Place 6 or 8', '7 to 6'],
              ['Field (3, 4, 9, 10, 11)', '1 to 1'],
              ['Field 2 / 12', '2 to 1 / 3 to 1'],
              ['Hard 4 or 10', '7 to 1'],
              ['Hard 6 or 8', '9 to 1'],
              ['Any 7', '4 to 1'],
              ['Any craps (2, 3, 12)', '7 to 1'],
              ['2 or 12', '30 to 1'],
              ['3 or 11', '15 to 1'],
            ].map(([b, p]) => (
              <tr key={b}>
                <td className="py-2 text-ivory">{b}</td>
                <td className="py-2 text-gold-200">{p}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </InfoModal>
  );
}
