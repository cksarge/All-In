import { useState } from 'react';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { holdBalance, releaseBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface Config {
  tie_pays: number;
}
/** A tie waiting for war or surrender. */
interface Round {
  player: number;
  dealer: number;
  tied: boolean;
  ante: number;
  tie_bet: number;
  tie_return: number;
}
interface Result extends Round {
  round_id: string;
  outcome: 'win' | 'lose' | 'surrender' | 'war_win' | 'war_tie' | 'war_lose';
  went_to_war?: boolean;
  war_player?: number | null;
  war_dealer?: number | null;
  staked: number;
  win: number;
  balance: number;
}

const TEXT: Record<Result['outcome'], string> = {
  win: 'Your card is higher. You win!',
  lose: 'The dealer is higher.',
  surrender: 'You surrendered: half your ante comes back.',
  war_win: 'You won the war!',
  war_tie: 'Tied again: you win, with a bonus.',
  war_lose: 'The dealer won the war.',
};

export function CasinoWarGame() {
  const { info, error, load, call } = useSoloGame<Config, Round>('casino_war', 'more_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Opening the table…" />;
  return <Table info={info} call={call} />;
}

function Table({ info, call }: { info: SoloInfo<Config, Round>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const s = useSpotBets(info.tiers, info.game);
  const [round, setRound] = useState<(Round & { round_id: string }) | null>(info.round);
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);

  const deal = async () => {
    if (busy) return;
    const ante = s.bets.ante ?? 0;
    if (!ante) return toast.info('Put chips on Ante first', 'The Tie bet is an optional side bet.');
    setBusy(true);
    s.remember();
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - s.total);
    const [res, err] = await call<(Round & { round_id: string; balance: number }) | Result>('war_deal', {
      p_tier: s.tierKey,
      p_ante: ante,
      p_tie: s.bets.tie ?? 0,
    });
    if (err !== null) {
      releaseBalance();
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    setShown(false);
    s.clear();
    if (res.tied) {
      setResult(null);
      setRound(res);
      await sleep(900);
      settleBalance(res.balance);
      playSound('turn');
    } else {
      setRound(null);
      setResult(res as Result);
      await sleep(900);
      setShown(true);
      settleBalance(res.balance);
      playSound((res as Result).win > 0 ? 'win' : 'lose');
    }
    setBusy(false);
  };

  const act = async (war: boolean) => {
    if (busy || !round) return;
    setBusy(true);
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - (war ? round.ante : 0));
    const [res, err] = await call<Result>('war_act', { p_war: war });
    if (err !== null) {
      releaseBalance();
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound(war ? 'card' : 'click');
    setRound(null);
    setResult(res);
    await sleep(war ? 1200 : 300);
    setShown(true);
    settleBalance(res.balance);
    playSound(res.win > res.staked ? 'win' : 'lose');
    setBusy(false);
  };

  const live = round ?? result;
  const betting = !round && s.total > 0;
  const amounts = betting || !live ? s.bets : { ante: live.ante, tie: live.tie_bet };
  const done = shown && result && !betting ? result : null;
  const status = round
    ? "It's a tie! Go to war, or surrender?"
    : result && !betting
      ? shown
        ? TEXT[result.outcome]
        : 'Cards up…'
      : 'Place your ante';
  const id = live?.round_id ?? 'none';

  return (
    <SoloShell
      info={info}
      tier={s.tierKey}
      status={status}
      controls={
        round ? (
          <>
            <p className="text-sm text-cream/85">
              War costs another <ChipAmount value={round.ante} className="font-bold text-ivory" iconClassName="h-4 w-4" />
            </p>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void act(false)}>
                Surrender
              </Button>
              <Button className="min-w-32" loading={busy} onClick={() => void act(true)}>
                Go to war
              </Button>
            </div>
          </>
        ) : (
          <SpotControls s={s} tiers={info.tiers} busy={busy} action="Deal" onAction={() => void deal()} />
        )
      }
      rules={
        <>
          <p>
            You get one card and the dealer gets one. <strong className="text-ivory">The higher card wins</strong> and pays 1 to 1. Aces are
            high.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>If the cards tie, you choose: <strong className="text-ivory">surrender</strong> and get half your ante back (rounded down), or <strong className="text-ivory">go to war</strong>.</li>
            <li>War costs a second bet equal to your ante. Three cards are set aside for each side, then you each get one more.</li>
            <li>Win the war and the second bet pays 1 to 1 and your ante comes back. Lose it and both bets are lost.</li>
            <li>If the war cards tie too, you win, and you&apos;re paid a bonus equal to your ante on top.</li>
            <li>The optional <strong className="text-ivory">Tie</strong> bet pays {info.config.tie_pays} to 1 if the first two cards match.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            House edge about 2.3% if you always go to war (the better choice), 3.7% if you surrender, and about 18% on the Tie
            bet. Cards come from a six-deck shoe, dealt by the server. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="flex items-start justify-center gap-6 sm:gap-10">
        {(['dealer', 'player'] as const).map((who) => (
          <div key={who} className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/75">{who === 'dealer' ? 'Dealer' : 'You'}</p>
            <div className="mt-2 flex min-h-[6.3rem] items-center justify-center gap-2">
              {live && <PlayingCard key={`${id}-${who}`} card={live[who]} size="lg" delay={who === 'dealer' ? 0.35 : 0} />}
              {result?.went_to_war && (
                <PlayingCard key={`${id}-${who}-war`} card={who === 'dealer' ? result.war_dealer : result.war_player} size="lg" delay={who === 'dealer' ? 0.7 : 0.35} />
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="mx-auto mt-4 grid max-w-sm grid-cols-2 gap-2">
        <BetSpot name="Ante" pays="1 to 1" amount={amounts.ante ?? 0} onClick={() => s.add('ante')} disabled={busy || Boolean(round)} state={done ? (done.win > 0 && done.outcome !== 'surrender' ? 'win' : 'lose') : null} />
        <BetSpot
          name="Tie"
          pays={`${info.config.tie_pays} to 1`}
          amount={amounts.tie ?? 0}
          onClick={() => s.add('tie')}
          disabled={busy || Boolean(round)}
          state={done && done.tie_bet ? (done.tied ? 'win' : 'lose') : round && round.tie_bet ? 'win' : null}
        />
      </div>
      {done && <Outcome staked={done.staked} win={done.win} />}
    </SoloShell>
  );
}
