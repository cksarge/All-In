import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import type { EconomyStatus, LedgerEntry } from '@/lib/types';

interface ClaimResult {
  amount: number;
  balance: number;
  streak?: number;
  multiplier?: number;
}

interface WalletState {
  status: EconomyStatus | null;
  loading: boolean;
  error: string | null;
  /** serverTime ≈ Date.now() + clockOffsetMs */
  clockOffsetMs: number;
  ledger: LedgerEntry[];
  ledgerLoading: boolean;
  ledgerError: string | null;
  claiming: 'daily' | 'refill' | null;
  fetchStatus: () => Promise<void>;
  fetchLedger: () => Promise<void>;
  claimDaily: () => Promise<{ ok: true; result: ClaimResult } | { ok: false; error: string }>;
  claimRefill: () => Promise<{ ok: true; result: ClaimResult } | { ok: false; error: string }>;
  connect: (userId: string) => () => void;
  reset: () => void;
}

const LEDGER_LIMIT = 25;
let channel: RealtimeChannel | null = null;
let refetchTimer: number | undefined;

export const useWallet = create<WalletState>()((set, get) => ({
  status: null,
  loading: false,
  error: null,
  clockOffsetMs: 0,
  ledger: [],
  ledgerLoading: false,
  ledgerError: null,
  claiming: null,

  fetchStatus: async () => {
    set({ loading: get().status === null, error: null });
    const sentAt = Date.now();
    const { data, error } = await supabase.rpc('get_economy_status');
    if (error) {
      set({ loading: false, error: friendlyError(error) });
      return;
    }
    const status = data as EconomyStatus;
    const rtt = Date.now() - sentAt;
    set({
      status,
      loading: false,
      clockOffsetMs: new Date(status.server_now).getTime() - (sentAt + rtt / 2),
    });
  },

  fetchLedger: async () => {
    set({ ledgerLoading: true, ledgerError: null });
    const { data, error } = await supabase
      .from('chip_ledger')
      .select('id, delta, balance_after, reason, game, metadata, created_at')
      .order('id', { ascending: false })
      .limit(LEDGER_LIMIT);
    if (error) set({ ledgerLoading: false, ledgerError: friendlyError(error) });
    else set({ ledger: (data ?? []) as LedgerEntry[], ledgerLoading: false });
  },

  claimDaily: async () => {
    if (get().claiming) return { ok: false, error: 'Already working on it…' };
    set({ claiming: 'daily' });
    const { data, error } = await supabase.rpc('claim_daily_bonus');
    set({ claiming: null });
    if (error) {
      void get().fetchStatus();
      return { ok: false, error: friendlyError(error) };
    }
    await get().fetchStatus();
    return { ok: true, result: data as ClaimResult };
  },

  claimRefill: async () => {
    if (get().claiming) return { ok: false, error: 'Already working on it…' };
    set({ claiming: 'refill' });
    const { data, error } = await supabase.rpc('claim_refill');
    set({ claiming: null });
    if (error) {
      void get().fetchStatus();
      return { ok: false, error: friendlyError(error) };
    }
    await get().fetchStatus();
    return { ok: true, result: data as ClaimResult };
  },

  connect: (userId: string) => {
    void get().fetchStatus();
    void get().fetchLedger();

    const scheduleRefetch = () => {
      window.clearTimeout(refetchTimer);
      refetchTimer = window.setTimeout(() => void get().fetchStatus(), 250);
    };

    if (channel) void supabase.removeChannel(channel);
    channel = supabase
      .channel(`wallet:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wallets', filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { balance?: number; peak_balance?: number } | null;
          const status = get().status;
          if (status && row && typeof row.balance === 'number') {
            set({ status: { ...status, balance: row.balance, peak_balance: row.peak_balance ?? status.peak_balance } });
          }
          scheduleRefetch();
        },
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chip_ledger', filter: `user_id=eq.${userId}` },
        (payload) => {
          const entry = payload.new as LedgerEntry;
          set((s) =>
            s.ledger.some((e) => e.id === entry.id)
              ? s
              : { ledger: [entry, ...s.ledger].slice(0, LEDGER_LIMIT) },
          );
        },
      )
      .subscribe((state) => {
        // After a reconnect, re-sync anything we may have missed.
        if (state === 'SUBSCRIBED') scheduleRefetch();
      });

    const onVisible = () => {
      if (document.visibilityState === 'visible') scheduleRefetch();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  },

  reset: () => set({ status: null, ledger: [], error: null, ledgerError: null, loading: false }),
}));

export const serverNow = () => Date.now() + useWallet.getState().clockOffsetMs;
