import { useRemembered } from '@/hooks/useRemembered';
import { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { BetStepper, Outcome, SoloGate, SoloShell } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { holdBalance, releaseBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { prefersReducedMotion, useSettings } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

type Risk = 'low' | 'medium' | 'high';
interface Config {
  /** returns[rows][risk][slot] in hundredths of the bet */
  returns: Record<string, Record<Risk, number[]>>;
}
interface Result {
  round_id: string;
  path: number[];
  slot: number;
  units: number;
  bet: number;
  win: number;
  balance: number;
}

const ROWS = [8, 12, 16];
const BALL_COUNTS = [1, 3, 5, 10];
const RISKS: Risk[] = ['low', 'medium', 'high'];
const STEP_MS = 150;

export function PlinkoGame() {
  const { info, error, load, call } = useSoloGame<Config>('plinko', 'more_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Setting up the pegs…" />;
  return <Board info={info} call={call} />;
}

function slotColor(units: number) {
  if (units >= 1000) return 'bg-ruby-600 text-ivory';
  if (units >= 200) return 'bg-gold-500 text-ink-950';
  if (units >= 100) return 'bg-felt-500 text-ivory';
  return 'bg-ink-600 text-cream/80';
}

function Segmented<T extends string | number>({ label, options, value, onChange, disabled, text }: { label: string; options: T[]; value: T; onChange: (v: T) => void; disabled?: boolean; text?: (v: T) => string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      <span className="mr-1 text-[0.65rem] uppercase tracking-wider text-muted">{label}</span>
      {options.map((o) => (
        <button
          key={String(o)}
          type="button"
          role="radio"
          aria-checked={value === o}
          disabled={disabled}
          onClick={() => onChange(o)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-xs font-semibold capitalize transition disabled:opacity-50',
            value === o ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:text-ivory',
          )}
        >
          {text ? text(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

/** A ball on the board: `step` is how many pegs it has passed. */
interface Ball extends Result {
  step: number;
}

function Board({ info, call }: { info: SoloInfo<Config>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  const [rows, setRows] = useRemembered('plinko:rows', 12, (v) => [8, 12, 16].includes(v));
  const [risk, setRisk] = useRemembered<Risk>('plinko:risk', 'medium', (v) => ['low', 'medium', 'high'].includes(v));
  const [count, setCount] = useState(1);
  const [betIndex, setBetIndex] = useRemembered(`bet:${info.game}`, 0, (v) => Number.isInteger(v) && v >= 0 && v < info.bets.length);
  const [balls, setBalls] = useState<Ball[]>([]);
  /** Balls sent to the server or still bouncing. */
  const [inFlight, setInFlight] = useState(0);
  /** The balls of the current burst that have landed: what was staked and won. */
  const [tally, setTally] = useState({ balls: 0, staked: 0, win: 0, best: 0, last: 0 });
  /** What the header balance shows while balls are in the air. */
  const shown = useRef(0);
  const flying = useRef(0);
  const bet = info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);
  const table = info.config.returns[String(rows)][risk];
  const busy = inFlight > 0;

  const show = (delta: number) => {
    shown.current += delta;
    holdBalance(shown.current);
  };
  const landed = () => {
    flying.current -= 1;
    setInFlight(flying.current);
    if (flying.current === 0) {
      // Everything has landed: let the real balance through again.
      releaseBalance();
      void useWallet.getState().fetchStatus();
    }
  };

  /** One ball: bet, ask the server, then bounce it down the path it was given. */
  const dropOne = async (delay: number) => {
    await sleep(delay);
    const [res, err] = await call<Result>('plinko_drop', { p_bet: bet, p_rows: rows, p_risk: risk });
    if (err !== null) {
      show(bet);
      landed();
      return err;
    }
    setBalls((b) => [...b, { ...res, step: 0 }]);
    for (let i = 1; i <= res.path.length; i++) {
      await sleep(reduced ? 10 : STEP_MS);
      setBalls((b) => b.map((x) => (x.round_id === res.round_id ? { ...x, step: i } : x)));
      if (flying.current <= 2) playSound('click');
    }
    await sleep(reduced ? 50 : 250);
    show(res.win);
    setTally((t) => ({ balls: t.balls + 1, staked: t.staked + res.bet, win: t.win + res.win, best: Math.max(t.best, res.units), last: res.units }));
    playSound(res.win > res.bet ? 'win' : res.win > 0 ? 'chip' : 'lose');
    landed();
    // Leave it in its slot for a moment, then clear it away.
    window.setTimeout(() => setBalls((b) => b.filter((x) => x.round_id !== res.round_id)), 900);
    return null;
  };

  const drop = async () => {
    const base = flying.current === 0 ? balance : shown.current;
    if (base < bet * count) {
      return toast.info('Not enough chips for that', count > 1 ? `${count} balls at this bet come to ${(bet * count).toLocaleString('en-US')} chips.` : 'Lower your bet, or pick up free chips in the lounge.');
    }
    if (flying.current === 0) {
      shown.current = balance;
      setTally({ balls: 0, staked: 0, win: 0, best: 0, last: 0 });
    }
    flying.current += count;
    setInFlight(flying.current);
    show(-bet * count);
    const errors = await Promise.all(Array.from({ length: count }, (_, i) => dropOne(i * (reduced ? 20 : 140))));
    const failed = errors.find((e) => e !== null);
    if (failed) {
      playSound('error');
      toast.error(failed);
    }
  };

  // Geometry in "peg units": row r (0-based) has r + 3 pegs; the ball sits between pegs.
  const W = rows + 2;
  const pegX = (r: number, i: number) => (W - (r + 2)) / 2 + i;
  const hits = new Map<number, number>();
  for (const b of balls) if (b.step >= b.path.length) hits.set(b.slot, (hits.get(b.slot) ?? 0) + 1);
  const status = busy
    ? inFlight > 1
      ? `${inFlight} balls bouncing…`
      : 'Bouncing…'
    : tally.balls > 1
      ? `${tally.balls} balls landed. Best: ×${tally.best / 100}`
      : tally.balls === 1
        ? `Landed on ×${tally.last / 100}`
        : 'Pick your rows and risk, then drop';

  return (
    <SoloShell
      info={info}
      tier={tier?.tier}
      status={status}
      controls={
        <>
          <BetStepper label="Bet per ball" bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy} tiers={info.tiers} />
          <div className="flex flex-col gap-1.5">
            <Segmented label="Rows" options={ROWS} value={rows} onChange={setRows} disabled={busy} />
            <Segmented label="Risk" options={RISKS} value={risk} onChange={setRisk} disabled={busy} />
            <Segmented label="Balls" options={BALL_COUNTS} value={count} onChange={setCount} />
          </div>
          <Button size="lg" className="ml-auto min-w-32" disabled={balance < bet && !busy} onClick={() => void drop()}>
            {count > 1 ? `Drop ${count}` : 'Drop'}
          </Button>
        </>
      }
      rules={
        <>
          <p>
            A ball drops through rows of pegs. At every peg it bounces left or right, an even chance each way, and the slot it
            lands in decides your prize.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>The ball usually ends up near the middle, so the middle slots pay least and the edges pay most.</li>
            <li><strong className="text-ivory">Rows</strong>: more rows means more slots and rarer, bigger edges.</li>
            <li><strong className="text-ivory">Risk</strong>: low risk pays a little almost every time. High risk pays very little in the middle and a lot at the edges.</li>
            <li><strong className="text-ivory">Balls</strong>: drop 1, 3, 5 or 10 at once. Each ball is its own bet at the amount shown, and you can press Drop again while others are still bouncing.</li>
            <li>The numbers under the board are multiples of your bet. Anything under ×1 gives back less than you bet.</li>
            <li>
              <strong className="text-ivory">Plinko earns less XP than other games.</strong> Balls drop fast and nearly all of the bet comes
              back, so each ball earns a quarter of the square root of its bet, with no flat bonus: nothing for a 10-chip ball, 2 XP for a
              100-chip ball, 7 for a 1,000-chip ball (half again if the ball pays more than it cost).
            </li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            Every combination of rows and risk returns about 99% over a very long run. The server decides each bounce. Play
            chips have no cash value.
          </p>
        </>
      }
    >
      <div className="mx-auto w-full max-w-lg">
        <svg
          viewBox={`-0.5 -1.2 ${W} ${rows + 1.6}`}
          className="w-full"
          role="img"
          aria-label={busy ? `${inFlight} ball${inFlight === 1 ? '' : 's'} on the board` : 'Plinko board'}
        >
          {Array.from({ length: rows }).flatMap((_, r) =>
            Array.from({ length: r + 3 }).map((__, i) => <circle key={`${r}-${i}`} cx={pegX(r, i) - 0.5} cy={r + 0.5} r={0.11} fill="#f4ead2" opacity={0.75} />),
          )}
          {balls.length === 0 && <circle cx={(W - 1) / 2} cy={-0.6} r={0.3} fill="#d4af37" stroke="#fff4cf" strokeWidth={0.06} opacity={0.5} />}
          {balls.map((b) => {
            const rights = b.path.slice(0, b.step).reduce((n, v) => n + v, 0);
            return (
              <motion.circle
                key={b.round_id}
                r={0.3}
                fill="#d4af37"
                stroke="#fff4cf"
                strokeWidth={0.06}
                initial={{ cx: (W - 1) / 2, cy: -0.6 }}
                animate={{ cx: (W - 1) / 2 + rights - b.step / 2, cy: b.step }}
                transition={{ duration: STEP_MS / 1000, ease: 'easeIn' }}
              />
            );
          })}
        </svg>
        <div className="mt-1 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${rows + 1}, minmax(0, 1fr))`, marginInline: `${(0.5 / W) * 100}%` }}>
          {table.map((u, i) => (
            <div
              key={i}
              className={cn(
                'flex h-7 items-center justify-center rounded text-[0.5rem] font-bold tabular-nums transition sm:text-[0.65rem]',
                slotColor(u),
                hits.has(i) && 'scale-110 ring-2 ring-ivory',
              )}
            >
              {u >= 1000 ? Math.round(u / 100) : u / 100}
            </div>
          ))}
        </div>
      </div>
      {!busy && tally.balls > 0 && <Outcome staked={tally.staked} win={tally.win} />}
      <p className="mt-3 text-center text-xs text-muted">
        Plinko earns less XP than other games: {Math.floor(Math.sqrt(bet) / 4)} XP per ball at this bet. See Rules.
      </p>
    </SoloShell>
  );
}
