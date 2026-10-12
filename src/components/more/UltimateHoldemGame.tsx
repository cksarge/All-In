import { useState } from 'react';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { HAND_NAMES, holdBalance, releaseBalance, settleBalance, sleep, useSoloGame, type SoloInfo } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface Config {
  blind: Record<string, number>;
  trips: Record<string, number>;
}
type Stage = 'preflop' | 'flop' | 'river';
interface Round {
  hole: number[];
  board: number[];
  stage: Stage;
  ante: number;
  trips: number;
}
interface Result {
  round_id: string;
  done: true;
  hole: number[];
  board: number[];
  dealer: number[];
  made: string;
  dealer_made: string;
  best: number[];
  dealer_best: number[];
  qualifies: boolean;
  outcome: 'win' | 'lose' | 'tie' | 'fold';
  ante: number;
  trips: number;
  play: number;
  returns: { ante: number; blind: number; play: number; trips: number };
  staked: number;
  win: number;
  balance: number;
}

const ACTIONS: Record<Stage, { key: string; label: string; mult: number; primary?: boolean }[]> = {
  preflop: [
    { key: 'check', label: 'Check', mult: 0 },
    { key: 'bet3', label: 'Bet 3×', mult: 3 },
    { key: 'bet4', label: 'Bet 4×', mult: 4, primary: true },
  ],
  flop: [
    { key: 'check', label: 'Check', mult: 0 },
    { key: 'bet2', label: 'Bet 2×', mult: 2, primary: true },
  ],
  river: [
    { key: 'fold', label: 'Fold', mult: 0 },
    { key: 'bet1', label: 'Bet 1×', mult: 1, primary: true },
  ],
};
const PROMPT: Record<Stage, string> = {
  preflop: 'Your two cards. Bet 4× or 3× now, or check to see the flop.',
  flop: 'The flop. Bet 2× now, or check to see the last two cards.',
  river: 'All five are out. Bet 1× to play, or fold.',
};
const OUTCOME: Record<Result['outcome'], string> = {
  win: 'Your hand wins!',
  lose: 'The dealer wins.',
  tie: 'A tie: your bets come back.',
  fold: 'You folded.',
};
const ORDER = ['royal_flush', 'straight_flush', 'four_kind', 'full_house', 'flush', 'straight', 'three_kind'];

