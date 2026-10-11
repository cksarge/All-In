import { AVATAR_GLYPH, FRAMES, type Loadout } from '@/lib/progress';
import { cn } from './cn';

/**
 * A player's avatar: their equipped picture (or their initial) inside their equipped frame.
 * `size` is in pixels. With no loadout it shows the plain initial.
 */
export function Avatar({
  username,
  loadout,
  size = 36,
  me,
  dim,
  className,
}: {
  username: string;
  loadout?: Pick<Loadout, 'avatar' | 'frame'> | null;
  size?: number;
  /** Your own avatar gets the ruby background. */
  me?: boolean;
  dim?: boolean;
  className?: string;
}) {
  const glyph = loadout ? AVATAR_GLYPH[loadout.avatar] : null;
  const frame = FRAMES[loadout?.frame ?? 'frame_none'] ?? FRAMES.frame_none;
  const ring = Math.max(2, Math.round(size * 0.07));
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', dim && 'opacity-50', className)}
      style={{
        width: size,
        height: size,
        padding: ring,
        background: frame.gradient ?? frame.color,
        boxShadow: frame.glow ? `0 0 ${Math.round(size * 0.35)}px ${frame.glow}` : undefined,
      }}
      aria-hidden="true"
    >
      <span
        className={cn(
          'flex h-full w-full items-center justify-center rounded-full font-display font-bold leading-none',
          me ? 'bg-gradient-to-br from-ruby-600 to-ruby-800 text-gold-200' : 'bg-ink-700 text-cream',
        )}
        style={{ fontSize: glyph ? size * 0.5 : size * 0.42 }}
      >
        {glyph ?? username.slice(0, 1).toUpperCase()}
      </span>
    </span>
  );
}
