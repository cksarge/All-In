import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { TierKey } from '@/lib/types';
import { useAuth } from '@/stores/authStore';
import { usePresence } from '@/stores/presenceStore';

export interface LobbyTable {
  id: string;
  name: string;
  tier: TierKey;
  variant: string | null;
  tier_rank: number;
  tier_label: string;
  min_bet: number;
  max_bet: number;
  min_bankroll: number;
  is_private: boolean;
  max_seats: number;
  persistent: boolean;
  seats_filled: number;
  is_mine: boolean;
  players: { seat_no: number; username: string; connected: boolean }[];
}

/** Live table list for one game (Postgres Changes → refetch). */
export function useLobbyTables(game: string) {
  const user = useAuth((s) => s.user);
  const [tables, setTables] = useState<LobbyTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('list_tables', { p_game: game });
    if (err) setError(friendlyError(err));
    else {
      setTables((data ?? []) as LobbyTable[]);
      setError(null);
    }
  }, [game]);

  useEffect(() => {
    if (!user) return;
    setTables(null);
    void load();
    const schedule = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void load(), 300);
    };
    const ch = supabase
      .channel(`lobby-tables:${game}:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_tables' }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_seats' }, schedule)
      .subscribe((status) => status === 'SUBSCRIBED' && schedule());
    const safety = window.setInterval(() => void load(), 20_000);
    return () => {
      window.clearInterval(safety);
      window.clearTimeout(timer.current);
      void supabase.removeChannel(ch);
    };
  }, [game, user, load]);

  return { tables, error, reload: load };
}

/** Keeps the global "who's online" Presence channel joined while signed in. Mount once. */
export function useOnlinePresence() {
  const user = useAuth((s) => s.user);
  const username = useAuth((s) => s.profile?.username);
  const setOnline = usePresence((s) => s.setOnline);

  useEffect(() => {
    if (!user || !username) return;
    const ch = supabase.channel('presence:lobby', { config: { presence: { key: user.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState<{ username?: string }>();
      setOnline(
        Object.entries(st).map(([id, metas]) => ({ user_id: id, username: metas[0]?.username ?? 'Player' })),
      );
    }).subscribe((status) => {
      if (status === 'SUBSCRIBED') void ch.track({ username, online_at: new Date().toISOString() });
    });
    return () => {
      void supabase.removeChannel(ch);
      setOnline([]);
    };
  }, [user, username, setOnline]);
}
