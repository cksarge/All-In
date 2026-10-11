import { AnimatePresence, motion } from 'framer-motion';
import { CardFan, type CardSize } from '@/components/cards/PlayingCard';
import { ReactionBubble } from '@/components/table/ReactionBar';
import { TimerRing } from '@/components/table/TimerRing';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import type { Reaction } from '@/hooks/useLiveTable';
import { formatChipsCompact } from '@/lib/format';
import type { PkConfig, PkHand, PkPlayer, PkSeat } from '@/lib/poker';
import { SeatAvatar } from '@/components/table/SeatAvatar';

export function PokerSeat({
  seatNo,
  seat,
  player,
  hand,
  config,
  isMe,
  myHole,
  myBest,
  canSit,
  onSit,
  reaction,
  offsetMs,
  compact,
  top,
  style,
}: {
  seatNo: number;
  seat: PkSeat | undefined;
  player: PkPlayer | undefined;
  hand: PkHand | null;
  config: PkConfig;
  isMe: boolean;
  myHole: number[] | null;
  myBest: number[] | null;
  canSit: boolean;
  onSit: () => void;
  reaction: Reaction | undefined;
  offsetMs: number;
  compact: boolean;
  /** Seat is on the top half of the table: cards go below the nameplate, toward the pot. */
  top: boolean;
  style: React.CSSProperties;
}) {
  if (!seat && !player) {
    return (
      <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1" style={style}>
        {canSit ? (
          <Button size="sm" variant="outline" onClick={onSit} aria-label={`Sit in seat ${seatNo}`} className="h-8 rounded-full px-3 text-xs">
            Sit
          </Button>
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-white/15 text-[0.65rem] text-white/30">
            {seatNo}
          </div>
        )}
      </div>
    );
  }

  const name = seat?.username ?? player?.username ?? 'Player';
  const isTurn = Boolean(hand && hand.phase === 'betting' && hand.turn_seat === seatNo && player);
  const settled = hand?.phase === 'settled';
  const folded = player?.status === 'folded';
  const net = player ? player.won - player.committed : 0;
  const winner = Boolean(settled && player && player.won > 0);
  const shown = player?.shown_cards ?? null;

  // Which cards to draw for this seat.
  const othersSize: CardSize = compact ? 'xs' : 'sm';
  const mySize: CardSize = compact ? 'sm' : 'md';
  let cards: React.ReactNode = null;
  if (player && !folded) {
    if (isMe && myHole) {
      cards = <CardFan cards={myHole} size={mySize} highlight={winner ? player.best_cards : myBest} overlap={tightOverlap(myHole.length, mySize)} />;
    } else if (shown) {
      cards = <CardFan cards={shown} size={othersSize} highlight={winner ? player.best_cards : null} overlap={tightOverlap(shown.length, othersSize)} />;
    } else if (config.family === 'stud') {
      // Two down, the up cards, then the last card down.
      const down = Math.max(0, player.card_count - player.up_cards.length);
      const first = Math.min(2, down);
      cards = (
        <div className="flex items-end">
          <CardFan cards={[]} hidden={first} size={othersSize} overlap={tightOverlap(7, othersSize)} />
          <CardFan cards={player.up_cards} size={othersSize} className={first ? tightOverlap(7, othersSize) : undefined} overlap={tightOverlap(7, othersSize)} />
          {down > 2 && <CardFan cards={[]} hidden={down - 2} size={othersSize} className={tightOverlap(7, othersSize)} />}
        </div>
      );
    } else if (player.card_count > 0) {
      cards = <CardFan cards={[]} hidden={player.card_count} size={othersSize} overlap={tightOverlap(player.card_count, othersSize)} />;
    }
  }

  const badge = (() => {
    if (winner) return { text: `+${formatChipsCompact(player!.won)}`, cls: 'bg-gradient-to-r from-gold-300 to-gold-500 text-ink-950' };
    if (!player) return null;
    if (settled && player.hand_name) return { text: player.hand_name, cls: 'bg-ink-950/90 text-cream' };
    if (player.status === 'allin') return { text: 'All in', cls: 'bg-ruby-600 text-ivory' };
    if (player.last_action) {
      const a = player.last_action;
      const cls =
        a === 'Fold' || a === 'Left' ? 'bg-ink-700 text-cream/70'
        : a === 'Raise' || a === 'Bet' || a === 'Complete' ? 'bg-gold-500 text-ink-950'
        : 'bg-felt-600 text-ivory';
      return { text: a, cls };
    }
    return null;
  })();

  const nameplate = (
    <div
      className={cn(
        'relative flex min-w-0 items-center gap-1.5 rounded-full border bg-ink-950/90 py-1 pl-1 pr-2.5 shadow-lg',
        isTurn ? 'border-gold-400 shadow-[0_0_18px_rgba(227,195,94,0.45)]' : winner ? 'border-gold-300' : 'border-white/15',
        (folded || seat?.status === 'sitting_out' || (seat && !seat.connected)) && 'opacity-60',
      )}
    >
      <div className="relative h-8 w-8 shrink-0">
        {isTurn && hand?.phase_ends_at && <TimerRing endsAt={hand.phase_ends_at} totalSeconds={config.turn_seconds} offsetMs={offsetMs} size={40} />}
        <SeatAvatar userId={seat?.user_id} username={name} isMe={isMe} size={32} className="block" />
        {seat && (
          <span
            className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-950', seat.connected ? 'bg-felt-300' : 'bg-ink-400')}
            title={seat.connected ? 'Connected' : 'Reconnecting…'}
          />
        )}
        <AnimatePresence>{reaction && <ReactionBubble key={reaction.id} kind={reaction.kind} index={reaction.index} />}</AnimatePresence>
      </div>
      <div className="min-w-0 leading-tight">
        <p className={cn('max-w-[4.6rem] truncate text-[0.7rem] font-semibold sm:max-w-[6rem] sm:text-xs', isMe ? 'text-gold-200' : 'text-ivory')}>
          {name}
          {isMe && <span className="sr-only"> (you)</span>}
        </p>
        <p className="text-[0.65rem] text-cream/75 sm:text-[0.7rem]">
          {!seat ? (
            'Left'
          ) : !seat.connected ? (
            'Reconnecting…'
          ) : seat.status === 'sitting_out' && !player ? (
            'Sitting out'
          ) : (
            <ChipAmount value={seat.stack} compact iconClassName="h-3 w-3" className="gap-1" />
          )}
        </p>
      </div>
    </div>
  );

  return (
    <div
      className={cn('absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1', top && 'flex-col-reverse')}
      style={style}
      aria-label={`Seat ${seatNo}: ${name}${isMe ? ' (you)' : ''}${player ? `, ${player.status === 'allin' ? 'all in' : player.status}` : ''}`}
    >
      <div className={cn('flex min-h-[2.5rem] items-end justify-center', isMe && !compact && 'min-h-[4.9rem]', folded && 'opacity-40')}>{cards}</div>
      <div className="relative">
        {nameplate}
        <AnimatePresence>
          {badge && (
            <motion.span
              key={badge.text}
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 22 }}
              className={cn(
                'absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide shadow',
                top ? '-top-3' : '-bottom-3',
                badge.cls,
              )}
            >
              {badge.text}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {settled && player && isMe && net !== 0 && <span className="sr-only">{net > 0 ? `You won ${net} chips` : `You lost ${-net} chips`}</span>}
    </div>
  );
}

/** More cards → tighter overlap so a seat never gets too wide. */
function tightOverlap(n: number, size: CardSize) {
  if (size === 'xs') return n > 4 ? '-ml-5' : '-ml-4';
  if (size === 'sm') return n > 4 ? '-ml-8' : n > 2 ? '-ml-7' : '-ml-5';
  return n > 4 ? '-ml-10' : n > 2 ? '-ml-9' : '-ml-6';
}
