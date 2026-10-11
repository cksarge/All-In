import { useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Die } from '@/components/craps/Dice';
import { holdBalance, settleBalance, sleep, useSoloGame, type SoloInfo, type Spots } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from './SoloShell';

interface Config {
  pays: {
    small: number;
    big: number;
    odd: number;
    even: number;
    single: number[];
    double: number;
    triple: number;
    any_triple: number;
    combo: number;
    total: Record<string, number>;
  };
}
interface Result {
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

const FACES = [1, 2, 3, 4, 5, 6];
const TOTALS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const COMBOS = FACES.flatMap((a) => FACES.filter((b) => b > a).map((b) => [a, b] as const));

export function SicBoGame() {
  const { info, error, load, call } = useSoloGame<Config>('sic_bo');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Shaking the dice…" />;
  return <Table info={info} call={call} />;
}

const PIPS: Record<number, [number, number][]> = {
  1: [[10, 10]],
  2: [[6, 6], [14, 14]],
  3: [[5, 5], [10, 10], [15, 15]],
  4: [[6, 6], [14, 6], [6, 14], [14, 14]],
  5: [[5, 5], [15, 5], [10, 10], [5, 15], [15, 15]],
  6: [[6, 5], [14, 5], [6, 10], [14, 10], [6, 15], [14, 15]],
};
/** A small die face for labelling the betting spots. */
function Mini({ v }: { v: number }) {
  return (
    <svg viewBox="0 0 20 20" className="h-[1.15rem] w-[1.15rem] shrink-0" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="4" fill="#f4ead2" stroke="#d4af37" strokeWidth="0.8" />
      {PIPS[v].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="1.9" fill="#141816" />
      ))}
    </svg>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-cream/65">{title}</p>
      {children}
    </div>
  );
}

