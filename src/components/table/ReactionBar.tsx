import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EMOTES, QUICK_PHRASES } from '@/lib/blackjack';
import { phraseGroups, type ChatContext } from '@/lib/chat';
import { playSound } from '@/lib/sound';
import { cn } from '@/components/ui/cn';

/** Quick chat: preset phrases and emotes only (no free text, by design). `game` picks which phrases lead. */
export function ReactionBar({ onSend, game = 'blackjack' }: { onSend: (kind: 'phrase' | 'emote', index: number) => boolean; game?: ChatContext }) {
  const [open, setOpen] = useState(false);
  const groups = phraseGroups(game);
  const [tab, setTab] = useState<string>(groups[0].key);
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
        aria-label="Quick chat and emotes"
        className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 px-3 text-sm text-cream/85 transition hover:border-white/25"
      >
        <span aria-hidden="true">💬</span>
        <span className="hidden sm:inline">Chat</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            className="surface absolute bottom-12 left-0 z-30 w-[min(20rem,calc(100vw-1.5rem))] border-white/10 bg-ink-800 p-3"
            role="dialog"
            aria-label="Quick chat"
          >
            <div role="tablist" aria-label="Kind of message" className="flex flex-wrap gap-1">
              {[...groups, { key: 'emotes', label: 'Emotes' }].map((g) => (
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
            {current ? (
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
