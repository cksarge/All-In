import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from './errors';
import { supabase } from './supabase';

/** Tournaments (14_tournaments.sql): Sit & Go poker, Slot Showdowns and the Daily Freeroll. */
export interface TourneyConfig {
  sng: {
    sizes: number[];
    entry_fees: number[];
    stack: number;
    level_seconds: number;
    /** [small blind, big blind] per level. */
    levels: number[][];
    /** Percent of the pool per place, by number of players. */
    payouts: Record<string, number[]>;
  };
  showdown: { round_seconds: number; spins: number; min_players: number; tiers: Record<string, number>; machines: string[] };
  freeroll: { spins: number; prizes: number[] };
}

export interface SngRow {
  size: number;
  entry_fee: number;
  prize_pool: number;
  /** The one that is filling up, if anyone is waiting. */
  id: string | null;
  players: string[];
  registered: boolean;
}

export interface Standing {
  user_id: string;
  username: string;
  score: number;
  spins_left: number;
  place: number;
  prize: number | null;
}

export interface Showdown {
  id: string;
  kind: 'showdown' | 'freeroll';
  status: 'running' | 'finished' | 'void';
  tier: string;
  entry_fee: number;
  machine: string;
  machine_name: string;
  starts_at: string;
  ends_at: string;
  entrants: number;
  prize_pool: number;
  top: Standing[];
  me: { score: number; spins_left: number; place: number; prize: number | null } | null;
  server_now?: string;
}

export interface TourneyResult {
  id: string;
  kind: 'sng' | 'showdown' | 'freeroll';
  status: 'finished' | 'void';
  entry_fee: number;
  size: number | null;
  tier: string | null;
  machine_name: string | null;
  place: number | null;
  prize: number | null;
  score: number;
  at: string;
  entrants: number;
}

export interface TourneyState {
  server_now: string;
  config: TourneyConfig;
  sng: SngRow[];
  my_sng: { id: string; status: 'registering' | 'running'; table_id: string | null; size: number; entry_fee: number } | null;
  live: { id: string; table_id: string; size: number; entry_fee: number; players_left: number }[];
  showdowns: Showdown[];
  results: TourneyResult[];
}

export interface SngStatus {
  tournament_id: string;
  status: 'registering' | 'running' | 'finished' | 'void';
  size: number;
  entry_fee: number;
  prize_pool: number;
  prizes: number[];
  level: number | null;
  blinds: number[] | null;
  next_blinds: number[] | null;
  next_level_at: string | null;
  players_left: number;
  entries: { user_id: string; username: string; status: 'registered' | 'playing' | 'out'; place: number | null; prize: number | null }[];
  me: { status: 'registered' | 'playing' | 'out'; place: number | null; prize: number | null } | null;
}

export const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

export const sizeLabel = (size: number) => (size === 2 ? 'Heads-up' : `${size} players`);

export const SHOWDOWN_TIER_LABEL: Record<string, string> = { low: 'Low stakes', mid: 'Mid stakes', high: 'High stakes', free: 'Free entry' };

/** "4:07" or "3h 12m" until a moment (never negative). */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Polls an RPC that returns a snapshot with `server_now`, and refetches when the
 * tournament tables change. Returns the snapshot, the server clock offset and a reload.
 */
export function useTourneyFeed<T extends { server_now?: string }>(fn: string, args: Record<string, unknown>, everyMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const key = JSON.stringify(args);
  const busy = useRef(false);

  const load = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const sentAt = Date.now();
    const { data: d, error: err } = await supabase.rpc(fn, JSON.parse(key) as Record<string, unknown>);
    busy.current = false;
    if (err) {
      setError(friendlyError(err));
      return;
    }
    const snap = d as T;
    if (snap?.server_now) setOffsetMs(new Date(snap.server_now).getTime() - (sentAt + (Date.now() - sentAt) / 2));
    setError(null);
    setData(snap);
  }, [fn, key]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), everyMs);
    let timer: number | undefined;
    const soon = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 150);
    };
    const onVisible = () => document.visibilityState === 'visible' && soon();
    document.addEventListener('visibilitychange', onVisible);
    const ch = supabase
      .channel(`tourney:${fn}:${key}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_entries' }, soon)
      .subscribe();
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(ch);
    };
  }, [load, everyMs, fn, key]);

  return { data, error, offsetMs, load };
}
