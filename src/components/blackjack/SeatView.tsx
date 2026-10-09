import { AnimatePresence, motion } from 'framer-motion';
import { CardFan } from '@/components/cards/PlayingCard';
import { ChipStack } from '@/components/table/ChipStack';
import { ReactionBubble } from '@/components/table/ReactionBar';
import { TimerRing } from '@/components/table/TimerRing';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { handLabel, type BjHand, type BjRound, type BjSeat } from '@/lib/blackjack';
import { formatChipsCompact } from '@/lib/format';
import type { Reaction } from '@/hooks/useBlackjackTable';

const RESULT_STYLE: Record<string, { text: string; cls: string }> = {
  win: { text: 'Win', cls: 'bg-felt-500 text-ivory' },
  blackjack: { text: 'Blackjack!', cls: 'bg-gradient-to-r from-gold-300 to-gold-500 text-ink-950' },
  push: { text: 'Push', cls: 'bg-ink-500 text-ivory' },
  lose: { text: 'Lose', cls: 'bg-ruby-700 text-ivory' },
  surrender: { text: 'Surrender', cls: 'bg-ink-600 text-cream' },
};

export function SeatView({
  seatNo,
  seat,
  hands,
  round,
  isMe,
  canSit,
  onSit,
  reaction,
  turnSeconds,
  offsetMs,
  compact,
}: {
  seatNo: number;
  seat: BjSeat | undefined;
  hands: BjHand[];
  round: BjRound | null;
  isMe: boolean;
  canSit: boolean;
  onSit: () => void;
  reaction: Reaction | undefined;
  turnSeconds: number;
  offsetMs: number;
  compact: boolean;
}) {
  const turnHand = hands.find((h) => h.id === round?.turn_hand_id);
  const active = Boolean(turnHand);

  if (!seat) {
    return (
      <div className="flex min-h-36 flex-col items-center justify-end gap-2">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-white/15 text-xs text-white/30">
          {seatNo}
        </div>
        {canSit ? (
          <Button size="sm" variant="outline" onClick={onSit} aria-label={`Sit in seat ${seatNo}`}>
            Sit
          </Button>
        ) : (
          <span className="h-9 text-xs text-white/30">Open</span>
        )}
      </div>
    );
  }

  const cardSize = compact ? 'sm' : 'md';
  return (
    <div
      className={cn('relative flex min-h-36 min-w-0 flex-col items-center justify-end gap-1.5 rounded-2xl px-1 pb-1 pt-2 transition', active && 'bg-gold-500/[0.07]')}
      aria-label={`Seat ${seatNo}: ${seat.username}${isMe ? ' (you)' : ''}`}
    >
      {/* Hands */}
      <div className="flex items-end gap-2">
        {hands.map((h) => {
          const res = h.result ? RESULT_STYLE[h.result] : null;
          const isTurn = h.id === round?.turn_hand_id;
          return (
            <div key={h.id} className={cn('relative flex flex-col items-center gap-1', isTurn && 'drop-shadow-[0_0_12px_rgba(227,195,94,0.55)]')}>
              <AnimatePresence>
                {res && (
                  <motion.span
                    initial={{ scale: 0.4, opacity: 0, y: 6 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 18 }}
                    className={cn('absolute -top-3 z-10 rounded-full px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wider shadow', res.cls)}
                  >
                    {res.text}
                    {h.payout > h.bet + h.insurance && ` +${formatChipsCompact(h.payout - h.bet - h.insurance)}`}
                  </motion.span>
                )}
              </AnimatePresence>
              {h.cards.length > 0 && (
                <CardFan cards={h.cards} size={cardSize} dim={h.result === 'lose' || h.status === 'busted'} />
              )}
              {h.cards.length > 0 && (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-xs font-bold tabular-nums',
                    h.status === 'busted' ? 'bg-ruby-800 text-ruby-300' : h.status === 'blackjack' ? 'bg-gold-500 text-ink-950' : 'bg-ink-950/80 text-ivory',
                  )}
                >
                  {handLabel(h)}
                </span>
              )}
              <ChipStack amount={h.bet} />
              {h.insurance > 0 && <span className="text-[0.6rem] text-gold-300">Ins. {formatChipsCompact(h.insurance)}</span>}
            </div>
          );
        })}
      </div>

      {/* Player */}
      <div className="relative mt-1 flex min-w-0 max-w-full flex-col items-center gap-1 sm:flex-row sm:gap-2">
        <div className="relative h-11 w-11">
          {active && round?.phase_ends_at && (
            <TimerRing endsAt={round.phase_ends_at} totalSeconds={turnSeconds} offsetMs={offsetMs} size={52} />
          )}
          <div
            className={cn(
              'flex h-11 w-11 items-center justify-center rounded-full border-2 font-display text-lg font-bold',
              isMe ? 'border-gold-400 bg-gradient-to-br from-ruby-600 to-ruby-800 text-gold-200' : 'border-white/25 bg-ink-700 text-cream',
              !seat.connected && 'opacity-50',
            )}
          >
            {seat.username.slice(0, 1).toUpperCase()}
          </div>
          <span
            className={cn('absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-felt-800', seat.connected ? 'bg-felt-300' : 'bg-ink-400')}
            title={seat.connected ? 'Connected' : 'Reconnecting…'}
          />
          <AnimatePresence>{reaction && <ReactionBubble key={reaction.id} kind={reaction.kind} index={reaction.index} />}</AnimatePresence>
        </div>
        <div className="min-w-0 max-w-full text-center sm:text-left">
          <p className={cn('max-w-[5.5rem] truncate text-xs font-semibold sm:max-w-[6.5rem] sm:text-sm', isMe ? 'text-gold-200' : 'text-ivory')}>
            {seat.username}
            {isMe && <span className="sr-only"> (you)</span>}
          </p>
          <p className="text-[0.65rem] text-cream/60">
            {!seat.connected ? 'Reconnecting…' : seat.status === 'sitting_out' ? 'Sitting out' : `Seat ${seatNo}`}
          </p>
        </div>
      </div>
    </div>
  );
}
