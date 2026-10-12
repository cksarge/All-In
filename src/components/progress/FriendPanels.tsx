import { useCallback, useEffect, useState } from 'react';
import { ChatBox } from '@/components/chat/ChatBox';
import { InfoModal } from '@/components/table/InfoModal';
import { ButtonLink } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { useChat } from '@/hooks/useChat';
import { friendlyError } from '@/lib/errors';
import { formatRelativeTime } from '@/lib/format';
import { gameHref, gameMode } from '@/lib/games';
import { historyLine } from '@/lib/solo';
import { supabase } from '@/lib/supabase';

/** A direct conversation with one friend. Typed chat with the same filter and rules as everywhere else; kept 3 days. */
export function DmModal({ friend, onClose }: { friend: { user_id: string; username: string } | null; onClose: () => void }) {
  return (
    <InfoModal open={friend !== null} onClose={onClose} title={friend ? `Messages with ${friend.username}` : 'Messages'}>
      {friend && <Conversation friendId={friend.user_id} />}
    </InfoModal>
  );
}

function Conversation({ friendId }: { friendId: string }) {
  const chat = useChat(`dm:${friendId}`, true);
  return (
    <>
      <ChatBox chat={chat} className="mt-3" listClassName="h-64" writeHint="You can only message your friends." />
      <p className="mt-2 text-xs text-muted">Only the two of you see this. Messages are deleted after 3 days. The chat rules and filter apply here too.</p>
    </>
  );
}

interface Watch {
  user_id: string;
  username: string;
  game_key: string | null;
  game: string | null;
  balance: number | null;
  table: { id: string; name: string; game_key: string; game: string; full: boolean } | null;
  rounds: { id: string; wagered: number; returned: number; outcome: 'win' | 'loss' | 'push'; summary: Record<string, unknown>; at: string }[];
}

/**
 * Watching a friend. At a public table you are sent to the table itself (anyone can watch one, and sit down
 * if there is a seat). Away from the tables this shows what they have open and how their last rounds went,
 * refreshed every few seconds, with a way to join in.
 */
export function WatchModal({ friend, onClose }: { friend: { user_id: string; username: string } | null; onClose: () => void }) {
  const [w, setW] = useState<Watch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = friend?.user_id;

  const load = useCallback(async () => {
    if (!id) return;
    const { data, error: err } = await supabase.rpc('friend_watch', { p_user: id });
    if (err) setError(friendlyError(err));
    else {
      setError(null);
      setW(data as Watch);
    }
  }, [id]);

  useEffect(() => {
    setW(null);
    setError(null);
    if (!id) return;
    void load();
    const t = window.setInterval(() => !document.hidden && void load(), 3000);
    return () => window.clearInterval(t);
  }, [id, load]);

  const mode = w?.game_key ? gameMode({ key: w.game_key, multiplayer: false }) : null;
  return (
    <InfoModal open={friend !== null} onClose={onClose} title={friend ? `Watching ${friend.username}` : 'Watching'}>
      {error ? (
        <p className="mt-4 text-sm text-cream/85">{error}</p>
      ) : !w ? (
        <p className="mt-4 text-sm text-muted">Looking over their shoulder…</p>
      ) : (
        <div className="mt-3 space-y-4">
          {w.table && (
            <div className="rounded-xl border border-felt-300/30 bg-felt-600/15 p-3">
              <p className="text-sm text-cream/90">
                At <strong className="text-ivory">{w.table.name}</strong>, playing {w.table.game}.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <ButtonLink size="sm" variant="outline" to={`/table/${w.table.id}`}>
                  Watch the table
                </ButtonLink>
                {!w.table.full && (
                  <ButtonLink size="sm" to={`/table/${w.table.id}`}>
                    Join their table
                  </ButtonLink>
                )}
              </div>
              <p className="mt-2 text-xs text-muted">At the table you see every card and bet as it happens. Take a free seat to play.</p>
            </div>
          )}
          {w.game_key ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-cream/90">
                  Playing <strong className="text-ivory">{w.game}</strong> right now
                  {w.balance !== null && (
                    <>
                      {' '}
                      · <ChipAmount value={w.balance} iconClassName="h-3.5 w-3.5" /> chips
                    </>
                  )}
                </p>
                <ButtonLink size="sm" to={gameHref({ key: w.game_key, multiplayer: false })}>
                  {mode === 'room' ? 'Join the room' : 'Play it too'}
                </ButtonLink>
              </div>
              <ul className="max-h-72 divide-y divide-white/[0.06] overflow-y-auto" aria-live="polite" aria-label="Their recent rounds">
                {w.rounds.length === 0 ? (
                  <li className="py-2 text-sm text-muted">No rounds in the last few minutes yet. This updates by itself.</li>
                ) : (
                  w.rounds.map((r) => {
                    const net = r.returned - r.wagered;
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 truncate text-cream/85">
                          {historyLine(w.game_key!, r.summary)}
                          <span className="ml-2 text-xs text-muted">{formatRelativeTime(r.at)}</span>
                        </span>
                        <ChipAmount value={net} signed className={cn('shrink-0 font-semibold', net > 0 ? 'text-felt-300' : net < 0 ? 'text-ruby-300' : 'text-cream')} iconClassName="h-3.5 w-3.5" />
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          ) : (
            !w.table && <p className="text-sm text-muted">{w.username} isn&apos;t in a game at the moment. This updates by itself when they start one.</p>
          )}
        </div>
      )}
    </InfoModal>
  );
}
