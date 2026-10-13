import { create } from 'zustand';
import { supabase } from '@/lib/supabase';

/** What the server says about your own account (15_moderation.sql: my_account). */
export interface Account {
  server_now: string;
  admin: boolean;
  banned: boolean;
  ban_reason: string | null;
  timeout_until: string | null;
  timeout_reason: string | null;
  must_rename: boolean;
  /** Two-step verification is switched on. (Missing until 15_moderation.sql is current.) */
  two_step?: boolean;
  /** This session entered a code from an email (sign-up, password reset or the two-step code). */
  verified?: boolean;
  /** Two-step verification is on and this session has only the password: a code is owed. */
  verify_required?: boolean;
  blocked: { user_id: string; username: string }[];
  /** An announcement from the admin, shown to everyone. */
  notice: string | null;
}

interface AccountState {
  account: Account | null;
  /** True once the first answer (or failure) is in, so pages can tell "not admin" from "not known yet". */
  loaded: boolean;
  /** Goes up when the session becomes a verified one, so what failed to load before is loaded again. */
  epoch: number;
  bump: () => void;
  fetch: () => Promise<void>;
  connect: (userId: string) => () => void;
  reset: () => void;
}

export const useAccount = create<AccountState>()((set, get) => ({
  account: null,
  loaded: false,
  epoch: 0,
  bump: () => set((s) => ({ epoch: s.epoch + 1 })),
  fetch: async () => {
    const { data, error } = await supabase.rpc('my_account');
    // Before 15_moderation.sql is run there is no such function: carry on with nothing to enforce.
    if (error) set({ loaded: true });
    else set({ account: data as Account, loaded: true });
  },
  connect: (userId) => {
    void get().fetch();
    const id = window.setInterval(() => void get().fetch(), 60_000);
    const onVisible = () => document.visibilityState === 'visible' && void get().fetch();
    document.addEventListener('visibilitychange', onVisible);
    const ch = supabase
      .channel(`account:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_sanctions', filter: `user_id=eq.${userId}` }, () => void get().fetch())
      .subscribe();
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(ch);
    };
  },
  reset: () => set({ account: null, loaded: false }),
}));

/** Have you blocked this player? */
export const isBlocked = (userId: string | undefined) => Boolean(userId && useAccount.getState().account?.blocked.some((b) => b.user_id === userId));
