import { motion } from 'framer-motion';
import { cardName, cardRank, cardSuit, isRed } from '@/lib/cards';
import { cn } from '@/components/ui/cn';

const sizes = {
  sm: 'h-[3.6rem] w-[2.6rem] text-[0.7rem] rounded-md',
  md: 'h-[4.9rem] w-[3.5rem] text-sm rounded-lg',
  lg: 'h-[6.3rem] w-[4.5rem] text-base rounded-lg',
} as const;

export type CardSize = keyof typeof sizes;

function CardBack({ className }: { className?: string }) {
  return (
    <div
      className={cn('absolute inset-0 overflow-hidden border border-gold-500/60 bg-ruby-700', className)}
      style={{
        backgroundImage:
          'repeating-linear-gradient(45deg, rgba(240,214,136,0.22) 0 2px, transparent 2px 9px), repeating-linear-gradient(-45deg, rgba(240,214,136,0.22) 0 2px, transparent 2px 9px)',
      }}
    >
      <div className="absolute inset-[12%] rounded-[inherit] border border-gold-300/40" />
    </div>
  );
}

/**
 * A playing card. `card` undefined = face down. Animates in from the shoe,
 * and flips when a face-down card is revealed.
 */
export function PlayingCard({
  card,
  size = 'md',
  index = 0,
  className,
  dim,
}: {
  card?: number | null;
  size?: CardSize;
  index?: number;
  className?: string;
  dim?: boolean;
}) {
  const faceUp = card !== undefined && card !== null;
  const red = faceUp && isRed(card);
  return (
    <motion.div
      initial={{ opacity: 0, y: -40, x: 30, rotate: -8, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, x: 0, rotate: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26, delay: index * 0.08 }}
      className={cn('relative shrink-0 select-none [perspective:600px]', sizes[size], className)}
      role="img"
      aria-label={faceUp ? cardName(card) : 'Face-down card'}
    >
      <motion.div
        className="relative h-full w-full rounded-[inherit] [transform-style:preserve-3d]"
        initial={false}
        animate={{ rotateY: faceUp ? 0 : 180 }}
        transition={{ duration: 0.45, ease: 'easeInOut' }}
      >
        {/* Face */}
        <div
          className={cn(
            'absolute inset-0 rounded-[inherit] border border-black/10 bg-[#fbf7ee] shadow-[0_6px_14px_-6px_rgba(0,0,0,0.7)] [backface-visibility:hidden]',
            dim && 'brightness-75',
          )}
        >
          {faceUp && (
            <div className={cn('flex h-full flex-col justify-between p-[0.28em] font-bold leading-none', red ? 'text-ruby-600' : 'text-ink-900')}>
              <span className="flex flex-col items-start">
                <span>{cardRank(card)}</span>
                <span className="text-[0.85em]">{cardSuit(card)}</span>
              </span>
              <span className="self-center text-[1.9em] leading-none" aria-hidden="true">
                {cardSuit(card)}
              </span>
              <span className="flex rotate-180 flex-col items-start">
                <span>{cardRank(card)}</span>
                <span className="text-[0.85em]">{cardSuit(card)}</span>
              </span>
            </div>
          )}
        </div>
        {/* Back */}
        <div className="absolute inset-0 rounded-[inherit] shadow-[0_6px_14px_-6px_rgba(0,0,0,0.7)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <CardBack className="rounded-[inherit]" />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Overlapping row of cards. */
export function CardFan({
  cards,
  hidden = 0,
  size = 'md',
  className,
  dim,
}: {
  cards: number[];
  /** Extra face-down cards to show after the visible ones (e.g. the dealer's hole card). */
  hidden?: number;
  size?: CardSize;
  className?: string;
  dim?: boolean;
}) {
  const overlap = size === 'sm' ? '-ml-6' : size === 'md' ? '-ml-8' : '-ml-10';
  const all: (number | null)[] = [...cards, ...Array.from({ length: hidden }, () => null)];
  return (
    <div className={cn('flex items-end', className)}>
      {all.map((c, i) => (
        <PlayingCard key={i} card={c} size={size} index={i} className={i > 0 ? overlap : undefined} dim={dim} />
      ))}
    </div>
  );
}
