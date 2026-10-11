import { useState } from 'react';
import { motion } from 'framer-motion';
import { BetStepper, Outcome, SoloGate, SoloShell } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { holdBalance, releaseBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
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

function Board({ info, call }: { info: SoloInfo<Config>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<Risk>('medium');
  const [betIndex, setBetIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const bet = info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);
  const table = info.config.returns[String(rows)][risk];

  const drop = async () => {
    if (busy) return;
    if (balance < bet) return toast.info('Not enough chips for that bet', 'Lower your bet, or pick up free chips in the lounge.');
    setBusy(true);
    setDone(false);
    holdBalance(balance - bet);
    const [res, err] = await call<Result>('plinko_drop', { p_bet: bet, p_rows: rows, p_risk: risk });
    if (err !== null) {
      releaseBalance();
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    setResult(res);
    setStep(0);
    for (let i = 1; i <= res.path.length; i++) {
      await sleep(reduced ? 10 : STEP_MS);
      setStep(i);
      playSound('click');
    }
    await sleep(reduced ? 50 : 250);
    setDone(true);
    settleBalance(res.balance);
    playSound(res.win > res.bet ? 'win' : res.win > 0 ? 'chip' : 'lose');
    setBusy(false);
  };

  // Geometry in "peg units": row r (0-based) has r + 3 pegs; the ball sits between pegs.
  const W = rows + 2;
  const pegX = (r: number, i: number) => (W - (r + 2)) / 2 + i;
  const rights = result ? result.path.slice(0, step).reduce((a, b) => a + b, 0) : 0;
  const ballX = result ? (W - 1) / 2 + rights - step / 2 : (W - 1) / 2;
  const ballY = result ? step : -0.6;
  const status = busy && !done ? 'Bouncing…' : done && result ? `Landed on ×${result.units / 100}` : 'Pick your rows and risk, then drop';

  return (
    <SoloShell
      info={info}
      tier={tier?.tier}
      status={status}
      controls={
        <>
          <BetStepper bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy} tiers={info.tiers} />
          <div className="flex flex-col gap-1.5">
            <Segmented label="Rows" options={ROWS} value={rows} onChange={(v) => { setRows(v); setResult(null); setDone(false); }} disabled={busy} />
            <Segmented label="Risk" options={RISKS} value={risk} onChange={setRisk} disabled={busy} />
          </div>
          <Button size="lg" className="ml-auto min-w-32" loading={busy} disabled={balance < bet} onClick={() => void drop()}>
            Drop
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
            <li>The numbers under the board are multiples of your bet. Anything under ×1 gives back less than you bet.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            Every combination of rows and risk returns about 99% over a very long run. The server decides each bounce. Play
            chips have no cash value.
          </p>
        </>
      }
    >
      <div className="mx-auto w-full max-w-lg">
        <svg viewBox={`-0.5 -1.2 ${W} ${rows + 1.6}`} className="w-full" role="img" aria-label={done && result ? `The ball landed in slot ${result.slot + 1} of ${rows + 1}` : 'Plinko board'}>
          {Array.from({ length: rows }).flatMap((_, r) =>
            Array.from({ length: r + 3 }).map((__, i) => <circle key={`${r}-${i}`} cx={pegX(r, i) - 0.5} cy={r + 0.5} r={0.11} fill="#f4ead2" opacity={0.75} />),
          )}
          <motion.circle
            r={0.3}
            fill="#d4af37"
            stroke="#fff4cf"
            strokeWidth={0.06}
            initial={false}
            animate={{ cx: ballX, cy: ballY }}
            transition={step === 0 ? { duration: 0 } : { duration: STEP_MS / 1000, ease: 'easeIn' }}
          />
        </svg>
        <div className="mt-1 grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${rows + 1}, minmax(0, 1fr))`, marginInline: `${(0.5 / W) * 100}%` }}>
          {table.map((u, i) => (
            <div
              key={i}
              className={cn(
                'flex h-7 items-center justify-center rounded text-[0.5rem] font-bold tabular-nums transition sm:text-[0.65rem]',
                slotColor(u),
                done && result?.slot === i && 'scale-110 ring-2 ring-ivory',
              )}
            >
              {u >= 1000 ? Math.round(u / 100) : u / 100}
            </div>
          ))}
        </div>
      </div>
      {done && result && <Outcome staked={result.bet} win={result.win} />}
    </SoloShell>
  );
}
