import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/authStore';
import { pingDmInbox, useDm } from '@/stores/dmStore';
import { CHAT_GAP_MS, useReputation } from '@/stores/reputationStore';

export interface ChatMessage {
  id: number;
  user_id: string;
  username: string;
  body: string;
  at: string;
}

export interface ChatSent {
  message?: ChatMessage;
  /** Why the filter caught it: swear words are starred out and delivered, spam and advertising are not delivered. */
  caught?: 'swear' | 'spam' | 'promo';
  /** The one warning of the day: no points lost. */
  warned?: boolean;
  /** Reputation points lost. */
  penalty?: number;
  reputation: number;
  can_chat: boolean;
}

/**
 * Typed chat for one channel ("table:<id>", "club:<id>", "room:<game>", or "dm:<a friend's id>").
 * Every message comes from the server (chat_fetch): it decides who may read what, stars out
 * swear words and leaves out players you blocked. Realtime only carries a content-free
 * "something new" ping between browsers, and a slow poll covers a missed ping.
 * `active` = the chat is on screen (poll faster and count nothing as unread).
 */
export function useChat(channel: string | null, active: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [nextAt, setNextAt] = useState(0);
  const lastId = useRef(0);
  const ping = useRef<RealtimeChannel | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const first = useRef(true);
  const myId = useAuth((s) => s.user?.id);
  // A direct conversation is named by the other player, so each side names it differently:
  // the two browsers meet on a ping channel made from both ids.
  const dmWith = channel?.startsWith('dm:') ? channel.slice(3) : null;
  const pingName = dmWith && myId ? `chat:dm:${[myId, dmWith].sort().join('_')}` : `chat:${channel}`;

  const add = useCallback((list: ChatMessage[], countUnread: boolean) => {
    const fresh = list.filter((m) => m.id > lastId.current);
    if (!fresh.length) return;
    lastId.current = fresh[fresh.length - 1].id;
    setMessages((cur) => [...cur, ...fresh].slice(-80));
    if (countUnread && !activeRef.current) setUnread((n) => n + fresh.length);
  }, []);

  const fetch = useCallback(async () => {
    if (!channel) return;
    const { data, error: err } = await supabase.rpc('chat_fetch', { p_channel: channel, p_after: lastId.current });
    if (err) {
      setError(friendlyError(err));
      return;
    }
    const d = data as { can_write: boolean; messages: ChatMessage[] };
    setError(null);
    setCanWrite(d.can_write);
    // What was said before you arrived is history, not unread.
    add(d.messages, !first.current);
    first.current = false;
    // Reading a direct conversation clears its unread count on the server: show that at once.
    if (channel.startsWith('dm:')) void useDm.getState().fetch();
  }, [channel, add]);

  useEffect(() => {
    lastId.current = 0;
    first.current = true;
    setMessages([]);
    setUnread(0);
    setError(null);
    if (!channel) return;
    void fetch();
    const ch = supabase
      .channel(pingName)
      .on('broadcast', { event: 'new' }, () => void fetch())
      .subscribe();
    ping.current = ch;
    const onVisible = () => document.visibilityState === 'visible' && void fetch();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(ch);
      ping.current = null;
    };
  }, [channel, fetch, pingName]);

  useEffect(() => {
    if (!channel) return;
    const id = window.setInterval(() => !document.hidden && void fetch(), active ? 4000 : 12000);
    return () => window.clearInterval(id);
  }, [channel, active, fetch]);

  useEffect(() => {
    if (active) setUnread(0);
  }, [active, messages.length]);

  /** Sends a message. Returns [result, null] or [null, friendly error]. */
  const send = useCallback(
    async (text: string): Promise<[ChatSent, null] | [null, string]> => {
      if (!channel) return [null, 'There is no chat here.'];
      const { data, error: err } = await supabase.rpc('chat_send', { p_channel: channel, p_text: text });
      if (err) {
        void useReputation.getState().fetch();
        return [null, friendlyError(err)];
      }
      const res = data as ChatSent;
      setNextAt(Date.now() + CHAT_GAP_MS);
      if (res.message) add([res.message], false);
      useReputation.getState().patch({ score: res.reputation, can_chat: res.can_chat });
      if (res.caught) void useReputation.getState().fetch();
      // Tell the other browsers to look. The ping carries nothing: they ask the server.
      void ping.current?.send({ type: 'broadcast', event: 'new', payload: {} });
      // A friend who does not have the conversation open still hears about it.
      if (dmWith && res.message) pingDmInbox(dmWith);
      return [res, null];
    },
    [channel, add, dmWith],
  );

  const report = useCallback(async (id: number): Promise<string | null> => {
    const { error: err } = await supabase.rpc('chat_report', { p_message: id });
    return err ? friendlyError(err) : null;
  }, []);

  return { messages, canWrite, error, unread, nextAt, send, report, refetch: fetch };
}
