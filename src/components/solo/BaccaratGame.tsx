import { useState } from 'react';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { cn } from '@/components/ui/cn';
import { holdBalance, settleBalance, sleep, useSoloGame, type SoloInfo, type Spots } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from './SoloShell';

interface Config {
  pays: Record<string, number>;
  commission_pct: number;
}
type Side = 'player' | 'banker' | 'tie';
interface Result {
  round_id: string;
  player: number[];
  banker: number[];
  player_total: number;
  banker_total: number;
  natural: boolean;
  outcome: Side;
  bets: Spots;
  returns: Spots;
  commission: number;
  staked: number;
  win: number;
  balance: number;
}

const STEP = 0.38;
const SIDE_LABEL: Record<Side, string> = { player: 'Player', banker: 'Banker', tie: 'Tie' };
const BEAD: Record<Side, string> = { player: 'bg-sapphire-500', banker: 'bg-ruby-600', tie: 'bg-felt-500' };

export function BaccaratGame() {
  const { info, error, load, call } = useSoloGame<Config>('baccarat');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Opening the baccarat table…" />;
  return <Table info={info} call={call} />;
}

function Hand({ title, cards, order, total, shown, won, roundId }: { title: string; cards: number[]; order: number[]; total: number; shown: boolean; won: boolean; roundId: string }) {
  return (
    <div className={cn('flex flex-1 flex-col items-center rounded-2xl border p-3 transition', won ? 'border-gold-300 bg-gold-500/10' : 'border-white/10 bg-ink-950/25')}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cream/75">{title}</p>
      <div className="mt-2 flex min-h-[4.9rem] gap-1.5">
        {cards.map((c, i) => (
          <PlayingCard key={`${roundId}-${i}`} card={c} size="md" delay={order[i] * STEP} />
        ))}
      </div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums text-ivory" aria-label={shown ? `${title} total ${total}` : undefined}>
        {shown ? total : ' '}
      </p>
    </div>
  );
}

function Table({ info, call }: { info: SoloInfo<Config>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const s = useSpotBets(info.tiers, info.game);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(false);
  const [road, setRoad] = useState<Side[]>([]);

  const deal = async () => {
    if (busy || s.total === 0) return;
    setBusy(true);
    s.remember();
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - s.total);
    const [res, err] = await call<Result>('baccarat_deal', { p_tier: s.tierKey, p_bets: s.bets });
    if (err !== null) {
      holdBalance(start);
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    setShown(false);
    setResult(res);
    playSound('card');
    await sleep((res.player.length + res.banker.length) * STEP * 1000 + 500);
    setShown(true);
    settleBalance(res.balance);
    setRoad((r) => [...r, res.outcome].slice(-24));
    playSound(res.win > res.staked ? 'win' : res.win === res.staked ? 'chip' : 'lose');
    s.clear();
    setBusy(false);
  };

  // Deal order: player, banker, player, banker, then any third cards.
  const order = result
    ? { player: [0, 2, 4], banker: [1, 3, result.player.length === 3 ? 5 : 4] }
    : { player: [], banker: [] };
  const showBets = s.total > 0 || !result ? s.bets : result.bets;
  const spotState = (k: string) => (shown && result && s.total === 0 && result.bets[k] ? (result.returns[k] > 0 ? 'win' : 'lose') : null);
  const pays = info.config.pays;
  const spot = (k: string, name: string, paysText: string, className?: string) => (
    <BetSpot key={k} name={name} pays={paysText} amount={showBets[k] ?? 0} onClick={() => s.add(k)} disabled={busy} state={spotState(k)} className={className} />
  );

  const status = busy
    ? 'No more bets'
    : shown && result
      ? result.outcome === 'tie'
        ? `Tie, ${result.player_total} all`
        : `${SIDE_LABEL[result.outcome]} wins, ${Math.max(result.player_total, result.banker_total)} to ${Math.min(result.player_total, result.banker_total)}`
      : 'Place your bets';

  return (
    <SoloShell
      info={info}
      tier={s.tierKey}
      status={status}
      controls={<SpotControls s={s} tiers={info.tiers} busy={busy} action="Deal" onAction={() => void deal()} auto />}
      rules={
        <>
          <p>
            Two hands are dealt, <strong className="text-ivory">Player</strong> and <strong className="text-ivory">Banker</strong>. You
            bet on which will finish closer to 9, or on a tie. You don&apos;t make any decisions after that: the drawing rules are fixed.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Aces count 1, tens and face cards count 0, everything else its number. Only the last digit of a total counts, so 7 + 8 is 5.</li>
            <li>An 8 or 9 on the first two cards is a &quot;natural&quot; and ends the hand.</li>
            <li>Otherwise the Player draws a third card on 0 to 5 and stands on 6 or 7. The Banker then draws or stands by a fixed table that depends on the Player&apos;s third card.</li>
            <li><strong className="text-ivory">Player</strong> pays {pays.player} to 1. <strong className="text-ivory">Banker</strong> pays {pays.banker} to 1 less a {info.config.commission_pct}% commission (rounded up to a whole chip), because the Banker wins slightly more often.</li>
            <li><strong className="text-ivory">Tie</strong> pays {pays.tie} to 1. On a tie, Player and Banker bets are returned.</li>
            <li><strong className="text-ivory">Pairs</strong> pay {pays.player_pair} to 1 when that hand&apos;s first two cards are the same rank.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            House edge: Banker 1.06%, Player 1.24%, Tie about 14%, pairs about 10%. Cards come from a freshly shuffled eight-deck
            shoe, dealt by the server. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="flex gap-3">
        <Hand title="Player" cards={result?.player ?? []} order={order.player} total={result?.player_total ?? 0} shown={shown} won={shown && result?.outcome === 'player'} roundId={result?.round_id ?? ''} />
        <Hand title="Banker" cards={result?.banker ?? []} order={order.banker} total={result?.banker_total ?? 0} shown={shown} won={shown && result?.outcome === 'banker'} roundId={result?.round_id ?? ''} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {spot('player', 'Player', `${pays.player} to 1`)}
        {spot('tie', 'Tie', `${pays.tie} to 1`)}
        {spot('banker', 'Banker', `${pays.banker} to 1, less ${info.config.commission_pct}%`)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {spot('player_pair', 'Player pair', `${pays.player_pair} to 1`, 'min-h-12')}
        {spot('banker_pair', 'Banker pair', `${pays.banker_pair} to 1`, 'min-h-12')}
      </div>

      {shown && result && s.total === 0 && <Outcome staked={result.staked} win={result.win} />}

      {road.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1" aria-label={`Recent results: ${road.map((r) => SIDE_LABEL[r]).join(', ')}`}>
          {road.map((r, i) => (
            <span key={i} className={cn('flex h-5 w-5 items-center justify-center rounded-full text-[0.6rem] font-bold text-ivory', BEAD[r])} aria-hidden="true">
              {SIDE_LABEL[r][0]}
            </span>
          ))}
        </div>
      )}
    </SoloShell>
  );
}
