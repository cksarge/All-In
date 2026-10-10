import type { PkAction, PkState } from '@/lib/poker';
import { useLiveTable } from './useLiveTable';

/** Live poker table (see useLiveTable for the realtime/heartbeat/timer plumbing). */
export function usePokerTable(tableId: string) {
  const t = useLiveTable<PkState>({
    tableId,
    stateFn: 'pk_state',
    advanceFn: 'pk_advance',
    realtimeTables: ['pk_hands', 'pk_players'],
    // Turn, draw and next-hand timers all need the server: it acts for players
    // who timed out and deals the next hand.
    getDeadline: (s) => ({ at: s.hand?.phase_ends_at, advance: Boolean(s.hand) }),
  });
  const { call } = t;
  return {
    ...t,
    act: (action: PkAction, amount?: number) => call('pk_action', { p_action: action, p_amount: amount ?? null }),
    draw: (cards: number[]) => call('pk_draw', { p_discards: cards }),
    bringChips: (amount: number) => call('pk_bring_chips', { p_amount: amount }),
    advance: () => call('pk_advance'),
  };
}
