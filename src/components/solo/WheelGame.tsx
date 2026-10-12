import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { holdBalance, settleBalance, sleep, useSoloGame, WHEEL_LABELS, type SoloInfo, type Spots } from '@/lib/solo';
import { playSound } from '@/lib/sound';
import { prefersReducedMotion, useSettings } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';
import { BetSpot, Outcome, SoloGate, SoloShell, SpotControls, useSpotBets } from './SoloShell';

interface Config {
  pays: Record<string, number>;
  wheel: string[];
}
interface Result {
  round_id: string;
  stop: number;
  symbol: string;
  bets: Spots;
  returns: Spots;
  staked: number;
  win: number;
  balance: number;
}

const FILL: Record<string, string> = {
  x1: '#f4ead2',
  x2: '#3566c4',
  x5: '#1a774f',
  x10: '#c9303f',
  x20: '#7a4fc4',
  joker: '#141816',
  logo: '#d4af37',
};
const INK: Record<string, string> = { x1: '#141816', logo: '#141816' };
const ORDER = ['x1', 'x2', 'x5', 'x10', 'x20', 'joker', 'logo'];
const SPIN_MS = 4200;

export function WheelGame() {
  const { info, error, load, call } = useSoloGame<Config>('money_wheel');
  if (!info) return <SoloGate error={error} onRetry={() => void load()} label="Setting up the wheel…" />;
  return <Table info={info} call={call} />;
}

