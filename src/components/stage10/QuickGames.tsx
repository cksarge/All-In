import { useState } from 'react';
import { motion } from 'framer-motion';
import { PlayingCard } from '@/components/cards/PlayingCard';
import { Die } from '@/components/craps/Dice';
import { BetSpot, BetStepper, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from '@/components/solo/SoloShell';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { formatChips } from '@/lib/format';
import { holdBalance, settleBalance, sleep, useSoloGame, type SoloInfo, type Spots } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

/** Red Dog, Hi-Lo, Andar Bahar and Chuck-a-Luck (20_blackjack_variants.sql). */
type Call = ReturnType<typeof useSoloGame>['call'];
const RANK = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const rankName = (c: number) => RANK[c % 13];

// ----------------------------------------------------------------------------- Red Dog
interface RdRound {
  round_id: string;
  bet: number;
  cards: number[];
  spread: number;
  pays: number | null;
  final?: boolean;
  outcome?: 'win' | 'lose' | 'push' | 'triple';
  staked?: number;
  win?: number;
  balance?: number;
}

export function RedDogGame() {
  const { info, error, load, call } = useSoloGame<{ pays: Record<string, number>; triple: number }, RdRound>('red_dog', 'quick_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Shuffling…" />;
  return <RedDog info={info} call={call} />;
}

function RedDog({ info, call }: { info: SoloInfo<{ pays: Record<string, number>; triple: number }, RdRound>; call: Call }) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const [round, setRound] = useState<RdRound | null>(info.round);
  const [betIndex, setBetIndex] = useState(() => Math.max(0, info.bets.indexOf(info.round?.bet ?? info.bets[0])));
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  const live = round && !round.final ? round : null;
  const done = round?.final ? round : null;
  const bet = live?.bet ?? info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);

  const settle = async (res: RdRound, start: number) => {
    setShown(false);
    setRound(res);
    await sleep(800);
    setShown(true);
    settleBalance(res.balance ?? start);
    playSound((res.win ?? 0) > (res.staked ?? 0) ? 'win' : res.win === res.staked ? 'chip' : 'lose');
  };
  const deal = async () => {
    if (busy) return;
    if (balance < bet) return toast.info('Not enough chips for that bet');
    setBusy(true);
    holdBalance(balance - bet);
    const [res, err] = await call<RdRound>('reddog_deal', { p_bet: bet });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    if (res.final) await settle(res, balance);
    else {
      setRound(res);
      settleBalance(res.balance ?? balance);
    }
    setBusy(false);
  };
  const act = async (raise: boolean) => {
    if (busy || !live) return;
    setBusy(true);
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - (raise ? live.bet : 0));
    const [res, err] = await call<RdRound>('reddog_act', { p_raise: raise });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    playSound('card');
    await settle(res, start);
    setBusy(false);
  };

  const third = done && shown && done.cards.length === 3 ? done.cards[2] : null;
  const status = live
    ? `A spread of ${live.spread}: a card in between pays ${live.pays} to 1.`
    : done
      ? !shown
        ? 'The third card…'
        : { win: 'In between: you win!', lose: 'Outside the spread.', push: done.spread === 0 ? 'Next to each other: your bet comes back.' : 'A pair, but no third: your bet comes back.', triple: 'Three of a kind!' }[done.outcome ?? 'lose']
      : 'Pick your bet and deal';

  return (
    <SoloShell
      info={info}
      tier={tier?.tier}
      status={status}
      controls={
        live ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => void act(false)}>
              Stand
            </Button>
            <Button disabled={busy || balance < live.bet} onClick={() => void act(true)}>
              Raise <ChipAmount value={live.bet} className="ml-1.5" iconClassName="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <>
            <BetStepper bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy} tiers={info.tiers} />
            <Button size="lg" className="ml-auto min-w-36" loading={busy} disabled={balance < bet} onClick={() => void deal()}>
              Deal
            </Button>
          </>
        )
      }
      rules={
        <>
          <p>
            Two cards are dealt face up. You are betting that a <strong className="text-ivory">third card will fall between them</strong>. Aces are high.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>The gap between the two cards is the spread. Before the third card you may stand, or raise by doubling your bet.</li>
            <li>
              Payouts on a winning hand: spread of 1 pays {info.config.pays['1']} to 1, spread of 2 pays {info.config.pays['2']} to 1, spread of 3 pays{' '}
              {info.config.pays['3']} to 1, and 4 or more pays {info.config.pays['4']} to 1.
            </li>
            <li>If the third card matches either card or falls outside, you lose.</li>
            <li>Cards next to each other (like 7 and 8): nothing can fall between, so your bet comes back.</li>
            <li>A pair: a third card of the same rank pays {info.config.triple} to 1; anything else returns your bet.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">A simple guide: raise only when the spread is 7 or more. Play chips have no cash value.</p>
        </>
      }
    >
      <div className="flex min-h-[6rem] items-center justify-center gap-3">
        {round ? (
          <>
            <PlayingCard key={`${round.round_id}-a`} card={round.cards[0]} size="lg" index={0} />
            <div className="flex h-[6.3rem] w-[4.5rem] items-center justify-center rounded-lg border-2 border-dashed border-white/15">
              {third !== null && <PlayingCard key={`${round.round_id}-c`} card={third} size="lg" index={0} highlight={done?.outcome === 'win' || done?.outcome === 'triple'} />}
            </div>
            <PlayingCard key={`${round.round_id}-b`} card={round.cards[1]} size="lg" index={1} />
          </>
        ) : (
          <p className="text-sm text-cream/60">Two cards, then one more.</p>
        )}
      </div>
      {done && shown && <Outcome staked={done.staked ?? 0} win={done.win ?? 0} />}
    </SoloShell>
  );
}

