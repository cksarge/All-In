import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useLeaveWarning } from '@/hooks/useLeaveWarning';
import { GameStatsModal } from './GameStatsModal';
import { InviteModal } from './InviteModal';
import { TierBadge } from '@/components/ui/TierBadge';
import { formatChips } from '@/lib/format';
import type { TierKey } from '@/lib/types';
import { toast } from '@/stores/toastStore';
import type { LiveSeat } from '@/hooks/useLiveTable';

/** Top bar for every live table: leave, name, stakes, invite code, rules/history, sit out. */
export function TableHeader({
  table,
  watchers,
  connected,
  mySeat,
  onLeave,
  onRules,
  onHistory,
  onSitOut,
  extra,
  stakes,
  tournament,
  atStake,
  game,
}: {
  table: {
    name: string;
    tier: TierKey;
    min_bet: number;
    max_bet: number;
    is_private: boolean;
    invite_code: string | null;
    variant?: string | null;
  };
  watchers: number;
  connected: boolean;
  mySeat: LiveSeat | null;
  onLeave: () => void;
  onRules: () => void;
  onHistory: () => void;
  onSitOut?: () => void;
  extra?: React.ReactNode;
  /** Replaces "Bets min–max" (e.g. poker blinds). */
  stakes?: string;
  /** Tournament tables have no stake level, and leaving goes back to the tournaments. */
  tournament?: boolean;
  /**
   * Set while the player has chips riding on an unfinished round: what happens to them on leaving.
   * Leaving then asks first, and so does closing the tab. With nothing at stake, leaving is immediate.
   */
  atStake?: string | null;
  /** The game's key: adds a Stats button with the player's own numbers at this game. */
  game?: string;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  useLeaveWarning(Boolean(atStake));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} />
      {game && <GameStatsModal open={statsOpen} onClose={() => setStatsOpen(false)} game={game} />}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Leave with chips in play?" className="max-w-md">
        <h2 className="font-display text-2xl font-bold text-ivory">Leave with chips in play?</h2>
        <p className="mt-2 text-sm text-cream/85">{atStake}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmOpen(false)} data-autofocus>
            Stay
          </Button>
          <Button
            variant="ruby"
            onClick={() => {
              setConfirmOpen(false);
              onLeave();
            }}
          >
            Leave anyway
          </Button>
        </div>
      </Modal>
      <Button size="sm" variant={mySeat ? 'outline' : 'ghost'} onClick={() => (atStake ? setConfirmOpen(true) : onLeave())}>
        ← {tournament ? (mySeat ? 'Leave tournament' : 'Tournaments') : mySeat ? 'Leave table' : 'Lobby'}
      </Button>
      <h1 className="font-display text-xl font-bold text-ivory sm:text-2xl">{table.name}</h1>
      {tournament ? (
        <span className="rounded-full border border-gold-500/50 bg-gold-500/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-gold-200">
          Tournament
        </span>
      ) : (
        <TierBadge tier={table.tier} />
      )}
      {table.variant && (
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-cream/80">
          {table.variant}
        </span>
      )}
      <span className="text-xs text-muted">
        {stakes ?? `Bets ${formatChips(table.min_bet)}–${formatChips(table.max_bet)}`}
      </span>
      {table.is_private && table.invite_code && (
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(table.invite_code!);
              toast.success('Invite code copied', table.invite_code!);
            } catch {
              toast.info('Invite code', table.invite_code!);
            }
          }}
          className="rounded-lg border border-gold-500/40 px-2 py-1 font-mono text-xs tracking-widest text-gold-200 hover:bg-gold-500/10"
          aria-label={`Copy invite code ${table.invite_code}`}
        >
          {table.invite_code}
        </button>
      )}
      <div className="flex w-full flex-wrap items-center justify-end gap-1 sm:ml-auto sm:w-auto sm:gap-1.5">
        <span className="mr-1 hidden text-xs text-muted sm:inline" title="People at this table right now">
          👀 {watchers}
        </span>
        {!connected && <span className="text-xs text-ruby-300">Reconnecting…</span>}
        {extra}
        {mySeat && !tournament && (
          <Button size="sm" variant="ghost" onClick={() => setInviteOpen(true)}>
            Invite
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onRules}>
          Rules
        </Button>
        <Button size="sm" variant="ghost" onClick={onHistory}>
          History
        </Button>
        {game && (
          <Button size="sm" variant="ghost" onClick={() => setStatsOpen(true)}>
            Stats
          </Button>
        )}
        {mySeat && onSitOut && (
          <Button size="sm" variant="ghost" onClick={onSitOut}>
            {mySeat.status === 'sitting_out' ? "I'm back" : 'Sit out'}
          </Button>
        )}
      </div>
    </div>
  );
}
