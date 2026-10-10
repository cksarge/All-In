import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { EMOTES, QUICK_PHRASES } from '@/lib/blackjack';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/authStore';

export interface Reaction {
  id: number;
  user_id: string;
  kind: 'phrase' | 'emote';
  index: number;
}

export interface LiveSeat {
  seat_no: number;
  user_id: string;
  username: string;
  status: 'active' | 'sitting_out';
  connected: boolean;
}

export interface LiveTableState {
  server_now: string;
  seats: LiveSeat[];
}

/** When the table's current timer ends, and whether the server must be asked to advance. */
export interface Deadline {
  at: string | null | undefined;
  advance: boolean;
}

const HEARTBEAT_MS = 15_000;
const SAFETY_REFETCH_MS = 12_000;
const REACTION_COOLDOWN_MS = 2_000;
const REACTION_SHOW_MS = 3_500;
// Leaving the page inside the app (lobby, lounge, …) gives up the seat. The short
// delay lets React's dev-mode remount cancel it; a refresh or closed tab never
// unmounts, so those keep the 2-minute reconnect hold.
const pendingLeave = new Map<string, number>();

/**
 * Shared plumbing for every live table game:
 *  - Postgres Changes on the game's tables trigger a fresh server snapshot.
 *  - Broadcast carries quick-chat phrases and emotes (IDs only, never free text).
 *  - Presence tracks who's watching.
 *  - Heartbeats hold the seat; navigating away inside the app leaves it.
 *  - When a timer runs out, the client asks the server to advance; the server
 *    checks the deadline itself, so a closed tab can never stall the table.
 */
