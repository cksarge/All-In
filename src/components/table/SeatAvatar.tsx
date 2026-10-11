import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/components/ui/cn';
import { useLook, useProgress } from '@/stores/progressStore';

/** A seated player's avatar with whatever picture and frame they have equipped. */
export function SeatAvatar({
  userId,
  username,
  isMe,
  size,
  dim,
  className,
}: {
  userId: string | undefined;
  username: string;
  isMe: boolean;
  size: number;
  dim?: boolean;
  className?: string;
}) {
  const look = useLook(userId, isMe);
  return <Avatar username={username} loadout={look?.loadout} size={size} me={isMe} dim={dim} className={className} />;
}

/** A seated player's equipped title (e.g. "High Roller"). */
export function SeatTitle({ userId, isMe, className }: { userId: string | undefined; isMe: boolean; className?: string }) {
  const key = useLook(userId, isMe)?.loadout.title;
  const name = useProgress((s) => s.cosmetics.find((c) => c.key === key)?.name ?? '');
  if (!name) return null;
  return (
    <span className={cn('block truncate text-[0.6rem] font-semibold uppercase leading-tight tracking-wider text-gold-300/90', className)}>
      <span className="sr-only">Title: </span>
      {name}
    </span>
  );
}