export function UltimateHoldemGame() {
  const { info, error, load, call } = useSoloGame<Config, Round>('ultimate_holdem', 'more_info');
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
    if (!ante) return toast.info('Put chips on Ante first', 'The Blind matches it by itself. Trips is an optional side bet.');
    const need = ante * 3 + (s.bets.trips ?? 0);
    if (s.balance < need) return toast.info('Not enough chips', 'You need the Ante, an equal Blind, and at least a 1× Play bet.');
    setBusy(true);
    s.remember();
    const [res, err] = await call<Round & { round_id: string; balance: number }>('uth_deal', {
      p_tier: s.tierKey,
      p_ante: ante,
      p_trips: s.bets.trips ?? 0,
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

  const act = async (key: string, mult: number) => {
    if (busy || !round) return;
    setBusy(true);
    const start = useWallet.getState().status?.balance ?? 0;
    if (mult > 0 || key === 'fold') holdBalance(start - round.ante * mult);
    const [res, err] = await call<Result | (Round & { round_id: string; done: false })>('uth_act', { p_action: key });
    if (err !== null) {
      releaseBalance();
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    if (!res.done) {
      playSound('card');
      setRound(res);
      setBusy(false);
      return;
    }
    playSound(mult > 0 ? 'chip' : 'click');
    setRound(null);
    setResult(res);
    await sleep(1400);
    setShown(true);
    settleBalance(res.balance);
    playSound(res.win > res.staked ? 'win' : res.win === res.staked ? 'chip' : 'lose');
    setBusy(false);
  };

  const live = round ?? result;
  const betting = !round && s.total > 0;
  const done = shown && result && !betting ? result : null;
  const board = live?.board ?? [];
  const amounts = betting || !live
    ? { ante: s.bets.ante ?? 0, blind: s.bets.ante ?? 0, trips: s.bets.trips ?? 0, play: 0 }
    : { ante: live.ante, blind: live.ante, trips: live.trips, play: result?.play ?? 0 };
  const state = (k: 'ante' | 'blind' | 'play' | 'trips') => (done && amounts[k] ? (done.returns[k] > amounts[k] ? 'win' : done.returns[k] === amounts[k] ? null : 'lose') : null);
  const status = round ? PROMPT[round.stage] : result && !betting ? (shown ? OUTCOME[result.outcome] : 'Showdown…') : 'Place your ante';
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
              Ante <ChipAmount value={round.ante} className="font-bold text-ivory" iconClassName="h-4 w-4" />
            </p>
            <div className="ml-auto flex flex-wrap gap-2">
              {ACTIONS[round.stage].map((a) => (
                <Button key={a.key} variant={a.primary ? 'gold' : 'outline'} disabled={busy} className={a.primary ? 'min-w-28' : undefined} onClick={() => void act(a.key, a.mult)}>
                  {a.label}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <SpotControls s={s} tiers={info.tiers} busy={busy} action="Deal" onAction={() => void deal()} />
        )
      }
      rules={
        <>
          <p>
            Texas Hold&apos;em against the dealer. You each get two cards and share five. You make <strong className="text-ivory">one Play bet</strong>,
            and the earlier you make it, the bigger it can be.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Start with an <strong className="text-ivory">Ante</strong>. An equal <strong className="text-ivory">Blind</strong> bet goes down with it.</li>
            <li>With just your two cards: bet <strong className="text-ivory">4×</strong> or <strong className="text-ivory">3×</strong> your ante, or check.</li>
            <li>After the flop (three shared cards): bet <strong className="text-ivory">2×</strong>, or check.</li>
            <li>After all five: bet <strong className="text-ivory">1×</strong>, or fold and give up the Ante and Blind.</li>
            <li>The better five-card hand wins. Play and Ante pay 1 to 1. If the dealer has less than a pair, the Ante is returned instead, win or lose.</li>
            <li>The <strong className="text-ivory">Blind</strong> pays extra when you win with a straight or better, and is returned when you win with less. It loses if you lose.</li>
            <li><strong className="text-ivory">Trips</strong> is a side bet on your own final hand, paid whatever the dealer has.</li>
          </ul>
          <table className="w-full text-left">
            <caption className="sr-only">Blind and Trips payouts</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="py-1.5">Your hand</th>
                <th scope="col" className="py-1.5">Blind</th>
                <th scope="col" className="py-1.5">Trips</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {ORDER.map((k) => (
                <tr key={k}>
                  <td className="py-1.5 text-ivory">{HAND_NAMES[k]}</td>
                  <td className="py-1.5 text-gold-200">{info.config.blind[k] ? (info.config.blind[k] === 1.5 ? '3 to 2' : `${info.config.blind[k]} to 1`) : 'returned'}</td>
                  <td className="py-1.5 text-gold-200">{info.config.trips[k]} to 1</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            A simple guide: bet 4× with any ace, any pair of threes or better, or two big cards; bet 2× on the flop with two pair
            or better; at the end, play any pair or better. House edge about 2.2% of the ante with good play. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/75">Dealer</p>
          <div className="mt-1.5 flex min-h-[3.6rem] justify-center gap-1.5">
            {live && [0, 1].map((i) => <PlayingCard key={`${id}-d${i}`} card={result ? result.dealer[i] : null} size="sm" index={i + 2} highlight={Boolean(done?.dealer_best.includes(result!.dealer[i]))} />)}
          </div>
          <p className="mt-1 min-h-5 text-xs text-cream/80">{done ? `${HAND_NAMES[done.dealer_made]}${done.qualifies ? '' : ' (does not qualify)'}` : ' '}</p>
        </div>
        <div className="flex min-h-[4.9rem] justify-center gap-1.5 rounded-2xl border border-white/10 bg-ink-950/25 px-3 py-2 sm:gap-2">
          {[0, 1, 2, 3, 4].map((i) =>
            board[i] !== undefined ? (
              <PlayingCard key={`${id}-b${i}`} card={board[i]} size="md" delay={result && !round ? i * 0.12 : (i % 3) * 0.1} highlight={Boolean(done?.best.includes(board[i]))} />
            ) : (
              <div key={`e${i}`} className="h-[4.9rem] w-[3.5rem] rounded-lg border border-dashed border-white/15" aria-hidden="true" />
            ),
          )}
        </div>
        <div className="text-center">
          <div className="flex min-h-[4.9rem] justify-center gap-1.5">
            {live && live.hole.map((c, i) => <PlayingCard key={`${id}-h${i}`} card={c} size="md" index={i} highlight={Boolean(done?.best.includes(c))} />)}
          </div>
          <p className="mt-1 min-h-5 text-sm font-semibold text-gold-200">{done ? HAND_NAMES[done.made] : live ? 'Your cards' : ' '}</p>
        </div>
      </div>

      <div className="mx-auto mt-3 grid max-w-lg grid-cols-4 gap-2">
        <BetSpot name="Trips" pays="side bet" amount={amounts.trips} onClick={() => s.add('trips')} disabled={busy || Boolean(round)} state={state('trips')} />
        <BetSpot name="Ante" pays="1 to 1" amount={amounts.ante} onClick={() => s.add('ante')} disabled={busy || Boolean(round)} state={state('ante')} />
        <BetSpot name="Blind" pays="matches ante" amount={amounts.blind} onClick={() => s.add('ante')} disabled={busy || Boolean(round)} state={state('blind')} />
        <BetSpot name="Play" pays="1 to 1" amount={amounts.play} onClick={() => undefined} disabled state={state('play')} />
      </div>
      {done && <Outcome staked={done.staked} win={done.win} />}
    </SoloShell>
  );
}
