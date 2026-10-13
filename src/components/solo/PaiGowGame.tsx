import { useMemo, useState } from 'react';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { JOKER } from '@/lib/cards';
import { HAND_NAMES, holdBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from './SoloShell';

interface Config {
  commission_pct: number;
}
interface Round {
  hand: number[];
  bet: number;
  house_way: number[];
}
interface Result {
  round_id: string;
  low: number[];
  high: number[];
  dealer_low: number[];
  dealer_high: number[];
  high_made: string;
  low_made: string;
  dealer_high_made: string;
  dealer_low_made: string;
  high_wins: boolean;
  low_wins: boolean;
  outcome: 'win' | 'push' | 'lose';
  bet: number;
  commission: number;
  win: number;
  balance: number;
}

/** Joker first, then aces down to twos. */
const strength = (c: number) => (c === JOKER ? 99 : c % 13 === 0 ? 14 : (c % 13) + 1);
const sorted = (cards: number[]) => [...cards].sort((a, b) => strength(b) - strength(a) || a - b);

export function PaiGowGame() {
  const { info, error, load, call } = useSoloGame<Config, Round>('pai_gow_poker');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Opening the table…" />;
  return <Table info={info} call={call} />;
}

function Row({ who, low, high, lowMade, highMade, lowWon, highWon, id }: { who: string; low: number[]; high: number[]; lowMade: string; highMade: string; lowWon?: boolean; highWon?: boolean; id: string }) {
  const tag = (won: boolean | undefined) =>
    won === undefined ? null : <span className={cn('ml-1.5 font-bold', won ? 'text-gold-300' : 'text-ruby-300')}>{won ? 'wins' : 'loses'}</span>;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/75">{who}</p>
      <div className="mt-1.5 flex flex-wrap items-start justify-center gap-x-5 gap-y-2">
        <div className="text-center">
          <div className="flex justify-center gap-1">
            {sorted(low).map((c, i) => (
              <PlayingCard key={`${id}-l${c}`} card={c} size="sm" index={i} />
            ))}
          </div>
          <p className="mt-1 text-xs text-cream/80">
            Low: {HAND_NAMES[lowMade]}
            {tag(lowWon)}
          </p>
        </div>
        <div className="text-center">
          <div className="flex justify-center gap-1">
            {sorted(high).map((c, i) => (
              <PlayingCard key={`${id}-h${c}`} card={c} size="sm" index={i + 2} />
            ))}
          </div>
          <p className="mt-1 text-xs text-cream/80">
            High: {HAND_NAMES[highMade]}
            {tag(highWon)}
          </p>
        </div>
      </div>
    </div>
  );
}

