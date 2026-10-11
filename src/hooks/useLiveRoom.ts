import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useWallet } from '@/stores/walletStore';

/**
 * A live room without tables or seats (Crash, Bingo): one shared round that everyone watches.
 * Polls `stateFn` (which also moves the round along on the server), refetches at once when
 * Realtime reports a change, and works out the server clock offset for countdowns.
 */
export function useLiveRoom<S extends { server_now: string }>({
  stateFn,
  tables,
  pollMs,
}: {
  stateFn: string;
  /** Tables in the realtime publication that mean "something changed". */
  tables: string[];
  /** How long to wait before the next poll, given the latest state. */
  pollMs: (s: S | null) => number;
}) {
  const [state, setState] = useState<S | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const latest = useRef<S | null>(null);
  const pollRef = useRef(pollMs);
  pollRef.current = pollMs;
  const busy = useRef(false);

  const refetch = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const sentAt = Date.now();
    const { data, error: err } = await supabase.rpc(stateFn);
    busy.current = false;
    if (err) {
      if (!latest.current) setError(friendlyError(err));
      return;
    }
    const s = data as S;
    latest.current = s;
    setError(null);
    setState(s);
    setOffsetMs(new Date(s.server_now).getTime() - (sentAt + (Date.now() - sentAt) / 2));
  }, [stateFn]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const loop = async () => {
      if (!document.hidden) await refetch();
      if (alive) timer = window.setTimeout(() => void loop(), pollRef.current(latest.current));
    };
    void loop();

    let debounce: number | undefined;
    const channel = supabase.channel(`room:${stateFn}`);
    for (const table of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => void refetch(), 60);
      });
    }
    channel.subscribe();
    const onVisible = () => {
      if (!document.hidden) void refetch();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(debounce);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
      useWallet.getState().setDisplayBalance(null);
      void useWallet.getState().fetchStatus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch, stateFn, tables.join(',')]);

  /** Calls an RPC, then refetches the room. Returns [result, null] or [null, friendly error]. */
  const call = useCallback(
    async <T,>(fn: string, args: Record<string, unknown> = {}): Promise<[T, null] | [null, string]> => {
      const { data, error: err } = await supabase.rpc(fn, args);
      void refetch();
      if (err) return [null, friendlyError(err)];
      return [data as T, null];
    },
    [refetch],
  );

  return { state, error, offsetMs, refetch, call };
}
