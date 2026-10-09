import { useEffect, useRef } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { pocketColor, pocketLabel, WHEEL_ORDER, type RlVariant } from '@/lib/roulette';

const FILL = { red: '#a81c2c', black: '#141816', green: '#135c3e' } as const;

/**
 * SVG roulette wheel. While `spinning` it turns steadily (the server hasn't
 * revealed the pocket yet); once `result` arrives it decelerates and stops with
 * that pocket under the marker at the top.
 */
export function RouletteWheel({
  variant,
  spinning,
  result,
  instant = false,
  size = 260,
}: {
  variant: RlVariant;
  spinning: boolean;
  result: number | null;
  /** Jump straight to the result (e.g. the page was opened after the spin). */
  instant?: boolean;
  size?: number;
}) {
  const order = WHEEL_ORDER[variant];
  const n = order.length;
  const step = 360 / n;
  const rotation = useMotionValue(0);
  const reduced = useReducedMotion();
  const landed = useRef<number | null>(null);

  // Steady spin while waiting for the result.
  useEffect(() => {
    if (!spinning || result !== null) return;
    landed.current = null;
    if (reduced) return;
    const controls = animate(rotation, rotation.get() + 360 * 30, { duration: 60, ease: 'linear' });
    return () => controls.stop();
  }, [spinning, result, reduced, rotation]);

  // Land on the result.
  useEffect(() => {
    if (result === null || landed.current === result) return;
    const idx = order.indexOf(result);
    if (idx < 0) return;
    const finalMod = (360 - idx * step) % 360;
    landed.current = result;
    if (reduced || instant) {
      rotation.set(finalMod);
      return;
    }
    const current = rotation.get();
    const target = current - (((current % 360) + 360) % 360) + 360 * 2 + finalMod;
    const controls = animate(rotation, target, { duration: 3, ease: [0.12, 0.65, 0.25, 1] });
    return () => controls.stop();
  }, [result, order, step, reduced, rotation, instant]);

  const r = size / 2;
  const outer = r - 6;
  const inner = r * 0.62;
  const textR = (outer + inner) / 2;

  return (
    <div className="relative" style={{ width: size, height: size }} aria-hidden="true">
      <div className="absolute inset-0 rounded-full bg-gradient-to-b from-[#5a3a1c] to-[#2a1a0c] shadow-[0_20px_40px_-12px_rgba(0,0,0,0.8),inset_0_2px_6px_rgba(255,255,255,0.15)]" />
      <motion.svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0" style={{ rotate: rotation }}>
        {order.map((p, i) => {
          const a0 = ((i - 0.5) * step - 90) * (Math.PI / 180);
          const a1 = ((i + 0.5) * step - 90) * (Math.PI / 180);
          const pt = (rad: number, rr: number) => `${r + rr * Math.cos(rad)},${r + rr * Math.sin(rad)}`;
          const d = `M ${pt(a0, inner)} L ${pt(a0, outer)} A ${outer} ${outer} 0 0 1 ${pt(a1, outer)} L ${pt(a1, inner)} A ${inner} ${inner} 0 0 0 ${pt(a0, inner)} Z`;
          const mid = (i * step - 90) * (Math.PI / 180);
          return (
            <g key={p}>
              <path d={d} fill={FILL[pocketColor(p)]} stroke="#d4af37" strokeWidth={0.6} />
              <text
                x={r + textR * Math.cos(mid)}
                y={r + textR * Math.sin(mid)}
                fill="#f4ead2"
                fontSize={size * 0.042}
                fontWeight={700}
                textAnchor="middle"
                dominantBaseline="central"
                transform={`rotate(${i * step} ${r + textR * Math.cos(mid)} ${r + textR * Math.sin(mid)})`}
              >
                {pocketLabel(p)}
              </text>
            </g>
          );
        })}
        <circle cx={r} cy={r} r={inner} fill="#3a2412" stroke="#d4af37" strokeWidth={1.5} />
        <circle cx={r} cy={r} r={inner * 0.55} fill="#86661c" stroke="#f0d688" strokeWidth={1} />
        {[0, 45, 90, 135].map((deg) => (
          <rect key={deg} x={r - 2} y={r - inner * 0.85} width={4} height={inner * 1.7} rx={2} fill="#d4af37" transform={`rotate(${deg} ${r} ${r})`} />
        ))}
        <circle cx={r} cy={r} r={inner * 0.18} fill="#f0d688" />
      </motion.svg>
      {/* Marker and ball at the top */}
      <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1">
        <svg width="18" height="16" viewBox="0 0 18 16">
          <path d="M9 16 L1 2 Q9 -2 17 2 Z" fill="#f0d688" stroke="#5f4812" strokeWidth="1" />
        </svg>
      </div>
      {result !== null && !spinning && (
        <div
          className="absolute left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
          style={{ top: size * 0.06 }}
        />
      )}
    </div>
  );
}
