import { useId } from 'react';
import { cn } from './cn';

const palettes = {
  ruby: { face: '#a81c2c', inner: '#7a1220', edge: '#f4ead2' },
  gold: { face: '#c79a2a', inner: '#8a6a1f', edge: '#fff4cf' },
  felt: { face: '#135c3e', inner: '#0a3524', edge: '#f4ead2' },
  sapphire: { face: '#3566c4', inner: '#1b3a7a', edge: '#f4ead2' },
  onyx: { face: '#1c211f', inner: '#0b0d0c', edge: '#d4af37' },
} as const;

export type ChipColor = keyof typeof palettes;

/** The play-chip icon. Used everywhere a chip amount appears, instead of any currency symbol. */
export function ChipIcon({
  className,
  color = 'ruby',
  title,
}: {
  className?: string;
  color?: ChipColor;
  title?: string;
}) {
  const p = palettes[color];
  const gid = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('inline-block shrink-0', className ?? 'h-5 w-5')}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <defs>
        <radialGradient id={gid} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="60%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15" fill={p.face} />
      <circle cx="16" cy="16" r="15" fill="none" stroke={p.edge} strokeWidth="3.2" strokeDasharray="4.2 3.65" />
      <circle cx="16" cy="16" r="9.6" fill={p.inner} stroke="#d4af37" strokeWidth="1.1" />
      <path d="M16 10.2l1.6 3.6 3.9.4-2.9 2.6.8 3.8L16 18.7l-3.4 1.9.8-3.8-2.9-2.6 3.9-.4z" fill="#f0d688" opacity="0.92" />
      <circle cx="16" cy="16" r="15" fill={`url(#${gid})`} />
    </svg>
  );
}
