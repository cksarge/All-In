import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { toast } from '@/stores/toastStore';

/** One direct conversation with a friend (22_reputation_chat.sql: dm_threads). */
export interface DmThread {
  user_id: string;
  username: string;
  /** The newest message, as the other side sees it (swear words starred out). */
  last: string;
  mine: boolean;
  at: string;
  unread: number;
}

interface DmState {
  threads: DmThread[];
  unread: number;
  fetch: () => Promise<void>;
  connect: (userId: string) => () => void;
  reset: () => void;
}

/** Tells a friend's browser to look for new messages. The ping carries nothing: they ask the server. */
export function pingDmInbox(userId: string) {
  const ch = supabase.channel(`dm-inbox:${userId}`);
  ch.subscribe((status) => {
    if (status !== 'SUBSCRIBED') return;
    void ch.send({ type: 'broadcast', event: 'new', payload: {} }).then(() => supabase.removeChannel(ch));
  });
}

export const useDm = create<DmState>()((set, get) => ({
  threads: [],
  unread: 0,
  fetch: async () => {
    const { data, error } = await supabase.rpc('dm_threads');
    // Before the newer SQL is run there is no such function: no messages, that's all.
    if (error) return;
    const d = data as { threads: DmThread[]; unread: number };
    const before = get().unread;
    set({ threads: d.threads, unread: d.unread });
    if (d.unread > before) {
      const from = d.threads.find((t) => t.unread > 0 && !t.mine);
      if (from && !window.location.pathname.endsWith('/friends')) {
        toast.action(`New message from ${from.username}`, from.last, { label: 'Open', to: `/friends?dm=${from.user_id}` });
      }
    }
  },
  connect: (userId) => {
    void get().fetch();
    const id = window.setInterval(() => !document.hidden && void get().fetch(), 30_000);
    const onVisible = () => document.visibilityState === 'visible' && void get().fetch();
    document.addEventListener('visibilitychange', onVisible);
    const ch = supabase
      .channel(`dm-inbox:${userId}`)
      .on('broadcast', { event: 'new' }, () => void get().fetch())
      .subscribe();
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(ch);
    };
  },
  reset: () => set({ threads: [], unread: 0 }),
}));
