import { AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import type { LiveSeat, Reaction } from '@/hooks/useLiveTable';
import { ReactionBubble } from './ReactionBar';

/** Row of seated players for shared tables (roulette, craps). */
export function PlayerStrip({
  seats,
  maxSeats,
  userId,
  reactions,
  canSit,
  onSit,
  highlightUser,
  highlightLabel,
  stakes,
}: {
  seats: LiveSeat[];
  maxSeats: number;
  userId: string | undefined;
  reactions: Reaction[];
  canSit: boolean;
  onSit: () => void;
  highlightUser?: string | null;
  highlightLabel?: string;
  /** Chips each player has on the table right now. */
  stakes?: Map<string, number>;
}) {
  const reactionsByUser = new Map(reactions.map((r) => [r.user_id, r]));
  return (
    <ul className="flex flex-wrap items-end gap-3" aria-label="Players at this table">
      {seats.map((s) => {
        const me = s.user_id === userId;
        const reaction = reactionsByUser.get(s.user_id);
        const lit = highlightUser === s.user_id;
        return (
          <li key={s.seat_no} className="relative flex items-center gap-2 rounded-xl bg-ink-950/40 py-1.5 pl-1.5 pr-3">
            <div className="relative">
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full border-2 font-display font-bold',
                  me ? 'border-gold-400 bg-gradient-to-br from-ruby-600 to-ruby-800 text-gold-200' : 'border-white/25 bg-ink-700 text-cream',
                  lit && 'ring-2 ring-gold-400 ring-offset-2 ring-offset-felt-800',
                  !s.connected && 'opacity-50',
                )}
              >
                {s.username.slice(0, 1).toUpperCase()}
              </div>
              <span
                className={cn('absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-900', s.connected ? 'bg-felt-300' : 'bg-ink-400')}
                title={s.connected ? 'Connected' : 'Reconnecting…'}
              />
              <AnimatePresence>
                {reaction && <ReactionBubble key={reaction.id} kind={reaction.kind} index={reaction.index} />}
              </AnimatePresence>
            </div>
            <div className="min-w-0">
              <p className={cn('max-w-[7rem] truncate text-xs font-semibold', me ? 'text-gold-200' : 'text-ivory')}>
                {s.username}
                {me && <span className="sr-only"> (you)</span>}
              </p>
              <p className="text-[0.65rem] text-cream/60">
                {lit && highlightLabel ? (
                  <span className="text-gold-300">{highlightLabel}</span>
                ) : !s.connected ? (
                  'Reconnecting…'
                ) : stakes?.get(s.user_id) ? (
                  <ChipAmount value={stakes.get(s.user_id)!} iconClassName="h-3 w-3" />
                ) : s.status === 'sitting_out' ? (
                  'Sitting out'
                ) : (
                  `Seat ${s.seat_no}`
                )}
              </p>
            </div>
          </li>
        );
      })}
      {canSit && seats.length < maxSeats && (
        <li>
          <Button size="sm" variant="outline" onClick={onSit}>
            Take a seat
          </Button>
        </li>
      )}
    </ul>
  );
}