// ----------------------------------------------------------------------------- Hi-Lo
interface HlRound {
  round_id: string;
  bet: number;
  card: number;
  units: number;
  steps: number;
  seen: number[];
  hi: number | null;
  lo: number | null;
  collect: number;
  final?: boolean;
  outcome?: 'collect' | 'lose';
  win?: number;
  staked?: number;
  balance?: number;
}

export function HiLoGame() {
  const { info, error, load, call } = useSoloGame<{ edge_pct: number; max_units: number }, HlRound>('hi_lo', 'quick_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Shuffling…" />;
  return <HiLo info={info} call={call} />;
}

function HiLo({ info, call }: { info: SoloInfo<{ edge_pct: number; max_units: number }, HlRound>; call: Call }) {
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const [round, setRound] = useState<HlRound | null>(info.round);
  const [betIndex, setBetIndex] = useState(() => Math.max(0, info.bets.indexOf(info.round?.bet ?? info.bets[0])));
  const [busy, setBusy] = useState(false);
  const live = round && !round.final ? round : null;
  const done = round?.final ? round : null;
  const bet = live?.bet ?? info.bets[betIndex];
  const tier = info.tiers.find((t) => bet >= t.min_bet && bet <= t.max_bet);

  const run = async (fn: string, args: Record<string, unknown>, sound: 'card' | 'coins') => {
    if (busy) return;
    setBusy(true);
    const [res, err] = await call<HlRound>(fn, args);
    setBusy(false);
    if (err !== null) {
      playSound('error');
      return toast.error(err);
    }
    setRound(res);
    if (res.balance !== undefined) settleBalance(res.balance);
    playSound(res.final ? (res.outcome === 'collect' ? 'win' : 'lose') : sound);
  };
  const start = () => {
    if (balance < bet) return toast.info('Not enough chips for that bet');
    void run('hilo_start', { p_bet: bet }, 'card');
  };

  const times = (u: number) => `×${Number((u / 100).toFixed(1))}`;
  const status = live
    ? live.steps === 0
      ? `Is the next card higher or lower than ${rankName(live.card)}?`
      : `Right ${live.steps} time${live.steps === 1 ? '' : 's'}: ${times(live.units)} so far. Go on, or collect?`
    : done
      ? done.outcome === 'collect'
        ? `Collected at ${times(done.units)}.`
        : `It was ${rankName(done.card)}. Not this time.`
      : 'Pick your bet and start';

  return (
    <SoloShell
      info={info}
      tier={tier?.tier}
      status={status}
      controls={
        live ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="outline" disabled={busy || live.steps === 0} onClick={() => void run('hilo_collect', {}, 'coins')}>
              Collect <ChipAmount value={live.collect} className="ml-1.5" iconClassName="h-3.5 w-3.5" />
            </Button>
            <Button disabled={busy || live.lo === null} onClick={() => void run('hilo_guess', { p_dir: 'lo' }, 'card')}>
              Lower {live.lo !== null && <span className="ml-1.5 text-xs opacity-80">{times(live.lo)}</span>}
            </Button>
            <Button disabled={busy || live.hi === null} onClick={() => void run('hilo_guess', { p_dir: 'hi' }, 'card')}>
              Higher {live.hi !== null && <span className="ml-1.5 text-xs opacity-80">{times(live.hi)}</span>}
            </Button>
          </div>
        ) : (
          <>
            <BetStepper bets={info.bets} index={betIndex} onChange={setBetIndex} disabled={busy} tiers={info.tiers} />
            <Button size="lg" className="ml-auto min-w-36" loading={busy} disabled={balance < bet} onClick={start}>
              Start
            </Button>
          </>
        )
      }
      rules={
        <>
          <p>
            One card is turned. Guess whether the next will be <strong className="text-ivory">higher</strong> or <strong className="text-ivory">lower</strong>.
            Each right answer multiplies your prize, and you can collect after any of them.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Aces are high. A card of the same rank loses.</li>
            <li>The less likely your guess, the more it multiplies: the buttons show what each is worth from the card you&apos;re on.</li>
            <li>A guess that can hardly fail (higher than a 2, lower than an ace) multiplies by 1: nothing gained.</li>
            <li>One wrong guess loses the bet. The biggest prize is {formatChips(info.config.max_units / 100)} times your bet.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            Each card is drawn from the other 51. Multipliers are the fair odds less about {info.config.edge_pct}%, rounded down. Play chips have no cash
            value.
          </p>
        </>
      }
    >
      <div className="flex min-h-[7rem] flex-col items-center justify-center gap-3">
        {round ? (
          <>
            <PlayingCard key={`${round.round_id}-${round.seen.length}-${round.card}`} card={round.card} size="lg" index={0} highlight={done?.outcome === 'collect'} dim={done?.outcome === 'lose'} />
            {round.seen.length > 1 && (
              <p className="text-xs text-cream/70" aria-label="Cards so far">
                {round.seen.map(rankName).join(' → ')}
                {done?.outcome === 'lose' ? ` → ${rankName(done.card)}` : ''}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-cream/60">Higher or lower?</p>
        )}
      </div>
      {done && <Outcome staked={done.staked ?? 0} win={done.win ?? 0} />}
    </SoloShell>
  );
}

// ----------------------------------------------------------------------------- Andar Bahar
interface AbResult {
  round_id: string;
  joker: number;
  andar: number[];
  bahar: number[];
  winner: 'andar' | 'bahar';
  bets: Spots;
  returns: Spots;
  staked: number;
  win: number;
  balance: number;
}

export function AndarBaharGame() {
  const { info, error, load, call } = useSoloGame<{ commission_pct: number }>('andar_bahar', 'quick_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Shuffling…" />;
  return <AndarBahar info={info} call={call} />;
}

function AndarBahar({ info, call }: { info: SoloInfo<{ commission_pct: number }>; call: Call }) {
  const s = useSpotBets(info.tiers);
  const [result, setResult] = useState<AbResult | null>(null);
  // How many of the dealt cards are on the felt so far (they go down one by one).
  const [dealt, setDealt] = useState(0);
  const [busy, setBusy] = useState(false);

  const play = async () => {
    if (busy || s.total === 0) return;
    setBusy(true);
    s.remember();
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - s.total);
    const [res, err] = await call<AbResult>('andar_bahar_deal', { p_tier: s.tierKey, p_bets: s.bets });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    setDealt(0);
    setResult(res);
    const n = res.andar.length + res.bahar.length;
    // Long deals speed up so nobody waits half a minute.
    const pace = n > 16 ? 110 : n > 8 ? 190 : 300;
    for (let i = 1; i <= n; i++) {
      await sleep(pace);
      setDealt(i);
      playSound('card');
    }
    await sleep(350);
    settleBalance(res.balance);
    playSound(res.win > res.staked ? 'win' : res.win > 0 ? 'chip' : 'lose');
    s.clear();
    setBusy(false);
  };

  const total = result ? result.andar.length + result.bahar.length : 0;
  const finished = Boolean(result) && dealt >= total && !busy;
  const after = finished && s.total === 0 ? result : null;
  const showBets = s.total > 0 || !result ? s.bets : result.bets;
  // Andar gets cards 1, 3, 5...; Bahar gets 2, 4, 6...
  const side = (k: 'andar' | 'bahar') => (result ? result[k].slice(0, k === 'andar' ? Math.ceil(dealt / 2) : Math.floor(dealt / 2)) : []);
  const status = busy ? 'Dealing…' : after ? `${after.winner === 'andar' ? 'Andar' : 'Bahar'} matches the ${rankName(after.joker)} after ${total} card${total === 1 ? '' : 's'}.` : 'Bet on Andar or Bahar';

  const row = (k: 'andar' | 'bahar', name: string) => {
    const cards = side(k);
    return (
      <div className="flex items-center gap-2">
        <p className={cn('w-14 shrink-0 text-right text-xs font-semibold uppercase tracking-wider', after?.winner === k ? 'text-gold-200' : 'text-cream/75')}>{name}</p>
        <div className="flex min-h-[3.7rem] flex-1 flex-wrap items-center gap-0.5 overflow-hidden">
          {cards.slice(-9).map((c, i, list) => (
            <PlayingCard key={`${result?.round_id}-${k}-${c}`} card={c} size="sm" index={0} highlight={finished && result?.winner === k && i === list.length - 1} />
          ))}
          {cards.length > 9 && <span className="text-xs text-muted">+{cards.length - 9}</span>}
        </div>
      </div>
    );
  };

  return (
    <SoloShell
      info={info}
      tier={s.tierKey}
      status={status}
      controls={<SpotControls s={s} tiers={info.tiers} busy={busy} action="Deal" onAction={() => void play()} />}
      rules={
        <>
          <p>
            One card is turned face up: the <strong className="text-ivory">joker</strong>. Cards are then dealt one at a time, first to{' '}
            <strong className="text-ivory">Andar</strong>, then to <strong className="text-ivory">Bahar</strong>, and so on, until one matches the joker&apos;s
            rank. That side wins.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Bahar pays 1 to 1.</li>
            <li>
              Andar gets the first card, so it wins slightly more often (about 51.5%). It pays 1 to 1 less a {info.config.commission_pct}% commission,
              rounded up to a whole chip.
            </li>
            <li>You can bet on either side, or both.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">One fresh deck every hand, dealt by the server. Play chips have no cash value.</p>
        </>
      }
    >
      <div className="mx-auto flex max-w-xl flex-col gap-2">
        <div className="flex items-center gap-2">
          <p className="w-14 shrink-0 text-right text-xs font-semibold uppercase tracking-wider text-gold-300">Joker</p>
          <div className="min-h-[3.7rem]">{result && <PlayingCard key={`${result.round_id}-j`} card={result.joker} size="sm" index={0} highlight />}</div>
        </div>
        {row('andar', 'Andar')}
        {row('bahar', 'Bahar')}
      </div>
      <div className="mx-auto mt-3 grid max-w-xs grid-cols-2 gap-2">
        {(['andar', 'bahar'] as const).map((k) => (
          <BetSpot
            key={k}
            name={k === 'andar' ? 'Andar' : 'Bahar'}
            pays={k === 'andar' ? `1 to 1 less ${info.config.commission_pct}%` : '1 to 1'}
            amount={showBets[k] ?? 0}
            onClick={() => s.add(k)}
            disabled={busy}
            state={after ? (after.returns[k] > 0 ? 'win' : after.bets[k] ? 'lose' : null) : null}
          />
        ))}
      </div>
      {after && <Outcome staked={after.staked} win={after.win} />}
    </SoloShell>
  );
}

// ----------------------------------------------------------------------------- Chuck-a-Luck
interface ChConfig {
  pays: { number: number[]; high: number; low: number; field: number; triple: number };
  field: number[];
}
interface ChResult {
  round_id: string;
  dice: [number, number, number];
  total: number;
  triple: boolean;
  bets: Spots;
  returns: Spots;
  staked: number;
  win: number;
  balance: number;
}

export function ChuckGame() {
  const { info, error, load, call } = useSoloGame<ChConfig>('chuck_a_luck', 'quick_info');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Spinning the cage…" />;
  return <Chuck info={info} call={call} />;
}

function Chuck({ info, call }: { info: SoloInfo<ChConfig>; call: Call }) {
  const s = useSpotBets(info.tiers);
  const [result, setResult] = useState<ChResult | null>(null);
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  const p = info.config.pays;

  const roll = async () => {
    if (busy || s.total === 0) return;
    setBusy(true);
    s.remember();
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - s.total);
    const [res, err] = await call<ChResult>('chuck_roll', { p_tier: s.tierKey, p_bets: s.bets });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    setShown(false);
    setResult(res);
    playSound('dice');
    await sleep(1100);
    setShown(true);
    settleBalance(res.balance);
    playSound(res.win > res.staked ? 'win' : res.win > 0 ? 'chip' : 'lose');
    s.clear();
    setBusy(false);
  };

  const showBets = s.total > 0 || !result ? s.bets : result.bets;
  const after = shown && result && s.total === 0 ? result : null;
  const spot = (k: string, name: string, pays: string, className?: string) => (
    <BetSpot key={k} name={name} pays={pays} amount={showBets[k] ?? 0} onClick={() => s.add(k)} disabled={busy} state={after ? (after.returns[k] > 0 ? 'win' : after.bets[k] ? 'lose' : null) : null} className={className} />
  );
  const status = busy && !shown ? 'The cage turns…' : after ? `${after.dice.join(' · ')} makes ${after.total}${after.triple ? ', a triple!' : ''}` : 'Place your bets';

  return (
    <SoloShell
      info={info}
      tier={s.tierKey}
      status={status}
      controls={<SpotControls s={s} tiers={info.tiers} busy={busy} action="Roll" onAction={() => void roll()} />}
      rules={
        <>
          <p>Three dice tumble in a wire cage. Bet on what they will show.</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              <strong className="text-ivory">A number (1 to 6)</strong>: pays {p.number[0]} to 1 if it shows on one die, {p.number[1]} to 1 on two, and{' '}
              {p.number[2]} to 1 on all three.
            </li>
            <li>
              <strong className="text-ivory">High</strong> (a total of 11 or more) and <strong className="text-ivory">Low</strong> (10 or less) pay {p.high} to 1,
              but both lose to any triple.
            </li>
            <li>
              <strong className="text-ivory">Field</strong>: a total of {info.config.field.slice(0, 4).join(', ')} or {info.config.field.slice(4).join(', ')} pays{' '}
              {p.field} to 1.
            </li>
            <li>
              <strong className="text-ivory">Any triple</strong> pays {p.triple} to 1.
            </li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">The server rolls the dice. Play chips have no cash value.</p>
        </>
      }
    >
      <div className="flex min-h-[4.5rem] items-center justify-center gap-3">
        {result ? (
          result.dice.map((d, i) => (
            <motion.div key={`${result.round_id}-${i}`} initial={{ rotate: -200, y: -40, opacity: 0 }} animate={{ rotate: 0, y: 0, opacity: 1 }} transition={{ delay: i * 0.12, type: 'spring', stiffness: 140, damping: 12 }}>
              <Die value={d} />
            </motion.div>
          ))
        ) : (
          <div className="flex gap-3 opacity-40" aria-label="No roll yet">
            <Die value={2} />
            <Die value={4} />
            <Die value={6} />
          </div>
        )}
      </div>
      <div className="mx-auto mt-3 grid max-w-lg grid-cols-6 gap-1.5">
        {[1, 2, 3, 4, 5, 6].map((n) => spot(`n${n}`, String(n), `${p.number[0]}, ${p.number[1]}, ${p.number[2]}`))}
        {spot('low', 'Low', '10 or less', 'col-span-2')}
        {spot('field', 'Field', `${p.field} to 1`, 'col-span-2')}
        {spot('high', 'High', '11 or more', 'col-span-2')}
        {spot('triple', 'Any triple', `${p.triple} to 1`, 'col-span-6')}
      </div>
      {after && <Outcome staked={after.staked} win={after.win} />}
    </SoloShell>
  );
}
