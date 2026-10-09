import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { GameIcon } from '@/components/ui/GameIcon';
import { Modal } from '@/components/ui/Modal';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { TierBadge } from '@/components/ui/TierBadge';
import { TextField } from '@/components/ui/TextField';
import { cn } from '@/components/ui/cn';
import { useLobbyTables, type LobbyTable } from '@/hooks/useLobby';
import { friendlyError } from '@/lib/errors';
import { formatChips } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import type { GameRow, StakeTier, TierKey } from '@/lib/types';
import { usePresence } from '@/stores/presenceStore';
import { toast } from '@/stores/toastStore';
import { useWallet } from '@/stores/walletStore';

export function inviteLink(code: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}join/${code}`;
}

export default function LobbyPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [games, setGames] = useState<GameRow[] | null>(null);
  const [tiers, setTiers] = useState<StakeTier[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const game = params.get('game') ?? 'blackjack';
  const { tables, error, reload } = useLobbyTables(game);
  const online = usePresence((s) => s.online);
  const status = useWallet((s) => s.status);
  const chips = (status?.balance ?? 0) + (status?.chips_in_play ?? 0);
  const [busy, setBusy] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    void (async () => {
      const [g, t] = await Promise.all([
        supabase.from('games').select('key, name, category, tagline, multiplayer, max_seats, sort_order, released').eq('multiplayer', true).order('sort_order'),
        supabase.from('stake_tiers').select('*').order('tier_rank'),
      ]);
      const err = g.error ?? t.error;
      if (err) setLoadError(friendlyError(err));
      else {
        setGames(g.data as GameRow[]);
        setTiers(t.data as StakeTier[]);
      }
    })();
  }, []);

  const current = games?.find((g) => g.key === game);
  const gameTiers = useMemo(() => tiers.filter((t) => t.game_key === game), [tiers, game]);

  const go = async (key: string, fn: () => PromiseLike<{ data: unknown; error: unknown }>) => {
    setBusy(key);
    const { data, error: err } = await fn();
    setBusy(null);
    if (err) {
      playSound('error');
      toast.error("Couldn't join", friendlyError(err));
      return;
    }
    playSound('chip');
    navigate(`/table/${(data as { table_id: string }).table_id}`);
  };

  const onJoinCode = (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(clean)) {
      toast.error('Check the code', 'Invite codes are 6 letters and numbers.');
      return;
    }
    void go('code', () => supabase.rpc('join_by_code', { p_code: clean }));
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Couldn't open the lobby" message={loadError} onRetry={() => window.location.reload()} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">Multiplayer</p>
          <h1 className="font-display text-4xl font-bold text-ivory">Lobby</h1>
        </div>
        <p className="flex items-center gap-2 text-sm text-cream/80" aria-live="polite">
          <span className="h-2 w-2 rounded-full bg-felt-300 shadow-[0_0_8px_rgba(92,195,146,0.9)]" aria-hidden="true" />
          {online.length} {online.length === 1 ? 'player' : 'players'} online
        </p>
      </header>

      {/* Game tabs */}
      <div role="tablist" aria-label="Games" className="scrollbar-thin mt-6 flex gap-2 overflow-x-auto pb-1">
        {(games ?? []).map((g) => (
          <button
            key={g.key}
            role="tab"
            aria-selected={g.key === game}
            onClick={() => setParams({ game: g.key })}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition',
              g.key === game ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/80 hover:border-white/20',
            )}
          >
            <GameIcon gameKey={g.key} className="h-6 w-6" />
            {g.name}
            {!g.released && <span className="text-[0.6rem] uppercase tracking-wider text-muted">Soon</span>}
          </button>
        ))}
        {games === null && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-32 shrink-0" />)}
      </div>

      {current && !current.released ? (
        <div className="surface mt-8">
          <EmptyState
            icon={<GameIcon gameKey={current.key} className="h-12 w-12" />}
            title={`${current.name} opens soon`}
            message="The tables are being built. Blackjack is open now."
            action={
              <Button size="sm" className="mt-2" onClick={() => setParams({ game: 'blackjack' })}>
                Play blackjack
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {/* Quick join by stake level */}
          <section aria-labelledby="stakes-h" className="mt-8">
            <h2 id="stakes-h" className="font-display text-2xl font-bold text-ivory">Quick join</h2>
            <p className="mt-1 text-sm text-muted">Jump into the liveliest table at your stake level.</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {gameTiers.map((t) => {
                const locked = status ? chips < t.min_bankroll : false;
                return (
                  <li key={t.tier} className={cn(`tier-${t.tier}`, 'rounded-2xl border p-4', locked && 'opacity-60')}>
                    <div className="flex items-center justify-between">
                      <TierBadge tier={t.tier} />
                      {locked && <span className="text-xs text-cream/70">Locked</span>}
                    </div>
                    <p className="mt-3 text-sm text-cream/85">
                      Bets <strong className="text-ivory">{formatChips(t.min_bet)}–{formatChips(t.max_bet)}</strong>
                    </p>
                    <p className="text-xs text-cream/65">
                      Needs <ChipAmount value={t.min_bankroll} iconClassName="h-3.5 w-3.5" /> to sit
                    </p>
                    <Button
                      size="sm"
                      block
                      className="mt-3"
                      variant={t.tier === 'vip' ? 'gold' : 'felt'}
                      disabled={locked}
                      loading={busy === `quick-${t.tier}`}
                      onClick={() => go(`quick-${t.tier}`, () => supabase.rpc('quick_join', { p_game: game, p_tier: t.tier }))}
                    >
                      {locked ? `Need ${formatChips(t.min_bankroll)} chips` : 'Quick join'}
                    </Button>
                  </li>
                );
              })}
              {gameTiers.length === 0 && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
            </ul>
          </section>

          {/* Private tables */}
          <section className="surface mt-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-display text-xl font-bold text-ivory">Play with friends</h2>
              <p className="mt-1 text-sm text-muted">Open a private table and share the invite code.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setCreateOpen(true)}>
                Create private table
              </Button>
            </div>
            <form onSubmit={onJoinCode} className="flex items-end gap-2">
              <TextField
                label="Have a code?"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABC123"
                autoCapitalize="characters"
                spellCheck={false}
                className="w-36"
              />
              <Button type="submit" variant="felt" loading={busy === 'code'}>
                Join
              </Button>
            </form>
          </section>

          {/* Live tables */}
          <section aria-labelledby="tables-h" className="mt-8">
            <h2 id="tables-h" className="font-display text-2xl font-bold text-ivory">Live tables</h2>
            {error ? (
              <div className="surface mt-4">
                <ErrorState message={error} onRetry={() => void reload()} />
              </div>
            ) : tables === null ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-36" />
                ))}
              </div>
            ) : tables.length === 0 ? (
              <div className="surface mt-4">
                <EmptyState title="No tables yet" message="Use Quick join to open the first one." />
              </div>
            ) : (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {tables.map((t, i) => (
                  <TableCard
                    key={t.id}
                    table={t}
                    index={i}
                    locked={status ? chips < t.min_bankroll : false}
                    busy={busy === t.id}
                    onJoin={() => go(t.id, () => supabase.rpc('join_table', { p_table: t.id, p_seat: null }))}
                    onWatch={() => navigate(`/table/${t.id}`)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <CreatePrivateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        game={game}
        tiers={gameTiers}
        chips={chips}
        onCreated={(id) => navigate(`/table/${id}`)}
      />
    </div>
  );
}

function TableCard({
  table,
  index,
  locked,
  busy,
  onJoin,
  onWatch,
}: {
  table: LobbyTable;
  index: number;
  locked: boolean;
  busy: boolean;
  onJoin: () => void;
  onWatch: () => void;
}) {
  const full = table.seats_filled >= table.max_seats;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className={cn('surface flex flex-col p-4', table.is_mine && 'border-gold-500/50')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-bold text-ivory">{table.name}</h3>
          <p className="text-xs text-muted">
            Bets {formatChips(table.min_bet)}–{formatChips(table.max_bet)}
            {table.is_private && ' · Private'}
          </p>
        </div>
        <TierBadge tier={table.tier as TierKey} />
      </div>
      <div className="mt-3 flex items-center gap-1.5" aria-label={`${table.seats_filled} of ${table.max_seats} seats taken`}>
        {Array.from({ length: table.max_seats }).map((_, i) => (
          <span
            key={i}
            className={cn('h-2.5 w-2.5 rounded-full', i < table.seats_filled ? 'bg-gold-400' : 'bg-white/15')}
            aria-hidden="true"
          />
        ))}
        <span className="ml-1 text-xs text-cream/75">
          {table.seats_filled}/{table.max_seats}
        </span>
      </div>
      <p className="mt-2 min-h-5 truncate text-xs text-muted">
        {table.players.length ? table.players.map((p) => p.username).join(', ') : 'Empty table'}
      </p>
      <div className="mt-auto flex gap-2 pt-3">
        {table.is_mine ? (
          <Button size="sm" block onClick={onWatch}>
            Back to your seat
          </Button>
        ) : (
          <>
            <Button size="sm" className="flex-1" variant="felt" onClick={onJoin} loading={busy} disabled={full || locked}>
              {full ? 'Full' : locked ? 'Locked' : 'Sit down'}
            </Button>
            {!table.is_private && (
              <Button size="sm" variant="ghost" onClick={onWatch}>
                Watch
              </Button>
            )}
          </>
        )}
      </div>
    </motion.li>
  );
}

function CreatePrivateModal({
  open,
  onClose,
  game,
  tiers,
  chips,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  game: string;
  tiers: StakeTier[];
  chips: number;
  onCreated: (id: string) => void;
}) {
  const [tier, setTier] = useState<TierKey>('low');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);

  useEffect(() => {
    if (!open) setCreated(null);
  }, [open]);

  const create = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('create_table', { p_game: game, p_tier: tier, p_private: true });
    setBusy(false);
    if (error) {
      toast.error("Couldn't create the table", friendlyError(error));
      return;
    }
    const d = data as { table_id: string; invite_code: string };
    setCreated({ id: d.table_id, code: d.invite_code });
    playSound('success');
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.info('Copy the code', text);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create a private table">
      {created ? (
        <div className="text-center">
          <h2 className="font-display text-2xl font-bold text-ivory">Your table is ready</h2>
          <p className="mt-2 text-sm text-muted">Share this code with friends. They enter it in the lobby, or open the link.</p>
          <p className="mt-5 font-display text-4xl font-bold tracking-[0.3em] text-gold-300" aria-label={`Invite code ${created.code.split('').join(' ')}`}>
            {created.code}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => copy(created.code)}>
              Copy code
            </Button>
            <Button variant="outline" size="sm" onClick={() => copy(inviteLink(created.code))}>
              Copy invite link
            </Button>
          </div>
          <Button block className="mt-6" onClick={() => onCreated(created.id)}>
            Go to the table
          </Button>
        </div>
      ) : (
        <div>
          <h2 className="font-display text-2xl font-bold text-ivory">Private table</h2>
          <p className="mt-2 text-sm text-muted">Only people with the invite code can join.</p>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-cream/90">Stake level</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {tiers.map((t) => {
                const locked = chips < t.min_bankroll;
                return (
                  <label
                    key={t.tier}
                    className={cn(
                      'cursor-pointer rounded-xl border p-3 text-sm transition',
                      tier === t.tier ? 'border-gold-500/70 bg-gold-500/10' : 'border-white/10 hover:border-white/25',
                      locked && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <input
                      type="radio"
                      name="tier"
                      className="sr-only"
                      checked={tier === t.tier}
                      disabled={locked}
                      onChange={() => setTier(t.tier)}
                    />
                    <TierBadge tier={t.tier} />
                    <span className="mt-2 block text-xs text-cream/80">
                      {formatChips(t.min_bet)}–{formatChips(t.max_bet)}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <Button block className="mt-6" onClick={create} loading={busy}>
            Create table
          </Button>
          <p className="mt-3 text-center text-xs text-subtle">
            Or <Link to="/lobby" onClick={onClose} className="text-gold-300 hover:underline">browse public tables</Link>.
          </p>
        </div>
      )}
    </Modal>
  );
}
