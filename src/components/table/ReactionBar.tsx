import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EMOTES, QUICK_PHRASES } from '@/lib/blackjack';
import { phraseGroups, type ChatContext } from '@/lib/chat';
import { playSound } from '@/lib/sound';
import { ChatBox } from '@/components/chat/ChatBox';
import { cn } from '@/components/ui/cn';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/stores/authStore';
import { useReputation } from '@/stores/reputationStore';

/**
 * The Chat button at a table. Typed chat (when the table has a `channel`) and quick chat:
 * preset phrases and emotes. `game` picks which phrases lead.
 */
export function ReactionBar({ onSend, game = 'blackjack', channel }: { onSend: (kind: 'phrase' | 'emote', index: number) => boolean; game?: ChatContext; channel?: string }) {
  const [open, setOpen] = useState(false);
  const groups = phraseGroups(game);
  const [tab, setTab] = useState<string>(channel ? 'type' : groups[0].key);
  const userId = useAuth((s) => s.user?.id);
  const canQuick = useReputation((s) => s.rep?.can_quick !== false);
  const chat = useChat(channel ?? null, open && tab === 'type');
  // While the panel is shut, the newest message from someone else shows beside the button for a few seconds.
  const [peek, setPeek] = useState<{ id: number; text: string } | null>(null);
  const newest = chat.messages[chat.messages.length - 1];
  const seen = useRef(0);
  useEffect(() => {
    if (!newest || newest.id <= seen.current) return;
    seen.current = newest.id;
    // (What was already there when you sat down is not counted as unread, so it does not pop up.)
    if (chat.unread === 0 || open || newest.user_id === userId) return;
    setPeek({ id: newest.id, text: `${newest.username}: ${newest.body}` });
    const t = window.setTimeout(() => setPeek((p) => (p?.id === newest.id ? null : p)), 5000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newest?.id]);
  const send = (kind: 'phrase' | 'emote', i: number) => {
    if (onSend(kind, i)) {
      playSound('pop');
      setOpen(false);
    }
  };
  const current = groups.find((g) => g.key === tab);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={chat.unread > 0 ? `Chat, ${chat.unread} new` : 'Chat'}
        className="relative flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 px-3 text-sm text-cream/85 transition hover:border-white/25"
      >
        <span aria-hidden="true">💬</span>
        <span className="hidden sm:inline">Chat</span>
        {chat.unread > 0 && !open && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-ruby-500 px-1 text-[0.65rem] font-bold text-ivory" aria-hidden="true">
            {chat.unread > 9 ? '9+' : chat.unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {peek && !open && (
          <motion.p
            key={peek.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute bottom-12 left-0 z-30 w-max max-w-[min(18rem,calc(100vw-1.5rem))] truncate rounded-xl border border-white/10 bg-ink-800 px-3 py-1.5 text-xs text-cream shadow-lg"
          >
            {peek.text}
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            className="surface absolute bottom-12 left-0 z-30 w-[min(20rem,calc(100vw-1.5rem))] border-white/10 bg-ink-800 p-3"
            role="dialog"
            aria-label="Chat"
          >
            <div role="tablist" aria-label="Kind of message" className="flex flex-wrap gap-1">
              {[...(channel ? [{ key: 'type', label: 'Type' }] : []), ...groups, { key: 'emotes', label: 'Emotes' }].map((g) => (
                <button
                  key={g.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === g.key}
                  onClick={() => setTab(g.key)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition',
                    tab === g.key ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:border-white/25',
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
            {tab === 'type' ? (
              <ChatBox chat={chat} className="mt-2" listClassName="h-44" writeHint="Take a seat to chat here." />
            ) : !canQuick ? (
              <p className="mt-2 rounded-lg border border-ruby-500/30 bg-ruby-900/20 p-2 text-xs text-cream/85">Quick chat is switched off for you at the moment. Your profile says why.</p>
            ) : current ? (
              <div className="mt-2 grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto overscroll-contain pr-0.5">
                {current.items.map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => send('phrase', i)}
                    className="rounded-lg border border-white/10 px-2 py-1.5 text-xs text-cream transition hover:border-gold-500/50 hover:bg-gold-500/10"
                  >
                    {QUICK_PHRASES[i]}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {EMOTES.map((e, i) => (
                  <button key={e} type="button" onClick={() => send('emote', i)} className="rounded-lg py-1.5 text-2xl transition hover:bg-white/[0.08]" aria-label={`Send emote ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ReactionBubble({ kind, index }: { kind: 'phrase' | 'emote'; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.8 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.9 }}
      className={cn(
        'pointer-events-none absolute -top-9 left-1/2 z-20 max-w-[14rem] -translate-x-1/2 truncate whitespace-nowrap rounded-full border border-gold-500/40 bg-ink-900/95 shadow-lg',
        kind === 'emote' ? 'px-2 py-0.5 text-2xl' : 'px-3 py-1 text-xs font-semibold text-ivory',
      )}
      role="status"
    >
      {kind === 'emote' ? EMOTES[index] : QUICK_PHRASES[index]}
    </motion.div>
  );
}