/** The wheel. It turns steadily while `spinning`, then stops with segment `stop` under the pointer. */
function Wheel({ wheel, spinning, stop, size }: { wheel: string[]; spinning: boolean; stop: number | null; size: number }) {
  const rotation = useMotionValue(0);
  const reduced = prefersReducedMotion(useSettings((s) => s.motion));
  const landed = useRef<number | null>(null);
  const n = wheel.length;
  const step = 360 / n;

  useEffect(() => {
    if (!spinning || stop !== null) return;
    landed.current = null;
    if (reduced) return;
    const controls = animate(rotation, rotation.get() + 360 * 30, { duration: 45, ease: 'linear' });
    return () => controls.stop();
  }, [spinning, stop, reduced, rotation]);

  useEffect(() => {
    if (stop === null || landed.current === stop) return;
    landed.current = stop;
    const finalMod = (360 - stop * step) % 360;
    if (reduced) return rotation.set(finalMod);
    const current = rotation.get();
    const target = current - (((current % 360) + 360) % 360) + 360 * 3 + finalMod;
    const controls = animate(rotation, target, { duration: SPIN_MS / 1000, ease: [0.1, 0.6, 0.2, 1] });
    return () => controls.stop();
  }, [stop, step, reduced, rotation]);

  const r = size / 2;
  const outer = r - 8;
  const inner = r * 0.3;
  const textR = outer * 0.84;
  const pt = (deg: number, rr: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${r + rr * Math.cos(rad)},${r + rr * Math.sin(rad)}`;
  };
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }} aria-hidden="true">
      <div className="absolute inset-0 rounded-full bg-gradient-to-b from-[#5a3a1c] to-[#2a1a0c] shadow-[0_20px_40px_-12px_rgba(0,0,0,0.8)]" />
      <motion.svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" style={{ rotate: rotation }}>
        {wheel.map((sym, i) => {
          const a0 = (i - 0.5) * step;
          const a1 = (i + 0.5) * step;
          const [tx, ty] = pt(i * step, textR).split(',').map(Number);
          return (
            <g key={i}>
              <path d={`M ${pt(a0, inner)} L ${pt(a0, outer)} A ${outer} ${outer} 0 0 1 ${pt(a1, outer)} L ${pt(a1, inner)} A ${inner} ${inner} 0 0 0 ${pt(a0, inner)} Z`} fill={FILL[sym]} stroke="#d4af37" strokeWidth={0.7} />
              <text x={tx} y={ty} fill={INK[sym] ?? '#f4ead2'} fontSize={size * 0.034} fontWeight={800} textAnchor="middle" dominantBaseline="central" transform={`rotate(${i * step} ${tx} ${ty})`}>
                {sym === 'joker' ? '★' : sym === 'logo' ? 'A' : WHEEL_LABELS[sym]}
              </text>
              <circle cx={Number(pt(a0, outer - 3).split(',')[0])} cy={Number(pt(a0, outer - 3).split(',')[1])} r={1.6} fill="#f0d688" />
            </g>
          );
        })}
        <circle cx={r} cy={r} r={inner} fill="#3a2412" stroke="#d4af37" strokeWidth={2} />
        <circle cx={r} cy={r} r={inner * 0.45} fill="#d4af37" />
      </motion.svg>
      <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1">
        <svg width="22" height="22" viewBox="0 0 22 22">
          <path d="M11 22 L2 3 Q11 -2 20 3 Z" fill="#f0d688" stroke="#5f4812" strokeWidth="1.2" />
        </svg>
      </div>
    </div>
  );
}

function Table({ info, call }: { info: SoloInfo<Config>; call: ReturnType<typeof useSoloGame>['call'] }) {
  const s = useSpotBets(info.tiers, info.game);
  const big = useMediaQuery('(min-width: 640px)');
  const reduced = prefersReducedMotion(useSettings((st) => st.motion));
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [shown, setShown] = useState(false);
  const { pays, wheel } = info.config;
  const count = (sym: string) => wheel.filter((x) => x === sym).length;

  const spin = async () => {
    if (busy || s.total === 0) return;
    setBusy(true);
    s.remember();
    setShown(false);
    setResult(null);
    setSpinning(true);
    playSound('wheel');
    const start = useWallet.getState().status?.balance ?? 0;
    holdBalance(start - s.total);
    const [res, err] = await call<Result>('wheel_spin', { p_tier: s.tierKey, p_bets: s.bets });
    if (err !== null) {
      useWallet.getState().setDisplayBalance(null);
      setSpinning(false);
      setBusy(false);
      playSound('error');
      return toast.error(err);
    }
    setResult(res);
    await sleep(reduced ? 300 : SPIN_MS + 200);
    setSpinning(false);
    setShown(true);
    settleBalance(res.balance);
    playSound(res.win > res.staked ? 'win' : 'lose');
    s.clear();
    setBusy(false);
  };

  const showBets = s.total > 0 || !result ? s.bets : result.bets;
  const after = shown && result && s.total === 0 ? result : null;
  const status = busy && !shown ? 'Round and round…' : after ? `It stops on ${WHEEL_LABELS[after.symbol]}` : 'Place your bets';

  return (
    <SoloShell
      info={info}
      tier={s.tierKey}
      status={status}
      controls={<SpotControls s={s} tiers={info.tiers} busy={busy} action="Spin" onAction={() => void spin()} auto />}
      rules={
        <>
          <p>
            The wheel has {wheel.length} segments. Bet on which kind it will stop on, then press <strong className="text-ivory">Spin</strong>.
            The number on a segment is what it pays.
          </p>
          <table className="w-full text-left">
            <caption className="sr-only">Segments and payouts</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="py-1.5">Segment</th>
                <th scope="col" className="py-1.5">On the wheel</th>
                <th scope="col" className="py-1.5">Pays</th>
                <th scope="col" className="py-1.5">House edge</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {ORDER.map((k) => (
                <tr key={k}>
                  <td className="py-1.5 text-ivory">{WHEEL_LABELS[k]}</td>
                  <td className="py-1.5">{count(k)}</td>
                  <td className="py-1.5 text-gold-200">{pays[k]} to 1</td>
                  <td className="py-1.5">{(100 - (count(k) * (pays[k] + 1) * 100) / wheel.length).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rounded-xl border border-white/10 p-3 text-xs text-muted">
            This is the simplest game in the lounge and also the one with the highest house edge. The 1 is the best bet on the
            wheel. The server picks the segment. Play chips have no cash value.
          </p>
        </>
      }
    >
      <Wheel wheel={wheel} spinning={spinning} stop={result?.stop ?? null} size={big ? 340 : 260} />

      <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {ORDER.map((k) => (
          <BetSpot
            key={k}
            name={`Segment ${WHEEL_LABELS[k]}`}
            pays={`${pays[k]} to 1`}
            amount={showBets[k] ?? 0}
            onClick={() => s.add(k)}
            disabled={busy}
            state={after ? (after.returns[k] > 0 ? 'win' : after.bets[k] ? 'lose' : null) : null}
          >
            <span
              className="flex h-8 min-w-8 items-center justify-center rounded-md px-1.5 font-display text-base font-black"
              style={{ background: FILL[k], color: INK[k] ?? '#f4ead2', border: '1px solid #d4af37' }}
            >
              {WHEEL_LABELS[k]}
            </span>
          </BetSpot>
        ))}
      </div>

      {after && <Outcome staked={after.staked} win={after.win} />}
    </SoloShell>
  );
}
