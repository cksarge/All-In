import { useEffect, useRef, useState } from 'react';
import { BetStepper, SoloGate, SoloShell } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { useLiveRoom } from '@/hooks/useLiveRoom';
import { useNow } from '@/hooks/useNow';
import { settleBalance, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { useAuth } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface Config {
  bet_seconds: number;
  cooldown_seconds: number;
  growth: number;
  max: number;
  edge_pct: number;
}
interface Bet {
  user_id: string;
  username: string;
  amount: number;
  auto_at: number | null;
  collected_at: number | null;
  payout: number;
  settled: boolean;
}
interface State {
  server_now: string;
  round: {
    id: string;
    phase: 'betting' | 'flying' | 'crashed';
    betting_ends_at: string;
    started_at: string | null;
    crashed_at: string | null;
    crash_point: number | null;
  };
  bets: Bet[];
  recent: number[];
}

const fmt = (m: number) => `${m.toFixed(2)}×`;

export function CrashGame() {
  const { info, error, load } = useSoloGame<Config>('crash', 'more_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Fuelling the rocket…" />;
  return <Room info={info} />;
}

function Graph({ seconds, mult, crashed, growth }: { seconds: number; mult: number; crashed: boolean; growth: number }) {
  const W = 100;
  const H = 56;
  const tMax = Math.max(8, seconds * 1.15);
  const mMax = Math.max(2, mult * 1.15);
  const x = (t: number) => (t / tMax) * W;
  const y = (m: number) => H - ((m - 1) / (mMax - 1)) * H;
  const pts = Array.from({ length: 41 }, (_, i) => {
    const t = (seconds * i) / 40;
    return `${x(t).toFixed(2)},${y(Math.exp(growth * t)).toFixed(2)}`;
  });
  const color = crashed ? '#e25a68' : '#f0d688';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
      ))}
      {seconds > 0 && (
        <>
          <polygon points={`0,${H} ${pts.join(' ')} ${x(seconds).toFixed(2)},${H}`} fill={color} opacity="0.12" />
          <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function Room({ info }: { info: SoloInfo<Config> }) {
  const c = info.config;
  const userId = useAuth((s) => s.user?.id);
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const { state, error, offsetMs, call } = useLiveRoom<State>({
    stateFn: 'crash_state',
    tables: ['crash_rounds', 'crash_bets'],
    pollMs: (s) => (s?.round.phase === 'flying' ? 400 : 1000),
  });
  const now = useNow(60, offsetMs);
  const [betIndex, setBetIndex] = useState(0);
  const [auto, setAuto] = useState('');
  const [busy, setBusy] = useState(false);
  const bet = info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);

  const round = state?.round;
  const mine = state?.bets.find((b) => b.user_id === userId) ?? null;
  const seconds = round?.phase === 'flying' && round.started_at ? Math.max(0, (now - new Date(round.started_at).getTime()) / 1000) : 0;
  const flying = round?.phase === 'flying';
  const crashed = round?.phase === 'crashed';
  const mult = crashed ? Number(round?.crash_point ?? 1) : flying ? Math.floor(Math.exp(c.growth * seconds) * 100) / 100 : 1;
  const crashSeconds = crashed ? Math.log(mult) / c.growth : seconds;
  const countdown = round?.phase === 'betting' ? Math.max(0, Math.ceil((new Date(round.betting_ends_at).getTime() - now) / 1000)) : 0;

  // Sounds and a balance refresh when the round changes phase.
  const lastPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    const key = round ? `${round.id}-${round.phase}` : undefined;
    if (key === lastPhase.current) return;
    lastPhase.current = key;
    if (round?.phase === 'flying') playSound('whoosh');
    if (round?.phase === 'crashed') {
      void useWallet.getState().fetchStatus();
      if (mine) playSound(mine.payout > 0 ? 'win' : 'lose');
    }
  }, [round, mine]);

  const place = async () => {
    if (busy) return;
    if (balance < bet) return toast.info('Not enough chips for that bet', 'Lower your bet, or pick up free chips in the lounge.');
    const target = auto.trim() === '' ? null : Number(auto);
    if (target !== null && (!Number.isFinite(target) || target < 1.01 || target > c.max)) {
      return toast.info('Automatic collect', `Enter a multiplier from 1.01 to ${c.max}, or leave it empty.`);
    }
    setBusy(true);
    const [res, err] = await call<{ balance: number }>('crash_bet', { p_amount: bet, p_auto: target });
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    playSound('chip');
    settleBalance(res.balance);
  };

  const collect = async () => {
    if (busy) return;
    setBusy(true);
    const [res, err] = await call<{ collected_at: number; payout: number; balance: number }>('crash_collect');
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    playSound('win');
    settleBalance(res.balance);
    toast.success(`Collected at ${fmt(Number(res.collected_at))}`, `${res.payout.toLocaleString('en-US')} chips`);
  };

  if (!state || !round) return <SoloGate error={error} onRetry={() => undefined} label="Joining the room…" />;

  const status =
    round.phase === 'betting'
      ? `Next round in ${countdown}s. Place your bet.`
      : flying
        ? mine && !mine.settled
          ? 'Collect before it crashes!'
          : mine?.collected_at
            ? `You collected at ${fmt(Number(mine.collected_at))}`
            : 'In flight…'
        : `Crashed at ${fmt(mult)}`;
  const canCollect = flying && Boolean(mine) && !mine!.settled;

  return (
    <SoloShell
      info={info}
      tier={tier?.tier}
      status={status}
      controls={
        <>
          <BetStepper bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy || Boolean(mine && !mine.settled)} tiers={info.tiers} />
          <label className="flex flex-col text-[0.65rem] uppercase tracking-wider text-muted">
            Collect at (optional)
            <input
              type="number"
              inputMode="decimal"
              min={1.01}
              max={c.max}
              step={0.1}
              placeholder="e.g. 2"
              value={auto}
              onChange={(e) => setAuto(e.target.value)}
              disabled={round.phase !== 'betting' || Boolean(mine)}
              className="mt-0.5 h-9 w-28 rounded-lg border border-white/15 bg-ink-950/60 px-2 text-sm normal-case tracking-normal text-ivory placeholder:text-subtle disabled:opacity-50"
            />
          </label>
          {canCollect ? (
            <Button size="lg" variant="felt" className="ml-auto min-w-44" loading={busy} onClick={() => void collect()}>
              Collect {Math.floor(mine!.amount * mult).toLocaleString('en-US')}
            </Button>
          ) : (
            <Button size="lg" className="ml-auto min-w-44" loading={busy} disabled={round.phase !== 'betting' || Boolean(mine) || balance < bet} onClick={() => void place()}>
              {round.phase === 'betting' ? (mine ? 'Bet placed' : 'Bet') : 'Next round soon'}
            </Button>
          )}
        </>
      }
      rules={
        <>
          <p>
            Everyone in the room shares one round. A multiplier starts at 1.00× and climbs until, at a moment nobody can see
            coming, it <strong className="text-ivory">crashes</strong>. Collect before the crash and your bet is multiplied by whatever it
            showed. Still in when it crashes, and the bet is lost.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>You have {c.bet_seconds} seconds to bet before each flight. One bet per round.</li>
            <li>Press <strong className="text-ivory">Collect</strong> any time during the flight. What counts is the multiplier when your click reaches the server, so the number you get can be a touch different from the one you saw.</li>
            <li><strong className="text-ivory">Collect at</strong> is optional: set a multiplier and the server collects for you the moment the flight gets there.</li>
            <li>About {c.edge_pct} rounds in 100 crash at once at 1.00×, and nobody wins those.</li>
            <li>Half of all rounds crash below about 1.94×. One in ten reaches 9.7×. One in a hundred reaches 97×.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            Whatever multiplier you aim for, the long-run return is the same: {100 - c.edge_pct}%. The crash point is fixed by
            the server when betting closes and stays hidden until it happens. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="relative mx-auto h-52 w-full overflow-hidden rounded-2xl border border-white/10 bg-ink-950/50 sm:h-64">
        <Graph seconds={crashSeconds} mult={mult} crashed={Boolean(crashed)} growth={c.growth} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {round.phase === 'betting' ? (
            <>
              <p className="font-display text-5xl font-black tabular-nums text-ivory">{countdown}</p>
              <p className="mt-1 text-sm text-cream/75">seconds to bet</p>
            </>
          ) : (
            <>
              <p className={cn('font-display text-5xl font-black tabular-nums sm:text-6xl', crashed ? 'text-ruby-400' : 'text-gold-200')} aria-live="off">
                {fmt(mult)}
              </p>
              {crashed && <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-ruby-300">Crashed</p>}
            </>
          )}
        </div>
      </div>

      {state.recent.length > 0 && (
        <div className="scrollbar-thin mt-3 flex gap-1 overflow-x-auto pb-1" aria-label="Recent crash points">
          {state.recent.map((p, i) => (
            <span
              key={i}
              className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
                Number(p) >= 10 ? 'bg-gold-500/25 text-gold-200' : Number(p) >= 2 ? 'bg-felt-600/50 text-felt-300' : 'bg-ruby-900/60 text-ruby-300',
              )}
            >
              {fmt(Number(p))}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-cream/65">
          In this round ({state.bets.length})
        </p>
        {state.bets.length === 0 ? (
          <p className="mt-1 text-sm text-cream/60">Nobody has bet yet.</p>
        ) : (
          <ul className="mt-1 divide-y divide-white/[0.06]">
            {state.bets.map((b) => (
              <li key={b.user_id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className={cn('truncate', b.user_id === userId ? 'font-semibold text-ivory' : 'text-cream/85')}>
                  {b.username}
                  {b.user_id === userId && ' (you)'}
                </span>
                <span className="flex shrink-0 items-center gap-3">
                  <ChipAmount value={b.amount} className="text-cream/80" iconClassName="h-3.5 w-3.5" />
                  <span className={cn('w-28 text-right tabular-nums', b.collected_at ? 'text-gold-200' : b.settled ? 'text-ruby-300' : 'text-cream/60')}>
                    {b.collected_at
                      ? `${fmt(Number(b.collected_at))} · +${b.payout.toLocaleString('en-US')}`
                      : b.settled
                        ? 'crashed'
                        : b.auto_at
                          ? `auto ${fmt(Number(b.auto_at))}`
                          : 'in'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SoloShell>
  );
}