function Table({ info, call }: { info: SoloInfo<Config, Round>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const s = useSpotBets(info.tiers, info.game);
  const [round, setRound] = useState<(Round & { round_id: string }) | null>(info.round);
  const [low, setLow] = useState<number[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const hand = useMemo(() => (round ? sorted(round.hand) : []), [round]);

  const deal = async () => {
    if (busy || !s.bets.bet) return;
    setBusy(true);
    s.remember();
    const [res, err] = await call<Round & { round_id: string; balance: number }>('pgw_deal', { p_tier: s.tierKey, p_bet: s.bets.bet });
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    setResult(null);
    setShown(false);
    setLow([]);
    setRound(res);
    settleBalance(res.balance);
    s.clear();
  };

  const set = async () => {
    if (busy || !round || low.length !== 2) return;
    setBusy(true);
    holdBalance(useWallet.getState().status?.balance ?? 0);
    const [res, err] = await call<Result>('pgw_set', { p_low: low });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    setRound(null);
    setResult(res);
    await sleep(1100);
    setShown(true);
    settleBalance(res.balance);
    playSound(res.outcome === 'win' ? 'win' : res.outcome === 'push' ? 'chip' : 'lose');
    setBusy(false);
  };

  const pick = (c: number) => {
    if (busy) return;
    setLow((l) => (l.includes(c) ? l.filter((x) => x !== c) : l.length < 2 ? [...l, c] : [l[1], c]));
    playSound('click');
  };

  const betting = !round && s.total > 0;
  const status = round
    ? low.length === 2
      ? 'Ready? Set your hands.'
      : 'Tap two cards for your low hand'
    : result && !betting
      ? shown
        ? { win: 'You win both hands!', push: 'One hand each: a push.', lose: 'The dealer takes both hands.' }[result.outcome]
        : 'The dealer sets their hand…'
      : 'Place your bet';

  return (
    <SoloShell
      info={info}
      tier={round ? info.round?.tier ?? s.tierKey : s.tierKey}
      status={status}
      controls={
        round ? (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setLow(round.house_way)}>
              House way
            </Button>
            <Button className="min-w-32" loading={busy} disabled={low.length !== 2} onClick={() => void set()}>
              Set hands
            </Button>
          </div>
        ) : (
          <SpotControls s={s} tiers={info.tiers} busy={busy} action="Deal" onAction={() => void deal()} />
        )
      }
      rules={
        <>
          <p>
            You and the dealer each get seven cards and split them into a five-card <strong className="text-ivory">high hand</strong> and a
            two-card <strong className="text-ivory">low hand</strong>. Each of your hands plays against the dealer&apos;s matching hand.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Win both hands and you&apos;re paid 1 to 1, less a {info.config.commission_pct}% commission (rounded up to a whole chip).</li>
            <li>Win one and lose one and it&apos;s a <strong className="text-ivory">push</strong>: your bet comes back. That happens about 4 hands in 10, so chips last a long time here.</li>
            <li>Lose both and you lose the bet. If a hand ties exactly, the dealer wins that hand.</li>
            <li>Your low hand <strong className="text-ivory">can&apos;t be stronger</strong> than your high hand. The low hand is only ever a pair or two loose cards.</li>
            <li>The deck has one <strong className="text-ivory">joker</strong>. It counts as an ace, or as the card that completes a straight, a flush or a straight flush.</li>
            <li>Not sure? <strong className="text-ivory">House way</strong> sets your cards the way the dealer would. The dealer always sets theirs that way.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            House edge about 2.7% when you set your hands the house way. A-2-3-4-5 is the lowest straight. Play chips have no cash value.
          </p>
        </>
      }
    >
      {round ? (
        <div className="text-center">
          <div className="flex flex-wrap justify-center gap-1.5 sm:gap-2">
            {hand.map((c, i) => {
              const picked = low.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  disabled={busy}
                  aria-pressed={picked}
                  onClick={() => pick(c)}
                  className={cn('flex flex-col items-center gap-1 rounded-lg p-0.5 transition', picked ? '-translate-y-2' : 'hover:-translate-y-1')}
                >
                  <span aria-hidden={!picked} className={cn('h-4 text-[0.65rem] font-bold uppercase tracking-wider', picked ? 'text-gold-300' : 'text-transparent')}>Low</span>
                  <PlayingCard key={`${round.round_id}-${c}`} card={c} size="md" index={i} highlight={picked} />
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-cream/70">The other five cards make your high hand.</p>
        </div>
      ) : (
        <>
          {result && !betting && (
        <div className="mb-4 space-y-4 text-center">
          <Row who="Dealer" low={result.dealer_low} high={result.dealer_high} lowMade={result.dealer_low_made} highMade={result.dealer_high_made} id={result.round_id + 'd'} />
          <Row
            who="You"
            low={result.low}
            high={result.high}
            lowMade={result.low_made}
            highMade={result.high_made}
            lowWon={shown ? result.low_wins : undefined}
            highWon={shown ? result.high_wins : undefined}
            id={result.round_id + 'p'}
          />
          {shown && <Outcome staked={result.bet} win={result.win} />}
        </div>
          )}
          <div className="mx-auto max-w-xs">
            <BetSpot name="Bet" pays={`1 to 1, less ${info.config.commission_pct}%`} amount={s.bets.bet ?? 0} onClick={() => s.add('bet')} disabled={busy} className="min-h-20 w-full" />
          </div>
        </>
      )}
    </SoloShell>
  );
}
