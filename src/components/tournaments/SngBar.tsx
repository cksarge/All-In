import { useEffect, useRef, useState } from 'react';
import { ChipBurst } from '@/components/economy/ChipBurst';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/components/ui/cn';
import { useNow } from '@/hooks/useNow';
import { formatChips } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { countdown, ordinal, type SngStatus } from '@/lib/tournaments';
import { useProgress } from '@/stores/progressStore';
import { useWallet } from '@/stores/walletStore';

/** Loads the tournament a poker table belongs to, and keeps it fresh as hands go by. */
export function useSngStatus(tableId: string, enabled: boolean, pulse: string) {
  const [status, setStatus] = useState<SngStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    // tourney_status covers Sit & Gos and multi-table events; before 18_tournaments_plus.sql it doesn't exist.
    const load = () =>
      void supabase.rpc('tourney_status', { p_table: tableId }).then(async (first) => {
        const { data } = first.error ? await supabase.rpc('sng_status', { p_table: tableId }) : first;
        if (alive && data) setStatus(data as SngStatus);
      });
    load();
    const id = window.setInterval(load, 8000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [tableId, enabled, pulse]);
  return status;
}

/** The strip above a tournament table: blinds, the clock, who is left, the prizes. */
export function SngBar({ status, offsetMs }: { status: SngStatus; offsetMs: number }) {
  const now = useNow(1000, offsetMs);
  const nextIn = status.next_level_at ? new Date(status.next_level_at).getTime() - now : null;
  // A beep when the blinds go up.
  const level = useRef(status.level);
  useEffect(() => {
    if (status.level && level.current && status.level > level.current) playSound('turn');
    level.current = status.level;
  }, [status.level]);

  return (
    <section aria-label="Tournament" className="mt-3 rounded-2xl border border-gold-500/30 bg-gold-500/[0.07] px-4 py-2.5">
      <dl className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm">
        <Item label={status.level ? `Level ${status.level}` : 'Blinds'} value={status.blinds ? status.blinds.map((n) => formatChips(n)).join(' / ') : '–'} />
        {status.next_blinds && nextIn !== null && (
          <Item
            label="Next level"
            value={
              <>
                {status.next_blinds.map((n) => formatChips(n)).join(' / ')}{' '}
                <span className={cn('tabular-nums', nextIn < 30_000 ? 'text-ruby-300' : 'text-cream/70')}>in {countdown(nextIn)}</span>
              </>
            }
          />
        )}
        <Item label="Players left" value={`${status.players_left} of ${status.size}`} />
        {status.kind === 'mtt' && status.tables_left !== undefined && <Item label="Tables" value={status.tables_left} />}
        <Item
          label="Prizes"
          value={
            <span className="flex flex-wrap gap-x-3">
              {status.prizes.map((p, i) => (
                <span key={i}>
                  <span className="text-cream/60">{ordinal(i + 1)}</span> <ChipAmount value={p} className="text-gold-200" iconClassName="h-3.5 w-3.5" />
                </span>
              ))}
            </span>
          }
        />
      </dl>
    </section>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-[0.65rem] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="font-semibold text-ivory">{value}</dd>
    </div>
  );
}

/** Pops up once when you are knocked out or win. */
export function SngResult({ status }: { status: SngStatus }) {
  const me = status.me;
  const done = Boolean(me && me.status === 'out' && me.place);
  // Second place in a paying game is only known to be paid once the tournament has finished.
  const settled = status.status === 'finished';
  const [open, setOpen] = useState(false);
  const shown = useRef<string | null>(null);
  const key = done ? `${status.tournament_id}-${settled}` : null;
  useEffect(() => {
    if (!key || shown.current === key) return;
    shown.current = key;
    setOpen(true);
    if (me?.place === 1) playSound('jackpot');
    else playSound(me?.prize ? 'win' : 'lose');
    void useWallet.getState().fetchStatus();
    void useProgress.getState().fetch();
  }, [key, me?.place, me?.prize]);
  if (!me || !done) return null;
  const won = me.place === 1;
  const pending = !settled && (status.prizes[(me.place ?? 0) - 1] ?? 0) > 0;
  const prize = settled ? me.prize ?? 0 : status.prizes[(me.place ?? 0) - 1] ?? 0;
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={won ? 'You won the tournament!' : 'You are out'} className="max-w-md">
      <div className="relative text-center">
        {won && <ChipBurst count={30} />}
        <p className="gold-text font-display text-5xl font-black">{ordinal(me.place ?? 0)}</p>
        <p className="mt-1 text-sm text-cream/80">
          of {status.size} player{status.size === 1 ? '' : 's'}
        </p>
        {prize > 0 ? (
          <p className="mt-4 text-lg text-ivory">
            {pending ? 'You will win ' : 'You won '}
            <ChipAmount value={prize} className="font-bold text-gold-200" iconClassName="h-5 w-5" />
          </p>
        ) : (
          <p className="mt-4 text-sm text-muted">No prize this time. Better luck in the next one.</p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <ButtonLink to="/tournaments">Play another</ButtonLink>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {settled ? 'Close' : 'Keep watching'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
