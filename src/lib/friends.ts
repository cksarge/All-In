import { friendlyError } from './errors';
import type { PlayerCard } from './progress';
import { supabase } from './supabase';

/** A friend, and the table they are sitting at (`id` is null for a private table). */
export interface Friend extends PlayerCard {
  since: string;
  table: { id: string | null; game_key: string; game: string; name: string; private: boolean; full: boolean } | null;
}
export interface FriendList {
  friends: Friend[];
  incoming: (PlayerCard & { at: string })[];
  outgoing: (PlayerCard & { at: string })[];
}
/** The game a friend has open away from the tables, by their id. */
export type FriendsPlaying = Record<string, { game_key: string; game: string }>;

/**
 * Your friends and what they are doing: `friends_list()` and `friends_activity()` together.
 * Whatever could not be read comes back null (with `error` for the list), so a caller keeps what it had.
 */
export async function loadFriends(): Promise<{ list: FriendList | null; error: string | null; playing: FriendsPlaying | null; watchable: boolean | null }> {
  const [list, act] = await Promise.all([supabase.rpc('friends_list'), supabase.rpc('friends_activity')]);
  const a = act.error ? null : (act.data as { watchable: boolean; playing: FriendsPlaying });
  return {
    list: list.error ? null : (list.data as FriendList),
    error: list.error ? friendlyError(list.error) : null,
    playing: a?.playing ?? null,
    watchable: a?.watchable ?? null,
  };
}
