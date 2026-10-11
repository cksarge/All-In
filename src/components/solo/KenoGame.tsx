import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { chipsFor, timesBet } from '@/lib/slots';
import { holdBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { prefersReducedMotion, useSettings } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { BetStepper, Outcome, SoloGate, SoloShell } from './SoloShell';

interface Config {
  max_picks: number;
  numbers: number;
  drawn: number;
  /** returns[picks][hits] in hundredths of the bet */
  returns: Record<string, Record<string, number>>;
}
interface Result {
  round_id: string;
  picks: number[];
  drawn: number[];
  hits: number[];
  units: number;
  bet: number;
  win: number;
  balance: number;
}

export function KenoGame() {
  const { info, error, load, call } = useSoloGame<Config>('keno');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Loading the keno board…" />;
  return <Board info={info} call={call} />;
}

function Board({ info, call }: { info: SoloInfo<Config>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const c = info.config;
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  const [picks, setPicks] = useState<number[]>([]);
  const [betIndex, setBetIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [revealed, setRevealed] = useState(0);
  const bet = info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);
  const done = Boolean(result) && revealed >= c.drawn;
  const drawn = new Set(result ? result.drawn.slice(0, revealed) : []);
  const hitsSoFar = picks.filter((n) => drawn.has(n)).length;

  const toggle = (n: number) => {
    if (busy) return;
    if (result) {
      setResult(null);
      setRevealed(0);
    }
    if (picks.includes(n)) return setPicks(picks.filter((x) => x !== n));
    if (picks.length >= c.max_picks) return toast.info(`You can pick up to ${c.max_picks} numbers`);
    setPicks([...picks, n]);
    playSound('click');
  };

  const quickPick = () => {
    const count = picks.length || 5;
    const pool = Array.from({ length: c.numbers }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    setResult(null);
    setRevealed(0);
    setPicks(pool.slice(0, count).sort((a, b) => a - b));
    playSound('chip');
  };

  const play = async () => {
    if (busy || picks.length === 0) return;
    if (balance < bet) return toast.info('Not enough chips for that bet', 'Lower your bet, or pick up free chips in the lounge.');
    setBusy(true);
    setResult(null);
    setRevealed(0);
    holdBalance(balance - bet);
    const [res, err] = await call<Result>('keno_draw', { p_bet: bet, p_picks: picks });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    setResult(res);
    for (let i = 1; i <= res.drawn.length; i++) {
      setRevealed(i);
      playSound(res.hits.includes(res.drawn[i - 1]) ? 'pop' : 'click');
      await sleep(reduced ? 20 : 130);
    }
    settleBalance(res.balance);
    playSound(res.win > res.bet ? 'win' : res.win > 0 ? 'chip' : 'lose');
    setBusy(false);
  };

  const table = c.returns[String(picks.length)] ?? {};
  const status = busy
    ? `Drawing… ${revealed} of ${c.drawn}`
    : done && result
      ? `${result.hits.length} of your ${result.picks.length} came up`
      : picks.length === 0
        ? `Pick 1 to ${c.max_picks} numbers`
        : `${picks.length} picked`;

  return (
    <SoloShell
      info={info}
      wide
      tier={tier?.tier}
      status={status}
      controls={
        <>
          <BetStepper bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy} tiers={info.tiers} />
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={quickPick}>
              Quick pick
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || picks.length === 0}
              onClick={() => {
                setPicks([]);
                setResult(null);
                setRevealed(0);
              }}
            >
              Clear
            </Button>
            <Button className="min-w-28" loading={busy} disabled={picks.length === 0 || balance < bet} onClick={() => void play()}>
              Play
            </Button>
          </div>
        </>
      }
      rules={
        <>
          <p>
            Pick between 1 and {c.max_picks} numbers out of {c.numbers}. The server then draws {c.drawn} balls. The more of your numbers
            come up, the more you win.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>The prizes depend on how many numbers you picked. The table next to the board always shows the prizes for your current picks and bet.</li>
            <li>Picking more numbers means bigger top prizes, but you need more hits before anything pays.</li>
            <li>With {c.max_picks} picks, hitting none at all also pays: that&apos;s rarer than it sounds.</li>
            <li><strong className="text-ivory">Quick pick</strong> chooses random numbers for you (the same count you have now, or five).</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            However many numbers you pick, keno returns about 94 to 95% over a very long run. Every draw is independent: no number
            is ever &quot;due&quot;. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1fr_13rem]">
        <div className="grid grid-cols-10 gap-1" role="group" aria-label="Keno board">
          {Array.from({ length: c.numbers }, (_, i) => i + 1).map((n) => {
            const picked = picks.includes(n);
            const out = drawn.has(n);
            return (
              <button
                key={n}
                type="button"
                disabled={busy}
                aria-pressed={picked}
                aria-label={`${n}${picked ? ', picked' : ''}${out ? ', drawn' : ''}`}
                onClick={() => toggle(n)}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-md border text-xs font-bold tabular-nums transition sm:text-sm',
                  picked && out
                    ? 'scale-105 border-gold-200 bg-gold-400 text-ink-950 shadow-glow-gold'
                    : out
                      ? 'border-sapphire-300/60 bg-sapphire-700/70 text-ivory'
                      : picked
                        ? 'border-gold-400 bg-gold-500/20 text-gold-200'
                        : 'border-white/10 bg-ink-950/40 text-cream/75 hover:border-white/30',
                )}
              >
                {n}
              </button>
            );
          })}
        </div>

        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-cream/65">
            {picks.length ? `Prizes for ${picks.length} pick${picks.length === 1 ? '' : 's'}` : 'Prizes'}
          </p>
          {picks.length === 0 ? (
            <p className="mt-2 text-sm text-cream/70">Tap numbers on the board to see what they can win.</p>
          ) : (
            <table className="mt-1 w-full text-sm">
              <caption className="sr-only">Prizes at your bet</caption>
              <tbody>
                {Object.keys(table)
                  .map(Number)
                  .sort((a, b) => b - a)
                  .map((h) => (
                    <tr key={h} className={cn('border-b border-white/[0.06]', result && hitsSoFar === h && 'bg-gold-500/20')}>
                      <th scope="row" className="py-1 text-left font-normal text-cream/85">
                        {h === 0 ? 'No hits' : `${h} hit${h === 1 ? '' : 's'}`}
                      </th>
                      <td className="py-1 text-right">
                        <ChipAmount value={chipsFor(bet, table[String(h)])} className="text-gold-200" iconClassName="h-3 w-3" />
                        <span className="ml-1 text-[0.7rem] text-subtle">{timesBet(table[String(h)])}</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          {done && result && <Outcome staked={result.bet} win={result.win} />}
        </div>
      </div>
    </SoloShell>
  );
}
