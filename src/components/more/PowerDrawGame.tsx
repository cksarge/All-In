import { useRemembered } from '@/hooks/useRemembered';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { BetStepper, Outcome, SoloGate, SoloShell } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { chipsFor, timesBet } from '@/lib/slots';
import { holdBalance, releaseBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { prefersReducedMotion, useSettings } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface Config {
  numbers: number;
  picks: number;
  powers: number;
  /** '3' = three numbers, '3p' = three numbers and the power ball; hundredths of the bet */
  returns: Record<string, number>;
}
interface Result {
  round_id: string;
  picks: number[];
  power_pick: number;
  drawn: number[];
  power: number;
  hits: number[];
  power_hit: boolean;
  units: number;
  bet: number;
  win: number;
  balance: number;
}

const TIERS = ['5p', '5', '4p', '4', '3p', '3', '2p', '1p', '0p'];
const tierLabel = (k: string) => {
  const n = parseInt(k, 10);
  const p = k.endsWith('p');
  return n === 0 ? 'Power ball only' : `${n} number${n === 1 ? '' : 's'}${p ? ' + power ball' : ''}`;
};

export function PowerDrawGame() {
  const { info, error, load, call } = useSoloGame<Config>('power_draw', 'more_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Loading the machine…" />;
  return <Ticket info={info} call={call} />;
}

function Ball({ n, power, hit, delay = 0 }: { n: number | null; power?: boolean; hit?: boolean; delay?: number }) {
  return (
    <motion.span
      initial={n === null ? false : { scale: 0, rotate: -180 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18, delay }}
      className={cn(
        'flex h-11 w-11 items-center justify-center rounded-full font-display text-lg font-black tabular-nums shadow-[inset_0_-4px_6px_rgba(0,0,0,0.25),0_4px_8px_rgba(0,0,0,0.5)] sm:h-12 sm:w-12',
        n === null ? 'bg-ink-950/50 text-transparent' : power ? 'bg-ruby-500 text-ivory' : 'bg-ivory text-ink-950',
        hit && 'ring-4 ring-gold-300',
      )}
    >
      {n ?? 0}
    </motion.span>
  );
}

function Ticket({ info, call }: { info: SoloInfo<Config>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const c = info.config;
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  const [picks, setPicks] = useState<number[]>([]);
  const [power, setPower] = useState<number | null>(null);
  const [betIndex, setBetIndex] = useRemembered(`bet:${info.game}`, 0, (v) => Number.isInteger(v) && v >= 0 && v < info.bets.length);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [revealed, setRevealed] = useState(0);
  const bet = info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);
  const ready = picks.length === c.picks && power !== null;
  const done = Boolean(result) && revealed > c.picks;
  const key = done && result ? `${result.hits.length}${result.power_hit ? 'p' : ''}` : null;

  const clearResult = () => {
    setResult(null);
    setRevealed(0);
  };
  const toggle = (n: number) => {
    if (busy) return;
    clearResult();
    if (picks.includes(n)) return setPicks(picks.filter((x) => x !== n));
    if (picks.length >= c.picks) return toast.info(`Pick ${c.picks} numbers`, 'Tap one of yours to swap it out.');
    setPicks([...picks, n].sort((a, b) => a - b));
    playSound('click');
  };
  const quickPick = () => {
    const pool = Array.from({ length: c.numbers }, (_, i) => i + 1);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    clearResult();
    setPicks(pool.slice(0, c.picks).sort((a, b) => a - b));
    setPower(1 + Math.floor(Math.random() * c.powers));
    playSound('chip');
  };

  const play = async () => {
    if (busy || !ready) return;
    if (balance < bet) return toast.info('Not enough chips for that ticket', 'Lower the price, or pick up free chips in the lounge.');
    setBusy(true);
    clearResult();
    holdBalance(balance - bet);
    const [res, err] = await call<Result>('power_draw_play', { p_bet: bet, p_picks: picks, p_power: power });
    if (err !== null) {
      releaseBalance();
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    setResult(res);
    for (let i = 1; i <= c.picks + 1; i++) {
      await sleep(reduced ? 30 : 650);
      setRevealed(i);
      const hit = i <= c.picks ? res.hits.includes(res.drawn[i - 1]) : res.power_hit;
      playSound(hit ? 'pop' : 'click');
    }
    await sleep(reduced ? 30 : 400);
    settleBalance(res.balance);
    playSound(res.win > res.bet ? 'win' : res.win > 0 ? 'chip' : 'lose');
    setBusy(false);
  };

  const status = busy
    ? 'Drawing…'
    : done && result
      ? result.win > 0
        ? `${tierLabel(key!)}!`
        : `${result.hits.length} number${result.hits.length === 1 ? '' : 's'}, no power ball. No prize.`
      : ready
        ? 'Ticket ready'
        : `Pick ${c.picks} numbers and a power ball`;

  return (
    <SoloShell
      info={info}
      wide
      tier={tier?.tier}
      status={status}
      controls={
        <>
          <BetStepper label="Ticket price" bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy} tiers={info.tiers} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={quickPick} hotkey="q">
              Quick pick
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || (picks.length === 0 && power === null)}
              hotkey="c"
              onClick={() => {
                setPicks([]);
                setPower(null);
                clearResult();
              }}
            >
              Clear
            </Button>
            <Button className="min-w-28" loading={busy} disabled={!ready || balance < bet} onClick={() => void play()} hotkey="space">
              Draw
            </Button>
          </div>
        </>
      }
      rules={
        <>
          <p>
            A lottery-style draw. Pick <strong className="text-ivory">{c.picks} numbers</strong> from 1 to {c.numbers} and one red{' '}
            <strong className="text-ivory">power ball</strong> from 1 to {c.powers}. Five white balls and one power ball are drawn, and
            you&apos;re paid for what you match.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>The order doesn&apos;t matter, only how many of your numbers come up.</li>
            <li>Matching the power ball always pays something, even with no other numbers.</li>
            <li>Matching one or two white balls without the power ball pays nothing.</li>
            <li>All five and the power ball is a 1 in 1,425,060 shot.</li>
            <li><strong className="text-ivory">Quick pick</strong> fills in a random ticket.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            About 1 ticket in 8 wins something, and the game returns about 94% over a very long run, much of it in the rare top
            prizes. Every draw is independent. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="mb-4 flex items-center justify-center gap-1.5 sm:gap-2" aria-live="polite" aria-label={done && result ? `Drawn: ${result.drawn.join(', ')} and power ball ${result.power}` : 'Draw'}>
        {Array.from({ length: c.picks }, (_, i) => {
          const n = result && revealed > i ? result.drawn[i] : null;
          return <Ball key={`${result?.round_id}-${i}-${n}`} n={n} hit={n !== null && result!.hits.includes(n)} />;
        })}
        <span className="mx-1 h-8 w-px bg-white/20" aria-hidden="true" />
        <Ball key={`${result?.round_id}-p-${revealed > c.picks}`} n={result && revealed > c.picks ? result.power : null} power hit={Boolean(result && revealed > c.picks && result.power_hit)} />
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
        <div>
          <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-cream/65">
            Your numbers ({picks.length} of {c.picks})
          </p>
          <div className="grid grid-cols-10 gap-1" role="group" aria-label="Numbers">
            {Array.from({ length: c.numbers }, (_, i) => i + 1).map((n) => {
              const picked = picks.includes(n);
              const out = Boolean(result) && result!.drawn.slice(0, revealed).includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  disabled={busy}
                  aria-pressed={picked}
                  aria-label={`Number ${n}${picked ? ', picked' : ''}${out ? ', drawn' : ''}`}
                  onClick={() => toggle(n)}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-full border text-xs font-bold tabular-nums transition sm:text-sm',
                    picked && out
                      ? 'border-gold-200 bg-gold-400 text-ink-950'
                      : out
                        ? 'border-white/40 bg-white/15 text-ivory'
                        : picked
                          ? 'border-ivory bg-ivory text-ink-950'
                          : 'border-white/10 bg-ink-950/40 text-cream/75 hover:border-white/30',
                  )}
                >
                  {n}
                </button>
              );
            })}
          </div>
          <p className="mb-1 mt-3 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-cream/65">Your power ball</p>
          <div className="grid grid-cols-10 gap-1" role="radiogroup" aria-label="Power ball">
            {Array.from({ length: c.powers }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={power === n}
                aria-label={`Power ball ${n}`}
                disabled={busy}
                onClick={() => {
                  clearResult();
                  setPower(n);
                  playSound('click');
                }}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-full border text-xs font-bold tabular-nums transition sm:text-sm',
                  power === n ? 'border-ruby-300 bg-ruby-500 text-ivory' : 'border-ruby-400/30 bg-ruby-900/40 text-cream/75 hover:border-ruby-300',
                  done && result?.power === n && 'ring-2 ring-gold-300',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-cream/65">Prizes</p>
          <table className="mt-1 w-full text-sm">
            <caption className="sr-only">Prizes at your ticket price</caption>
            <tbody>
              {TIERS.map((k) => (
                <tr key={k} className={cn('border-b border-white/[0.06]', key === k && 'bg-gold-500/20')}>
                  <th scope="row" className="py-1 text-left text-xs font-normal text-cream/85">{tierLabel(k)}</th>
                  <td className="py-1 text-right">
                    <ChipAmount value={chipsFor(bet, c.returns[k])} compact className="text-gold-200" iconClassName="h-3 w-3" />
                    <span className="ml-1 hidden text-[0.7rem] text-subtle sm:inline">{timesBet(c.returns[k])}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {done && result && <Outcome staked={result.bet} win={result.win} />}
        </div>
      </div>
    </SoloShell>
  );
}
