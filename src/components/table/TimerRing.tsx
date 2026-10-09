import { useNow } from '@/hooks/useNow';

/** Countdown ring around an avatar. `endsAt` is server time; offset converts it. */
export function TimerRing({
  endsAt,
  totalSeconds,
  offsetMs,
  size = 52,
}: {
  endsAt: string;
  totalSeconds: number;
  offsetMs: number;
  size?: number;
}) {
  const now = useNow(200, offsetMs);
  const left = Math.max(0, new Date(endsAt).getTime() - now);
  const frac = Math.min(1, left / (totalSeconds * 1000));
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  const color = frac > 0.5 ? '#5cc392' : frac > 0.2 ? '#e3c35e' : '#e25a68';
  return (
    <svg width={size} height={size} className="pointer-events-none absolute -inset-[4px] -rotate-90" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        style={{ transition: 'stroke-dashoffset 0.2s linear, stroke 0.3s' }}
      />
    </svg>
  );
}

export function useSecondsLeft(endsAt: string | null | undefined, offsetMs: number) {
  const now = useNow(250, offsetMs);
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - now) / 1000));
}
