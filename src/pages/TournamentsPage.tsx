import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { QuickStart } from '@/components/onboarding/QuickStart';
import { PrivateEvents } from '@/components/tournaments/PrivateEvents';
import { TournamentRules } from '@/components/tournaments/TournamentRules';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { formatChips, formatRelativeTime } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import {
  countdown,
  ordinal,
  SHOWDOWN_TIER_LABEL,
  sizeLabel,
  useTourneyFeed,
  type Showdown,
  type SngRow,
  type TourneyResult,
  type TourneyState,
  type MttState,
  VARIANT_LABEL,
} from '@/lib/tournaments';
import { useNow } from '@/hooks/useNow';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

export default function TournamentsPage() {
  const navigate = useNavigate();
  const { data, error, offsetMs, load } = useTourneyFeed<TourneyState>('tournaments_state', {}, 5000);
  const now = useNow(1000, offsetMs);
  const balance = useWallet((s) => s.status?.balance ?? 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [variant, setVariant] = useState('standard');
  // The multi-table event has its own feed; it stays empty until 18_tournaments_plus.sql is run.
  const mtt = useTourneyFeed<MttState>('mtt_state', {}, 5000);
  const mttTable = mtt.data?.my_table ?? null;
  const mttWaiting = useRef(false);
  useEffect(() => {
    if (mttTable && mttWaiting.current) {
      playSound('turn');
      toast.success('The Main Event is starting', 'Good luck!');
      navigate(`/table/${mttTable}`);
    }
    mttWaiting.current = Boolean(mtt.data?.next?.registered);
  }, [mttTable, mtt.data?.next?.registered, navigate]);
  // Remembered so the event still starts for you if you wander off to another page (see App.tsx).
  const mttAt = mtt.data?.next?.registered ? mtt.data.next.starts_at : null;
  useEffect(() => {
    try {
      if (mttAt) window.localStorage.setItem('allin-mtt-at', mttAt);
      else if (mtt.data) window.localStorage.removeItem('allin-mtt-at');
    } catch {
      // private mode: the tournaments page itself still starts it
    }
  }, [mttAt, mtt.data]);

  // Your Sit & Go filled up while you were looking at this page: off to the table.
  const wasWaiting = useRef(false);
  const mySng = data?.my_sng ?? null;
  useEffect(() => {
    if (mySng?.status === 'running' && mySng.table_id && wasWaiting.current) {
      playSound('turn');
      toast.success('Your Sit & Go is starting', 'Good luck!');
      navigate(`/table/${mySng.table_id}`);
    }
    wasWaiting.current = mySng?.status === 'registering';
  }, [mySng?.status, mySng?.table_id, navigate]);

  if (error && !data) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Couldn't open the tournaments" message={error} onRetry={() => void load()} />
        </div>
      </div>
    );
  }
  if (!data) return <FullPageLoader label="Setting up the tournaments…" />;

  const run = async <T,>(key: string, fn: string, args: Record<string, unknown>): Promise<T | null> => {
    if (busy) return null;
    setBusy(key);
    const { data: res, error: err } = await supabase.rpc(fn, args);
    setBusy(null);
    void useWallet.getState().fetchStatus();
    void load();
    void mtt.load();
    if (err) {
      playSound('error');
      toast.error(friendlyError(err));
      return null;
    }
    return res as T;
  };

  const register = async (row: SngRow) => {
    const res = await run<{ started: boolean; table_id: string | null }>(`sng-${row.size}-${row.entry_fee}-${row.variant ?? 'standard'}`, 'sng_register', {
      p_size: row.size,
      p_entry_fee: row.entry_fee,
      ...(row.variant && row.variant !== 'standard' ? { p_variant: row.variant } : {}),
    });
    if (!res) return;
    playSound('chip');
    if (res.started && res.table_id) navigate(`/table/${res.table_id}`);
    else toast.success('You have a seat', 'It starts the moment the last seat fills. You can wait anywhere on the site.');
  };
  const unregister = async (row: SngRow) => {
    if (!row.id) return;
    if (await run(`sng-${row.size}-${row.entry_fee}-${row.variant ?? 'standard'}`, 'sng_unregister', { p_tournament: row.id })) toast.info('Seat given up', 'Your entry is back in your wallet.');
  };
  const enter = async (s: Showdown) => {
    if (await run(`sd-${s.id}`, 'showdown_enter', { p_tournament: s.id })) {
      playSound('chip');
      navigate(`/tournaments/${s.id}`);
    }
  };

  const freeroll = data.showdowns.find((s) => s.kind === 'freeroll');
  const showdowns = data.showdowns.filter((s) => s.kind === 'showdown');
  const fees = data.config.sng.entry_fees;
  const variants = Object.keys(data.config.sng.variants ?? { standard: 1 }).sort((a, b) => ['standard', 'turbo', 'omaha'].indexOf(a) - ['standard', 'turbo', 'omaha'].indexOf(b));
  const levelMinutes = (data.config.sng.variants?.[variant]?.level_seconds ?? data.config.sng.level_seconds) / 60;
  const inPoker = Boolean(mySng) || Boolean(mtt.data?.next?.registered) || Boolean(mttTable);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">Play for the pot</p>
          <h1 className="font-display text-4xl font-bold text-ivory">Tournaments</h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Knockout poker that starts when the table fills, slot races every {Math.round(data.config.showdown.round_seconds / 60)} minutes, and a free
            one every day.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)}>
            How it works
          </Button>
          <ButtonLink to="/leaderboards?board=tournaments" variant="ghost" size="sm">
            Tournament leaderboard
          </ButtonLink>
          <ButtonLink to="/lounge" variant="ghost" size="sm">
            ← Lounge
          </ButtonLink>
        </div>
      </header>

      {mySng?.status === 'running' && mySng.table_id && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          role="status"
          className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-500/40 bg-gold-500/10 px-5 py-4"
        >
          <p className="text-sm text-cream/90">
            Your <strong className="text-gold-200">{sizeLabel(mySng.size)} Sit &amp; Go</strong> is being played right now. Your seat is kept, and
            you&apos;re folded each hand until you&apos;re back.
          </p>
          <ButtonLink to={`/table/${mySng.table_id}`} size="sm">
            Return to your table
          </ButtonLink>
        </motion.div>
      )}

      {/* Daily Freeroll */}
      {freeroll && (
        <section aria-labelledby="freeroll-h" className="mt-8">
          <div className="relative overflow-hidden rounded-3xl border border-gold-500/40 bg-gradient-to-br from-[#3a2a08] via-ink-800 to-ink-900 p-5 shadow-card sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">Free entry · once a day</p>
                <h2 id="freeroll-h" className="gold-text font-display text-3xl font-black sm:text-4xl">
                  Daily Freeroll
                </h2>
                <p className="mt-2 max-w-md text-sm text-cream/85">
                  {data.config.freeroll.spins} spins on <strong className="text-ivory">{freeroll.machine_name}</strong>. The top{' '}
                  {data.config.freeroll.prizes.length} scores share{' '}
                  <ChipAmount value={freeroll.prize_pool} className="font-bold text-gold-200" iconClassName="h-4 w-4" color="gold" /> from the house.
                </p>
                <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <Stat label="Ends in" value={countdown(new Date(freeroll.ends_at).getTime() - now)} />
                  <Stat label="Players" value={formatChips(freeroll.entrants)} />
                  <Stat label="First place" value={<ChipAmount value={data.config.freeroll.prizes[0]} iconClassName="h-4 w-4" />} />
                  {freeroll.me && <Stat label="Your place" value={`${ordinal(freeroll.me.place)} · ${formatChips(freeroll.me.score)} pts`} />}
                </dl>
              </div>
              <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                <ShowdownAction s={freeroll} busy={busy === `sd-${freeroll.id}`} canAfford onEnter={() => void enter(freeroll)} big />
                {freeroll.top.length > 0 && (
                  <p className="text-xs text-cream/70 sm:text-right">
                    Leading: <strong className="text-cream">{freeroll.top[0].username}</strong> with {formatChips(freeroll.top[0].score)} pts
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Slot Showdowns */}
      <section aria-labelledby="showdown-h" className="mt-10">
        <h2 id="showdown-h" className="font-display text-2xl font-bold text-ivory">
          Slot Showdowns
        </h2>
        <p className="mt-1 text-sm text-muted">
          {data.config.showdown.spins} spins each, highest score takes the pot. Needs at least {data.config.showdown.min_players} players, or entries
          are returned.
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {showdowns.map((s) => (
            <li key={s.id} className="surface flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-lg font-bold text-ivory">{SHOWDOWN_TIER_LABEL[s.tier] ?? s.tier}</h3>
                <span className="rounded-full bg-felt-600/60 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider tabular-nums text-felt-300">
                  {countdown(new Date(s.ends_at).getTime() - now)} left
                </span>
              </div>
              <p className="text-sm text-cream/80">
                On <strong className="text-ivory">{s.machine_name}</strong>
              </p>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <Stat label="Entry" value={<ChipAmount value={s.entry_fee} iconClassName="h-3.5 w-3.5" />} />
                <Stat label="Players" value={s.entrants} />
                <Stat label="Pot" value={<ChipAmount value={s.prize_pool} iconClassName="h-3.5 w-3.5" />} />
              </dl>
              {s.me && (
                <p className="text-xs text-gold-200">
                  You&apos;re {ordinal(s.me.place)} with {formatChips(s.me.score)} pts
                  {s.me.spins_left > 0 ? ` · ${s.me.spins_left} spins left` : ' · all spins used'}
                </p>
              )}
              <div className="mt-auto">
                <ShowdownAction s={s} busy={busy === `sd-${s.id}`} canAfford={balance >= s.entry_fee} onEnter={() => void enter(s)} />
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Main Event: the multi-table tournament */}
      {mtt.data && (
        <section aria-labelledby="mtt-h" className="mt-10">
          <h2 id="mtt-h" className="font-display text-2xl font-bold text-ivory">
            Main Event
          </h2>
          <p className="mt-1 text-sm text-muted">
            A multi-table Hold&apos;em tournament every {Math.round(mtt.data.config.every_seconds / 60)} minutes. Up to {mtt.data.config.max_players} players on
            tables of {mtt.data.config.seats}; tables merge as players go out. Needs {mtt.data.config.min_players} to start, or entries are returned.
          </p>
          {mttTable && (
            <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-500/40 bg-gold-500/10 px-5 py-4">
              <p className="text-sm text-cream/90">You&apos;re in the Main Event that is being played now.</p>
              <ButtonLink to={`/table/${mttTable}`} size="sm">
                Return to your table
              </ButtonLink>
            </div>
          )}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {mtt.data.next && (
              <div className={cn('surface flex flex-col gap-3 p-5', mtt.data.next.registered && 'border-gold-500/50')}>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-display text-lg font-bold text-ivory">Next event</h3>
                  <span className="rounded-full bg-felt-600/60 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider tabular-nums text-felt-300">
                    starts in {countdown(new Date(mtt.data.next.starts_at).getTime() - (Date.now() + mtt.offsetMs))}
                  </span>
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                  <Stat label="Entry" value={<ChipAmount value={mtt.data.next.entry_fee} iconClassName="h-3.5 w-3.5" />} />
                  <Stat label="Players" value={`${mtt.data.next.players.length} / ${mtt.data.config.max_players}`} />
                  <Stat label="Pot so far" value={<ChipAmount value={mtt.data.next.entry_fee * mtt.data.next.players.length} iconClassName="h-3.5 w-3.5" />} />
                </dl>
                <p className="min-h-4 truncate text-xs text-muted">{mtt.data.next.players.length ? `In: ${mtt.data.next.players.join(', ')}` : 'Nobody in yet. Be the first.'}</p>
                {mtt.data.next.registered ? (
                  <Button size="sm" variant="outline" loading={busy === 'mtt'} onClick={() => void run('mtt', 'mtt_unregister', { p_tournament: mtt.data!.next!.id }).then((r) => r && toast.info('You are out of the event', 'Your entry is back in your wallet.'))}>
                    Leave the event
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    loading={busy === 'mtt'}
                    disabled={inPoker || balance < mtt.data.next.entry_fee || mtt.data.next.players.length >= mtt.data.config.max_players}
                    onClick={() => void run('mtt', 'mtt_register', { p_tournament: mtt.data!.next!.id }).then((r) => r && toast.success('You are in the Main Event', 'You will be taken to your table when it starts.'))}
                  >
                    {balance < mtt.data.next.entry_fee ? 'Not enough chips' : 'Register'}
                  </Button>
                )}
              </div>
            )}
            <div className="surface p-5">
              <h3 className="font-display text-lg font-bold text-ivory">Events being played</h3>
              {mtt.data.running.length === 0 ? (
                <p className="mt-3 text-sm text-muted">No Main Event is running at the moment.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {mtt.data.running.map((ev) => (
                    <li key={ev.id} className="text-sm">
                      <p className="text-cream/90">
                        {ev.players_left} of {ev.entrants} left · pot <ChipAmount value={ev.prize_pool} className="text-gold-200" iconClassName="h-3.5 w-3.5" />
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-2">
                        {ev.tables.map((tb) => (
                          <li key={tb.table_id}>
                            <Link to={`/table/${tb.table_id}`} className="rounded-lg border border-white/15 px-2.5 py-1 text-xs font-semibold text-gold-300 hover:border-gold-500/50">
                              Watch {tb.name.split(' · ').pop()} ({tb.players})
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Sit & Go */}
      <section aria-labelledby="sng-h" className="mt-10">
        <h2 id="sng-h" className="font-display text-2xl font-bold text-ivory">
          Sit &amp; Go poker
        </h2>
        <p className="mt-1 text-sm text-muted">
          {variant === 'omaha' ? 'Pot-Limit Omaha' : 'No-Limit Hold’em'} knockouts. Take a seat; it starts the moment the table is full. {formatChips(data.config.sng.stack)} tournament chips
          each, blinds up every {levelMinutes === 1 ? 'minute' : `${levelMinutes} minutes`}.
        </p>
        {variants.length > 1 && (
          <div role="radiogroup" aria-label="Format" className="mt-3 flex flex-wrap gap-1.5">
            {variants.map((v) => (
              <button
                key={v}
                role="radio"
                aria-checked={variant === v}
                onClick={() => setVariant(v)}
                className={cn(
                  'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                  variant === v ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:border-white/20 hover:text-ivory',
                )}
              >
                {VARIANT_LABEL[v] ?? v}
                <span className="ml-1.5 text-xs text-muted">{v === 'turbo' ? 'fast blinds' : v === 'omaha' ? 'four cards, pot limit' : "Hold'em"}</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-4 space-y-5">
          {fees.map((b) => (
            <div key={b}>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-cream/70">
                Entry <ChipAmount value={b} className="text-ivory" iconClassName="h-4 w-4" />
              </h3>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {data.sng
                  .filter((r) => r.entry_fee === b && (r.variant ?? 'standard') === variant)
                  .map((r) => {
                    const key = `sng-${r.size}-${r.entry_fee}-${r.variant ?? 'standard'}`;
                    const shares = data.config.sng.payouts[String(r.size)] ?? [100];
                    const locked = inPoker && !r.registered;
                    return (
                      <li key={key} className={cn('surface flex flex-col gap-2.5 p-4', r.registered && 'border-gold-500/50')}>
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-display text-lg font-bold text-ivory">{sizeLabel(r.size)}</h4>
                          <span className="text-xs text-muted">
                            Pot <ChipAmount value={r.prize_pool} className="font-semibold text-gold-200" iconClassName="h-3.5 w-3.5" />
                          </span>
                        </div>
                        <p className="text-xs text-cream/70">
                          {shares.length === 1 ? 'Winner takes all' : `Pays ${shares.map((p, i) => `${ordinal(i + 1)} ${p}%`).join(', ')}`}
                        </p>
                        <div className="flex items-center gap-1.5" aria-label={`${r.players.length} of ${r.size} seats taken`}>
                          {Array.from({ length: r.size }).map((_, i) => (
                            <span
                              key={i}
                              className={cn('h-2.5 flex-1 rounded-full', i < r.players.length ? 'bg-gold-400' : 'bg-white/10')}
                              aria-hidden="true"
                            />
                          ))}
                        </div>
                        <p className="min-h-4 truncate text-xs text-muted">
                          {r.players.length ? `Waiting: ${r.players.join(', ')}` : 'Nobody waiting yet. Be the first.'}
                        </p>
                        {r.registered ? (
                          <Button size="sm" variant="outline" loading={busy === key} onClick={() => void unregister(r)}>
                            Give up seat
                          </Button>
                        ) : (
                          <Button size="sm" loading={busy === key} disabled={locked || balance < r.entry_fee} onClick={() => void register(r)}>
                            {balance < r.entry_fee ? 'Not enough chips' : 'Take a seat'}
                          </Button>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </div>
        {mySng?.status === 'registering' && (
          <p className="mt-3 text-sm text-gold-200" role="status">
            You have a seat in a {sizeLabel(mySng.size)} game. You&apos;ll be taken to the table when it fills, wherever you are on the site.
          </p>
        )}
      </section>

      <PrivateEvents sizes={data.config.sng.sizes} variants={variants} inPoker={inPoker} onChanged={() => void load()} />

      <div className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="live-h" className="surface p-5">
          <h2 id="live-h" className="font-display text-xl font-bold text-ivory">
            Being played now
          </h2>
          {data.live.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No Sit &amp; Go is running at the moment.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.06]">
              {data.live.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="text-cream/85">
                    {sizeLabel(l.size)} · entry <ChipAmount value={l.entry_fee} iconClassName="h-3.5 w-3.5" /> ·{' '}
                    <span className="text-muted">{l.players_left} left</span>
                  </span>
                  <Link to={`/table/${l.table_id}`} className="font-semibold text-gold-300 hover:underline">
                    Watch →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="results-h" className="surface p-5">
          <h2 id="results-h" className="font-display text-xl font-bold text-ivory">
            Your results
          </h2>
          {data.results.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Nothing yet. Your finished tournaments show up here.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.06]">
              {data.results.map((r) => (
                <ResultRow key={r.id} r={r} />
              ))}
            </ul>
          )}
        </section>
      </div>

      <QuickStart guide="tournaments" />
      <TournamentRules open={rulesOpen} onClose={() => setRulesOpen(false)} config={data.config} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[0.65rem] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-ivory">{value}</dd>
    </div>
  );
}

function ShowdownAction({ s, busy, canAfford, onEnter, big }: { s: Showdown; busy: boolean; canAfford: boolean; onEnter: () => void; big?: boolean }) {
  const size = big ? 'lg' : 'sm';
  if (s.me) {
    return (
      <ButtonLink to={`/tournaments/${s.id}`} size={size} variant={s.me.spins_left > 0 ? 'gold' : 'outline'} block={!big}>
        {s.me.spins_left > 0 ? `Play your spins (${s.me.spins_left})` : 'See the standings'}
      </ButtonLink>
    );
  }
  return (
    <Button size={size} loading={busy} disabled={!canAfford} onClick={onEnter} block={!big}>
      {!canAfford ? 'Not enough chips' : s.entry_fee === 0 ? 'Enter free' : 'Enter'}
    </Button>
  );
}

function ResultRow({ r }: { r: TourneyResult }) {
  const name = r.kind === 'mtt' ? 'Main Event' : r.kind === 'sng' ? `Sit & Go · ${sizeLabel(r.size ?? 2)}` : r.kind === 'freeroll' ? 'Daily Freeroll' : `Slot Showdown · ${r.machine_name ?? ''}`;
  const inner = (
    <>
      <span className="min-w-0">
        <span className="block truncate text-cream/90">{name}</span>
        <span className="block text-xs text-muted">
          {r.status === 'void' ? 'Called off: entry returned' : r.place ? `${ordinal(r.place)} of ${r.entrants}` : 'Finished'}
          {r.at ? ` · ${formatRelativeTime(r.at)}` : ''}
        </span>
      </span>
      {r.status !== 'void' &&
        (r.prize ? (
          <ChipAmount value={r.prize} signed className="shrink-0 font-semibold text-gold-200" iconClassName="h-4 w-4" />
        ) : (
          <span className="shrink-0 text-xs text-muted">No prize</span>
        ))}
    </>
  );
  return (
    <li className="text-sm">
      {r.kind === 'sng' || r.kind === 'mtt' ? (
        <div className="flex items-center justify-between gap-3 py-2.5">{inner}</div>
      ) : (
        <Link to={`/tournaments/${r.id}`} className="flex items-center justify-between gap-3 rounded-lg py-2.5 hover:bg-white/[0.03]">
          {inner}
        </Link>
      )}
    </li>
  );
}
