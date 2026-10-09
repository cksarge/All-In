import { AnimatePresence, motion } from 'framer-motion';
import { useToasts } from '@/stores/toastStore';
import { cn } from './cn';

const tone = {
  success: 'border-felt-400/50 before:bg-felt-400',
  error: 'border-ruby-400/50 before:bg-ruby-400',
  info: 'border-gold-500/40 before:bg-gold-400',
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-16 z-[60] flex flex-col items-center gap-2 p-4 sm:top-20 sm:items-end"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className={cn(
              'pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-xl border bg-ink-800/95 py-3 pl-5 pr-10 shadow-2xl backdrop-blur',
              "before:absolute before:inset-y-0 before:left-0 before:w-1 before:content-['']",
              tone[t.tone],
            )}
            role={t.tone === 'error' ? 'alert' : 'status'}
          >
            <p className="text-sm font-semibold text-ivory">{t.title}</p>
            {t.body && <p className="mt-0.5 text-sm text-cream/80">{t.body}</p>}
            <button
              onClick={() => dismiss(t.id)}
              className="absolute right-2 top-2 rounded-md p-1 text-muted hover:text-ivory"
              aria-label="Dismiss notification"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
