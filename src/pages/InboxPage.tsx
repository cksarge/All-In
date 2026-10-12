import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { formatRelativeTime } from '@/lib/format';
import { inboxText } from '@/lib/live';
import { useLive } from '@/stores/liveStore';

const ICON: Record<string, string> = {
  friend_request: '👋',
  friend_accepted: '🤝',
  table_invite: '🪑',
  tournament_result: '🏆',
  tournament_off: '🏆',
  achievement: '⭐',
  season_start: '📅',
  season_rewards: '🎁',
  season_gift: '🎁',
  chips_adjusted: '🛡️',
  club_joined: '♣️',
  club_role: '♣️',
  club_removed: '♣️',
};

/** /inbox: friend requests, invites, results and rewards in one place. */
export default function InboxPage() {
  const { inbox, unread, fetchInbox, markRead, clearInbox } = useLive();
  const navigate = useNavigate();
  // React Router gives the first page of a visit the key "default": then there is nothing to go back to.
  const cameFromApp = useLocation().key !== 'default';
  useEffect(() => {
    void fetchInbox();
  }, [fetchInbox]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">What you missed</p>
          <h1 className="font-display text-4xl font-bold text-ivory">Inbox</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {unread > 0 && (
            <Button size="sm" variant="outline" onClick={() => void markRead()}>
              Mark all read
            </Button>
          )}
          {inbox.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void clearInbox()}>
              Clear all
            </Button>
          )}
          {/* Back to wherever you opened the inbox from (the lounge if you came straight here). */}
          <Button variant="ghost" size="sm" onClick={() => (cameFromApp ? navigate(-1) : navigate('/lounge'))}>
            ← {cameFromApp ? 'Back' : 'Lounge'}
          </Button>
        </div>
      </header>

      {inbox.length === 0 ? (
        <div className="surface mt-6">
          <EmptyState title="Nothing here yet" message="Friend requests, table invites, tournament results and rewards will show up here." />
        </div>
      ) : (
        <ul className="mt-6 space-y-2" aria-label="Notifications">
          {inbox.map((n) => {
            const t = inboxText(n);
            return (
              <li key={n.id} className={cn('surface flex items-start gap-3 p-4', !n.read && 'border-gold-500/40')}>
                <span className="mt-0.5 text-xl" aria-hidden="true">
                  {ICON[n.kind] ?? '🔔'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', n.read ? 'text-cream/85' : 'font-semibold text-ivory')}>
                    {!n.read && <span className="sr-only">Unread: </span>}
                    {t.title}
                  </p>
                  {t.body && <p className="mt-0.5 text-sm text-cream/70">{t.body}</p>}
                  <p className="mt-1 text-xs text-muted">{formatRelativeTime(n.at)}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {t.to && (
                    <Link to={t.to} onClick={() => void markRead([n.id])} className="rounded-lg border border-gold-500/50 px-3 py-1 text-sm font-semibold text-gold-300 hover:bg-gold-500/10">
                      {t.action ?? 'Open'}
                    </Link>
                  )}
                  <button type="button" onClick={() => void clearInbox(n.id)} className="text-xs text-muted hover:text-cream" aria-label={`Remove: ${t.title}`}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
