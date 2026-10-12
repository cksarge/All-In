import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

/** Your own standing (22_reputation_chat.sql: my_reputation). Only you and the admin can see it. */
export interface Reputation {
  score: number;
  /** Typed chat is allowed (reputation above the limit and no ban from a moderator). */
  can_chat: boolean;
  /** Quick chat (preset phrases and emotes) is allowed. */
  can_quick: boolean;
  chat_banned_until: string | null;
  quick_banned_until: string | null;
  /** Why a moderator switched it off, if they said. */
  chat_ban_reason?: string | null;
  quick_ban_reason?: string | null;
  /** Clean messages since the last point earned. */
  clean_count: number;
  gained_today: number;
  config: {
    start: number;
    chat_off: number;
    quick_off: number;
    gain_every: number;
    gain_cap: number;
    recover: number;
    recover_to: number;
    filter_penalty: number;
    gap_seconds: number;
    max_length: number;
    keep_days: number;
    tiers: number[];
  };
  log: { delta: number; score: number; reason: string; note: string | null; at: string }[];
}

interface ReputationState {
  rep: Reputation | null;
  fetch: () => Promise<void>;
  /** After sending a message the server says where you stand: no need to ask again. */
  patch: (p: Partial<Pick<Reputation, 'score' | 'can_chat'>>) => void;
  connect: (userId: string) => () => void;
  reset: () => void;
}

export const useReputation = create<ReputationState>()((set, get) => ({
  rep: null,
  fetch: async () => {
    const { data, error } = await supabase.rpc('my_reputation');
    // Before 22_reputation_chat.sql is run there is no such function: nothing is restricted.
    if (!error) set({ rep: data as Reputation });
  },
  patch: (p) => set((s) => (s.rep ? { rep: { ...s.rep, ...p } } : s)),
  connect: (userId) => {
    void get().fetch();
    const id = window.setInterval(() => void get().fetch(), 60_000);
    const onVisible = () => document.visibilityState === 'visible' && void get().fetch();
    document.addEventListener('visibilitychange', onVisible);
    const ch = supabase
      .channel(`reputation:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_reputation', filter: `user_id=eq.${userId}` }, () => void get().fetch())
      .subscribe();
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(ch);
    };
  },
  reset: () => set({ rep: null }),
}));

/** May you use quick chat right now? (True until the server has said otherwise.) */
export const canQuickChat = () => useReputation.getState().rep?.can_quick !== false;

/** Seconds every player must leave between two chat messages, typed or quick. It cannot be switched off. */
export const CHAT_GAP_MS = 3000;

/** What each entry in your reputation history means. */
export const REPUTATION_REASONS: Record<string, string> = {
  chat_clean: 'Chatting well',
  recovery: 'A day of play',
  chat_warning: 'Warning from the chat filter',
  chat_swear: 'Swearing in chat',
  chat_spam: 'Spamming the chat',
  chat_promo: 'Advertising in chat',
  warning: 'Warning from a moderator',
  rename: 'A moderator removed your username',
  timeout_short: 'Timeout',
  timeout_day: 'Timeout of a day or more',
  timeout_long: 'Timeout of a week or more',
  ban: 'Account banned',
  false_report: 'A report you made was judged false',
  admin_adjust: 'Changed by a moderator',
};
