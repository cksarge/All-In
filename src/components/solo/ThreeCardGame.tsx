import { useState } from 'react';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { HAND_NAMES, holdBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from './SoloShell';

interface Config {
  pair_plus: Record<string, number>;
  ante_bonus: Record<string, number>;
}
interface Round {
  hand: number[];
  ante: number;
  pair_plus: number;
  made: string;
}
interface Result extends Round {
  round_id: string;
  dealer: number[];
  dealer_made: string;
  qualifies: boolean;
  outcome: 'win' | 'lose' | 'tie' | 'fold' | 'no_qualify';
  played: boolean;
  returns: { ante: number; play: number; ante_bonus: number; pair_plus: number };
  staked: number;
  win: number;
  balance: number;
}

const OUTCOME: Record<Result['outcome'], string> = {
  win: 'Your hand wins!',
  lose: 'The dealer wins.',
  tie: 'A tie: your bets come back.',
  fold: 'You folded.',
  no_qualify: "The dealer doesn't qualify: your ante wins.",
};
const PP_ORDER = ['straight_flush', 'three_kind', 'straight', 'flush', 'pair'];

export function ThreeCardGame() {
  const { info, error, load, call } = useSoloGame<Config, Round>('three_card_poker');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Opening the table…" />;
  return <Table info={info} call={call} />;
}

function Table({ info, call }: { info: SoloInfo<Config, Round>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const s = useSpotBets(info.tiers);
  const [round, setRound] = useState<(Round & { round_id: string }) | null>(info.round);
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);

  const deal = async () => {
    if (busy) return;
    const ante = s.bets.ante ?? 0;
    if (!ante) return toast.info('Put chips on Ante first', 'Pair Plus is an optional side bet.');
    if (s.balance < s.total + ante) return toast.info('Not enough chips', 'You need enough to cover the Play bet too, which matches your ante.');
    setBusy(true);
    s.remember();
    const [res, err] = await call<Round & { round_id: string; balance: number }>('tcp_deal', {
      p_tier: s.tierKey,
      p_ante: ante,
      p_pair_plus: s.bets.pair_plus ?? 0,
    });
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    setResult(null);
    setShown(false);
    setRound(res);
    settleBalance(res.balance);
    s.clear();
  };

  const act = async (play: boolean) => {
    if (busy || !round) return;
    setBusy(true);
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - (play ? round.ante : 0));
    const [res, err] = await call<Result>('tcp_act', { p_play: play });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound(play ? 'chip' : 'click');
    setRound(null);
    setResult(res);
    await sleep(900);
    setShown(true);
    settleBalance(res.balance);
    playSound(res.win > res.staked ? 'win' : res.win === res.staked ? 'chip' : 'lose');
    setBusy(false);
  };

  const live = round ?? result;
  const betting = !round && s.total > 0;
  const amounts = betting || !live ? s.bets : { ante: live.ante, pair_plus: live.pair_plus, play: result?.played ? result.ante : 0 };
  const state = (k: 'ante' | 'play' | 'pair_plus') =>
    shown && result && !betting && (k === 'play' ? result.played : amounts[k]) ? (result.returns[k] > 0 ? 'win' : 'lose') : null;

  const status = round
    ? `You have ${HAND_NAMES[round.made].toLowerCase()}. Play or fold?`
    : result && !betting
      ? shown
        ? OUTCOME[result.outcome]
        : 'The dealer turns over…'
      : 'Place your ante';

  return (
    <SoloShell
      info={info}
      tier={round ? info.round?.tier ?? s.tierKey : s.tierKey}
      status={status}
      controls={
        round ? (
          <>
            <p className="text-sm text-cream/85">
              Play costs <ChipAmount value={round.ante} className="font-bold text-ivory" iconClassName="h-4 w-4" />
            </p>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void act(false)}>
                Fold
              </Button>
              <Button className="min-w-28" loading={busy} onClick={() => void act(true)}>
                Play
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
            You and the dealer each get three cards. Put up an <strong className="text-ivory">Ante</strong>, look at your hand, then
            either <strong className="text-ivory">Play</strong> (a second bet equal to your ante) or <strong className="text-ivory">Fold</strong> and
            give up the ante.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>With three cards the order is: straight flush, three of a kind, straight, flush, pair, high card. A straight beats a flush here.</li>
            <li>The dealer needs <strong className="text-ivory">queen high or better</strong> to qualify. If not, your ante pays 1 to 1 and your Play bet comes back.</li>
            <li>If the dealer qualifies, the better hand wins: ante and Play both pay 1 to 1, or both lose. A tie returns them.</li>
            <li>
              <strong className="text-ivory">Ante bonus</strong>, paid on the ante whenever you play, even if the dealer wins: straight flush{' '}
              {info.config.ante_bonus.straight_flush} to 1, three of a kind {info.config.ante_bonus.three_kind} to 1, straight{' '}
              {info.config.ante_bonus.straight} to 1.
            </li>
            <li>
              <strong className="text-ivory">Pair Plus</strong> is a side bet on your own three cards, paid whatever the dealer has:{' '}
              {PP_ORDER.map((k) => `${HAND_NAMES[k].toLowerCase()} ${info.config.pair_plus[k]} to 1`).join(', ')}.
            </li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            A simple rule that is close to the best play: Play with queen-six-four or better, fold anything lower. House edge about
            3.4% of the ante, and about 2.3% on Pair Plus. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/75">Dealer</p>
          <div className="mt-2 flex min-h-[4.9rem] justify-center gap-2">
            {live &&
              [0, 1, 2].map((i) => <PlayingCard key={`${live.round_id}-d${i}`} card={result ? result.dealer[i] : null} size="md" index={i + 3} />)}
          </div>
          <p className="mt-1 min-h-5 text-sm text-cream/80">
            {shown && result && !betting ? `${HAND_NAMES[result.dealer_made]}${result.qualifies ? '' : ' (does not qualify)'}` : ' '}
          </p>
        </div>
        <div className="text-center">
          <div className="flex min-h-[4.9rem] justify-center gap-2">
            {live && live.hand.map((c, i) => <PlayingCard key={`${live.round_id}-p${i}`} card={c} size="md" index={i} />)}
          </div>
          <p className={cn('mt-1 min-h-5 text-sm font-semibold', live ? 'text-gold-200' : 'text-cream/60')}>{live ? HAND_NAMES[live.made] : 'Your hand'}</p>
        </div>
      </div>

      <div className="mx-auto mt-3 grid max-w-md grid-cols-3 gap-2">
        <BetSpot name="Pair Plus" pays="side bet" amount={amounts.pair_plus ?? 0} onClick={() => s.add('pair_plus')} disabled={busy || Boolean(round)} state={state('pair_plus')} />
        <BetSpot name="Ante" pays="1 to 1" amount={amounts.ante ?? 0} onClick={() => s.add('ante')} disabled={busy || Boolean(round)} state={state('ante')} />
        <BetSpot name="Play" pays="matches ante" amount={'play' in amounts ? (amounts.play ?? 0) : 0} onClick={() => undefined} disabled state={state('play')} />
      </div>

      {shown && result && !betting && (
        <>
          <Outcome staked={result.staked} win={result.win} />
          {result.returns.ante_bonus > 0 && (
            <p className="mt-1 text-center text-xs text-gold-200">
              Includes an ante bonus of <ChipAmount value={result.returns.ante_bonus} iconClassName="h-3 w-3" />
            </p>
          )}
        </>
      )}
    </SoloShell>
  );
}