export function useLiveTable<S extends LiveTableState>(opts: {
  tableId: string;
  stateFn: string;
  advanceFn: string;
  realtimeTables: string[];
  getDeadline: (s: S) => Deadline;
}) {
  const { tableId, stateFn, advanceFn, getDeadline } = opts;
  const realtimeKey = opts.realtimeTables.join(',');
  const user = useAuth((s) => s.user);
  const username = useAuth((s) => s.profile?.username);
  const [state, setState] = useState<S | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [watchers, setWatchers] = useState(0);
  const [connected, setConnected] = useState(true);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const refetchTimer = useRef<number | undefined>(undefined);
  const lastReactionAt = useRef(0);
  const inflight = useRef(false);
  const queued = useRef(false);

  const refetch = useCallback(async () => {
    if (inflight.current) {
      queued.current = true;
      return;
    }
    inflight.current = true;
    const sentAt = Date.now();
    const { data, error: err } = await supabase.rpc(stateFn, { p_table: tableId });
    inflight.current = false;
    if (err) {
      setError(friendlyError(err));
    } else {
      const s = data as S;
      const rtt = Date.now() - sentAt;
      setOffsetMs(new Date(s.server_now).getTime() - (sentAt + rtt / 2));
      setState(s);
      setError(null);
    }
    if (queued.current) {
      queued.current = false;
      void refetch();
    }
  }, [tableId, stateFn]);

  const scheduleRefetch = useCallback(() => {
    window.clearTimeout(refetchTimer.current);
    refetchTimer.current = window.setTimeout(() => void refetch(), 60);
  }, [refetch]);

  // Realtime channel
  useEffect(() => {
    if (!user) return;
    void refetch();
    const filter = `table_id=eq.${tableId}`;
    let ch = supabase.channel(`table:${tableId}`, {
      config: { broadcast: { self: true }, presence: { key: user.id } },
    });
    for (const table of realtimeKey.split(',')) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table, filter }, scheduleRefetch);
    }
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'table_seats', filter }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_tables', filter: `id=eq.${tableId}` }, scheduleRefetch)
      .on('broadcast', { event: 'react' }, ({ payload }) => {
        const p = payload as Partial<Reaction>;
        // Only render known phrase/emote IDs: there is no free-text chat.
        const max = p.kind === 'phrase' ? QUICK_PHRASES.length : p.kind === 'emote' ? EMOTES.length : 0;
        if (typeof p.user_id !== 'string' || typeof p.index !== 'number' || p.index < 0 || p.index >= max) return;
        const r: Reaction = { id: Date.now() + Math.random(), user_id: p.user_id, kind: p.kind!, index: p.index };
        setReactions((list) => [...list.filter((x) => x.user_id !== r.user_id), r]);
        window.setTimeout(() => setReactions((list) => list.filter((x) => x.id !== r.id)), REACTION_SHOW_MS);
      })
      .on('presence', { event: 'sync' }, () => setWatchers(Object.keys(ch.presenceState()).length))
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') {
          void ch.track({ username: username ?? 'Player' });
          scheduleRefetch(); // catch up on anything missed while disconnected
        }
      });
    channelRef.current = ch;

    const safety = window.setInterval(() => void refetch(), SAFETY_REFETCH_MS);
    const onVisible = () => document.visibilityState === 'visible' && scheduleRefetch();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', scheduleRefetch);

    return () => {
      window.clearInterval(safety);
      window.clearTimeout(refetchTimer.current);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', scheduleRefetch);
      void supabase.removeChannel(ch);
      channelRef.current = null;
    };
  }, [tableId, user, username, refetch, scheduleRefetch, realtimeKey]);

  const mySeat = state?.seats.find((s) => s.user_id === user?.id) ?? null;
  const mySeatNo = mySeat?.seat_no;

  // Leave the seat when navigating away inside the app.
  const seatedRef = useRef(false);
  seatedRef.current = Boolean(mySeatNo);
  useEffect(() => {
    window.clearTimeout(pendingLeave.get(tableId));
    pendingLeave.delete(tableId);
    return () => {
      if (!seatedRef.current) return;
      pendingLeave.set(
        tableId,
        window.setTimeout(() => {
          pendingLeave.delete(tableId);
          // Supabase requests only run once awaited/then'd.
          void supabase.rpc('leave_table', { p_table: tableId }).then(() => undefined);
        }, 300),
      );
    };
  }, [tableId]);

  // Heartbeat keeps the seat (reconnect hold is 2 minutes).
  useEffect(() => {
    if (!mySeatNo) return;
    const beat = () => void supabase.rpc('table_heartbeat', { p_table: tableId }).then(() => undefined);
    beat();
    const id = window.setInterval(beat, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [tableId, mySeatNo]);

  // Deadline watcher: ask the server to advance (or just refresh) once a timer has passed.
  const deadline = state ? getDeadline(state) : null;
  const dueAt = deadline?.at ?? null;
  const advance = deadline?.advance ?? false;
  useEffect(() => {
    if (!dueAt) return;
    const due = new Date(dueAt).getTime() - (Date.now() + offsetMs);
    if (!advance) {
      const t = window.setTimeout(scheduleRefetch, Math.max(0, due) + 100);
      return () => window.clearTimeout(t);
    }
    // Small random delay so every client doesn't hit the server at once.
    const wait = Math.max(0, due) + 400 + Math.random() * 600;
    const t = window.setTimeout(async () => {
      await supabase.rpc(advanceFn, { p_table: tableId });
      scheduleRefetch();
    }, wait);
    return () => window.clearTimeout(t);
  }, [dueAt, advance, offsetMs, tableId, advanceFn, scheduleRefetch]);

  /** Call an RPC with p_table filled in; returns a friendly error or null. */
  const call = useCallback(
    async (fn: string, args: Record<string, unknown> = {}): Promise<string | null> => {
      const { error: err } = await supabase.rpc(fn, { p_table: tableId, ...args });
      scheduleRefetch();
      return err ? friendlyError(err) : null;
    },
    [tableId, scheduleRefetch],
  );

  const sendReaction = useCallback(
    (kind: 'phrase' | 'emote', index: number) => {
      if (!user || !channelRef.current) return false;
      if (Date.now() - lastReactionAt.current < REACTION_COOLDOWN_MS) return false;
      lastReactionAt.current = Date.now();
      void channelRef.current.send({ type: 'broadcast', event: 'react', payload: { user_id: user.id, kind, index } });
      return true;
    },
    [user],
  );

  return {
    state,
    error,
    offsetMs,
    connected,
    reactions,
    watchers,
    mySeat,
    userId: user?.id,
    refetch,
    call,
    sit: (seat?: number) => call('join_table', { p_seat: seat ?? null }),
    leave: () => call('leave_table'),
    sitOut: (out: boolean) => call('set_sitting_out', { p_sitting_out: out }),
    sendReaction,
  };
}
