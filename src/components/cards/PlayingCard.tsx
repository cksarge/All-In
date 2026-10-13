import { motion } from 'framer-motion';
import { cardName, cardRank, cardSuit, isRed, JOKER } from '@/lib/cards';
import { cn } from '@/components/ui/cn';
import { CARD_BACKS } from '@/lib/progress';
import { useProgress } from '@/stores/progressStore';

const sizes = {
  xs: 'h-[2.5rem] w-[1.8rem] text-[0.55rem] rounded',
  sm: 'h-[3.6rem] w-[2.6rem] text-[0.7rem] rounded-md',
  md: 'h-[4.9rem] w-[3.5rem] text-sm rounded-lg',
  lg: 'h-[6.3rem] w-[4.5rem] text-base rounded-lg',
} as const;

export type CardSize = keyof typeof sizes;

/** The big suit in the middle of a card, sized so it clears the two corners on every size of card. */
const PIP = { xs: 'text-[1em]', sm: 'text-[1.3em]', md: 'text-[1.6em]', lg: 'text-[1.9em]' } as const;

/** The back of a card, in the design the player has equipped (`back` overrides it, for previews). */
export function CardBack({ className, back }: { className?: string; back?: string }) {
  const equipped = useProgress((s) => s.me?.loadout.card_back);
  const b = CARD_BACKS[back ?? equipped ?? 'back_ruby'] ?? CARD_BACKS.back_ruby;
  return (
    <div
      className={cn('absolute inset-0 overflow-hidden border', className)}
      style={{
        backgroundColor: b.base,
        borderColor: `rgba(${b.line},0.6)`,
        backgroundImage: `repeating-linear-gradient(45deg, rgba(${b.line},0.22) 0 2px, transparent 2px 9px), repeating-linear-gradient(-45deg, rgba(${b.line},0.22) 0 2px, transparent 2px 9px)`,
      }}
    >
      <div className="absolute inset-[12%] rounded-[inherit] border" style={{ borderColor: `rgba(${b.line},0.4)` }} />
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
  highlight,
  delay,
  still,
}: {
  card?: number | null;
  size?: CardSize;
  index?: number;
  className?: string;
  dim?: boolean;
  /** Gold glow, e.g. the cards that make the winning hand. */
  highlight?: boolean;
  /** Seconds before the card flies in (defaults to a short stagger by index). */
  delay?: number;
  /** No deal animation (e.g. cards in a history list). */
  still?: boolean;
}) {
  const faceUp = card !== undefined && card !== null;
  const joker = card === JOKER;
  const red = faceUp && !joker && isRed(card);
  return (
    <motion.div
      initial={still ? false : { opacity: 0, y: -40, x: 30, rotate: -8, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, x: 0, rotate: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26, delay: delay ?? index * 0.08 }}
      className={cn(
        'relative shrink-0 select-none [perspective:600px]',
        sizes[size],
        highlight && 'z-10 -translate-y-1 drop-shadow-[0_0_10px_rgba(240,214,136,0.9)]',
        className,
      )}
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
            highlight && 'ring-2 ring-gold-300',
          )}
        >
          {joker && (
            <div className="flex h-full flex-col items-center justify-center gap-[0.2em] font-bold leading-none text-sapphire-700">
              <span className="text-[2em] leading-none" aria-hidden="true">★</span>
              <span className="text-[0.62em] tracking-wider">JOKER</span>
            </div>
          )}
          {faceUp && !joker && (
            // Each piece is pinned to its own place, so nothing can be pushed off the card at any size:
            // the rank over its suit in two opposite corners (the lower one upside down), and one big suit
            // in the middle. The corners are the same width whatever the rank, so they line up from card to card.
            <div className={cn('absolute inset-0 overflow-hidden rounded-[inherit] font-bold leading-none', red ? 'text-ruby-600' : 'text-ink-900')}>
              <span className="absolute left-[0.22em] top-[0.26em] flex w-[1.25em] flex-col items-center gap-[0.06em]">
                <span className="tracking-[-0.06em]">{cardRank(card)}</span>
                <span className="text-[0.8em] leading-none">{cardSuit(card)}</span>
              </span>
              <span className={cn('absolute inset-0 flex items-center justify-center leading-none', PIP[size])} aria-hidden="true">
                {cardSuit(card)}
              </span>
              <span className="absolute bottom-[0.26em] right-[0.22em] flex w-[1.25em] rotate-180 flex-col items-center gap-[0.06em]" aria-hidden="true">
                <span className="tracking-[-0.06em]">{cardRank(card)}</span>
                <span className="text-[0.8em] leading-none">{cardSuit(card)}</span>
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
  highlight,
  overlap: overlapClass,
  still,
}: {
  cards: number[];
  /** Extra face-down cards to show after the visible ones (e.g. the dealer's hole card). */
  hidden?: number;
  size?: CardSize;
  className?: string;
  dim?: boolean;
  /** Cards to highlight (e.g. the winning five). */
  highlight?: number[] | null;
  /** Override the negative margin between cards. */
  overlap?: string;
  still?: boolean;
}) {
  const overlap = overlapClass ?? (size === 'xs' ? '-ml-4' : size === 'sm' ? '-ml-6' : size === 'md' ? '-ml-8' : '-ml-10');
  const all: (number | null)[] = [...cards, ...Array.from({ length: hidden }, () => null)];
  return (
    <div className={cn('flex items-end', className)}>
      {all.map((c, i) => (
        <PlayingCard
          key={i}
          card={c}
          size={size}
          index={i}
          className={i > 0 ? overlap : undefined}
          dim={dim || (Boolean(highlight?.length) && c !== null && !highlight!.includes(c))}
          highlight={c !== null && Boolean(highlight?.includes(c))}
          still={still}
        />
      ))}
    </div>
  );
}
