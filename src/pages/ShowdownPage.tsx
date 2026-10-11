import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChipBurst } from '@/components/economy/ChipBurst';
import { describeGrid, SlotReels } from '@/components/slots/SlotReels';
import { TournamentRules } from '@/components/tournaments/TournamentRules';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { useNow } from '@/hooks/useNow';
import { friendlyError } from '@/lib/errors';
import { formatChips } from '@/lib/format';
import { buildScenes, idleGrid, reelCount, THEMES, type Scene, type SlotInfo, type SlotResult } from '@/lib/slots';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { countdown, ordinal, SHOWDOWN_TIER_LABEL, useTourneyFeed, type Showdown, type TourneyConfig } from '@/lib/tournaments';
import { useAuth } from '@/stores/authStore';
import { prefersReducedMotion, useSettings } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

const WIDTH: Record<string, string> = { classic: 'max-w-sm', lines: 'max-w-2xl', ways: 'max-w-md', cluster: 'max-w-lg' };
// Spins are scored as if the bet were 100, so a win's points are its hundredths of the bet.
const POINTS_BET = 100;

interface SpinAnswer {
  round_id: string;
  game: string;
  result: SlotResult;
  units: number;
  score: number;
  spins_left: number;
}

/** /tournaments/:id: one Slot Showdown or Daily Freeroll round. */
export default function ShowdownPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const userId = useAuth((s) => s.user?.id);
  const { data: round, error, offsetMs, load } = useTourneyFeed<Showdown>('showdown_state', { p_tournament: id }, 5000);
  const now = useNow(500, offsetMs);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  const [info, setInfo] = useState<SlotInfo | null>(null);
  const [config, setConfig] = useState<TourneyConfig | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'playing'>('idle');
  const [scene, setScene] = useState<Scene | null>(null);
  const [landed, setLanded] = useState(true);
  const [spinning, setSpinning] = useState<boolean[]>([]);
  const [last, setLast] = useState<number | null>(null);
  const [burst, setBurst] = useState(0);
  // What the reels have shown so far: the server already knows the final numbers.
  const [shown, setShown] = useState<{ score: number; spins: number } | null>(null);

  const machine = round?.machine;
  useEffect(() => {
    if (!machine) return;
    void supabase.rpc('slot_info', { p_game: machine }).then(({ data, error: err }) => {
      if (err) toast.error(friendlyError(err));
      else setInfo(data as SlotInfo);
    });
  }, [machine]);

  const runId = useRef(0);
  const skip = useRef(false);
  const wake = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      runId.current++;
      wake.current?.();
    },
    [],
  );
  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        if (skip.current) return resolve();
        const t = window.setTimeout(resolve, ms);
        wake.current = () => {
          window.clearTimeout(t);
          resolve();
        };
      }),
    [],
  );

  const cfg = info?.config;
  const idle = useMemo<Scene | null>(
    () => (cfg && machine ? { id: 'idle', grid: idleGrid(machine, cfg), enter: 'none', hl: [], lines: [], units: 0, won: 0, ms: 0, tone: 'base' } : null),
    [cfg, machine],
  );

  // The round was settled: your wallet and achievements may have changed.
  const status = round?.status;
  useEffect(() => {
    if (status && status !== 'running') void useWallet.getState().fetchStatus();
  }, [status]);

  if (error && !round) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Couldn't open this round" message={error} onRetry={() => void load()} />
          <div className="flex justify-center pb-6">
            <Button variant="outline" size="sm" onClick={() => navigate('/tournaments')}>
              Back to tournaments
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!round || !info || !cfg || !idle) return <FullPageLoader label="Warming up the reels…" />;

  const theme = THEMES[round.machine] ?? THEMES.slots_classic;
  const reels = reelCount(cfg);
  const msLeft = new Date(round.ends_at).getTime() - now;
  const open = round.status === 'running' && msLeft > 0;
  const me = round.me;
  const busy = phase !== 'idle';
  const score = busy && shown ? shown.score : me?.score ?? 0;
  const spinsLeft = busy && shown ? shown.spins : me?.spins_left ?? 0;
  const view = scene ?? idle;
  const title = round.kind === 'freeroll' ? 'Daily Freeroll' : `Slot Showdown · ${SHOWDOWN_TIER_LABEL[round.tier] ?? ''}`;

  const openRules = async () => {
    if (!config) {
      const { data } = await supabase.rpc('tournaments_state');
      if (data) setConfig((data as { config: TourneyConfig }).config);
    }
    setRulesOpen(true);
  };

  const enter = async () => {
    const { error: err } = await supabase.rpc('showdown_enter', { p_tournament: round.id });
    void useWallet.getState().fetchStatus();
    if (err) {
      playSound('error');
      toast.error(friendlyError(err));
    } else playSound('chip');
    void load();
  };

  const spin = async () => {
    if (busy || !me || me.spins_left <= 0 || !open) return;
    const my = ++runId.current;
    const alive = () => my === runId.current;
    const speed = reduced ? 0.35 : 1;
    skip.current = false;
    setShown({ score: me.score, spins: me.spins_left - 1 });
    setPhase('waiting');
    setLast(null);
    setLanded(false);
    setSpinning(Array(reels).fill(true));
    playSound('spin');
    const t0 = performance.now();
    const { data, error: err } = await supabase.rpc('showdown_spin', { p_tournament: round.id });
    if (!alive()) return;
    if (err) {
      setSpinning(Array(reels).fill(false));
      setLanded(true);
      setPhase('idle');
      setShown(null);
      playSound('error');
      toast.error(friendlyError(err));
      void load();
      return;
    }
    const res = data as SpinAnswer;
    const scenes = buildScenes(
      { round_id: res.round_id, game: res.game, bet: POINTS_BET, tier: 'low', win: res.units, jackpot_won: 0, jackpot: null, balance: 0, result: res.result },
      cfg,
    );
    await sleep(Math.max(0, 550 * speed - (performance.now() - t0)));
    setPhase('playing');
    for (let i = 0; i < scenes.length && alive() && !skip.current; i++) {
      const sc = scenes[i];
      setLanded(false);
      if (sc.enter === 'spin') {
        if (i > 0) {
          setSpinning(Array(reels).fill(true));
          playSound('spin');
          await sleep(400 * speed);
        }
        setScene(sc);
        for (let c = 0; c < reels && alive() && !skip.current; c++) {
          setSpinning((prev) => prev.map((s, k) => (k <= c ? false : s)));
          playSound('reel');
          await sleep((reels > 5 ? 80 : reels > 3 ? 110 : 170) * speed);
        }
      } else {
        setSpinning(Array(reels).fill(false));
        setScene(sc);
        if (sc.enter !== 'none') await sleep(340 * speed);
      }
      if (!alive() || skip.current) break;
      setLanded(true);
      setLast(sc.won);
      setShown({ score: me.score + sc.won, spins: res.spins_left });
      if (sc.banner && !sc.units) playSound('feature');
      else if (sc.fresh?.length) playSound('pop');
      else if (sc.units >= 500) playSound('win');
      else if (sc.units > 0) playSound('coins');
      await sleep(sc.ms * 0.8 * speed);
    }
    if (!alive()) return;
    const end = scenes[scenes.length - 1];
    setSpinning(Array(reels).fill(false));
    setScene({ ...end, id: `${end.id}-end`, enter: 'none', banner: undefined, caption: undefined });
    setLanded(true);
    setLast(res.units);
    if (res.units >= 2000) setBurst((b) => b + 1);
    setShown({ score: res.score, spins: res.spins_left });
    await load();
    if (!alive()) return;
    setPhase('idle');
    setShown(null);
    if (res.spins_left === 0) {
      playSound('success');
      toast.success('All spins used', `Your score is ${formatChips(res.score)}. Results come when the clock runs out.`);
    }
  };

  const line = (() => {
    if (phase === 'waiting') return 'Spinning…';
    if (phase === 'playing') return view.caption ?? (landed && view.label ? view.label : 'Good luck!');
    if (round.status === 'void') return 'Not enough players: this round was called off.';
    if (!open) return round.status === 'finished' ? 'Final standings' : 'Time is up. Working out the results…';
    if (!me) return 'Enter to get your spins.';
    if (me.spins_left === 0) return 'All spins used. Waiting for the clock.';
    if (last === null) return `${me.spins_left} spins to go. Every win adds to your score.`;
    return last > 0 ? `+${formatChips(last)} points` : 'No points that spin.';
  })();

  const inTop = round.top.some((r) => r.user_id === userId);

  return (
    <div className="mx-auto max-w-5xl px-3 pb-36 pt-4 sm:px-4 md:pb-10">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="ghost" onClick={() => navigate('/tournaments')}>
          ← Tournaments
        </Button>
        <h1 className="font-display text-xl font-bold text-ivory sm:text-2xl">{title}</h1>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-cream/80">{round.machine_name}</span>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums',
              open ? (msLeft < 60_000 ? 'bg-ruby-500/25 text-ruby-200' : 'bg-felt-600/60 text-felt-300') : 'bg-white/[0.07] text-cream/75',
            )}
            role="timer"
            aria-label={open ? `Time left ${countdown(msLeft)}` : 'Round over'}
          >
            {open ? `${countdown(msLeft)} left` : round.status === 'void' ? 'Called off' : 'Round over'}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void openRules()}>
            Rules
          </Button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-label={`${round.machine_name} reels`} className="relative rounded-3xl border border-gold-500/30 p-3 shadow-card sm:p-5" style={{ background: theme.cabinet }}>
          <p key={line} className="mb-3 min-h-6 text-center font-display text-base font-bold sm:text-lg" style={{ color: theme.accent }} aria-live="polite">
            {line}
          </p>
          <div className={cn('relative mx-auto', WIDTH[cfg.kind])}>
            <SlotReels game={round.machine} cfg={cfg} scene={view} landed={landed} spinning={spinning} bet={POINTS_BET} />
            <p className="sr-only" aria-live="polite">
              {landed && phase !== 'waiting' ? describeGrid(round.machine, view) : ''}
            </p>
            <AnimatePresence>
              {landed && view.banner && (
                <motion.div
                  key={view.id}
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
                >
                  <div className="rounded-2xl border border-gold-400/60 bg-ink-950/90 px-6 py-4 text-center shadow-glow-gold">
                    <p className="gold-text font-display text-2xl font-black sm:text-4xl">{view.banner.title}</p>
                    {view.banner.chips !== undefined && <p className="mt-1 text-xl font-bold text-ivory">+{formatChips(view.banner.chips)} points</p>}
                    {view.banner.sub && <p className="mt-1 text-sm text-cream/80">{view.banner.sub}</p>}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {burst > 0 && <ChipBurst key={burst} count={18} />}
          </div>
          <dl className="mt-3 flex items-center justify-center gap-8 text-center text-sm">
            <div>
              <dt className="text-[0.65rem] uppercase tracking-wider text-cream/60">Your score</dt>
              <dd className="font-display text-2xl font-black tabular-nums text-gold-200" data-testid="showdown-score">
                {formatChips(score)}
              </dd>
            </div>
            <div>
              <dt className="text-[0.65rem] uppercase tracking-wider text-cream/60">Spins left</dt>
              <dd className="font-display text-2xl font-black tabular-nums text-ivory" data-testid="showdown-spins">
                {me ? spinsLeft : '–'}
              </dd>
            </div>
            {me && (
              <div>
                <dt className="text-[0.65rem] uppercase tracking-wider text-cream/60">Place</dt>
                <dd className="font-display text-2xl font-black tabular-nums text-ivory">{ordinal(me.place)}</dd>
              </div>
            )}
          </dl>
        </section>

        <aside aria-labelledby="standings-h" className="surface self-start p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="standings-h" className="font-display text-lg font-bold text-ivory">
              {round.status === 'finished' ? 'Final standings' : 'Standings'}
            </h2>
            <span className="text-xs text-muted">
              {round.entrants} in · pot <ChipAmount value={round.prize_pool} className="text-gold-200" iconClassName="h-3 w-3" />
            </span>
          </div>
          {round.top.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nobody has entered yet.</p>
          ) : (
            <ol className="mt-2 divide-y divide-white/[0.06]">
              {round.top.map((r) => (
                <li key={r.user_id} className={cn('flex items-center gap-2 py-2 text-sm', r.user_id === userId && 'text-gold-200')}>
                  <span className="w-6 shrink-0 text-right tabular-nums text-muted">{r.place}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{r.user_id === userId ? 'You' : r.username}</span>
                  {r.prize ? (
                    <ChipAmount value={r.prize} signed className="shrink-0 text-xs font-semibold text-gold-200" iconClassName="h-3 w-3" />
                  ) : (
                    round.status === 'running' && r.spins_left > 0 && <span className="shrink-0 text-[0.65rem] text-muted">{r.spins_left} left</span>
                  )}
                  <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{formatChips(r.user_id === userId ? score : r.score)}</span>
                </li>
              ))}
              {me && !inTop && (
                <li className="flex items-center gap-2 py-2 text-sm text-gold-200">
                  <span className="w-6 shrink-0 text-right tabular-nums">{me.place}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">You</span>
                  <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{formatChips(score)}</span>
                </li>
              )}
            </ol>
          )}
          {round.status === 'finished' && me && (
            <p className="mt-3 rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 text-sm text-cream/90" role="status">
              You finished <strong className="text-gold-200">{ordinal(me.place)}</strong> of {round.entrants}
              {me.prize ? (
                <>
                  {' '}
                  and won <ChipAmount value={me.prize} className="font-bold text-gold-200" iconClassName="h-4 w-4" />.
                </>
              ) : (
                '.'
              )}
            </p>
          )}
        </aside>
      </div>

      <section
        aria-label="Your controls"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-900/95 px-3 py-3 backdrop-blur md:static md:mt-5 md:rounded-2xl md:border md:bg-ink-800/80 md:px-5 md:py-4"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-sm text-cream/80">
            {!open
              ? 'This round is over.'
              : !me
                ? round.entry_fee === 0
                  ? 'Free to enter.'
                  : 'Spins move no chips: only the entry is at stake.'
                : 'Spins move no chips: every win is points.'}
          </p>
          {!open ? (
            <Button size="lg" className="min-w-36" onClick={() => navigate('/tournaments')}>
              More tournaments
            </Button>
          ) : !me ? (
            <Button size="lg" className="min-w-36" onClick={() => void enter()}>
              {round.entry_fee === 0 ? 'Enter free' : `Enter · ${formatChips(round.entry_fee)}`}
            </Button>
          ) : phase === 'playing' ? (
            <Button
              size="lg"
              variant="outline"
              className="min-w-36"
              onClick={() => {
                skip.current = true;
                wake.current?.();
              }}
            >
              Skip
            </Button>
          ) : (
            <Button size="lg" className="min-w-36" loading={phase === 'waiting'} disabled={me.spins_left <= 0} onClick={() => void spin()}>
              {me.spins_left > 0 ? 'Spin' : 'Done'}
            </Button>
          )}
        </div>
      </section>

      {config && <TournamentRules open={rulesOpen} onClose={() => setRulesOpen(false)} config={config} />}
    </div>
  );
}
