import { useAccount } from '@/stores/accountStore';
import { SectionNav } from '@/components/layout/SectionNav';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DmModal, WatchModal } from '@/components/progress/FriendPanels';
import { useDm } from '@/stores/dmStore';
import { PlayerLine } from '@/components/progress/bits';
import { Button, ButtonLink } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { TextField } from '@/components/ui/TextField';
import { friendlyError } from '@/lib/errors';
import type { Friendship, PlayerCard } from '@/lib/progress';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { usePresence } from '@/stores/presenceStore';
import { useProgress } from '@/stores/progressStore';
import { toast } from '@/stores/toastStore';

interface Friend extends PlayerCard {
  since: string;
  /** Where they are sitting. `id` is null for a private table. */
  table: { id: string | null; game_key: string; game: string; name: string; private: boolean; full: boolean } | null;
}
interface List {
  friends: Friend[];
  incoming: (PlayerCard & { at: string })[];
  outgoing: (PlayerCard & { at: string })[];
}
type Found = PlayerCard & { friendship: Friendship };

export default function FriendsPage() {
  const online = usePresence((s) => s.online);
  const requests = useProgress((s) => s.me?.friend_requests);
  const [list, setList] = useState<List | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const isOnline = (id: string) => online.some((o) => o.user_id === id);
  // What friends have open away from the tables, and whether you let them see the same about you.
  const [playing, setPlaying] = useState<Record<string, { game_key: string; game: string }>>({});
  const [watchable, setWatchable] = useState<boolean | null>(null);
  const [dm, setDm] = useState<{ user_id: string; username: string } | null>(null);
  const [watch, setWatch] = useState<{ user_id: string; username: string } | null>(null);
  const threads = useDm((s) => s.threads);
  const unreadFrom = (id: string) => threads.find((t) => t.user_id === id)?.unread ?? 0;
  const [params, setParams] = useSearchParams();

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('friends_list');
    if (err) setError(friendlyError(err));
    else {
      setError(null);
      setList(data as List);
    }
    const act = await supabase.rpc('friends_activity');
    if (!act.error) {
      const d = act.data as { watchable: boolean; playing: Record<string, { game_key: string; game: string }> };
      setPlaying(d.playing);
      setWatchable(d.watchable);
    }
  }, []);

  // A "new message" toast links here with ?dm=<their id>: open that conversation.
  const openDm = params.get('dm');
  useEffect(() => {
    if (!openDm || !list) return;
    const f = list.friends.find((x) => x.user_id === openDm);
    if (f) setDm({ user_id: f.user_id, username: f.username });
    setParams({}, { replace: true });
  }, [openDm, list, setParams]);

  const toggleWatchable = async () => {
    const next = !watchable;
    setWatchable(next);
    const { error: err } = await supabase.rpc('set_watchable', { p_on: next });
    if (err) {
      setWatchable(!next);
      return toast.error(friendlyError(err));
    }
    toast.success(next ? 'Friends can see what you are playing' : 'Friends can no longer see what you play on your own');
  };

  // Refresh when a request arrives, and every so often to follow friends between tables.
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load, requests]);

  const blockedList = useAccount((st) => st.account?.blocked) ?? [];

  const act = async (key: string, fn: string, args: Record<string, unknown>, done: string) => {
    setBusy(key);
    const { error: err } = await supabase.rpc(fn, args);
    setBusy(null);
    if (err) {
      playSound('error');
      return toast.error(friendlyError(err));
    }
    playSound('click');
    toast.success(done);
    await load();
    void useProgress.getState().fetch();
    if (found) void search();
  };

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    if (query.trim().length < 2) return toast.info('Type at least two letters of their name');
    const { data, error: err } = await supabase.rpc('find_players', { p_query: query.trim() });
    if (err) return toast.error(friendlyError(err));
    setFound(data as Found[]);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      <SectionNav />
      <DmModal friend={dm} onClose={() => setDm(null)} />
      <WatchModal friend={watch} onClose={() => setWatch(null)} />
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">Play together</p>
      <h1 className="font-display text-4xl font-bold text-ivory">Friends</h1>

      <section className="surface mt-6 p-5" aria-labelledby="find-title">
        <h2 id="find-title" className="font-display text-xl font-bold text-ivory">
          Add a friend
        </h2>
        <form onSubmit={(e) => void search(e)} className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <TextField label="Player name" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing a name" autoComplete="off" maxLength={16} />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
        {found &&
          (found.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nobody found with a name starting like that.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.06]">
              {found.map((f) => (
                <li key={f.user_id} className="flex items-center justify-between gap-3 py-2.5">
                  <PlayerLine username={f.username} level={f.level} loadout={f.loadout} />
                  {f.friendship === 'friends' ? (
                    <span className="shrink-0 text-xs text-felt-300">Friends ✓</span>
                  ) : f.friendship === 'pending_out' ? (
                    <span className="shrink-0 text-xs text-muted">Request sent</span>
                  ) : (
                    <Button size="sm" disabled={busy !== null} onClick={() => void act(f.user_id, 'friend_request', { p_username: f.username }, f.friendship === 'pending_in' ? `You and ${f.username} are now friends` : 'Friend request sent')}>
                      {f.friendship === 'pending_in' ? 'Accept' : 'Add friend'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ))}
      </section>

      {error ? (
        <div className="surface mt-5">
          <ErrorState message={error} onRetry={() => void load()} />
        </div>
      ) : !list ? (
        <LoadingState label="Finding your friends…" />
      ) : (
        <>
          {list.incoming.length > 0 && (
            <section className="surface mt-5 border-gold-500/30 p-5" aria-labelledby="incoming-title">
              <h2 id="incoming-title" className="font-display text-xl font-bold text-ivory">
                Friend requests
              </h2>
              <ul className="mt-2 divide-y divide-white/[0.06]">
                {list.incoming.map((f) => (
                  <li key={f.user_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <PlayerLine username={f.username} level={f.level} loadout={f.loadout} />
                    <span className="flex gap-2">
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(f.user_id, 'friend_respond', { p_user: f.user_id, p_accept: false }, 'Request declined')}>
                        Decline
                      </Button>
                      <Button size="sm" disabled={busy !== null} onClick={() => void act(f.user_id, 'friend_respond', { p_user: f.user_id, p_accept: true }, `You and ${f.username} are now friends`)}>
                        Accept
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="surface mt-5 p-5" aria-labelledby="friends-title">
            <h2 id="friends-title" className="font-display text-xl font-bold text-ivory">
              Your friends <span className="text-base font-normal text-muted">({list.friends.length})</span>
            </h2>
            {list.friends.length === 0 ? (
              <EmptyState title="No friends yet" message="Search for a player above, or add someone from their profile." />
            ) : (
              <ul className="mt-2 divide-y divide-white/[0.06]">
                {list.friends.map((f) => (
                  <li key={f.user_id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3">
                    <PlayerLine username={f.username} level={f.level} loadout={f.loadout} online={isOnline(f.user_id)} />
                    <span className="flex flex-wrap items-center gap-2">
                      {f.table ? (
                        f.table.private ? (
                          <span className="text-xs text-muted">At a private {f.table.game} table</span>
                        ) : (
                          <>
                            <span className="text-xs text-cream/75">
                              Playing {f.table.game} at {f.table.name}
                            </span>
                            {f.table.id && !f.table.full ? (
                              <ButtonLink size="sm" to={`/table/${f.table.id}`}>
                                Join their table
                              </ButtonLink>
                            ) : (
                              f.table.id && (
                                <ButtonLink size="sm" variant="outline" to={`/table/${f.table.id}`}>
                                  Watch (table full)
                                </ButtonLink>
                              )
                            )}
                          </>
                        )
                      ) : playing[f.user_id] ? (
                        <span className="text-xs text-cream/75">Playing {playing[f.user_id].game}</span>
                      ) : (
                        <span className="text-xs text-muted">{isOnline(f.user_id) ? 'Online, not in a game' : 'Offline'}</span>
                      )}
                      {(playing[f.user_id] || (f.table && !f.table.private)) && (
                        <Button size="sm" variant="outline" aria-label={`Watch ${f.username}`} onClick={() => setWatch({ user_id: f.user_id, username: f.username })}>
                          Watch
                        </Button>
                      )}
                      <Button size="sm" variant="outline" aria-label={`Message ${f.username}${unreadFrom(f.user_id) ? `, ${unreadFrom(f.user_id)} new` : ''}`} onClick={() => setDm({ user_id: f.user_id, username: f.username })}>
                        Message
                        {unreadFrom(f.user_id) > 0 && <span className="ml-1.5 rounded-full bg-ruby-500 px-1.5 text-[0.65rem] font-bold text-ivory">{unreadFrom(f.user_id)}</span>}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy !== null} aria-label={`Remove ${f.username} from your friends`} onClick={() => void act(f.user_id, 'friend_remove', { p_user: f.user_id }, 'Removed from your friends')}>
                        Remove
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {watchable !== null && (
              <label className="mt-4 flex cursor-pointer items-start gap-3 border-t border-white/[0.06] pt-4">
                <input type="checkbox" checked={watchable} onChange={() => void toggleWatchable()} className="mt-0.5 h-4 w-4 accent-gold-500" />
                <span className="text-sm text-cream/90">
                  Let my friends see what I&apos;m playing and watch
                  <span className="block text-xs text-muted">
                    Friends see which game you have open and how your last few rounds there went. At a public table anyone can watch anyway.
                  </span>
                </span>
              </label>
            )}
          </section>

          {list.outgoing.length > 0 && (
            <section className="surface mt-5 p-5" aria-labelledby="outgoing-title">
              <h2 id="outgoing-title" className="font-display text-xl font-bold text-ivory">
                Waiting for an answer
              </h2>
              <ul className="mt-2 divide-y divide-white/[0.06]">
                {list.outgoing.map((f) => (
                  <li key={f.user_id} className="flex items-center justify-between gap-3 py-2.5">
                    <PlayerLine username={f.username} level={f.level} loadout={f.loadout} />
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(f.user_id, 'friend_remove', { p_user: f.user_id }, 'Request taken back')}>
                      Take back
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {blockedList.length > 0 && (
        <section className="surface mt-5 p-5" aria-labelledby="blocked-title">
          <h2 id="blocked-title" className="font-display text-xl font-bold text-ivory">
            Blocked players
          </h2>
          <p className="mt-1 text-sm text-muted">They can&apos;t send you friend requests, and you don&apos;t see their emotes.</p>
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {blockedList.map((b) => (
              <li key={b.user_id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="truncate text-sm font-medium text-cream">{b.username}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => void act(b.user_id, 'unblock_player', { p_user: b.user_id }, `${b.username} is unblocked`).then(() => useAccount.getState().fetch())}
                >
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
