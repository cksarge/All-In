import { Avatar } from '@/components/ui/Avatar';
import { useLook } from '@/stores/progressStore';

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
