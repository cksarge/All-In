import { AppealsTab, ChatLogTab, SchedulePanel, StatsTab } from '@/components/admin/AdminTools';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { FullPageLoader } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { formatChips, formatRelativeTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAccount } from '@/stores/accountStore';
import { useAuth } from '@/stores/authStore';
import { toast } from '@/stores/toastStore';

/**
 * /admin. Nothing links here. This screen is only a convenience: every admin RPC
 * checks the caller on the server (15_moderation.sql), so showing it to someone
 * else would get them nothing but errors.
 */
interface Overview {
  players: number;
  new_today: number;
  active_today: number;
  rounds_today: number;
  seated_now: number;
  chips_total: number;
  open_reports: number;
  banned: number;
  timed_out: number;
  notice: string | null;
  maintenance?: boolean;
  maintenance_message?: string | null;
  log: { id: number; action: string; at: string; target: string | null; details: Record<string, unknown> }[];
}
interface Report {
  id: number;
  reason: string;
  note: string | null;
  status: string;
  resolution: string | null;
  at: string;
  name_then: string | null;
  reported_id: string;
  reported: string | null;
  reporter: string | null;
  /** A reported chat message carries what was said. */
  context?: { chat?: boolean; body?: string; raw?: string; channel?: string } | null;
  reports_against: number;
  reporters: number;
}
interface PlayerRow {
  user_id: string;
  username: string;
  email: string | null;
  joined: string;
  last_seen: string | null;
  balance: number;
  level: number;
  banned: boolean;
  timeout_until: string | null;
  must_rename: boolean;
  admin: boolean;
  open_reports: number;
}
interface Player extends PlayerRow {
  last_sign_in: string | null;
  reports_open: number;
  peak_balance: number;
  in_play: number;
  xp: number;
  ban_reason: string | null;
  two_step?: boolean;
  timeout_reason: string | null;
  seat: { table_id: string; name: string; game: string; stack: number } | null;
  totals: { rounds: number; wagered: number; returned: number; biggest_win: number };
  games: { game: string; rounds: number; net: number }[];
  ledger: { at: string; delta: number; balance: number; reason: string; game: string | null }[];
  reports: { id: number; reason: string; note: string | null; status: string; at: string; reporter: string | null }[];
  reports_made: number;
  log: { action: string; at: string; details: Record<string, unknown> }[];
  /** The admin's own notes on this player. */
  notes?: { id: number; note: string; at: string }[];
}

const REASON: Record<string, string> = { name: 'Offensive username', cheating: 'Cheating', harassment: 'Harassment', other: 'Other' };
const TIMEOUTS = [
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '1 week', minutes: 10080 },
  { label: '30 days', minutes: 43200 },
];
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never');
const input = 'rounded-lg border border-white/15 bg-ink-950 px-3 py-2 text-sm text-cream';

export default function AdminPage() {
  const status = useAuth((s) => s.status);
  const account = useAccount((s) => s.account);
  const loaded = useAccount((s) => s.loaded);
  const [tab, setTab] = useState<'reports' | 'appeals' | 'players' | 'clubs' | 'chat' | 'stats' | 'overview'>('reports');
  const [selected, setSelected] = useState<string | null>(null);

  if (status === 'loading' || (status === 'signedIn' && !loaded)) return <FullPageLoader label="One moment…" />;
  if (status !== 'signedIn' || !account?.admin) {
    return (
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="font-display text-3xl font-bold text-ivory">Access not allowed</h1>
        <p className="mt-2 text-sm text-muted">This page isn&apos;t available to you.</p>
      </div>
    );
  }

  const open = (id: string) => {
    setSelected(id);
    setTab('players');
  };
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">Moderator only</p>
      <h1 className="font-display text-4xl font-bold text-ivory">Admin</h1>
      <div role="tablist" aria-label="Admin sections" className="mt-5 flex flex-wrap gap-1.5">
        {(['reports', 'appeals', 'players', 'clubs', 'chat', 'stats', 'overview'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-medium capitalize transition',
              tab === t ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:border-white/20 hover:text-ivory',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt-5">
        {tab === 'reports' && <Reports onOpen={open} />}
        {tab === 'players' && <Players selected={selected} onSelect={setSelected} />}
        {tab === 'clubs' && <Clubs onOpen={open} />}
        {tab === 'appeals' && <AppealsTab onOpen={open} />}
        {tab === 'chat' && <ChatLogTab onOpen={open} />}
        {tab === 'stats' && <StatsTab onOpen={open} />}
        {tab === 'overview' && <OverviewTab />}
      </div>
    </div>
  );
}

/** Runs an admin RPC and reports the outcome. Returns true when it worked. */
async function run(fn: string, args: Record<string, unknown>, done: string): Promise<boolean> {
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    toast.error(friendlyError(error));
    return false;
  }
  toast.success(done);
  return true;
}

/** Loads an admin RPC, and reloads it every `everyMs` and when the tab is looked at again. */
function useRpc<T>(fn: string, args: Record<string, unknown>, everyMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const key = JSON.stringify(args);
  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc(fn, JSON.parse(key) as Record<string, unknown>);
    if (error) toast.error(friendlyError(error));
    else setData(d as T);
  }, [fn, key]);
  useEffect(() => {
    setData(null);
    void load();
    const id = window.setInterval(() => document.visibilityState === 'visible' && void load(), everyMs);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, everyMs]);
  return { data, load };
}

