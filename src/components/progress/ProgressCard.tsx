import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { useAuth } from '@/stores/authStore';
import { useProgress } from '@/stores/progressStore';
import { LevelBadge, useTitleName, XpBar } from './bits';

/** Lounge card: your level, rewards waiting to be collected, and links to the rest. */
export function ProgressCard() {
  const username = useAuth((s) => s.profile?.username);
  const me = useProgress((s) => s.me);
  const total = useProgress((s) => s.achievements.length);
  const claiming = useProgress((s) => s.claiming);
  const claim = useProgress((s) => s.claim);
  const title = useTitleName(me?.loadout.title);
  if (!me || !username) return null;
  return (
    <section aria-labelledby="progress-title" className="surface p-6">
      <h2 id="progress-title" className="sr-only">
        Your progress
      </h2>
      <div className="flex items-center gap-3">
        <Avatar username={username} loadout={me.loadout} size={52} me />
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <Link to="/profile" className="truncate font-display text-xl font-bold text-ivory hover:underline">
              {username}
            </Link>
            <LevelBadge level={me.level} />
          </p>
          <p className="truncate text-xs text-muted">{title}</p>
        </div>
      </div>
      <XpBar xp={me.xp} level_xp={me.level_xp} next_level_xp={me.next_level_xp} className="mt-4" />
      {me.unclaimed_chips > 0 && (
        <div className="mt-4 rounded-xl border border-gold-500/40 bg-gold-500/10 p-3">
          <p className="text-sm text-cream/90">
            Rewards waiting: <ChipAmount value={me.unclaimed_chips} className="font-bold text-gold-200" iconClassName="h-4 w-4" />
          </p>
          <Button size="sm" block className="mt-2" loading={claiming} onClick={() => void claim()}>
            Collect rewards
          </Button>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Link to="/profile" className="rounded-lg border border-white/10 px-3 py-2 text-cream/85 hover:border-white/25 hover:text-ivory">
          Achievements
          <span className="block text-xs text-muted">
            {me.achievements.length} of {total}
          </span>
        </Link>
        <Link to="/locker" className="rounded-lg border border-white/10 px-3 py-2 text-cream/85 hover:border-white/25 hover:text-ivory">
          Locker
          <span className="block text-xs text-muted">{me.owned.length} items</span>
        </Link>
        <Link to="/friends" className="rounded-lg border border-white/10 px-3 py-2 text-cream/85 hover:border-white/25 hover:text-ivory">
          Friends
          <span className="block text-xs text-muted">
            {me.friend_requests > 0 ? `${me.friend_requests} request${me.friend_requests === 1 ? '' : 's'} waiting` : `${me.metrics.friends ?? 0} so far`}
          </span>
        </Link>
        <Link to="/leaderboards" className="rounded-lg border border-white/10 px-3 py-2 text-cream/85 hover:border-white/25 hover:text-ivory">
          Leaderboards
          <span className="block text-xs text-muted">See where you stand</span>
        </Link>
      </div>
    </section>
  );
}
