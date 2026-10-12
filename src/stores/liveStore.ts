import { create } from 'zustand';
import { inboxText, type InboxItem, type MissionsState } from '@/lib/live';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { useProgress } from './progressStore';
import { toast } from './toastStore';

interface LiveState {
  missions: MissionsState | null;
  inbox: InboxItem[];
  unread: number;
  /** Server clock minus this device's clock, for the countdowns. */
  offsetMs: number;
  fetchMissions: () => Promise<void>;
  fetchInbox: () => Promise<void>;
  markRead: (ids?: number[]) => Promise<void>;
  clearInbox: (id?: number) => Promise<void>;
  connect: (userId: string) => () => void;
  reset: () => void;
}

/** The newest notification id already seen in this session (null until the first load). */
let seenTop: number | null = null;

/** Missions, the season and the inbox, kept fresh while signed in. */
export const useLive = create<LiveState>()((set, get) => ({
  missions: null,
  inbox: [],
  unread: 0,
  offsetMs: 0,

  fetchMissions: async () => {
    const sentAt = Date.now();
    const { data, error } = await supabase.rpc('missions_state');
    if (error) return; // e.g. before 16_missions_seasons.sql is run: no missions to show
    const next = data as MissionsState;
    const prev = get().missions;
    if (prev) {
      const was = new Set(prev.missions.filter((m) => m.done).map((m) => `${m.period}-${m.key}`));
      const fresh = next.missions.filter((m) => m.done && !was.has(`${m.period}-${m.key}`));
      if (fresh.length > 0 && prev.missions.some((m) => fresh.some((f) => f.key === m.key && f.period === m.period))) {
        playSound('achievement');
        toast.action(fresh.length === 1 ? 'Mission complete' : `${fresh.length} missions complete`, 'Your reward is waiting.', { label: 'Collect', to: '/missions' });
      }
    }
    // A season's cosmetics appear in the catalogue the moment the season opens: pick them up.
    const known = new Set(useProgress.getState().cosmetics.map((c) => c.key));
    if (next.season?.tiers.some((t) => t.reward && !known.has(t.reward.key))) void useProgress.getState().fetchCatalogue(true);
    set({ missions: next, offsetMs: new Date(next.server_now).getTime() - (sentAt + (Date.now() - sentAt) / 2) });
  },

  fetchInbox: async () => {
    const { data, error } = await supabase.rpc('inbox');
    if (error) return;
    const next = data as { unread: number; items: InboxItem[] };
    // Worth interrupting for: an invite that arrived since the last look (never the backlog at sign-in).
    if (seenTop !== null) {
      for (const n of next.items.filter((i) => i.id > (seenTop as number) && i.kind === 'table_invite')) {
        const t = inboxText(n);
        playSound('turn');
        if (t.to) toast.action(t.title, t.body ?? '', { label: t.action ?? 'Open', to: t.to });
      }
    }
    seenTop = next.items[0]?.id ?? 0;
    set({ inbox: next.items, unread: next.unread });
  },

  markRead: async (ids) => {
    set((s) => ({
      inbox: s.inbox.map((i) => (!ids || ids.includes(i.id) ? { ...i, read: true } : i)),
      unread: ids ? Math.max(0, s.unread - s.inbox.filter((i) => ids.includes(i.id) && !i.read).length) : 0,
    }));
    await supabase.rpc('inbox_read', { p_ids: ids ?? null });
  },

  clearInbox: async (id) => {
    set((s) => {
      const inbox = id === undefined ? [] : s.inbox.filter((i) => i.id !== id);
      return { inbox, unread: inbox.filter((i) => !i.read).length };
    });
    await supabase.rpc('inbox_clear', { p_id: id ?? null });
  },

  connect: (userId) => {
    void get().fetchInbox().then(() => get().fetchMissions());
    let timer: number | undefined;
    const soon = (what: 'inbox' | 'missions') => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void (what === 'inbox' ? get().fetchInbox() : get().fetchMissions()), 400);
    };
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void get().fetchInbox();
      void get().fetchMissions();
    }, 60_000);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      void get().fetchInbox();
      void get().fetchMissions();
    };
    document.addEventListener('visibilitychange', onVisible);
    const ch = supabase
      .channel(`live:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, () => soon('inbox'))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'player_missions', filter: `user_id=eq.${userId}` }, () => soon('missions'))
      .subscribe();
    return () => {
      window.clearInterval(id);
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(ch);
    };
  },

  reset: () => {
    seenTop = null;
    set({ missions: null, inbox: [], unread: 0 });
  },
}));
