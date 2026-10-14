import { useRemembered } from '@/hooks/useRemembered';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { BetStepper, Outcome, SoloGate, SoloShell } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { formatChipsCompact } from '@/lib/format';
import { chipsFor, timesBet } from '@/lib/slots';
import { holdBalance, releaseBalance, settleBalance, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

type CardKey = 'clover' | 'gold' | 'diamond';
interface Config {
  cards: Record<CardKey, { name: string; prizes: [number, number][] }>;
  out_of: number;
}
interface Result {
  round_id: string;
  card: CardKey;
  /** Nine prizes in hundredths of the price. */
  panels: number[];
  units: number;
  bet: number;
  win: number;
  balance: number;
}

const LOOK: Record<CardKey, { emoji: string; blurb: string; bg: string; cover: string }> = {
  clover: { emoji: '🍀', blurb: 'Wins often, small prizes', bg: 'linear-gradient(160deg, #135c3e, #062417)', cover: 'linear-gradient(135deg, #5cc392, #1a774f)' },
  gold: { emoji: '⛏️', blurb: 'A bit of both', bg: 'linear-gradient(160deg, #86661c, #2a2108)', cover: 'linear-gradient(135deg, #f0d688, #ad872b)' },
  diamond: { emoji: '💎', blurb: 'Rare wins, huge top prize', bg: 'linear-gradient(160deg, #1b3a7a, #0d1b3a)', cover: 'linear-gradient(135deg, #8fb0f0, #3566c4)' },
};
const ORDER: CardKey[] = ['clover', 'gold', 'diamond'];

export function ScratchGame() {
  const { info, error, load, call } = useSoloGame<Config>('scratch_cards', 'more_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Printing the cards…" />;
  return <Counter info={info} call={call} />;
}

function Counter({ info, call }: { info: SoloInfo<Config>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const [card, setCard] = useRemembered<CardKey>('scratch:card', 'clover', (v) => ['clover', 'gold', 'diamond'].includes(v));
  const [betIndex, setBetIndex] = useRemembered(`bet:${info.game}`, 0, (v) => Number.isInteger(v) && v >= 0 && v < info.bets.length);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState<boolean[]>(Array(9).fill(false));
  const bet = info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);
  const done = Boolean(result) && open.every(Boolean);
  const scratching = Boolean(result) && !done;
  const shown = result?.card ?? card;
  const look = LOOK[shown];

  const reveal = (next: boolean[]) => {
    setOpen(next);
    if (result && next.every(Boolean)) {
      settleBalance(result.balance);
      playSound(result.win > 0 ? 'win' : 'lose');
    }
  };

  const take = async () => {
    if (busy || scratching) return;
    if (balance < bet) return toast.info('Not enough chips for that card', 'Pick a cheaper card, or collect free chips in the lounge.');
    setBusy(true);
    holdBalance(balance - bet);
    const [res, err] = await call<Result>('scratch_play', { p_card: card, p_bet: bet });
    setBusy(false);
    if (err !== null) {
      releaseBalance();
      playSound('error');
      return toast.error(err);
    }
    playSound('whoosh');
    setResult(res);
    setOpen(Array(9).fill(false));
  };

  const status = scratching
    ? 'Scratch the panels. Three matching prizes wins that prize.'
    : done && result
      ? result.win > 0
        ? `Three of a kind: ×${result.units / 100}!`
        : 'No match this time.'
      : 'Pick a card and a price';
  const winUnits = done && result ? result.units : 0;

  return (
    <SoloShell
      info={info}
      tier={tier?.tier}
      status={status}
      controls={
        <>
          <BetStepper label="Card price" bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy || scratching} tiers={info.tiers} />
          <div className="ml-auto flex items-center gap-2">
            {scratching && (
              <Button variant="outline" onClick={() => reveal(Array(9).fill(true))} hotkey="s">
                Scratch all
              </Button>
            )}
            <Button size="lg" className="min-w-32" loading={busy} disabled={scratching || balance < bet} onClick={() => void take()} hotkey="space">
              New card
            </Button>
          </div>
        </>
      }
      rules={
        <>
          <p>
            Pick one of three cards and what to pay for it. Scratch the nine panels: if <strong className="text-ivory">three panels show the
            same prize</strong>, you win that prize.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>The prize on a card is decided by the server the moment you take it. Scratching just shows you.</li>
            <li>Two matching prizes is not a win, however close it looks. A losing card never shows three of anything.</li>
            <li>The three cards return the same over a long run (94%) but feel very different:</li>
          </ul>
          <table className="w-full text-left">
            <caption className="sr-only">The three cards</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="py-1.5">Card</th>
                <th scope="col" className="py-1.5">Wins about</th>
                <th scope="col" className="py-1.5">Prizes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {ORDER.map((k) => {
                const p = info.config.cards[k].prizes;
                const hit = p.reduce((n, [, w]) => n + w, 0) / info.config.out_of;
                return (
                  <tr key={k}>
                    <td className="py-1.5 text-ivory">{info.config.cards[k].name}</td>
                    <td className="py-1.5">1 card in {Math.round(1 / hit)}</td>
                    <td className="py-1.5 text-gold-200">
                      {timesBet(p[0][0])} to {timesBet(p[p.length - 1][0])}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            Prizes are multiples of what you paid for the card. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div role="radiogroup" aria-label="Card" className="mx-auto grid max-w-md grid-cols-3 gap-2">
        {ORDER.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={card === k}
            disabled={busy || scratching}
            onClick={() => {
              setCard(k);
              setResult(null);
              playSound('click');
            }}
            className={cn(
              'rounded-xl border px-2 py-2 text-center transition disabled:opacity-60',
              (scratching ? shown : card) === k ? 'border-gold-300 shadow-glow-gold' : 'border-white/10 hover:border-white/30',
            )}
            style={{ background: LOOK[k].bg }}
          >
            <span className="block text-xl" aria-hidden="true">{LOOK[k].emoji}</span>
            <span className="block text-sm font-bold text-ivory">{info.config.cards[k].name}</span>
            <span className="block text-[0.65rem] leading-tight text-cream/75">{LOOK[k].blurb}</span>
          </button>
        ))}
      </div>

      <div className="mx-auto mt-4 max-w-xs rounded-2xl border border-gold-500/40 p-3" style={{ background: look.bg }}>
        <p className="mb-2 text-center font-display text-lg font-bold text-ivory">
          <span aria-hidden="true">{look.emoji} </span>
          {info.config.cards[shown].name}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 9 }, (_, i) => {
            const units = result?.panels[i];
            const isOpen = Boolean(result) && open[i];
            const winner = winUnits > 0 && units === winUnits;
            return (
              <button
                key={`${result?.round_id ?? 'blank'}-${i}`}
                type="button"
                disabled={!result || isOpen}
                aria-label={isOpen && units !== undefined ? `Panel ${i + 1}: ${chipsFor(result!.bet, units)} chips` : `Panel ${i + 1}, covered`}
                onClick={() => {
                  playSound('pop');
                  reveal(open.map((v, k) => v || k === i));
                }}
                className={cn(
                  'relative flex aspect-square items-center justify-center overflow-hidden rounded-lg border text-sm font-bold tabular-nums',
                  winner ? 'border-gold-200 bg-gold-400 text-ink-950 shadow-glow-gold' : 'border-black/30 bg-ink-950/70 text-ivory',
                )}
              >
                {isOpen && units !== undefined && <span>{formatChipsCompact(chipsFor(result!.bet, units))}</span>}
                {!isOpen && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex items-center justify-center text-lg text-ink-950/50"
                    style={{ background: look.cover }}
                    aria-hidden="true"
                  >
                    {result ? '?' : ''}
                  </motion.span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-center text-[0.7rem] text-cream/80">Match three prizes to win</p>
      </div>
      {done && result && <Outcome staked={result.bet} win={result.win} />}
    </SoloShell>
  );
}
