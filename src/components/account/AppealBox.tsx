import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { friendlyError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { toast } from '@/stores/toastStore';

interface MyAppeal {
  kind: 'ban' | 'timeout' | 'chat' | null;
  can_appeal: boolean;
  wait_until: string | null;
  latest: { id: number; kind: string; status: 'open' | 'accepted' | 'denied'; message: string; reply: string | null; at: string; resolved_at: string | null } | null;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The appeal form: shown to a player who is suspended, in a timeout or barred from chat.
 * One appeal at a time; the moderator's answer shows here and in the inbox. (25_admin_tools.sql)
 */
export function AppealBox({ what }: { what: string }) {
  const [data, setData] = useState<MyAppeal | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('my_appeal');
    // Before 25_admin_tools.sql is run there are no appeals: show nothing.
    if (!error) setData(d as MyAppeal);
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  if (!data) return null;
  const a = data.latest;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data: d, error } = await supabase.rpc('appeal_submit', { p_message: text });
    setBusy(false);
    if (error) return toast.error(friendlyError(error));
    setData(d as MyAppeal);
    setText('');
    setOpen(false);
    toast.success('Appeal sent', 'A moderator will read it. The answer will show here and in your inbox.');
  };

  return (
    <div className="rounded-xl border border-white/10 bg-ink-950/40 p-4 text-sm" aria-label="Appeal">
      <h2 className="font-display text-lg font-bold text-ivory">Appeal</h2>
      {a?.status === 'open' ? (
        <>
          <p className="mt-1 text-cream/85">Your appeal was sent on {when(a.at)} and is waiting for a moderator.</p>
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/[0.04] p-3 text-xs text-cream/75 [overflow-wrap:anywhere]">{a.message}</p>
        </>
      ) : (
        <>
          {a && a.resolved_at && (
            <div className="mt-1">
              <p className="text-cream/85">
                Your appeal of {when(a.at)} was{' '}
                <strong className={a.status === 'accepted' ? 'text-felt-300' : 'text-ruby-200'}>{a.status === 'accepted' ? 'accepted' : 'turned down'}</strong>.
              </p>
              {a.reply && <p className="mt-2 rounded-lg bg-white/[0.04] p-3 text-xs text-cream/85 [overflow-wrap:anywhere]">Moderator: {a.reply}</p>}
            </div>
          )}
          {data.can_appeal ? (
            open ? (
              <form onSubmit={(e) => void submit(e)} className="mt-2 flex flex-col gap-2">
                <label htmlFor="appeal-text" className="text-cream/85">
                  Tell the moderator why {what} should be lifted. Be honest and polite: you can send one appeal, and it is read by a person.
                </label>
                <textarea
                  id="appeal-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={5}
                  maxLength={1000}
                  required
                  className="rounded-lg border border-white/15 bg-ink-950 px-3 py-2 text-sm text-cream"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <Button type="submit" size="sm" loading={busy} disabled={text.trim().length < 20}>
                    Send appeal
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </Button>
                  <span className="text-xs tabular-nums text-muted">{text.trim().length} / 1,000 (at least 20)</span>
                </div>
              </form>
            ) : (
              <>
                {!a && <p className="mt-1 text-cream/85">If you think {what} is a mistake, you can ask a moderator to look again.</p>}
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
                  Write an appeal
                </Button>
              </>
            )
          ) : (
            data.wait_until && <p className="mt-2 text-xs text-muted">You can write again after {when(data.wait_until)}.</p>
          )}
        </>
      )}
    </div>
  );
}
