import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

interface Row {
  waiting: boolean;
  created_by: string | null;
  invite_code: string | null;
}

/**
 * The banner above a private table that is still in its waiting room: friends can sit down
 * (and bring chips), and nothing is dealt until the host presses Start. If the host has left,
 * anyone seated may start. It disappears by itself once the table is running.
 */
export function WaitingRoom({ tableId }: { tableId: string }) {
  const userId = useAuth((s) => s.user?.id);
  const [row, setRow] = useState<Row | null>(null);
  const [seated, setSeated] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      supabase.from('game_tables').select('waiting, created_by, invite_code').eq('id', tableId).maybeSingle(),
      supabase.from('table_seats').select('user_id').eq('table_id', tableId),
    ]);
    // (Before the newer SQL is run there is no `waiting` column: then no table has a waiting room.)
    if (!t.error) setRow((t.data as Row | null) ?? null);
    if (!s.error) setSeated(((s.data ?? []) as { user_id: string }[]).map((x) => x.user_id));
  }, [tableId]);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`waiting:${tableId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_tables', filter: `id=eq.${tableId}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_seats', filter: `table_id=eq.${tableId}` }, () => void load())
      .subscribe();
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      void supabase.removeChannel(ch);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tableId, load]);

  // While waiting, look again every few seconds: that is how the others notice the start without Realtime.
  const waiting = Boolean(row?.waiting);
  useEffect(() => {
    if (!waiting) return;
    const id = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(id);
  }, [waiting, load]);

  if (!row?.waiting) return null;
  const iAmSeated = Boolean(userId && seated.includes(userId));
  const hostHere = Boolean(row.created_by && seated.includes(row.created_by));
  const iAmHost = row.created_by === userId;
  const canStart = iAmSeated && (iAmHost || !hostHere);

  const start = async () => {
    setBusy(true);
    const { error } = await supabase.rpc('table_start', { p_table: tableId });
    setBusy(false);
    if (error) {
      playSound('error');
      return toast.error(friendlyError(error));
    }
    playSound('success');
    toast.success('The table is open', 'Good luck!');
    void load();
  };

  return (
    <div className="mx-auto max-w-6xl px-3 pt-4 sm:px-4" role="status">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-gold-500/40 bg-gold-500/[0.08] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold text-gold-200">Waiting room</p>
          <p className="text-sm text-cream/85">
            {seated.length} player{seated.length === 1 ? '' : 's'} seated.{' '}
            {canStart
              ? 'Nothing is dealt and no bets are taken until you press Start.'
              : iAmSeated
                ? 'The host starts the game when everyone is here.'
                : 'Take a seat. The host starts the game when everyone is here.'}
            {row.invite_code && (
              <>
                {' '}
                Invite code: <strong className="font-mono tracking-widest text-ivory">{row.invite_code}</strong>
              </>
            )}
          </p>
        </div>
        {canStart && (
          <Button loading={busy} onClick={() => void start()}>
            Start the game
          </Button>
        )}
      </div>
    </div>
  );
}