function Table({ info, call }: { info: SoloInfo<Config>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const s = useSpotBets(info.tiers);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(false);
  const p = info.config.pays;

  const roll = async () => {
    if (busy || s.total === 0) return;
    setBusy(true);
    s.remember();
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - s.total);
    const [res, err] = await call<Result>('sicbo_roll', { p_tier: s.tierKey, p_bets: s.bets });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    setShown(false);
    setResult(res);
    playSound('whoosh');
    await sleep(1100);
    setShown(true);
    settleBalance(res.balance);
    playSound(res.win > res.staked ? 'win' : res.win > 0 ? 'chip' : 'lose');
    s.clear();
    setBusy(false);
  };

  const showBets = s.total > 0 || !result ? s.bets : result.bets;
  const after = shown && result && s.total === 0 ? result : null;
  const spot = (k: string, name: string, pays: string, children?: ReactNode, className?: string) => (
    <BetSpot
      key={k}
      name={name}
      pays={pays}
      amount={showBets[k] ?? 0}
      onClick={() => s.add(k)}
      disabled={busy}
      state={after ? (after.returns[k] > 0 ? 'win' : after.bets[k] ? 'lose' : null) : null}
      className={className}
    >
      {children}
    </BetSpot>
  );

  const status = busy && !shown ? 'Rolling…' : after ? `${after.dice.join(' · ')} makes ${after.total}${after.triple ? ', a triple!' : after.total <= 10 ? ', small' : ', big'}` : 'Place your bets';

  return (
    <SoloShell
      info={info}
      wide
      tier={s.tierKey}
      status={status}
      controls={<SpotControls s={s} tiers={info.tiers} busy={busy} action="Roll" onAction={() => void roll()} />}
      rules={
        <>
          <p>
            Three dice are rolled. Put chips on as many outcomes as you like, then press <strong className="text-ivory">Roll</strong>.
            Every bet is settled on that one roll.
          </p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong className="text-ivory">Small</strong> (total 4 to 10) and <strong className="text-ivory">Big</strong> (11 to 17) pay {p.small} to 1. So do Odd and Even. All four lose if the dice show a triple.</li>
            <li><strong className="text-ivory">Total</strong>: the exact sum of the three dice. Rare totals pay more, up to {p.total['4']} to 1 for 4 or 17.</li>
            <li><strong className="text-ivory">One number</strong>: pays {p.single[0]} to 1 if it shows on one die, {p.single[1]} to 1 on two, {p.single[2]} to 1 on all three.</li>
            <li><strong className="text-ivory">Two dice</strong>: two different numbers that must both show. Pays {p.combo} to 1.</li>
            <li><strong className="text-ivory">Double</strong>: at least two dice show that number. Pays {p.double} to 1.</li>
            <li><strong className="text-ivory">Triple</strong>: all three show that number, {p.triple} to 1. <strong className="text-ivory">Any triple</strong> pays {p.any_triple} to 1.</li>
          </ul>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            Small, Big, Odd and Even have the lowest house edge (2.8%). One number is 7.9%. The long shots run from 12% to 19%.
            The dice are rolled by the server. Play chips have no cash value.
          </p>
        </>
      }
    >
      <div className="mb-4 flex min-h-12 items-center justify-center gap-3" aria-hidden={!result}>
        {(result?.dice ?? [1, 2, 3]).map((v, i) => (
          <motion.div
            key={`${result?.round_id ?? 'idle'}-${i}`}
            initial={result ? { y: -60, rotate: -360 - i * 120, opacity: 0 } : false}
            animate={{ y: 0, rotate: 0, opacity: result ? 1 : 0.35 }}
            transition={{ type: 'spring', stiffness: 130, damping: 13, delay: i * 0.08 }}
          >
            <Die value={v} />
          </motion.div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {spot('small', 'Small', `4–10 · ${p.small} to 1`)}
          {spot('odd', 'Odd', `${p.odd} to 1`)}
          {spot('even', 'Even', `${p.even} to 1`)}
          {spot('big', 'Big', `11–17 · ${p.big} to 1`)}
        </div>
        <Group title="Total of the three dice">
          <div className="grid grid-cols-7 gap-1.5">
            {TOTALS.map((n) =>
              spot(`total_${n}`, `Total ${n}`, `${p.total[String(n)]}:1`, <span className="font-display text-lg font-bold leading-none text-ivory">{n}</span>, 'min-h-14'),
            )}
          </div>
        </Group>
        <div className="grid gap-3 md:grid-cols-2">
          <Group title={`One number · ${p.single.join(', ')} to 1`}>
            <div className="grid grid-cols-6 gap-1.5">{FACES.map((n) => spot(`single_${n}`, `Number ${n}`, '', <Mini v={n} />, 'min-h-12'))}</div>
          </Group>
          <Group title={`Double · ${p.double} to 1`}>
            <div className="grid grid-cols-6 gap-1.5">
              {FACES.map((n) =>
                spot(`double_${n}`, `Double ${n}`, '', <span className="flex gap-0.5"><Mini v={n} /><Mini v={n} /></span>, 'min-h-12'),
              )}
            </div>
          </Group>
        </div>
        <Group title={`Two dice · ${p.combo} to 1`}>
          <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-[repeat(15,minmax(0,1fr))]">
            {COMBOS.map(([a, b]) =>
              spot(`combo_${a}_${b}`, `${a} and ${b}`, '', <span className="flex gap-0.5 sm:flex-col"><Mini v={a} /><Mini v={b} /></span>, 'min-h-12'),
            )}
          </div>
        </Group>
        <Group title={`Triple · ${p.triple} to 1 · any triple ${p.any_triple} to 1`}>
          <div className="grid grid-cols-7 gap-1.5">
            {FACES.map((n) =>
              spot(`triple_${n}`, `Triple ${n}`, '', <span className="flex flex-col items-center gap-0.5 sm:flex-row"><Mini v={n} /><Mini v={n} /><Mini v={n} /></span>, 'min-h-12'),
            )}
            {spot('any_triple', 'Any triple', '', <span className="text-xs font-bold leading-tight text-ivory">Any triple</span>, 'min-h-12')}
          </div>
        </Group>
      </div>

      {after && <Outcome staked={after.staked} win={after.win} />}
    </SoloShell>
  );
}
