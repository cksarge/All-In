import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { formatChips } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { countdown, sizeLabel, useTourneyFeed, VARIANT_LABEL } from '@/lib/tournaments';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

interface EventRow {
  id: string;
  size: number;
  entry_fee: number;
  variant: string;
  prize_pool: number;
  club: boolean;
  host: string | null;
  mine: boolean;
  registered: boolean;
  /** Only for the people already in a private tournament, to pass on. */
  code: string | null;
  players: string[];
  closes_at: string;
}
interface EventsState {
  server_now?: string;
  entry_fees: number[];
  wait_minutes: number;
  club: { id: string; name: string; can_host: boolean } | null;
  events: EventRow[];
}

const pill = (on: boolean) =>
  cn(
    'rounded-full border px-3 py-1.5 text-sm font-medium transition',
    on ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:border-white/20 hover:text-ivory',
  );

/**
 * Private tournaments (join with a code) and club events (for a club's members),
 * on the Tournaments page. Both are Sit & Gos once they fill: see 24_events.sql.
 */
export function PrivateEvents({
  sizes,
  variants,
  inPoker,
  onChanged,
}: {
  sizes: number[];
  variants: string[];
  /** Already in a poker tournament: one at a time. */
  inPoker: boolean;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const { data, load } = useTourneyFeed<EventsState>('events_state', {}, 5000);
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [size, setSize] = useState(3);
  const [fee, setFee] = useState(0);
  const [variant, setVariant] = useState('standard');
  const [forClub, setForClub] = useState(false);
  const [code, setCode] = useState('');
  const [shown, setShown] = useState(false);

  // Arriving from a club event's notification: bring this section into view.
  useEffect(() => {
    if (hash === '#events' && data) document.getElementById('events')?.scrollIntoView({ block: 'start' });
  }, [hash, Boolean(data)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stays hidden until 24_events.sql is run.
  if (!data) return null;

  const run = async <T,>(key: string, fn: string, args: Record<string, unknown>): Promise<T | null> => {
    if (busy) return null;
    setBusy(key);
    const { data: res, error } = await supabase.rpc(fn, args);
    setBusy(null);
    void useWallet.getState().fetchStatus();
    void load();
    onChanged();
    if (error) {
      playSound('error');
      toast.error(friendlyError(error));
      return null;
    }
    return res as T;
  };
  const entered = (res: { started: boolean; table_id: string | null } | null, waiting: string) => {
    if (!res) return;
    playSound('chip');
    if (res.started && res.table_id) navigate(`/table/${res.table_id}`);
    else toast.success('You have a seat', waiting);
  };

  const create = async () => {
    const res = await run<{ started: boolean; table_id: string | null; code: string }>('create', 'sng_private_create', {
      p_size: size,
      p_entry_fee: fee,
      p_variant: variant,
      p_club: forClub,
    });
    if (res) setShown(true);
    entered(res, forClub ? 'Your club has been told. It starts when the last seat fills.' : 'Give your friends the code. It starts when the last seat fills.');
  };
  const join = async (args: Record<string, unknown>, key: string) =>
    entered(await run(key, 'sng_private_join', args), 'It starts the moment the last seat fills. You can wait anywhere on the site.');

  const hosting = data.events.some((e) => e.mine);
  const clubSizes = sizes.filter((s) => s >= 3);
  const pickSizes = forClub ? clubSizes : sizes;
  const realSize = pickSizes.includes(size) ? size : pickSizes[0];

  return (
    <section id="events" aria-labelledby="events-h" className="mt-10 scroll-mt-24">
      <h2 id="events-h" className="font-display text-2xl font-bold text-ivory">
        Private tournaments and club events
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        A Sit &amp; Go just for the people you choose. Set one up and share its code with friends, or make it an event for your club. Entry can be
        free. These are played among friends, so they earn no trophies and do not count on the tournament leaderboard. One that has not filled in{' '}
        {data.wait_minutes / 60} hours is called off and every entry is returned.
      </p>

      {data.events.length > 0 && (
        <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.events.map((e) => (
            <li key={e.id} className={cn('surface flex flex-col gap-2.5 p-4', e.registered && 'border-gold-500/50')}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-lg font-bold text-ivory">
                  {e.club ? `${data.club?.name ?? 'Club'} event` : 'Private tournament'}
                </h3>
                <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-cream/75">
                  {sizeLabel(e.size)} · {VARIANT_LABEL[e.variant] ?? e.variant}
                </span>
              </div>
              <p className="text-xs text-cream/70">
                Hosted by <strong className="text-cream">{e.mine ? 'you' : (e.host ?? 'a player who left')}</strong> · entry{' '}
                {e.entry_fee > 0 ? <ChipAmount value={e.entry_fee} className="text-ivory" iconClassName="h-3.5 w-3.5" /> : <strong className="text-ivory">free</strong>}
                {e.prize_pool > 0 && (
                  <>
                    {' '}
                    · pot <ChipAmount value={e.prize_pool} className="text-gold-200" iconClassName="h-3.5 w-3.5" />
                  </>
                )}
              </p>
              <div className="flex items-center gap-1.5" aria-label={`${e.players.length} of ${e.size} seats taken`}>
                {Array.from({ length: e.size }).map((_, i) => (
                  <span key={i} className={cn('h-2.5 flex-1 rounded-full', i < e.players.length ? 'bg-gold-400' : 'bg-white/10')} aria-hidden="true" />
                ))}
              </div>
              <p className="truncate text-xs text-muted">In: {e.players.join(', ')}</p>
              {e.code && (
                <p className="flex flex-wrap items-center gap-2 text-sm text-cream/85">
                  Code:
                  <span className="rounded-lg border border-white/15 bg-ink-950/60 px-2.5 py-1 font-mono text-base font-bold tracking-[0.25em] text-gold-200" aria-label={shown ? `Code ${e.code}` : 'Code hidden'}>
                    {shown ? e.code : '••••••'}
                  </span>
                  <button type="button" className="text-xs font-semibold text-gold-300 hover:underline" onClick={() => setShown((v) => !v)}>
                    {shown ? 'Hide' : 'Show'}
                  </button>
                  <button
                    type="button"
                    className="text-xs font-semibold text-gold-300 hover:underline"
                    onClick={() => void navigator.clipboard?.writeText(e.code ?? '').then(() => toast.info('Code copied'))}
                  >
                    Copy
                  </button>
                </p>
              )}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs tabular-nums text-subtle">Called off in {countdown(new Date(e.closes_at).getTime() - Date.now())} if not full</span>
                {e.mine ? (
                  <Button size="sm" variant="outline" loading={busy === e.id} onClick={() => void run(e.id, 'sng_private_cancel', { p_tournament: e.id }).then((r) => r && toast.info('Tournament called off', 'Every entry has been returned.'))}>
                    Call it off
                  </Button>
                ) : e.registered ? (
                  <Button size="sm" variant="outline" loading={busy === e.id} onClick={() => void run(e.id, 'sng_unregister', { p_tournament: e.id }).then((r) => r && toast.info('Seat given up', e.entry_fee > 0 ? 'Your entry is back in your wallet.' : undefined))}>
                    Give up seat
                  </Button>
                ) : (
                  <Button size="sm" loading={busy === e.id} disabled={inPoker || balance < e.entry_fee} onClick={() => void join({ p_tournament: e.id }, e.id)}>
                    {balance < e.entry_fee ? 'Not enough chips' : 'Join the event'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="surface p-5">
          <h3 className="font-display text-lg font-bold text-ivory">Set one up</h3>
          <div className="mt-3 space-y-3">
            {data.club?.can_host && (
              <div role="radiogroup" aria-label="Who it is for" className="flex flex-wrap gap-1.5">
                <button type="button" role="radio" aria-checked={!forClub} className={pill(!forClub)} onClick={() => setForClub(false)}>
                  Private (join by code)
                </button>
                <button type="button" role="radio" aria-checked={forClub} className={pill(forClub)} onClick={() => setForClub(true)}>
                  Event for {data.club.name}
                </button>
              </div>
            )}
            <div role="radiogroup" aria-label="Players" className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 text-xs font-semibold uppercase tracking-wider text-muted">Players</span>
              {pickSizes.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={realSize === s} className={pill(realSize === s)} onClick={() => setSize(s)}>
                  {s}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Entry" className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 text-xs font-semibold uppercase tracking-wider text-muted">Entry</span>
              {data.entry_fees.map((f) => (
                <button key={f} type="button" role="radio" aria-checked={fee === f} aria-label={f === 0 ? 'Free entry' : `Entry ${formatChips(f)} chips`} className={pill(fee === f)} onClick={() => setFee(f)}>
                  {f === 0 ? 'Free' : formatChips(f)}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Format" className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 text-xs font-semibold uppercase tracking-wider text-muted">Format</span>
              {variants.map((v) => (
                <button key={v} type="button" role="radio" aria-checked={variant === v} className={pill(variant === v)} onClick={() => setVariant(v)}>
                  {VARIANT_LABEL[v] ?? v}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              loading={busy === 'create'}
              disabled={inPoker || hosting || balance < fee}
              onClick={() => {
                if (realSize !== size) setSize(realSize);
                void create();
              }}
            >
              {forClub ? 'Create the club event' : 'Create the tournament'}
            </Button>
            <p className="text-xs text-muted">
              {hosting
                ? 'You already have one waiting for players.'
                : inPoker
                  ? 'You are already in a poker tournament. One at a time.'
                  : balance < fee
                    ? 'Not enough chips for that entry.'
                    : fee > 0
                      ? 'You take the first seat, and your entry is taken now.'
                      : 'You take the first seat.'}
            </p>
          </div>
        </div>

        <form
          className="surface flex flex-col gap-3 p-5"
          onSubmit={(ev) => {
            ev.preventDefault();
            if (code.trim().length >= 6) void join({ p_code: code.trim() }, 'code').then(() => setCode(''));
          }}
        >
          <h3 className="font-display text-lg font-bold text-ivory">Join with a code</h3>
          <label htmlFor="event-code" className="text-sm text-muted">
            A friend who set up a private tournament can give you its six-character code.
          </label>
          <input
            id="event-code"
            value={code}
            onChange={(ev) => setCode(ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="ABC123"
            autoComplete="off"
            spellCheck={false}
            className="h-11 rounded-lg border border-white/10 bg-ink-950/60 px-3 text-center font-mono text-lg tracking-[0.3em] text-ivory placeholder:text-subtle"
          />
          <Button type="submit" variant="outline" loading={busy === 'code'} disabled={inPoker || code.trim().length < 6}>
            Join the tournament
          </Button>
          {!data.club && <p className="text-xs text-subtle">In a club? Its events show up here for every member, with no code needed.</p>}
        </form>
      </div>
    </section>
  );
}
