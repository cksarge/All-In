import { useState } from 'react';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from '@/components/solo/SoloShell';
import { cn } from '@/components/ui/cn';
import { holdBalance, releaseBalance, settleBalance, sleep, useSoloGame, type SoloInfo, type Spots } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface Config {
  pays: Record<string, number>;
}
interface Result {
  round_id: string;
  dragon: number;
  tiger: number;
  outcome: 'dragon' | 'tiger' | 'tie';
  suited: boolean;
  bets: Spots;
  returns: Spots;
  staked: number;
  win: number;
  balance: number;
}

export function DragonTigerGame() {
  const { info, error, load, call } = useSoloGame<Config>('dragon_tiger', 'more_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Opening the table…" />;
  return <Table info={info} call={call} />;
}

function Side({ title, emoji, card, won, id, delay }: { title: string; emoji: string; card: number | undefined; won: boolean; id: string; delay: number }) {
  return (
    <div className={cn('flex flex-1 flex-col items-center rounded-2xl border p-3 transition', won ? 'border-gold-300 bg-gold-500/10' : 'border-white/10 bg-ink-950/25')}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/75">
        <span aria-hidden="true">{emoji} </span>
        {title}
      </p>
      <div className="mt-2 flex min-h-[6.3rem] items-center">{card !== undefined && <PlayingCard key={id} card={card} size="lg" delay={delay} />}</div>
    </div>
  );
}

function Table({ info, call }: { info: SoloInfo<Config>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const s = useSpotBets(info.tiers, info.game);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(false);
  const pays = info.config.pays;

  const deal = async () => {
    if (busy || s.total === 0) return;
    setBusy(true);
    s.remember();
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - s.total);
    const [res, err] = await call<Result>('dragon_tiger_deal', { p_tier: s.tierKey, p_bets: s.bets });
    if (err !== null) {
      releaseBalance();
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    setShown(false);
    setResult(res);
    playSound('card');
    await sleep(1100);
    setShown(true);
    settleBalance(res.balance);
    playSound(res.win > res.staked ? 'win' : res.win > 0 ? 'chip' : 'lose');
    s.clear();
    setBusy(false);
  };

  const after = shown && result && s.total === 0 ? result : null;
  const showBets = s.total > 0 || !result ? s.bets : result.bets;
  const spot = (k: string, name: string, p: string, className?: string) => (
    <BetSpot
      key={k}
      name={name}
      pays={p}
      amount={showBets[k] ?? 0}
      onClick={() => s.add(k)}
      disabled={busy}
      state={after && after.bets[k] ? (after.returns[k] > after.bets[k] ? 'win' : 'lose') : null}
      className={className}
    />
  );
  const status = busy ? 'No more bets' : after ? (after.outcome === 'tie' ? (after.suited ? 'A suited tie!' : 'A tie') : `${after.outcome === 'dragon' ? 'Dragon' : 'Tiger'} wins`) : 'Place your bets';

  return (
    <SoloShell
      info={info}
      tier={s.tierKey}
      status={status}
      controls={<SpotControls s={s} tiers={info.tiers} busy={busy} action="Deal" onAction={() => void deal()} auto />}
      rules={
        <>
          <p>
            One card goes to the <strong className="text-ivory">Dragon</strong> and one to the <strong className="text-ivory">Tiger</strong>.
            Bet on which will be higher. That&apos;s the whole game.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Kings are high and <strong className="text-ivory">aces are low</strong>. Suits don&apos;t matter for who wins.</li>
            <li>Dragon and Tiger pay {pays.dragon} to 1. If the cards tie, you get <strong className="text-ivory">half your bet back</strong> (rounded down).</li>
            <li><strong className="text-ivory">Tie</strong> pays {pays.tie} to 1 when the two cards are the same rank.</li>
            <li><strong className="text-ivory">Suited tie</strong> pays {pays.suited_tie} to 1 when they are the same rank and the same suit.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            House edge: Dragon and Tiger 3.7%. Tie and Suited tie are long shots at about 10% and 14%. Cards come from a
            freshly shuffled eight-deck shoe, dealt by the server. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="flex gap-3">
        <Side title="Dragon" emoji="🐉" card={result?.dragon} won={Boolean(after && after.outcome === 'dragon')} id={`${result?.round_id}-d`} delay={0} />
        <Side title="Tiger" emoji="🐅" card={result?.tiger} won={Boolean(after && after.outcome === 'tiger')} id={`${result?.round_id}-t`} delay={0.4} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {spot('dragon', 'Dragon', `${pays.dragon} to 1`)}
        {spot('tie', 'Tie', `${pays.tie} to 1`)}
        {spot('tiger', 'Tiger', `${pays.tiger} to 1`)}
      </div>
      <div className="mt-2">{spot('suited_tie', 'Suited tie', `${pays.suited_tie} to 1`, 'min-h-12 w-full')}</div>
      {after && <Outcome staked={after.staked} win={after.win} />}
    </SoloShell>
  );
}
