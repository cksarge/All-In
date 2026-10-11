import { useState } from 'react';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { formatChips } from '@/lib/format';
import { HAND_NAMES, holdBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { BetStepper, Outcome, SoloGate, SoloShell } from './SoloShell';

interface Config {
  /** What a 1-chip bet gets back for each hand. */
  returns: Record<string, number>;
  rtp: number;
}
interface Round {
  hand: number[];
  bet: number;
  made: string | null;
}
interface Final extends Round {
  round_id: string;
  win: number;
  balance: number;
}

const ORDER: Record<string, string[]> = {
  video_poker_jacks: ['royal_flush', 'straight_flush', 'four_kind', 'full_house', 'flush', 'straight', 'three_kind', 'two_pair', 'jacks_or_better'],
  video_poker_deuces: ['natural_royal', 'four_deuces', 'wild_royal', 'five_kind', 'straight_flush', 'four_kind', 'full_house', 'flush', 'straight', 'three_kind'],
};

export function VideoPokerGame({ gameKey }: { gameKey: string }) {
  const { info, error, load, call } = useSoloGame<Config, Round>(gameKey);
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Powering up the machine…" />;
  return <Machine info={info} call={call} />;
}

function Machine({ info, call }: { info: SoloInfo<Config, Round>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const game = info.game;
  const deuces = game === 'video_poker_deuces';
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const big = useMediaQuery('(min-width: 640px)');
  // A hand left open (page closed before the draw) is picked up where it was.
  const [round, setRound] = useState<(Round & { round_id: string }) | null>(info.round);
  const [betIndex, setBetIndex] = useState(() => Math.max(0, info.bets.indexOf(info.round?.bet ?? info.bets[0])));
  const [holds, setHolds] = useState<boolean[]>([false, false, false, false, false]);
  const [final, setFinal] = useState<Final | null>(null);
  const [busy, setBusy] = useState(false);
  const bet = round?.bet ?? info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);

  const deal = async () => {
    if (busy) return;
    if (balance < bet) return toast.info('Not enough chips for that bet', 'Lower your bet, or pick up free chips in the lounge.');
    setBusy(true);
    const [res, err] = await call<Round & { round_id: string; balance: number }>('vp_deal', { p_game: game, p_bet: bet });
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    setFinal(null);
    setHolds([false, false, false, false, false]);
    setRound(res);
    settleBalance(res.balance);
  };

  const draw = async () => {
    if (busy || !round) return;
    setBusy(true);
    holdBalance(balance);
    const [res, err] = await call<Final>('vp_draw', { p_game: game, p_holds: holds });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    setRound(null);
    setFinal(res);
    await sleep(700);
    settleBalance(res.balance);
    playSound(res.win > 0 ? 'win' : 'lose');
    setBusy(false);
  };

  const toggle = (i: number) => {
    if (!round || busy) return;
    setHolds((h) => h.map((v, k) => (k === i ? !v : v)));
    playSound('click');
  };

  const hand = round?.hand ?? final?.hand ?? null;
  const made = round ? round.made : final ? final.made : null;
  const id = round?.round_id ?? final?.round_id ?? 'none';
  const status = round
    ? made
      ? `You have ${HAND_NAMES[made].toLowerCase()}. Tap the cards to keep.`
      : 'Tap the cards you want to keep, then draw.'
    : final
      ? final.made
        ? `${HAND_NAMES[final.made]}!`
        : 'No win this time.'
      : 'Pick your bet and deal.';

  return (
    <SoloShell
      info={info}
      tier={tier?.tier}
      status={status}
      controls={
        <>
          <BetStepper bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy || Boolean(round)} tiers={info.tiers} />
          <Button size="lg" className="ml-auto min-w-36" loading={busy} disabled={!round && balance < bet} onClick={() => void (round ? draw() : deal())}>
            {round ? 'Draw' : 'Deal'}
          </Button>
        </>
      }
      rules={
        <>
          <p>
            Five-card draw poker against a paytable. Press <strong className="text-ivory">Deal</strong> for five cards, tap the ones you
            want to keep, then <strong className="text-ivory">Draw</strong> to replace the rest. You&apos;re paid for the final hand.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            {deuces ? (
              <>
                <li>Every <strong className="text-ivory">2 is wild</strong>: it becomes whatever card makes your hand best.</li>
                <li>Because wilds make hands easier, the lowest paying hand is three of a kind. A pair or two pair pays nothing.</li>
                <li>A &quot;natural&quot; royal flush has no deuces. Four deuces is the second best hand.</li>
              </>
            ) : (
              <>
                <li>The lowest paying hand is a pair of jacks, queens, kings or aces, which returns your bet.</li>
                <li>Smaller pairs pay nothing, but they are still worth keeping to draw to three of a kind.</li>
              </>
            )}
            <li>Each hand uses a fresh 52-card deck. If you leave before drawing, the hand waits for you.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            Played perfectly, this paytable returns about {info.config.rtp}%. Mistakes in which cards to keep lower that. Play chips
            have no cash value.
          </p>
        </>
      }
    >
      <table className="mx-auto w-full max-w-md text-sm">
        <caption className="sr-only">Paytable at your bet</caption>
        <tbody>
          {ORDER[game].map((k) => (
            <tr key={k} className={cn('border-b border-white/[0.06]', made === k && 'bg-gold-500/20 text-gold-200')}>
              <th scope="row" className={cn('px-2 py-1 text-left font-normal', made === k ? 'font-semibold text-gold-200' : 'text-cream/85')}>
                {HAND_NAMES[k]}
              </th>
              <td className="px-2 py-1 text-right tabular-nums text-gold-200">{formatChips(bet * info.config.returns[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex justify-center gap-0.5 sm:gap-3">
        {[0, 1, 2, 3, 4].map((i) => {
          const card = hand?.[i];
          const held = Boolean(round) && holds[i];
          return (
            <button
              key={i}
              type="button"
              disabled={!round || busy}
              aria-pressed={round ? held : undefined}
              aria-label={card === undefined ? 'Card' : undefined}
              onClick={() => toggle(i)}
              className={cn('flex flex-col items-center gap-1 rounded-lg transition sm:p-0.5', round && !busy && 'hover:-translate-y-1', held && '-translate-y-2')}
            >
              <span aria-hidden={!held} className={cn('h-4 text-[0.65rem] font-bold uppercase tracking-wider', held ? 'text-gold-300' : 'text-transparent')}>Held</span>
              <PlayingCard key={`${id}-${i}-${card ?? 'x'}`} card={card ?? null} size={big ? 'lg' : 'md'} index={i} highlight={held} />
              <span
                aria-hidden={!(deuces && card !== undefined && card % 13 === 1)}
                className={cn('h-3 text-[0.6rem] font-bold uppercase tracking-wider', deuces && card !== undefined && card % 13 === 1 ? 'text-sapphire-300' : 'text-transparent')}
              >
                Wild
              </span>
            </button>
          );
        })}
      </div>

      {final && !round && <Outcome staked={final.bet} win={final.win} />}
      {!final && !round && (
        <p className="mt-3 text-center text-xs text-cream/60">
          Bets from <ChipAmount value={info.bets[0]} iconClassName="h-3 w-3" /> to <ChipAmount value={info.bets[info.bets.length - 1]} iconClassName="h-3 w-3" />
        </p>
      )}
    </SoloShell>
  );
}
