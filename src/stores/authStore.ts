import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import { friendlyError } from '@/lib/errors';
import type { Profile } from '@/lib/types';

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  profileLoading: boolean;
  profileError: string | null;
  init: () => () => void;
  loadProfile: () => Promise<void>;
  markOnboarded: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuth = create<AuthState>()((set, get) => ({
  status: 'loading',
  session: null,
  user: null,
  profile: null,
  profileLoading: false,
  profileError: null,

  init: () => {
    if (!supabaseConfigured) {
      set({ status: 'signedOut' });
      return () => {};
    }

    const apply = (session: Session | null) => {
      const prevUserId = get().user?.id;
      const user = session?.user ?? null;
      set({ session, user, status: user ? 'signedIn' : 'signedOut' });
      if (!user) {
        set({ profile: null, profileError: null });
      } else if (user.id !== prevUserId) {
        // Never await Supabase calls inside the auth callback (it can deadlock).
        window.setTimeout(() => void get().loadProfile(), 0);
      }
    };

    supabase.auth
      .getSession()
      .then(({ data }) => apply(data.session))
      .catch(() => set({ status: 'signedOut' }));

    const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => data.subscription.unsubscribe();
  },

  loadProfile: async () => {
    const uid = get().user?.id;
    if (!uid) return;
    set({ profileLoading: true, profileError: null });
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, created_at, onboarded_at')
      .eq('id', uid)
      .maybeSingle();
    if (error) {
      set({ profileLoading: false, profileError: friendlyError(error) });
    } else if (!data) {
      set({
        profileLoading: false,
        profileError: 'Your player profile is missing. (Admin: run supabase/sql/02_economy.sql to backfill.)',
      });
    } else {
      set({ profile: data as Profile, profileLoading: false });
    }
  },

  markOnboarded: async () => {
    const p = get().profile;
    if (p) set({ profile: { ...p, onboarded_at: new Date().toISOString() } });
    await supabase.rpc('complete_onboarding');
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null, status: 'signedOut' });
  },
}));
