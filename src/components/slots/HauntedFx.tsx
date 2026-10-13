import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '@/components/ui/cn';

/**
 * Haunted Manor's scenery, drawn behind the reels: a moon, drifting fog, bats crossing
 * the cabinet and a cobweb. At midnight (the free spins) the night deepens and the moon
 * swells. Decoration only, and hidden from screen readers.
 */
export function HauntedBackdrop({ midnight }: { midnight: boolean }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-3xl">
      {/* The night sky deepening at midnight. */}
      <div
        className={cn('absolute inset-0 transition-opacity duration-1000', midnight ? 'opacity-100' : 'opacity-0')}
        style={{ background: 'radial-gradient(120% 90% at 85% 0%, rgba(120,90,255,0.35), rgba(8,4,24,0.75) 60%)' }}
      />
      {/* Stars */}
      {[
        [8, 9], [22, 5], [37, 12], [55, 6], [68, 14], [14, 20], [46, 3], [91, 22],
      ].map(([x, y], i) => (
        <span
          key={i}
          className="haunt-twinkle absolute h-[3px] w-[3px] rounded-full bg-white/80"
          style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.7}s` }}
        />
      ))}
      {/* The moon */}
      <div
        className="absolute right-[5%] top-[3%] rounded-full transition-all duration-1000"
        style={{
          width: midnight ? '5.5rem' : '3.5rem',
          height: midnight ? '5.5rem' : '3.5rem',
          background: 'radial-gradient(circle at 35% 35%, #fffbe6, #f2e3a6 55%, #b9a65c 100%)',
          boxShadow: midnight ? '0 0 60px 18px rgba(255,236,170,0.45)' : '0 0 28px 6px rgba(255,236,170,0.25)',
          opacity: midnight ? 0.95 : 0.6,
        }}
      >
        <span className="absolute left-[22%] top-[30%] h-[18%] w-[18%] rounded-full bg-black/10" />
        <span className="absolute left-[55%] top-[55%] h-[24%] w-[24%] rounded-full bg-black/10" />
        <span className="absolute left-[60%] top-[20%] h-[12%] w-[12%] rounded-full bg-black/10" />
      </div>
      {/* Bats */}
      {[
        { top: '7%', delay: '0s', dur: '13s', size: '1.1rem' },
        { top: '16%', delay: '4.5s', dur: '17s', size: '0.85rem' },
        { top: '3%', delay: '9s', dur: '11s', size: '1.35rem' },
        ...(midnight
          ? [
              { top: '11%', delay: '1.5s', dur: '8s', size: '1rem' },
              { top: '22%', delay: '3s', dur: '9.5s', size: '1.2rem' },
            ]
          : []),
      ].map((b, i) => (
        <span key={i} className="haunt-bat absolute" style={{ top: b.top, fontSize: b.size, animationDelay: b.delay, animationDuration: b.dur }}>
          <span className="haunt-flap inline-block">🦇</span>
        </span>
      ))}
      {/* A cobweb in the corner */}
      <svg viewBox="0 0 60 60" className="absolute left-0 top-0 h-16 w-16 opacity-30 sm:h-20 sm:w-20">
        <g fill="none" stroke="#e9e2ff" strokeWidth="0.7">
          <path d="M0 0L58 22M0 0L42 42M0 0L22 58M0 0L60 4M0 0L4 60" />
          <path d="M14 1q2 6-13 13M27 2q4 12-25 25M41 3q6 20-38 38M54 4q8 26-50 50" />
        </g>
      </svg>
      {/* Fog along the floor */}
      <div className="haunt-fog absolute -bottom-6 left-[-50%] h-28 w-[200%] opacity-60" />
      <div className="haunt-fog haunt-fog-slow absolute -bottom-10 left-[-50%] h-36 w-[200%] opacity-40" />
    </div>
  );
}

/** A flash of lightning over the whole cabinet. Change `n` to strike again. */
export function Lightning({ n }: { n: number }) {
  return (
    <AnimatePresence>
      {n > 0 && (
        <motion.div
          key={n}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-3xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.9, 0.15, 0.7, 0] }}
          transition={{ duration: 0.6, times: [0, 0.08, 0.25, 0.4, 1] }}
          style={{ background: 'radial-gradient(90% 70% at 50% 0%, rgba(255,255,255,0.95), rgba(190,170,255,0.5) 55%, rgba(120,90,255,0.15))' }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <path
              d="M58 0L44 34l9 2-13 30 8 2-10 32 26-40-9-2 15-26-9-2 11-30z"
              fill="#fff"
              stroke="#d9ccff"
              strokeWidth="0.6"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** The midnight multiplier: one candle per step, lit up to the multiplier in force. */
export function MultiplierMeter({ value, max }: { value: number; max: number }) {
  return (
    <div className="relative mx-auto mb-3 max-w-2xl rounded-xl border border-[#b78cff]/40 bg-ink-950/90 px-3 py-2" role="status" aria-label={`Midnight multiplier: times ${value}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="shrink-0 text-[0.65rem] font-semibold uppercase tracking-wider text-[#d9c8ff]">Midnight multiplier</span>
        <motion.span
          key={value}
          initial={{ scale: 1.9, color: '#ffffff' }}
          animate={{ scale: 1, color: '#ffb057' }}
          transition={{ type: 'spring', stiffness: 300, damping: 14 }}
          className="font-display text-2xl font-black leading-none"
          style={{ textShadow: '0 0 14px rgba(255,150,40,0.8)' }}
        >
          ×{value}
        </motion.span>
      </div>
      <div className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: `repeat(${max}, minmax(0, 1fr))` }} aria-hidden="true">
        {Array.from({ length: max }, (_, i) => {
          const lit = i < value;
          return (
            <div key={i} className="flex flex-col items-center">
              <span className={cn('text-[0.7rem] leading-none transition-opacity duration-300', lit ? 'haunt-flicker opacity-100' : 'opacity-0')}>🔥</span>
              <span
                className={cn('mt-0.5 h-3 w-full max-w-3 rounded-sm transition-colors duration-300', lit ? 'bg-[#f3e9c8]' : 'bg-white/10')}
                style={lit ? { boxShadow: '0 0 8px rgba(255,170,60,0.7)' } : undefined}
              />
              <span className={cn('mt-0.5 text-[0.55rem] tabular-nums', i + 1 === value ? 'font-bold text-[#ffb057]' : 'text-muted')}>×{i + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
