import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DmModal, WatchModal } from '@/components/progress/FriendPanels';
import { Avatar } from '@/components/ui/Avatar';
import { Button, ButtonLink } from '@/components/ui/Button';
import type { PlayerCard } from '@/lib/progress';
import { supabase } from '@/lib/supabase';
import { useDm } from '@/stores/dmStore';
import { usePresence } from '@/stores/presenceStore';

interface Friend extends PlayerCard {
  /** Where they are sitting. `id` is null for a private table. */
  table: { id: string | null; game_key: string; game: string; name: string; private: boolean; full: boolean } | null;
}
type Who = { user_id: string; username: string };

/**
 * The lounge's strip of friends who are on the site right now: what each is doing, and one press
 * to join their table, watch their game or send a message. Not shown when nobody is on.
 */
export function FriendsStrip() {
  const online = usePresence((s) => s.online);
  const threads = useDm((s) => s.threads);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [playing, setPlaying] = useState<Record<string, { game_key: string; game: string }>>({});
  const [dm, setDm] = useState<Who | null>(null);
  const [watch, setWatch] = useState<Who | null>(null);

  const load = useCallback(async () => {
    const [list, act] = await Promise.all([supabase.rpc('friends_list'), supabase.rpc('friends_activity')]);
    if (!list.error) setFriends((list.data as { friends: Friend[] }).friends ?? []);
    if (!act.error) setPlaying((act.data as { playing: Record<string, { game_key: string; game: string }> }).playing ?? {});
  }, []);
  // Who is online arrives live; where they are is asked again when that changes, and every half minute.
  const onlineKey = online.map((o) => o.user_id).sort().join(',');
  useEffect(() => {
    void load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load, onlineKey]);

  // A friend at a table or with a game open is here, whether or not the live list has caught up.
  const here = friends.filter((f) => f.table || playing[f.user_id] || online.some((o) => o.user_id === f.user_id));
  if (here.length === 0) return null;
  const unread = (id: string) => threads.find((t) => t.user_id === id)?.unread ?? 0;

  return (
    <section aria-labelledby="friends-online-h" className="surface mb-6 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="friends-online-h" className="font-display text-lg font-bold text-ivory">
          Friends online <span className="text-sm font-normal text-muted">({here.length})</span>
        </h2>
        <Link to="/friends" className="text-sm font-medium text-gold-300 hover:underline">
          All friends
        </Link>
      </div>
      <ul className="-mx-1 mt-3 flex gap-3 overflow-x-auto px-1 pb-1">
        {here.map((f) => {
          const game = playing[f.user_id];
          const where = f.table ? (f.table.private ? `At a private ${f.table.game} table` : `${f.table.game} · ${f.table.name}`) : game ? `Playing ${game.game}` : 'In the lounge';
          const canWatch = Boolean(game) || Boolean(f.table && !f.table.private);
          return (
            <li key={f.user_id} className="flex w-60 shrink-0 flex-col gap-2.5 rounded-xl border border-white/10 bg-ink-950/40 p-3">
              <Link to={`/profile/${f.username}`} className="flex min-w-0 items-center gap-2.5 hover:opacity-90">
                <span className="relative">
                  <Avatar username={f.username} loadout={f.loadout} size={38} />
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-ink-900 bg-felt-400" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ivory">{f.username}</span>
                  <span className="block truncate text-xs text-cream/75">{where}</span>
                </span>
              </Link>
              <div className="flex flex-wrap items-center gap-1.5">
                {f.table?.id && !f.table.private && (
                  <ButtonLink size="sm" variant={f.table.full ? 'outline' : 'gold'} to={`/table/${f.table.id}`} aria-label={`${f.table.full ? 'Watch the table of' : 'Join'} ${f.username}`}>
                    {f.table.full ? 'Table' : 'Join'}
                  </ButtonLink>
                )}
                {canWatch && (
                  <Button size="sm" variant="outline" aria-label={`Watch ${f.username}`} onClick={() => setWatch({ user_id: f.user_id, username: f.username })}>
                    Watch
                  </Button>
                )}
                <Button size="sm" variant="ghost" aria-label={`Message ${f.username}${unread(f.user_id) ? `, ${unread(f.user_id)} new` : ''}`} onClick={() => setDm({ user_id: f.user_id, username: f.username })}>
                  Message
                  {unread(f.user_id) > 0 && <span className="ml-1.5 rounded-full bg-ruby-500 px-1.5 text-[0.65rem] font-bold text-ivory">{unread(f.user_id)}</span>}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <DmModal friend={dm} onClose={() => setDm(null)} />
      <WatchModal friend={watch} onClose={() => setWatch(null)} />
    </section>
  );
}
