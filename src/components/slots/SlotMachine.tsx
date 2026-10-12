import { GameStatsModal } from '@/components/table/GameStatsModal';
import { useRemembered } from '@/hooks/useRemembered';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChipBurst } from '@/components/economy/ChipBurst';
import { GameHistoryModal } from '@/components/table/GameHistoryModal';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { TierBadge } from '@/components/ui/TierBadge';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { formatChips } from '@/lib/format';
import {
  buildScenes,
  FEATURE_LABELS,
  idleGrid,
  reelCount,
  THEMES,
  timesBet,
  type Scene,
  type SlotInfo,
  type SpinResponse,
} from '@/lib/slots';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { prefersReducedMotion, useSettings } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { JackpotTicker, useJackpot } from './JackpotTicker';
import { describeGrid, SlotReels } from './SlotReels';
import { SlotRulesModal } from './SlotRules';

const WIDTH: Record<string, string> = {
  classic: 'max-w-sm',
  lines: 'max-w-2xl',
  ways: 'max-w-md',
  cluster: 'max-w-lg',
};

type Phase = 'idle' | 'waiting' | 'playing';

export function SlotMachine({ gameKey }: { gameKey: string }) {
  const navigate = useNavigate();
  const [info, setInfo] = useState<SlotInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [betIndex, setBetIndex] = useRemembered(`bet:${gameKey}`, 0, (v) => Number.isInteger(v) && v >= 0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [scene, setScene] = useState<Scene | null>(null);
  const [landed, setLanded] = useState(true);
  const [spinning, setSpinning] = useState<boolean[]>([]);
  const [won, setWon] = useState<number | null>(null);
  const [burst, setBurst] = useState(0);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Auto-spin: how many spins are left to play by themselves (0 = off).
  const [autoLeft, setAutoLeft] = useState(0);
  const [statsOpen, setStatsOpen] = useState(false);
  const spinRef = useRef<(() => Promise<void>) | null>(null);
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));

  // One run of spin() at a time; bumping the id abandons a run (e.g. on leaving the page).
  const runId = useRef(0);
  const running = useRef(false);
  const skip = useRef(false);
  const wake = useRef<(() => void) | null>(null);
  const sleep = useCallback(
    (ms: number) =>
      new Promise<void>((resolve) => {
        if (skip.current) return resolve();
        const id = window.setTimeout(resolve, ms);
        wake.current = () => {
          window.clearTimeout(id);
          resolve();
        };
      }),
    [],
  );

  const load = useCallback(async () => {
    setError(null);
    const { data, error: err } = await supabase.rpc('slot_info', { p_game: gameKey });
    if (err) setError(friendlyError(err));
    else setInfo(data as SlotInfo);
  }, [gameKey]);

  useEffect(() => {
    void load();
    return () => {
      // Leaving mid-round: the server already paid, so just stop the show.
      runId.current++;
      wake.current?.();
      useWallet.getState().setDisplayBalance(null);
      void useWallet.getState().fetchStatus();
    };
  }, [load]);

  // Each time a spin ends (features and wins play out in full first), play the next one.
  // It only stops when the count runs out, the chips do, or Stop is pressed.
  useEffect(() => {
    if (autoLeft <= 0 || phase !== 'idle') return;
    const id = window.setTimeout(() => {
      setAutoLeft((n) => Math.max(0, n - 1));
      void spinRef.current?.();
    }, 700);
    return () => window.clearTimeout(id);
  }, [autoLeft, phase]);

  const cfg = info?.config;
  const idle = useMemo<Scene | null>(
    () =>
      cfg
        ? { id: 'idle', grid: idleGrid(gameKey, cfg), enter: 'none', hl: [], lines: [], units: 0, won: 0, ms: 0, tone: 'base' }
        : null,
    [cfg, gameKey],
  );
  const jackpot = useJackpot(gameKey, info?.jackpot ?? null, phase !== 'idle');

  if (error && !info) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Couldn't open this machine" message={error} onRetry={() => void load()} />
          <div className="flex justify-center pb-6">
            <Button variant="outline" size="sm" onClick={() => navigate('/lounge')}>
              Back to the lounge
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (!info || !cfg || !idle) return <FullPageLoader label="Warming up the reels…" />;

  const theme = THEMES[gameKey] ?? THEMES.slots_classic;
  const reels = reelCount(cfg);
  const bet = info.bets[Math.min(betIndex, info.bets.length - 1)] ?? 10;
  const tierOf = (b: number) => info.tiers.find((t) => b >= t.min_bet && b <= t.max_bet);
  const tier = tierOf(bet);
  const nextBet = info.bets[betIndex + 1];
  const nextTier = nextBet ? tierOf(nextBet) : undefined;
  const nextLocked = Boolean(nextTier && balance < nextTier.min_bankroll);
  const canRaise = Boolean(nextBet) && !nextLocked && nextBet <= balance;
  const shown = scene ?? idle;
  const busy = phase !== 'idle';

  const spin = async () => {
    if (busy || running.current) return;
    if (balance < bet) {
      playSound('error');
      setAutoLeft(0);
      toast.info('Not enough chips for that bet', 'Lower your bet, or pick up free chips in the lounge.');
      return;
    }
    const my = ++runId.current;
    running.current = true;
    const alive = () => my === runId.current;
    const speed = reduced ? 0.35 : 1;
    const wallet = useWallet.getState();
    const start = balance;
    skip.current = false;
    setPhase('waiting');
    setWon(null);
    setLanded(false);
    setSpinning(Array(reels).fill(true));
    wallet.setDisplayBalance(start - bet);
    playSound('spin');
    const t0 = performance.now();

    const { data, error: err } = await supabase.rpc('slot_spin', { p_game: gameKey, p_bet: bet });
    if (!alive()) return;
    if (err) {
      setSpinning(Array(reels).fill(false));
      setLanded(true);
      setPhase('idle');
      running.current = false;
      wallet.setDisplayBalance(null);
      void wallet.fetchStatus();
      playSound('error');
      setAutoLeft(0);
      toast.error(friendlyError(err));
      return;
    }
    const res = data as SpinResponse;
    const scenes = buildScenes(res, cfg);
    await sleep(Math.max(0, 650 * speed - (performance.now() - t0)));
    setPhase('playing');

    for (let i = 0; i < scenes.length && alive() && !skip.current; i++) {
      const sc = scenes[i];
      setLanded(false);
      if (sc.enter === 'spin') {
        if (i > 0) {
          setSpinning(Array(reels).fill(true));
          playSound('spin');
          await sleep(450 * speed);
        }
        setScene(sc);
        for (let c = 0; c < reels && alive() && !skip.current; c++) {
          setSpinning((prev) => prev.map((s, k) => (k <= c ? false : s)));
          playSound('reel');
          await sleep((reels > 5 ? 90 : reels > 3 ? 130 : 200) * speed);
        }
      } else {
        setSpinning(Array(reels).fill(false));
        setScene(sc);
        if (sc.enter !== 'none') await sleep(380 * speed);
      }
      if (!alive() || skip.current) break;
      setLanded(true);
      setWon(sc.won);
      wallet.setDisplayBalance(start - bet + sc.won);
      if (sc.tone === 'jackpot') {
        playSound('jackpot');
        setBurst((b) => b + 1);
      } else if (sc.banner && !sc.units) playSound('feature');
      else if (sc.fresh?.length) playSound('pop');
      else if (sc.units >= 500) playSound('win');
      else if (sc.units > 0) playSound('coins');
      await sleep(sc.ms * speed);
    }
    if (!alive()) return;

    // Done (or skipped): show where the round ended and settle the balance.
    const last = scenes[scenes.length - 1];
    setSpinning(Array(reels).fill(false));
    setScene({ ...last, id: `${last.id}-end`, enter: 'none', banner: undefined, caption: undefined });
    setLanded(true);
    setWon(res.win);
    if (res.win >= bet * 20) {
      setBurst((b) => b + 1);
      if (skip.current) playSound('win');
    }
    useWallet.setState((s) => ({ status: s.status ? { ...s.status, balance: res.balance } : s.status, displayBalance: null }));
    void wallet.fetchStatus();
    if (res.jackpot !== null) {
      const pot = res.jackpot;
      setInfo((i) => (i?.jackpot ? { ...i, jackpot: { ...i.jackpot, amount: pot } } : i));
      if (res.jackpot_won > 0) void load();
    }
    running.current = false;
    setPhase('idle');
  };

  spinRef.current = spin;

  const onSkip = () => {
    skip.current = true;
    wake.current?.();
  };

  const status = (() => {
    if (phase === 'waiting') return 'Spinning…';
    if (phase === 'playing') return shown.caption ?? (landed && shown.label ? shown.label : 'Good luck!');
    if (won === null) return theme.tagline;
    if (won === 0) return 'No win this time.';
    return won >= bet * 20 ? 'Big win!' : 'You win!';
  })();

  return (
    <div className="mx-auto max-w-3xl px-3 pb-44 pt-4 sm:px-4 md:pb-10">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="ghost" onClick={() => navigate('/lounge')}>
          ← Lounge
        </Button>
        <h1 className="font-display text-xl font-bold text-ivory sm:text-2xl">{info.name}</h1>
        {tier && <TierBadge tier={tier.tier} />}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setRulesOpen(true)}>
            Rules
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
            History
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setStatsOpen(true)}>
            Stats
          </Button>
        </div>
        <GameStatsModal open={statsOpen} onClose={() => setStatsOpen(false)} game={gameKey} name={info.name} />
      </div>

      {jackpot && (
        <div className="mt-4">
          <JackpotTicker jackpot={jackpot} />
        </div>
      )}

      <section
        aria-label={`${info.name} reels`}
        className="relative mt-4 rounded-3xl border border-gold-500/30 p-3 shadow-card sm:p-5"
        style={{ background: theme.cabinet }}
      >
        <p
          key={status}
          className="mb-3 min-h-6 text-center font-display text-base font-bold sm:text-lg"
          style={{ color: theme.accent }}
          aria-live="polite"
        >
          {status}
        </p>

        <div className={cn('relative mx-auto', WIDTH[cfg.kind])}>
          <SlotReels game={gameKey} cfg={cfg} scene={shown} landed={landed} spinning={spinning} bet={bet} />
          <p className="sr-only" aria-live="polite">
            {landed && phase !== 'waiting' ? describeGrid(gameKey, shown) : ''}
          </p>
          <AnimatePresence>
            {landed && shown.banner && (
              <motion.div
                key={shown.id}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className={cn(
                  'pointer-events-none absolute inset-0 z-20 flex justify-center',
                  // Keep the row of crowns in view.
                  shown.tone === 'jackpot' ? 'items-end pb-[3%]' : 'items-center',
                )}
              >
                <div className="rounded-2xl border border-gold-400/60 bg-ink-950/90 px-6 py-4 text-center shadow-glow-gold">
                  <p className="gold-text font-display text-2xl font-black sm:text-4xl">{shown.banner.title}</p>
                  {shown.banner.chips !== undefined && (
                    <ChipAmount value={shown.banner.chips} className="mt-1 text-xl font-bold text-ivory sm:text-2xl" />
                  )}
                  {shown.banner.sub && <p className="mt-1 text-sm text-cream/80">{shown.banner.sub}</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {burst > 0 && <ChipBurst key={burst} count={shown.tone === 'jackpot' ? 36 : 18} />}
        </div>

        <div className="mt-3 flex items-center justify-center gap-6 text-sm">
          <span className="text-cream/70">
            Bet <ChipAmount value={bet} className="ml-1 font-semibold text-ivory" iconClassName="h-4 w-4" />
          </span>
          <span className="text-cream/70">
            Win{' '}
            <ChipAmount
              value={won ?? 0}
              className={cn('ml-1 font-semibold', won ? 'text-gold-200' : 'text-ivory')}
              iconClassName="h-4 w-4"
            />
          </span>
        </div>
      </section>

      <section
        aria-label="Your controls"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-ink-900/95 px-3 py-3 backdrop-blur md:static md:mt-5 md:rounded-2xl md:border md:bg-ink-800/80 md:px-5 md:py-4"
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2" role="group" aria-label="Bet">
            <Button
              size="sm"
              variant="outline"
              aria-label="Lower bet"
              disabled={busy || betIndex === 0}
              onClick={() => {
                setBetIndex((i) => Math.max(0, i - 1));
                playSound('chip');
              }}
            >
              −
            </Button>
            <div className="min-w-24 text-center">
              <p className="text-[0.65rem] uppercase tracking-wider text-muted">Bet</p>
              <ChipAmount value={bet} className="font-bold text-ivory" iconClassName="h-4 w-4" />
            </div>
            <Button
              size="sm"
              variant="outline"
              aria-label="Raise bet"
              disabled={busy || !canRaise}
              onClick={() => {
                setBetIndex((i) => i + 1);
                playSound('chip');
              }}
            >
              +
            </Button>
          </div>
          {phase === 'playing' ? (
            <Button size="lg" variant="outline" className="min-w-36" onClick={onSkip}>
              Skip
            </Button>
          ) : (
            <Button size="lg" className="min-w-36" loading={phase === 'waiting'} disabled={balance < bet} onClick={() => void spin()}>
              Spin
            </Button>
          )}
          <div className="flex items-center gap-1.5" role="group" aria-label="Auto-spin">
            {autoLeft > 0 ? (
              <Button size="sm" variant="outline" onClick={() => setAutoLeft(0)}>
                Stop auto ({autoLeft} left)
              </Button>
            ) : (
              <>
                <span className="text-xs text-muted">Auto</span>
                {[10, 25, 50].map((n) => (
                  <Button key={n} size="sm" variant="ghost" disabled={busy || balance < bet} aria-label={`Auto: ${n} rounds`} onClick={() => setAutoLeft(n)}>
                    {n}
                  </Button>
                ))}
              </>
            )}
          </div>
          <p className="w-full text-center text-xs text-muted md:w-auto md:text-right">
            {balance < bet ? (
              <>
                Not enough chips for this bet.{' '}
                <Link to="/lounge" className="font-semibold text-gold-300 hover:underline">
                  Get free chips in the lounge
                </Link>
              </>
            ) : nextLocked && nextTier ? (
              `${nextTier.label} stakes need ${formatChips(nextTier.min_bankroll)} chips.`
            ) : (
              `Bets from ${formatChips(info.bets[0])} to ${formatChips(info.bets[info.bets.length - 1])} chips.`
            )}
          </p>
        </div>
      </section>

      <SlotRulesModal open={rulesOpen} onClose={() => setRulesOpen(false)} info={info} bet={bet} />
      <GameHistoryModal<{ units?: number; feature?: string | null }>
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        game={gameKey}
        title="Spin history"
        renderRow={(r) => (
          <p className="truncate text-sm text-cream/85">
            {(r.summary.feature && FEATURE_LABELS[r.summary.feature]) || 'Spin'}
            {r.summary.units ? ` · ${timesBet(r.summary.units)} the bet` : ''}
          </p>
        )}
      />
    </div>
  );
}
