import type { BjAction, BjState } from '@/lib/blackjack';
import { useLiveTable } from './useLiveTable';

export type { Reaction } from './useLiveTable';

/** Live blackjack table (see useLiveTable for the realtime/heartbeat/timer plumbing). */
export function useBlackjackTable(tableId: string) {
  const t = useLiveTable<BjState>({
    tableId,
    stateFn: 'bj_state',
    advanceFn: 'bj_advance',
    realtimeTables: ['bj_rounds', 'bj_hands'],
    getDeadline: (s) => ({
      at: s.round?.phase_ends_at,
      // Betting, insurance and turn timers need the server; the results pause just needs a refresh.
      advance: Boolean(s.round && s.round.phase !== 'settled'),
    }),
  });
  const { call } = t;
  return {
    ...t,
    placeBet: (amount: number) => call('bj_place_bet', { p_amount: amount }),
    clearBet: () => call('bj_clear_bet'),
    dealNow: () => call('bj_deal_now'),
    insurance: (take: boolean) => call('bj_insurance', { p_take: take }),
    act: (action: BjAction) => call('bj_action', { p_action: action }),
  };
}
