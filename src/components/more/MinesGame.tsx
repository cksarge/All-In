import { useState } from 'react';
import { motion } from 'framer-motion';
import { BetStepper, Outcome, SoloGate, SoloShell } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { chipsFor } from '@/lib/slots';
import { holdBalance, releaseBalance, settleBalance, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface Config {
  tiles: number;
  edge_pct: number;
}
interface Round {
  bet: number;
  mines: number;
  picked: number[];
  /** Prize now, and after one more safe tile, in hundredths of the bet. */
  units: number;
  next_units: number;
}
interface Finished extends Round {
  round_id: string;
  done: true;
  outcome: 'boom' | 'collected' | 'cleared';
  hit: number | null;
  mine_tiles: number[];
  win: number;
  balance: number;
}
type Live = Round & { round_id: string; done?: false };

const MINE_CHOICES = [1, 3, 5, 10, 15, 24];

export function MinesGame() {
  const { info, error, load, call } = useSoloGame<Config, Round>('mines', 'more_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Laying the field…" />;
  return <Field info={info} call={call} />;
}

function Field({ info, call }: { info: SoloInfo<Config, Round>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const [round, setRound] = useState<Live | null>(info.round);
  const [end, setEnd] = useState<Finished | null>(null);
  const [mines, setMines] = useState(3);
  const [betIndex, setBetIndex] = useState(() => Math.max(0, info.bets.indexOf(info.round?.bet ?? info.bets[0])));
  const [busy, setBusy] = useState(false);
  const bet = round?.bet ?? info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);

  const finish = (res: Finished) => {
    setRound(null);
    setEnd(res);
    settleBalance(res.balance);
    playSound(res.outcome === 'boom' ? 'lose' : 'win');
  };

  const start = async () => {
    if (busy) return;
    if (balance < bet) return toast.info('Not enough chips for that bet', 'Lower your bet, or pick up free chips in the lounge.');
    setBusy(true);
    const [res, err] = await call<Live & { balance: number }>('mines_start', { p_bet: bet, p_mines: mines });
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    playSound('chip');
    setEnd(null);
    setRound(res);
    settleBalance(res.balance);
  };

  const pick = async (tile: number) => {
    if (busy || !round || round.picked.includes(tile)) return;
    setBusy(true);
    holdBalance(balance);
    const [res, err] = await call<Live | Finished>('mines_pick', { p_tile: tile });
    setBusy(false);
    if (err !== null) {
      releaseBalance();
      playSound('error');
      return toast.error(err);
    }
    if (res.done) return finish(res);
    releaseBalance();
    setRound(res);
    playSound('pop');
  };

  const collect = async () => {
    if (busy || !round) return;
    setBusy(true);
    const [res, err] = await call<Finished>('mines_collect', {});
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    finish(res);
  };

  const picked = new Set(round?.picked ?? end?.picked ?? []);
  const mineTiles = new Set(end?.mine_tiles ?? []);
  const shownMines = round?.mines ?? end?.mines ?? mines;
  const status = round
    ? round.picked.length === 0
      ? 'Pick a tile'
      : `×${round.units / 100} so far. Keep going, or collect?`
    : end
      ? end.outcome === 'boom'
        ? 'Boom. That was a mine.'
        : end.outcome === 'cleared'
          ? 'You found every gem!'
          : `Collected at ×${end.units / 100}`
      : 'Choose how many mines, then start';

  return (
    <SoloShell
      info={info}
      tier={tier?.tier}
      status={status}
      controls={
        round ? (
          <>
            <p className="text-sm text-cream/85">
              Next tile: <ChipAmount value={chipsFor(round.bet, round.next_units)} className="font-bold text-ivory" iconClassName="h-4 w-4" />
            </p>
            <Button size="lg" className="ml-auto min-w-44" loading={busy} disabled={round.picked.length === 0} onClick={() => void collect()}>
              {round.picked.length === 0 ? 'Collect' : `Collect ${chipsFor(round.bet, round.units).toLocaleString('en-US')}`}
            </Button>
          </>
        ) : (
          <>
            <BetStepper bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy} tiers={info.tiers} />
            <div role="radiogroup" aria-label="Number of mines" className="flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[0.65rem] uppercase tracking-wider text-muted">Mines</span>
              {MINE_CHOICES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mines === m}
                  aria-label={`${m} mines`}
                  disabled={busy}
                  onClick={() => setMines(m)}
                  className={cn(
                    'min-w-8 rounded-full border px-2 py-1 text-xs font-semibold transition',
                    mines === m ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:text-ivory',
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <Button size="lg" className="ml-auto min-w-32" loading={busy} disabled={balance < bet} onClick={() => void start()}>
              Start
            </Button>
          </>
        )
      }
      rules={
        <>
          <p>
            A 5 by 5 field hides some mines; every other tile is a gem. Uncover gems one at a time. Each one raises your prize,
            and you can <strong className="text-ivory">collect</strong> whenever you like. Hit a mine and the bet is lost.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>You choose how many mines there are, from 1 to 24. More mines means each gem is worth more, and is harder to find.</li>
            <li>The prize after each gem is the fair odds of having got that far, less a {info.config.edge_pct}% house edge.</li>
            <li>You have to uncover at least one tile before you can collect.</li>
            <li>Find every gem and the prize is collected for you.</li>
            <li>If you leave, the field waits for you exactly as it was.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            Whenever you collect, the long-run return is the same: about {100 - info.config.edge_pct}%. Stopping early or late
            only changes how bumpy the ride is. The mines are placed by the server before your first pick. Play chips have no cash value.
          </p>
        </>
      }
    >
      <p className="mb-2 text-center text-xs text-cream/70">
        {shownMines} mine{shownMines === 1 ? '' : 's'}, {25 - shownMines} gem{25 - shownMines === 1 ? '' : 's'}
      </p>
      <div className="mx-auto grid max-w-xs grid-cols-5 gap-1.5 sm:max-w-sm sm:gap-2" role="group" aria-label="Mine field">
        {Array.from({ length: 25 }, (_, i) => {
          const safe = picked.has(i);
          const mine = mineTiles.has(i);
          const hit = end?.hit === i;
          return (
            <button
              key={i}
              type="button"
              disabled={!round || busy || safe}
              aria-label={`Tile ${i + 1}${safe ? ', gem' : mine ? ', mine' : ''}`}
              onClick={() => void pick(i)}
              className={cn(
                'flex aspect-square items-center justify-center rounded-xl border text-2xl transition sm:text-3xl',
                safe
                  ? 'border-felt-300/50 bg-felt-600/60'
                  : hit
                    ? 'border-ruby-300 bg-ruby-700'
                    : mine
                      ? 'border-ruby-400/40 bg-ruby-900/60 opacity-80'
                      : end
                        ? 'border-white/10 bg-ink-950/40 opacity-50'
                        : 'border-gold-500/30 bg-ink-800 hover:-translate-y-0.5 hover:border-gold-400 disabled:hover:translate-y-0',
              )}
            >
              {(safe || mine) && (
                <motion.span initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} aria-hidden="true">
                  {safe ? '💎' : '💣'}
                </motion.span>
              )}
            </button>
          );
        })}
      </div>
      {end && !round && <Outcome staked={end.bet} win={end.win} />}
    </SoloShell>
  );
}
