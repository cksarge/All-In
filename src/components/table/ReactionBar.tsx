import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EMOTES, QUICK_PHRASES } from '@/lib/blackjack';
import { playSound } from '@/lib/sound';
import { cn } from '@/components/ui/cn';

/** Quick chat: preset phrases and emotes only (no free text, by design). */
export function ReactionBar({ onSend }: { onSend: (kind: 'phrase' | 'emote', index: number) => boolean }) {
  const [open, setOpen] = useState(false);
  const send = (kind: 'phrase' | 'emote', i: number) => {
    if (onSend(kind, i)) {
      playSound('pop');
      setOpen(false);
    }
  };
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
            className="surface absolute bottom-12 left-0 z-30 w-72 border-white/10 bg-ink-800 p-3"
            role="dialog"
            aria-label="Quick chat"
          >
            <div className="grid grid-cols-4 gap-1.5">
              {EMOTES.map((e, i) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => send('emote', i)}
                  className="rounded-lg py-1.5 text-2xl transition hover:bg-white/[0.08]"
                  aria-label={`Send emote ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {QUICK_PHRASES.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => send('phrase', i)}
                  className={cn('rounded-lg border border-white/10 px-2 py-1.5 text-xs text-cream transition hover:border-gold-500/50 hover:bg-gold-500/10')}
                >
                  {p}
                </button>
              ))}
            </div>
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
        'pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-gold-500/40 bg-ink-900/95 shadow-lg',
        kind === 'emote' ? 'px-2 py-0.5 text-2xl' : 'px-3 py-1 text-xs font-semibold text-ivory',
      )}
      role="status"
    >
      {kind === 'emote' ? EMOTES[index] : QUICK_PHRASES[index]}
    </motion.div>
  );
}