function Reports({ onOpen }: { onOpen: (userId: string) => void }) {
  const [status, setStatus] = useState('open');
  const { data, load } = useRpc<Report[]>('admin_reports', { p_status: status });
  const resolve = async (r: Report, to: string) => {
    if (await run('admin_resolve_report', { p_report: r.id, p_status: to, p_resolution: null }, to === 'open' ? 'Report reopened' : `Report marked ${to}`)) void load();
  };
  const warn = async (r: Report) => {
    const why = window.prompt(`Warn ${r.reported ?? 'this player'}? They lose 25 reputation and the report is marked actioned.\n\nReason (the player sees this):`, '');
    if (why === null) return;
    if (await run('admin_warn', { p_user: r.reported_id, p_reason: why.trim() || null, p_report: r.id }, 'Warning given')) void load();
  };
  const falseReport = async (r: Report) => {
    if (!window.confirm(`Dismiss this as a false report? ${r.reporter ?? 'The reporter'} loses 10 reputation.`)) return;
    if (await run('admin_report_false', { p_report: r.id }, 'Dismissed as a false report')) void load();
  };
  return (
    <section aria-label="Reports">
      <div className="flex flex-wrap gap-1.5">
        {['open', 'actioned', 'dismissed', 'all'].map((s) => (
          <Button key={s} size="sm" variant={status === s ? 'outline' : 'ghost'} onClick={() => setStatus(s)} className="capitalize">
            {s}
          </Button>
        ))}
      </div>
      {!data ? (
        <p className="mt-4 text-sm text-muted">Loading…</p>
      ) : data.length === 0 ? (
        <p className="surface mt-4 p-5 text-sm text-muted">No {status === 'all' ? '' : status} reports.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {data.map((r) => (
            <li key={r.id} className="surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-cream/90">
                    <button type="button" className="font-semibold text-gold-200 underline" onClick={() => onOpen(r.reported_id)}>
                      {r.reported ?? 'Deleted account'}
                    </button>
                    {r.name_then && r.name_then !== r.reported && <span className="text-muted"> (was {r.name_then})</span>} · {REASON[r.reason] ?? r.reason}
                  </p>
                  {r.note && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-cream/80">“{r.note}”</p>}
                  {r.context?.chat && (
                    <p className="mt-1 rounded-lg bg-ink-950/60 p-2 text-sm text-cream/90 [overflow-wrap:anywhere]">
                      <span className="text-xs text-muted">Chat message ({r.context.channel}): </span>
                      {r.context.raw ?? r.context.body}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted">
                    From {r.reporter ?? 'a deleted account'} · {formatRelativeTime(r.at)} · {r.reports_against} report{r.reports_against === 1 ? '' : 's'} against this
                    player from {r.reporters} {r.reporters === 1 ? 'person' : 'people'}
                    {r.status !== 'open' && ` · ${r.status}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => onOpen(r.reported_id)}>
                    Open player
                  </Button>
                  {r.status === 'open' ? (
                    <>
                      <Button size="sm" variant="felt" onClick={() => void resolve(r, 'actioned')}>
                        Mark actioned
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void warn(r)} title="A warning and nothing else: the reported player loses 25 reputation">
                        Warn (−25 rep)
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void falseReport(r)} title="Dismiss, and take 10 reputation from the reporter">
                        False report (−10 rep)
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void resolve(r, 'dismissed')}>
                        Dismiss
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void resolve(r, 'open')}>
                      Reopen
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Badges({ p }: { p: PlayerRow }) {
  return (
    <>
      {p.admin && <Tag className="border-gold-500/50 text-gold-200">Admin</Tag>}
      {p.banned && <Tag className="border-ruby-400/60 text-ruby-200">Banned</Tag>}
      {p.timeout_until && <Tag className="border-ruby-400/40 text-ruby-200">Timeout</Tag>}
      {p.must_rename && <Tag className="border-white/25 text-cream/80">Must rename</Tag>}
      {p.open_reports > 0 && <Tag className="border-gold-500/40 text-gold-200">{p.open_reports} open</Tag>}
    </>
  );
}
function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider', className)}>{children}</span>;
}

function Players({ selected, onSelect }: { selected: string | null; onSelect: (id: string | null) => void }) {
  const [query, setQuery] = useState('');
  const [sent, setSent] = useState('');
  const { data } = useRpc<PlayerRow[]>('admin_find_players', { p_query: sent });
  return (
    <div className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <section aria-label="Find a player">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSent(query);
          }}
          className="flex gap-2"
        >
          <label className="sr-only" htmlFor="admin-q">
            Username or email
          </label>
          <input id="admin-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Username, email, or “banned”" className={cn(input, 'min-w-0 flex-1')} />
          <Button type="submit" size="sm">
            Search
          </Button>
        </form>
        <ul className="mt-3 max-h-[70vh] divide-y divide-white/[0.06] overflow-y-auto">
          {(data ?? []).map((p) => (
            <li key={p.user_id}>
              <button
                type="button"
                onClick={() => onSelect(p.user_id)}
                className={cn('flex w-full flex-wrap items-center gap-1.5 rounded-lg px-2 py-2 text-left text-sm hover:bg-white/[0.05]', selected === p.user_id && 'bg-gold-500/10')}
              >
                <span className="font-semibold text-ivory">{p.username}</span>
                <span className="text-xs text-muted">Lv {p.level}</span>
                <Badges p={p} />
                <span className="w-full truncate text-xs text-muted">
                  {p.email} · {p.last_seen ? `seen ${formatRelativeTime(p.last_seen)}` : 'not seen yet'}
                </span>
              </button>
            </li>
          ))}
          {data && data.length === 0 && <li className="py-3 text-sm text-muted">Nobody found.</li>}
        </ul>
      </section>
      {selected ? <PlayerPanel key={selected} userId={selected} /> : <p className="surface p-5 text-sm text-muted">Search for a player, or pick one from a report.</p>}
    </div>
  );
}

function PlayerPanel({ userId }: { userId: string }) {
  const { data: p, load } = useRpc<Player>('admin_player', { p_user: userId });
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [newName, setNewName] = useState('');
  if (!p) return <p className="surface p-5 text-sm text-muted">Loading…</p>;

  const act = async (fn: string, args: Record<string, unknown>, done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    if (await run(fn, { p_user: userId, ...args }, done)) {
      setReason('');
      void load();
    }
  };
  const chips = Number(amount.replace(/[^0-9-]/g, ''));
  const chipsOk = amount.trim() !== '' && Number.isFinite(chips);

  return (
    <section aria-label={`Player ${p.username}`} className="space-y-4">
      <div className="surface p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-display text-2xl font-bold text-ivory">{p.username}</h2>
          <Badges p={{ ...p, open_reports: p.reports_open }} />
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Fact label="Email">{p.email ?? '–'}</Fact>
          <Fact label="Joined">{when(p.joined)}</Fact>
          <Fact label="Last seen on the site">{p.last_seen ? `${formatRelativeTime(p.last_seen)} (${when(p.last_seen)})` : 'not since this was added'}</Fact>
          <Fact label="Last password sign-in">{when(p.last_sign_in)}</Fact>
          <Fact label="Balance">
            <ChipAmount value={p.balance} iconClassName="h-4 w-4" />
          </Fact>
          <Fact label="In play">
            <ChipAmount value={p.in_play} iconClassName="h-4 w-4" />
          </Fact>
          <Fact label="Peak balance">
            <ChipAmount value={p.peak_balance} iconClassName="h-4 w-4" />
          </Fact>
          <Fact label="Level">
            {p.level} ({formatChips(p.xp)} XP)
          </Fact>
          <Fact label="Rounds">{formatChips(p.totals.rounds)}</Fact>
          <Fact label="Net result">
            <ChipAmount value={p.totals.returned - p.totals.wagered} signed iconClassName="h-4 w-4" />
          </Fact>
          <Fact label="Seated at">{p.seat ? `${p.seat.name} (${p.seat.game})` : 'nowhere'}</Fact>
          <Fact label="Reports against them">
            {p.reports.length} ({p.reports_open} open)
          </Fact>
          <Fact label="Reports they sent">{p.reports_made}</Fact>
          <Fact label="Account id">
            <span className="break-all text-xs">{p.user_id}</span>
          </Fact>
        </dl>
        {p.banned && <p className="mt-3 text-sm text-ruby-200">Banned{p.ban_reason ? `: ${p.ban_reason}` : ''}</p>}
        {p.two_step && (
          <p className="mt-3 flex flex-wrap items-center gap-3 text-sm text-cream/85">
            Two-step verification is on.
            <Button
              size="sm"
              variant="outline"
              onClick={() => void act('admin_two_step_off', {}, `Two-step verification is off for ${p.username}`, `Switch two-step verification off for ${p.username}? Only do this when you are sure it is them asking: their password alone will log them in again.`)}
            >
              Switch it off
            </Button>
          </p>
        )}
        {p.timeout_until && (
          <p className="mt-3 text-sm text-ruby-200">
            In a timeout until {when(p.timeout_until)}
            {p.timeout_reason ? `: ${p.timeout_reason}` : ''}
          </p>
        )}
      </div>

      {!p.admin && (
        <div className="surface space-y-4 p-5">
          <h3 className="font-display text-lg font-bold text-ivory">Moderation</h3>
          <div>
            <label className="text-xs text-muted" htmlFor="admin-reason">
              Reason (the player sees this)
            </label>
            <input id="admin-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={cn(input, 'mt-1 w-full')} />
          </div>
          <div className="flex flex-wrap gap-2">
            {p.banned ? (
              <Button size="sm" variant="felt" onClick={() => void act('admin_unban', {}, `${p.username} is unbanned`)}>
                Unban
              </Button>
            ) : (
              <Button size="sm" variant="ruby" onClick={() => void act('admin_ban', { p_reason: reason || null }, `${p.username} is banned`, `Ban ${p.username}? They won't be able to play until you unban them.`)}>
                Ban
              </Button>
            )}
            {TIMEOUTS.map((t) => (
              <Button key={t.minutes} size="sm" variant="outline" onClick={() => void act('admin_timeout', { p_minutes: t.minutes, p_reason: reason || null }, `${p.username} is in a timeout for ${t.label}`)}>
                Timeout {t.label}
              </Button>
            ))}
            {p.timeout_until && (
              <Button size="sm" variant="felt" onClick={() => void act('admin_timeout', { p_minutes: 0, p_reason: null }, 'Timeout ended')}>
                End timeout
              </Button>
            )}
            {p.seat && (
              <Button size="sm" variant="outline" onClick={() => void act('admin_kick', {}, `${p.username} was taken off their table`)}>
                Remove from table
              </Button>
            )}
          </div>
          <div className="border-t border-white/[0.06] pt-4">
            <p className="text-sm font-medium text-cream">Username</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void act('admin_rename', { p_username: null }, 'Name removed. They must choose a new one.', `Take away the name "${p.username}" and make them choose a new one?`)}
              >
                Force a name change
              </Button>
              <label className="sr-only" htmlFor="admin-name">
                New username
              </label>
              <input id="admin-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Or set a name yourself" maxLength={16} className={cn(input, 'min-w-0 flex-1')} />
              <Button size="sm" variant="ghost" disabled={newName.trim().length < 3} onClick={() => void act('admin_rename', { p_username: newName.trim() }, 'Username changed').then(() => setNewName(''))}>
                Set name
              </Button>
            </div>
          </div>
        </div>
      )}

      <ReputationPanel userId={userId} username={p.username} />
      <NotesPanel userId={userId} notes={p.notes ?? []} onChange={load} />

      <div className="surface p-5">
        <h3 className="font-display text-lg font-bold text-ivory">Chips</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="admin-chips">
            Amount
          </label>
          <input id="admin-chips" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="Amount" className={cn(input, 'w-36')} />
          <Button size="sm" variant="felt" disabled={!chipsOk || chips <= 0} onClick={() => void act('admin_chips', { p_mode: 'add', p_amount: chips, p_note: reason || null }, `Added ${formatChips(chips)} chips`).then(() => setAmount(''))}>
            Add
          </Button>
          <Button size="sm" variant="outline" disabled={!chipsOk || chips <= 0} onClick={() => void act('admin_chips', { p_mode: 'add', p_amount: -chips, p_note: reason || null }, `Removed ${formatChips(chips)} chips`).then(() => setAmount(''))}>
            Remove
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!chipsOk || chips < 0}
            onClick={() => void act('admin_chips', { p_mode: 'set', p_amount: chips, p_note: reason || null }, `Balance set to ${formatChips(chips)}`, `Set ${p.username}'s balance to exactly ${formatChips(chips)}?`).then(() => setAmount(''))}
          >
            Set balance to this
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">Shows up in the player&apos;s activity as “Adjusted by a moderator”. The reason above is saved as a note.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <List title={`Reports against (${p.reports.length})`} empty="None.">
          {p.reports.map((r) => (
            <li key={r.id} className="py-2 text-sm">
              <span className="text-cream/90">{REASON[r.reason] ?? r.reason}</span> <span className="text-xs text-muted">· {r.status} · from {r.reporter ?? 'deleted'} · {formatRelativeTime(r.at)}</span>
              {r.note && <span className="block break-words text-xs text-cream/70">“{r.note}”</span>}
            </li>
          ))}
        </List>
        <List title="Admin actions on this player" empty="None.">
          {p.log.map((l, i) => (
            <li key={i} className="py-2 text-sm">
              <span className="text-cream/90">{l.action}</span> <span className="text-xs text-muted">· {formatRelativeTime(l.at)}</span>
              <span className="block break-words text-xs text-cream/60">{JSON.stringify(l.details)}</span>
            </li>
          ))}
        </List>
        <List title="Recent chip activity" empty="None.">
          {p.ledger.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="min-w-0 truncate text-cream/85">
                {l.reason}
                {l.game ? ` · ${l.game}` : ''} <span className="text-xs text-muted">{formatRelativeTime(l.at)}</span>
              </span>
              <ChipAmount value={l.delta} signed className={cn('shrink-0', l.delta < 0 ? 'text-ruby-300' : 'text-felt-300')} iconClassName="h-3.5 w-3.5" />
            </li>
          ))}
        </List>
        <List title="Games played" empty="Nothing yet.">
          {p.games.map((g) => (
            <li key={g.game} className="flex items-center justify-between gap-3 py-1.5 text-sm">
              <span className="text-cream/85">
                {g.game} <span className="text-xs text-muted">{formatChips(g.rounds)} rounds</span>
              </span>
              <ChipAmount value={g.net} signed className={cn('shrink-0', g.net < 0 ? 'text-ruby-300' : 'text-felt-300')} iconClassName="h-3.5 w-3.5" />
            </li>
          ))}
        </List>
      </div>
    </section>
  );
}

interface RepView {
  score: number;
  best: number;
  can_chat: boolean;
  can_quick: boolean;
  chat_banned_until: string | null;
  quick_banned_until: string | null;
  chat_ban_reason?: string | null;
  quick_ban_reason?: string | null;
  log: { delta: number; score: number; reason: string; note: string | null; at: string }[];
  messages: { id: number; channel: string; text: string; flagged: string | null; hidden: boolean; at: string }[];
}
const BAN_TIMES: { label: string; minutes: number | null }[] = [
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 1440 },
  { label: '1 week', minutes: 10080 },
  { label: 'Until lifted', minutes: null },
];
const banLabel = (iso: string | null) => (!iso ? null : new Date(iso).getFullYear() > 9000 ? 'until lifted' : `until ${when(iso)}`);

