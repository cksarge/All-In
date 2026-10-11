import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/components/ui/cn';
import { levelFraction, type Loadout } from '@/lib/progress';
import { useProgress } from '@/stores/progressStore';

/** The name of an equipped title, from the catalogue. */
export function useTitleName(key: string | undefined): string {
  return useProgress((s) => s.cosmetics.find((c) => c.key === key)?.name ?? '');
}

export function LevelBadge({ level, className }: { level: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border border-gold-500/50 bg-gold-500/10 px-2 py-0.5 text-[0.7rem] font-bold tabular-nums text-gold-200', className)}>
      <span className="sr-only">Level </span>
      <span aria-hidden="true">Lv&nbsp;</span>
      {level}
    </span>
  );
}

export function XpBar({ xp, level_xp, next_level_xp, className }: { xp: number; level_xp: number; next_level_xp: number | null; className?: string }) {
  const f = levelFraction({ xp, level_xp, next_level_xp });
  return (
    <div className={className}>
      <div
        className="h-2 overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(f * 100)}
        aria-label="Progress to the next level"
      >
        <div className="h-full rounded-full bg-gradient-to-r from-gold-600 to-gold-300 transition-[width] duration-500" style={{ width: `${f * 100}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted">
        {next_level_xp === null
          ? `${xp.toLocaleString('en-US')} XP · top level`
          : `${(xp - level_xp).toLocaleString('en-US')} / ${(next_level_xp - level_xp).toLocaleString('en-US')} XP to the next level`}
      </p>
    </div>
  );
}

/** Avatar, name (linked to the profile), title and level: one player in a list. */
export function PlayerLine({
  username,
  level,
  loadout,
  me,
  online,
  size = 40,
}: {
  username: string;
  level: number;
  loadout: Loadout;
  me?: boolean;
  online?: boolean;
  size?: number;
}) {
  const title = useTitleName(loadout.title);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="relative shrink-0">
        <Avatar username={username} loadout={loadout} size={size} me={me} />
        {online !== undefined && (
          <span
            className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ink-800', online ? 'bg-felt-300' : 'bg-ink-400')}
            title={online ? 'Online' : 'Offline'}
          />
        )}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <Link to={`/profile/${username}`} className={cn('truncate font-semibold hover:underline', me ? 'text-gold-200' : 'text-ivory')}>
            {username}
          </Link>
          <LevelBadge level={level} />
        </span>
        {title && <span className="block truncate text-xs text-muted">{title}</span>}
      </span>
    </span>
  );
}
