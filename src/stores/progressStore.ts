import { create } from 'zustand';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { friendlyError } from '@/lib/errors';
import { FELTS, type Achievement, type Cosmetic, type Loadout, type MyProgress, registerLooks } from '@/lib/progress';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { toast } from './toastStore';
import { useWallet } from './walletStore';

interface Look {
  loadout: Loadout;
  level: number;
}

interface ProgressState {
  /** Your own progress; null until loaded (or if 13_progression.sql hasn't been run). */
  me: MyProgress | null;
  cosmetics: Cosmetic[];
  achievements: Achievement[];
  /** Other players' looks, by user id (the avatars around a table). */
  looks: Record<string, Look>;
  claiming: boolean;
  fetch: () => Promise<void>;
  fetchCatalogue: (force?: boolean) => Promise<void>;
  claim: () => Promise<void>;
  equip: (key: string) => Promise<string | null>;
  /** Ask for a player's look; several asks in the same moment become one request. */
  wantLook: (userId: string) => void;
  connect: (userId: string) => () => void;
  reset: () => void;
}

let channel: RealtimeChannel | null = null;
let refetchTimer: number | undefined;
let lookTimer: number | undefined;
const wanted = new Set<string>();
const asked = new Set<string>();

/** The felt colour is a pair of CSS variables on <html>, read by the .felt class. */
function applyFelt(key: string | undefined) {
  const felt = FELTS[key ?? 'felt_classic'] ?? FELTS.felt_classic;
  document.documentElement.style.setProperty('--felt-base', felt.base);
  document.documentElement.style.setProperty('--felt-glow', felt.glow);
}

export const useProgress = create<ProgressState>()((set, get) => ({
  me: null,
  cosmetics: [],
  achievements: [],
  looks: {},
  claiming: false,

  fetch: async () => {
    const { data, error } = await supabase.rpc('my_progress');
    if (error || !data) return; // quietly: the rest of the app works without it
    const next = data as MyProgress;
    const prev = get().me;
    set({ me: next });
    applyFelt(next.loadout.felt);
    if (!prev) return;
    // Say so when something new has been earned since the last look.
    const known = new Set(prev.achievements.map((a) => a.key));
    const fresh = next.achievements.filter((a) => !known.has(a.key));
    if (fresh.length > 0) {
      const names = fresh.map((a) => get().achievements.find((x) => x.key === a.key)?.name ?? 'Achievement');
      playSound('achievement');
      toast.success(
        fresh.length === 1 ? `Achievement unlocked: ${names[0]}` : `${fresh.length} achievements unlocked`,
        fresh.length === 1 ? 'See it on your profile.' : names.join(', '),
      );
    }
    if (next.level > prev.level) {
      playSound('levelup');
      toast.success(`Level ${next.level}!`, 'New rewards are waiting in the lounge.');
    }
    if (next.friend_requests > prev.friend_requests) toast.info('New friend request', 'Answer it on the Friends page.');
  },

  fetchCatalogue: async (force = false) => {
    if (get().achievements.length > 0 && !force) return;
    const [first, a] = await Promise.all([
      supabase.from('cosmetics').select('key, kind, name, unlock_level, sort_order, season, look').order('sort_order'),
      supabase.from('achievements').select('key, name, description, category, metric, goal, reward_chips, reward_xp, cosmetic_key, sort_order').order('sort_order'),
    ]);
    // Before 16_missions_seasons.sql is run the two newer columns don't exist yet.
    const c = first.error ? await supabase.from('cosmetics').select('key, kind, name, unlock_level, sort_order').order('sort_order') : first;
    if (c.error || a.error) return;
    registerLooks((c.data ?? []) as Cosmetic[]);
    set({ cosmetics: (c.data ?? []) as Cosmetic[], achievements: (a.data ?? []) as Achievement[] });
  },

  claim: async () => {
    if (get().claiming) return;
    set({ claiming: true });
    const { data, error } = await supabase.rpc('claim_rewards');
    set({ claiming: false });
    if (error) {
      playSound('error');
      toast.error(friendlyError(error));
    } else {
      const amount = (data as { amount: number }).amount;
      playSound('coins');
      toast.success('Rewards collected', `${amount.toLocaleString('en-US')} chips added.`);
      void useWallet.getState().fetchStatus();
    }
    await get().fetch();
  },

  equip: async (key) => {
    const { data, error } = await supabase.rpc('equip_cosmetic', { p_key: key });
    if (error) return friendlyError(error);
    const me = get().me;
    const loadout = data as Loadout;
    if (me) set({ me: { ...me, loadout } });
    applyFelt(loadout.felt);
    return null;
  },

  wantLook: (userId) => {
    if (asked.has(userId)) return;
    asked.add(userId);
    wanted.add(userId);
    window.clearTimeout(lookTimer);
    lookTimer = window.setTimeout(async () => {
      const ids = [...wanted];
      wanted.clear();
      const { data, error } = await supabase.rpc('loadouts_for', { p_users: ids });
      if (error || !data) return ids.forEach((id) => asked.delete(id));
      const map = data as Record<string, Loadout & { level: number }>;
      set((s) => ({
        looks: { ...s.looks, ...Object.fromEntries(Object.entries(map).map(([id, v]) => [id, { loadout: v, level: v.level }])) },
      }));
    }, 40);
  },

  connect: (userId) => {
    void get().fetchCatalogue().then(() => get().fetch());
    const schedule = () => {
      window.clearTimeout(refetchTimer);
      refetchTimer = window.setTimeout(() => void get().fetch(), 600);
    };
    if (channel) void supabase.removeChannel(channel);
    channel = supabase
      .channel(`progress:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'player_progress', filter: `user_id=eq.${userId}` }, schedule)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'player_achievements', filter: `user_id=eq.${userId}` }, schedule)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, schedule)
      .subscribe();
    const onVisible = () => {
      if (!document.hidden) schedule();
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(() => {
      if (!document.hidden) void get().fetch();
    }, 45_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(interval);
      window.clearTimeout(refetchTimer);
      if (channel) void supabase.removeChannel(channel);
      channel = null;
    };
  },

  reset: () => {
    asked.clear();
    wanted.clear();
    applyFelt(undefined);
    set({ me: null, looks: {} });
  },
}));

/** A player's equipped look, fetched once and shared. Your own is always current. */
export function useLook(userId: string | undefined, isMe = false): Look | undefined {
  const mine = useProgress((s) => s.me);
  const look = useProgress((s) => (userId ? s.looks[userId] : undefined));
  const want = useProgress((s) => s.wantLook);
  if (userId && !isMe && !look) queueMicrotask(() => want(userId));
  if (isMe && mine) return { loadout: mine.loadout, level: mine.level };
  return look;
}