/** A player's reputation, their chat bans and what they typed lately, with its own reason box. */
function ReputationPanel({ userId, username }: { userId: string; username: string }) {
  const { data: r, load } = useRpc<RepView>('admin_reputation_view', { p_user: userId });
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  if (!r) return null;
  const n = Number(amount.replace(/[^0-9]/g, ''));
  const ok = amount.trim() !== '' && Number.isFinite(n) && n <= 100;
  const act = async (fn: string, args: Record<string, unknown>, done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    if (await run(fn, { p_user: userId, ...args }, done)) {
      setAmount('');
      setReason('');
      void load();
    }
  };
  return (
    <div className="surface space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-ivory">Reputation and chat</h3>
        <p className="text-sm text-cream/85">
          <strong className="font-display text-2xl text-ivory">{r.score}</strong> / 100 <span className="text-muted">(best {r.best})</span>
        </p>
      </div>
      <div>
        <label className="text-xs text-muted" htmlFor="admin-rep-reason">
          Reason (the player sees this with a warning or a chat ban; with a points change it is only a note for you)
        </label>
        <input id="admin-rep-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={cn(input, 'mt-1 w-full')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="admin-rep">
          Reputation points
        </label>
        <input id="admin-rep" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="Points" className={cn(input, 'w-28')} />
        <Button size="sm" variant="felt" disabled={!ok || n <= 0} onClick={() => void act('admin_reputation', { p_mode: 'add', p_amount: n, p_note: reason || null }, `Added ${n} reputation`)}>
          Add points
        </Button>
        <Button size="sm" variant="outline" disabled={!ok || n <= 0} onClick={() => void act('admin_reputation', { p_mode: 'add', p_amount: -n, p_note: reason || null }, `Removed ${n} reputation`)}>
          Remove points
        </Button>
        <Button size="sm" variant="ghost" disabled={!ok} onClick={() => void act('admin_reputation', { p_mode: 'set', p_amount: n, p_note: reason || null }, `Reputation set to ${n}`, `Set ${username}'s reputation to exactly ${n}?`)}>
          Set to this
        </Button>
        <Button size="sm" variant="outline" onClick={() => void act('admin_warn', { p_reason: reason || null, p_report: null }, 'Warning given', `Warn ${username}? They lose 25 reputation${reason.trim() ? ` and are told: "${reason.trim()}"` : '. No reason is written: they will only be told it was a warning'}.`)}>
          Warn (−25)
        </Button>
      </div>
      {(
        [
          ['chat', 'Typed chat', r.can_chat, r.chat_banned_until],
          ['quick', 'Quick chat', r.can_quick, r.quick_banned_until],
        ] as const
      ).map(([kind, label, can, banned]) => (
        <div key={kind} className="flex flex-wrap items-center gap-2">
          <p className="w-full text-sm text-cream/85 sm:w-56">
            {label}: <strong className={can ? 'text-felt-300' : 'text-ruby-300'}>{can ? 'on' : 'off'}</strong>
            {banned ? ` (banned ${banLabel(banned)})` : !can ? ' (reputation too low)' : ''}
            {banned && (kind === 'chat' ? r.chat_ban_reason : r.quick_ban_reason) && <span className="block text-xs text-muted">Reason given: {kind === 'chat' ? r.chat_ban_reason : r.quick_ban_reason}</span>}
          </p>
          {banned ? (
            <Button size="sm" variant="felt" onClick={() => void act('admin_chat_ban', { p_kind: kind, p_minutes: 0, p_reason: null }, `${label} ban lifted`)}>
              Lift ban
            </Button>
          ) : (
            BAN_TIMES.map((t) => (
              <Button key={t.label} size="sm" variant="outline" onClick={() => void act('admin_chat_ban', { p_kind: kind, p_minutes: t.minutes, p_reason: reason.trim() || null }, `${label} banned: ${t.label.toLowerCase()}`)}>
                {t.label}
              </Button>
            ))
          )}
        </div>
      ))}
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Reputation history</h4>
          {r.log.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No changes yet.</p>
          ) : (
            <ul className="mt-1 max-h-56 divide-y divide-white/[0.06] overflow-y-auto text-sm">
              {r.log.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-cream/85">
                    {l.reason.replace(/_/g, ' ')}
                    {l.note ? `: ${l.note}` : ''} <span className="text-xs text-muted">{formatRelativeTime(l.at)}</span>
                  </span>
                  <span className={cn('shrink-0 tabular-nums', l.delta > 0 ? 'text-felt-300' : l.delta < 0 ? 'text-ruby-300' : 'text-muted')}>
                    {l.delta > 0 ? `+${l.delta}` : l.delta} → {l.score}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Typed in the last 3 days (as typed)</h4>
          {r.messages.length === 0 ? (
            <p className="mt-1 text-sm text-muted">Nothing.</p>
          ) : (
            <ul className="mt-1 max-h-56 divide-y divide-white/[0.06] overflow-y-auto text-sm">
              {r.messages.map((m) => (
                <li key={m.id} className="py-1.5">
                  <p className="text-cream/90 [overflow-wrap:anywhere]">{m.text}</p>
                  <p className="text-xs text-muted">
                    {m.channel} · {formatRelativeTime(m.at)}
                    {m.flagged && <span className="ml-1 text-ruby-300">· caught: {m.flagged}{m.hidden ? ' (not delivered)' : ' (starred out)'}</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** The admin's own notes on a player: a file only the admin can read. */
function NotesPanel({ userId, notes, onChange }: { userId: string; notes: { id: number; note: string; at: string }[]; onChange: () => unknown }) {
  const [text, setText] = useState('');
  const add = async () => {
    if (await run('admin_file_note_add', { p_user: userId, p_note: text }, 'Note added')) {
      setText('');
      void onChange();
    }
  };
  const remove = async (id: number) => {
    if (!window.confirm('Delete this note?')) return;
    if (await run('admin_file_note_delete', { p_note: id }, 'Note deleted')) void onChange();
  };
  return (
    <div className="surface space-y-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-ivory">Notes on this player ({notes.length})</h3>
        <p className="text-xs text-muted">Only you can see these. The player never does.</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <label className="sr-only" htmlFor="admin-note">
          New note
        </label>
        <textarea id="admin-note" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={2} placeholder="Write a note for the file…" className={cn(input, 'min-w-0 flex-1')} />
        <Button size="sm" variant="felt" disabled={!text.trim()} onClick={() => void add()}>
          Add note
        </Button>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-muted">No notes yet.</p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <p className="min-w-0 whitespace-pre-wrap text-cream/90 [overflow-wrap:anywhere]">
                {n.note}
                <span className="block text-xs text-muted">{when(n.at)}</span>
              </p>
              <button type="button" onClick={() => void remove(n.id)} className="shrink-0 text-xs text-subtle hover:text-ruby-300" aria-label="Delete this note">
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="truncate font-medium text-cream">{children}</dd>
    </div>
  );
}
function List({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <div className="surface p-5">
      <h3 className="font-display text-lg font-bold text-ivory">{title}</h3>
      {children.length === 0 ? <p className="mt-2 text-sm text-muted">{empty}</p> : <ul className="mt-2 max-h-72 divide-y divide-white/[0.06] overflow-y-auto">{children}</ul>}
    </div>
  );
}

interface AdminClub {
  id: string;
  name: string;
  tag: string;
  members: number;
  week_rounds: number;
  owner: string | null;
  owner_id: string | null;
}

function Clubs({ onOpen }: { onOpen: (userId: string) => void }) {
  const { data, load } = useRpc<AdminClub[]>('admin_clubs', { p_query: '' }, 30_000);
  const rename = async (c: AdminClub) => {
    const name = window.prompt('New club name (3 to 24 letters, numbers and spaces)', c.name);
    if (!name) return;
    const tag = window.prompt('New tag (2 to 5 letters or numbers)', c.tag);
    if (!tag) return;
    if (await run('admin_club_rename', { p_club: c.id, p_name: name, p_tag: tag }, 'Club renamed')) void load();
  };
  const remove = async (c: AdminClub) => {
    if (!window.confirm(`Close the club "${c.name}" for good? Its ${c.members} members are simply left without a club.`)) return;
    if (await run('admin_club_delete', { p_club: c.id }, 'Club closed')) void load();
  };
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  if (data.length === 0) return <p className="surface p-5 text-sm text-muted">No clubs yet.</p>;
  return (
    <ul className="space-y-2" aria-label="Clubs">
      {data.map((c) => (
        <li key={c.id} className="surface flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ivory">
              {c.name} <span className="ml-1 rounded border border-white/15 px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wider text-cream/80">{c.tag}</span>
            </p>
            <p className="text-xs text-muted">
              {c.members} members · {formatChips(c.week_rounds)} rounds this week · owner{' '}
              {c.owner_id ? (
                <button type="button" className="text-gold-200 underline" onClick={() => onOpen(c.owner_id!)}>
                  {c.owner}
                </button>
              ) : (
                'nobody'
              )}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void rename(c)}>
            Rename
          </Button>
          <Button size="sm" variant="ruby" onClick={() => void remove(c)}>
            Close club
          </Button>
        </li>
      ))}
    </ul>
  );
}

function OverviewTab() {
  const { data, load } = useRpc<Overview>('admin_overview', {});
  const [notice, setNotice] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const text = notice ?? data.notice ?? '';
  const maintenance = async (on: boolean) => {
    if (on && !window.confirm('Close the site to everyone but you? Players will see a maintenance page until you open it again.')) return;
    if (await run('admin_set_maintenance', { p_on: on, p_message: on ? (why ?? data.maintenance_message ?? '') : null }, on ? 'The site is closed for maintenance' : 'The site is open again')) {
      setWhy(null);
      void load();
    }
  };
  const save = async (message: string) => {
    if (await run('admin_set_notice', { p_message: message }, message ? 'Notice is up' : 'Notice taken down')) {
      setNotice(null);
      void load();
      void useAccount.getState().fetch();
    }
  };
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Players', data.players],
          ['New today', data.new_today],
          ['Played today', data.active_today],
          ['Rounds today', data.rounds_today],
          ['Seated now', data.seated_now],
          ['Open reports', data.open_reports],
          ['Banned', data.banned],
          ['In a timeout', data.timed_out],
        ].map(([label, value]) => (
          <div key={label} className="surface p-4">
            <dt className="text-[0.65rem] uppercase tracking-wider text-muted">{label}</dt>
            <dd className="font-display text-2xl font-bold tabular-nums text-ivory">{formatChips(Number(value))}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">
        Chips held by all players: <ChipAmount value={data.chips_total} className="text-cream" iconClassName="h-4 w-4" />
      </p>
      <div className={cn('surface p-5', data.maintenance && 'border-ruby-400/60')}>
        <h3 className="font-display text-lg font-bold text-ivory">Site maintenance</h3>
        <p className="mt-1 text-sm text-muted">
          While this is on, nobody but you can use the site: everyone else sees a maintenance page, signed in or not, and nobody can log in. Stay
          signed in here, or you will need the emergency file (supabase/maintenance/maintenance_off.sql) to open the site again.
        </p>
        <p className={cn('mt-3 text-sm font-semibold', data.maintenance ? 'text-ruby-200' : 'text-felt-300')} role="status">
          Maintenance is {data.maintenance ? 'ON: the site is closed' : 'off: the site is open'}.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="admin-maint">
            Message for players (optional)
          </label>
          <input id="admin-maint" value={why ?? data.maintenance_message ?? ''} onChange={(e) => setWhy(e.target.value)} maxLength={300} placeholder="Message for players (optional), e.g. Back at 9 pm" className={cn(input, 'min-w-0 flex-1')} />
          {data.maintenance ? (
            <Button size="sm" variant="felt" onClick={() => void maintenance(false)}>
              Open the site
            </Button>
          ) : (
            <Button size="sm" variant="ruby" onClick={() => void maintenance(true)}>
              Close the site for maintenance
            </Button>
          )}
        </div>
      </div>
      <div className="surface p-5">
        <h3 className="font-display text-lg font-bold text-ivory">Site notice</h3>
        <p className="mt-1 text-sm text-muted">A strip under the top bar that every signed-in player sees. Leave it empty to show nothing.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="admin-notice">
            Notice
          </label>
          <input id="admin-notice" value={text} onChange={(e) => setNotice(e.target.value)} maxLength={200} className={cn(input, 'min-w-0 flex-1')} />
          <Button size="sm" onClick={() => void save(text)}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void save('')}>
            Take down
          </Button>
        </div>
      </div>
      <SchedulePanel />
      <div className="surface p-5">
        <h3 className="font-display text-lg font-bold text-ivory">Recent admin actions</h3>
        {data.log.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {data.log.map((l) => (
              <li key={l.id} className="py-2 text-sm">
                <span className="text-cream/90">{l.action}</span>
                {l.target && <span className="text-gold-200"> · {l.target}</span>} <span className="text-xs text-muted">· {formatRelativeTime(l.at)}</span>
                <span className="block break-words text-xs text-cream/60">{JSON.stringify(l.details)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
