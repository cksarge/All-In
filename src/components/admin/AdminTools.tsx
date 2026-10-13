import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { formatChips, formatRelativeTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { useAccount } from '@/stores/accountStore';
import { toast } from '@/stores/toastStore';

/** The moderator's tools of stage 12 part 4: the schedule, site statistics, the chat log and appeals. */

const input = 'rounded-lg border border-white/15 bg-ink-950 px-3 py-2 text-sm text-cream';
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

async function call<T>(fn: string, args: Record<string, unknown>, done?: string): Promise<T | null> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    toast.error(friendlyError(error));
    return null;
  }
  if (done) toast.success(done);
  return (data ?? true) as T;
}

function useLoad<T>(fn: string, args: Record<string, unknown>, everyMs = 0) {
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
    if (!everyMs) return;
    const id = window.setInterval(() => document.visibilityState === 'visible' && void load(), everyMs);
    return () => window.clearInterval(id);
  }, [load, everyMs]);
  return { data, load };
}

// ---------------------------------------------------------------------------
// Scheduled notices and maintenance
// ---------------------------------------------------------------------------
interface Scheduled {
  id: number;
  kind: 'notice' | 'maintenance';
  message: string | null;
  starts_at: string;
  ends_at: string | null;
  state: 'waiting' | 'running' | 'over' | 'cancelled';
}
const STATE_STYLE = { waiting: 'text-gold-200', running: 'text-felt-300', over: 'text-muted', cancelled: 'text-muted line-through' } as const;

/** A value for <input type="datetime-local"> some minutes from now, in the browser's own time zone. */
function localIn(minutes: number): string {
  const d = new Date(Date.now() + minutes * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function SchedulePanel() {
  const { data, load } = useLoad<Scheduled[]>('admin_schedule', {}, 30_000);
  const [kind, setKind] = useState<'notice' | 'maintenance'>('notice');
  const [message, setMessage] = useState('');
  const [start, setStart] = useState(() => localIn(30));
  const [end, setEnd] = useState(() => localIn(90));
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (kind === 'maintenance' && !window.confirm(`Close the site to everyone but you from ${when(new Date(start).toISOString())}${end ? ` until ${when(new Date(end).toISOString())}` : ' until you open it again'}?`)) return;
    setBusy(true);
    const ok = await call('admin_schedule_add', { p_kind: kind, p_message: message, p_starts_at: new Date(start).toISOString(), p_ends_at: end ? new Date(end).toISOString() : null }, 'Scheduled');
    setBusy(false);
    if (ok) {
      setMessage('');
      void load();
      void useAccount.getState().fetch();
    }
  };
  const cancel = async (s: Scheduled) => {
    await call('admin_schedule_cancel', { p_id: s.id }, 'Cancelled');
    void load();
    // The notice strip on this page follows at once.
    void useAccount.getState().fetch();
  };

  return (
    <div className="surface p-5">
      <h3 className="font-display text-lg font-bold text-ivory">Schedule a notice or maintenance</h3>
      <p className="mt-1 text-sm text-muted">
        It starts and ends by itself, at the times you set (shown in your own time zone). A scheduled notice replaces the one above while it runs.
        Scheduled maintenance closes the site like the switch does; players get a warning strip during the hour before. Leave the end empty to keep
        the site closed until you open it.
      </p>
      <form onSubmit={(e) => void add(e)} className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-[auto_1fr_auto_auto_auto] lg:items-end">
        <label className="flex flex-col gap-1 text-xs text-muted">
          What
          <select value={kind} onChange={(e) => setKind(e.target.value as 'notice' | 'maintenance')} className={input}>
            <option value="notice">Notice</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted">
          {kind === 'notice' ? 'Words of the notice' : 'Words for players (optional)'}
          <input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={kind === 'notice' ? 200 : 300} required={kind === 'notice'} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Starts
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Ends
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required={kind === 'notice'} className={input} />
        </label>
        <Button type="submit" size="sm" loading={busy} variant={kind === 'maintenance' ? 'ruby' : 'gold'}>
          Schedule
        </Button>
      </form>
      {!data ? (
        <p className="mt-3 text-sm text-muted">Loading…</p>
      ) : data.length === 0 ? (
        <p className="mt-3 text-sm text-muted">Nothing is scheduled.</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/[0.06]" aria-label="Scheduled">
          {data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className={cn('w-20 shrink-0 text-xs font-bold uppercase tracking-wider', STATE_STYLE[s.state])}>{s.state}</span>
              <span className="font-semibold capitalize text-ivory">{s.kind}</span>
              <span className="text-cream/80">
                {when(s.starts_at)} to {s.ends_at ? when(s.ends_at) : 'until opened'}
              </span>
              {s.message && <span className="min-w-0 basis-full text-xs text-cream/70 [overflow-wrap:anywhere] sm:basis-auto">“{s.message}”</span>}
              {(s.state === 'waiting' || s.state === 'running') && (
                <Button size="sm" variant="ghost" className="ml-auto" aria-label={`Cancel the scheduled ${s.kind}`} onClick={() => void cancel(s)}>
                  Cancel
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Site statistics
// ---------------------------------------------------------------------------
interface Stats {
  totals: Record<string, number>;
  days: { day: string; new_players: number; active: number; rounds: number; wagered: number; returned: number }[];
  games: { game: string; name: string; rounds: number; players: number; wagered: number; returned: number }[];
  ledger: { reason: string; entries: number; chips: number }[];
  richest: { user_id: string; username: string; balance: number }[];
}

function Bars({ title, days, value, format = formatChips }: { title: string; days: Stats['days']; value: (d: Stats['days'][number]) => number; format?: (n: number) => string }) {
  const max = Math.max(1, ...days.map(value));
  const total = days.reduce((n, d) => n + value(d), 0);
  return (
    <figure className="surface p-4">
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ivory">{title}</span>
        <span className="text-xs text-muted">
          today {format(value(days[days.length - 1]))} · total {format(total)}
        </span>
      </figcaption>
      <div className="mt-3 flex h-24 items-end gap-[3px]" role="img" aria-label={`${title}, by day: ${days.map((d) => `${d.day} ${value(d)}`).join(', ')}`}>
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end">
            <div className="w-full rounded-t bg-gold-500/70 group-hover:bg-gold-300" style={{ height: `${Math.max(2, (value(d) / max) * 100)}%` }} />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink-950 px-1.5 py-0.5 text-[0.65rem] text-cream group-hover:block">
              {d.day.slice(5)}: {format(value(d))}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1 flex justify-between text-[0.65rem] text-subtle">
        <span>{days[0].day.slice(5)}</span>
        <span>{days[days.length - 1].day.slice(5)}</span>
      </p>
    </figure>
  );
}

export function StatsTab({ onOpen }: { onOpen: (userId: string) => void }) {
  const [span, setSpan] = useState(14);
  const { data, load } = useLoad<Stats>('admin_stats', { p_days: span }, 60_000);
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  const t = data.totals;
  const facts: [string, ReactNode][] = [
    ['Players', formatChips(t.players)],
    ['Online now', formatChips(t.online_now)],
    ['Seated now', formatChips(t.seated_now)],
    ['Played today', formatChips(t.active_1d)],
    ['Played, 7 days', formatChips(t.active_7d)],
    ['Played, 30 days', formatChips(t.active_30d)],
    ['Average level', String(t.average_level)],
    ['Average reputation', String(t.average_reputation)],
    ['Chat limited', formatChips(t.chat_limited)],
    ['Suspended', formatChips(t.banned)],
    ['Open reports', formatChips(t.open_reports)],
    ['Open appeals', formatChips(t.open_appeals)],
    ['Clubs', `${formatChips(t.clubs)} (${formatChips(t.club_members)} members)`],
    ['Friendships', formatChips(t.friendships)],
    ['Tournaments, 7 days', formatChips(t.tournaments_7d)],
    ['Chat kept', `${formatChips(t.messages_kept)} (${formatChips(t.messages_caught)} caught)`],
  ];
  const wagered = data.games.reduce((n, g) => n + g.wagered, 0);
  const returned = data.games.reduce((n, g) => n + g.returned, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Days shown:</span>
        {[7, 14, 30, 60].map((n) => (
          <button key={n} type="button" aria-pressed={span === n} onClick={() => setSpan(n)} className={cn('rounded-full border px-3 py-1 text-sm', span === n ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75')}>
            {n}
          </button>
        ))}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {facts.map(([label, value]) => (
          <div key={label} className="surface p-3">
            <dt className="text-[0.65rem] uppercase tracking-wider text-muted">{label}</dt>
            <dd className="font-display text-xl font-bold tabular-nums text-ivory">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">
        Chips held by all players: <ChipAmount value={t.chips_total} className="text-cream" iconClassName="h-4 w-4" /> · the player in the middle holds{' '}
        <ChipAmount value={t.chips_median} className="text-cream" iconClassName="h-4 w-4" />
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Bars title="Players who played" days={data.days} value={(d) => d.active} />
        <Bars title="Rounds played" days={data.days} value={(d) => d.rounds} />
        <Bars title="New players" days={data.days} value={(d) => d.new_players} />
        <Bars title="Chips bet" days={data.days} value={(d) => d.wagered} />
      </div>
      <p className="text-xs text-muted">Days are UTC. Old rounds are removed by the cleanup file, so long spans may look emptier than they were.</p>

      <div className="surface p-5">
        <h3 className="font-display text-lg font-bold text-ivory">Games, last 7 days</h3>
        <p className="mt-1 text-sm text-muted">
          {data.games.length} game{data.games.length === 1 ? '' : 's'} played. Bet {formatChips(wagered)}, paid back {formatChips(returned)}
          {wagered > 0 ? ` (${((returned / wagered) * 100).toFixed(1)}%)` : ''}. Poker and tournaments move chips between players, so theirs sit near 100%.
        </p>
        <div className="scrollbar-thin mt-3 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wider text-muted">
                <th scope="col" className="py-1.5">Game</th>
                <th scope="col" className="py-1.5 text-right">Rounds</th>
                <th scope="col" className="py-1.5 text-right">Players</th>
                <th scope="col" className="py-1.5 text-right">Bet</th>
                <th scope="col" className="py-1.5 text-right">Paid back</th>
                <th scope="col" className="py-1.5 text-right">Return</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {data.games.map((g) => (
                <tr key={g.game}>
                  <th scope="row" className="py-1.5 font-normal text-cream">{g.name}</th>
                  <td className="py-1.5 text-right tabular-nums">{formatChips(g.rounds)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatChips(g.players)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatChips(g.wagered)}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatChips(g.returned)}</td>
                  <td className="py-1.5 text-right tabular-nums text-gold-200">{g.wagered > 0 ? `${((g.returned / g.wagered) * 100).toFixed(1)}%` : '·'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="surface p-5">
          <h3 className="font-display text-lg font-bold text-ivory">Where chips came from and went, last 7 days</h3>
          <ul className="mt-2 divide-y divide-white/[0.06] text-sm">
            {data.ledger.map((l) => (
              <li key={l.reason} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-cream">
                  {l.reason.replace(/_/g, ' ')} <span className="text-xs text-muted">· {formatChips(l.entries)} {l.entries === 1 ? 'entry' : 'entries'}</span>
                </span>
                <span className={cn('tabular-nums', l.chips >= 0 ? 'text-felt-300' : 'text-ruby-200')}>
                  {l.chips >= 0 ? '+' : '−'}
                  {formatChips(Math.abs(l.chips))}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="surface p-5">
          <h3 className="font-display text-lg font-bold text-ivory">Largest balances</h3>
          <ol className="mt-2 divide-y divide-white/[0.06] text-sm">
            {data.richest.map((r, i) => (
              <li key={r.user_id} className="flex items-baseline justify-between gap-3 py-1.5">
                <button type="button" className="text-left text-gold-200 hover:underline" onClick={() => onOpen(r.user_id)}>
                  {i + 1}. {r.username}
                </button>
                <ChipAmount value={r.balance} className="text-cream" iconClassName="h-3.5 w-3.5" />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat log search
// ---------------------------------------------------------------------------
interface ChatRow {
  id: number;
  channel: string;
  kind: 'table' | 'club' | 'room' | 'dm';
  place: string | null;
  user_id: string;
  username: string;
  body: string;
  raw: string | null;
  flagged: string | null;
  hidden: boolean;
  at: string;
}
const CHAT_KINDS: [string, string][] = [
  ['all', 'Everywhere'],
  ['table', 'Tables'],
  ['club', 'Clubs'],
  ['room', 'Live rooms'],
  ['dm', 'Direct messages'],
  ['caught', 'Caught by the filter'],
  ['hidden', 'Not delivered'],
];

export function ChatLogTab({ onOpen }: { onOpen: (userId: string) => void }) {
  const [query, setQuery] = useState('');
  const [player, setPlayer] = useState('');
  const [kind, setKind] = useState('all');
  const [rows, setRows] = useState<ChatRow[] | null>(null);
  const [kept, setKept] = useState(3);
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);

  const search = async (before: number | null) => {
    setBusy(true);
    const res = await call<{ messages: ChatRow[]; kept_days: number }>('admin_chat_search', { p_query: query, p_player: player, p_kind: kind, p_before: before });
    setBusy(false);
    if (!res) return;
    setKept(res.kept_days);
    setMore(res.messages.length === 100);
    setRows((old) => (before && old ? [...old, ...res.messages] : res.messages));
  };

  return (
    <div className="space-y-4">
      <form
        className="surface flex flex-wrap items-end gap-2 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void search(null);
        }}
      >
        <label className="flex min-w-0 flex-1 basis-48 flex-col gap-1 text-xs text-muted">
          Words
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Any words (empty = everything)" className={input} />
        </label>
        <label className="flex min-w-0 basis-40 flex-col gap-1 text-xs text-muted">
          Player
          <input value={player} onChange={(e) => setPlayer(e.target.value)} placeholder="Username" className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Where
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
            {CHAT_KINDS.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" loading={busy}>
          Search the chat
        </Button>
      </form>
      <p className="text-xs text-muted">
        Messages are kept for {kept} days and then deleted, so that is as far back as a search can go. Each search is written to the admin log.
        “As typed” shows what a player wrote before the filter starred it out.
      </p>
      {rows === null ? null : rows.length === 0 ? (
        <p className="surface p-5 text-sm text-muted">No messages match.</p>
      ) : (
        <ul className="surface divide-y divide-white/[0.06] px-4" aria-label="Messages found">
          {rows.map((m) => (
            <li key={m.id} className="py-2.5 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <button type="button" className="font-semibold text-gold-200 hover:underline" onClick={() => onOpen(m.user_id)}>
                  {m.username}
                </button>
                <span className="text-xs text-muted">
                  {m.place ?? m.channel} · {formatRelativeTime(m.at)} · {when(m.at)}
                </span>
                {m.hidden && <span className="rounded-full bg-ruby-600/40 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-ruby-100">not delivered</span>}
                {m.flagged && <span className="rounded-full bg-gold-500/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-gold-200">{m.flagged}</span>}
              </p>
              <p className="mt-0.5 text-cream [overflow-wrap:anywhere]">{m.body}</p>
              {m.raw && m.raw !== m.body && <p className="mt-0.5 text-xs text-cream/60 [overflow-wrap:anywhere]">As typed: {m.raw}</p>}
            </li>
          ))}
        </ul>
      )}
      {rows && more && (
        <Button size="sm" variant="outline" loading={busy} onClick={() => void search(rows[rows.length - 1].id)}>
          Older messages
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------
interface Appeal {
  id: number;
  user_id: string;
  username: string;
  kind: 'ban' | 'timeout' | 'chat';
  message: string;
  context: { ban_reason?: string; timeout_until?: string; timeout_reason?: string; reputation?: number };
  status: 'open' | 'accepted' | 'denied';
  reply: string | null;
  at: string;
  resolved_at: string | null;
  now: 'ban' | 'timeout' | 'chat' | null;
  reputation: number;
  earlier: number;
}
const APPEAL_KIND = { ban: 'Suspension', timeout: 'Timeout', chat: 'Chat restriction' } as const;

function AppealRow({ a, onOpen, onDone }: { a: Appeal; onOpen: (userId: string) => void; onDone: () => void }) {
  const [reply, setReply] = useState('');
  const [lift, setLift] = useState(true);
  const [rep, setRep] = useState(a.kind === 'chat' || a.reputation > 30 ? '' : '50');
  const [busy, setBusy] = useState(false);
  const answer = async (accept: boolean) => {
    setBusy(true);
    const ok = await call('admin_appeal_resolve', { p_appeal: a.id, p_accept: accept, p_reply: reply, p_lift: lift, p_reputation: accept && rep !== '' ? Number(rep) : null }, accept ? 'Appeal accepted' : 'Appeal turned down');
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <li className="surface p-4 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <button type="button" className="font-display text-lg font-bold text-gold-200 hover:underline" onClick={() => onOpen(a.user_id)}>
          {a.username}
        </button>
        <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-cream/80">{APPEAL_KIND[a.kind]}</span>
        <span className="text-xs text-muted">
          {formatRelativeTime(a.at)}
          {a.earlier > 0 ? ` · ${a.earlier} earlier appeal${a.earlier === 1 ? '' : 's'}` : ''}
        </span>
        {a.status !== 'open' && <span className={cn('ml-auto text-xs font-bold uppercase tracking-wider', a.status === 'accepted' ? 'text-felt-300' : 'text-ruby-200')}>{a.status}</span>}
      </p>
      <p className="mt-1 text-xs text-muted">
        {a.context.ban_reason && `Reason given: ${a.context.ban_reason}. `}
        {a.context.timeout_until && `Timeout until ${when(a.context.timeout_until)}${a.context.timeout_reason ? ` (${a.context.timeout_reason})` : ''}. `}
        Reputation then {a.context.reputation ?? '?'}, now {a.reputation}. Standing now: {a.now ? APPEAL_KIND[a.now].toLowerCase() : 'nothing in force'}.
      </p>
      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-white/[0.04] p-3 text-cream [overflow-wrap:anywhere]">{a.message}</p>
      {a.status === 'open' ? (
        <div className="mt-3 space-y-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Your reply (the player sees this)
            <input value={reply} onChange={(e) => setReply(e.target.value)} maxLength={500} className={input} />
          </label>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-xs text-cream/85">
              <input type="checkbox" checked={lift} onChange={(e) => setLift(e.target.checked)} className="h-4 w-4 accent-[#d4af37]" />
              Accepting lifts the {APPEAL_KIND[a.kind].toLowerCase()}
            </label>
            <label className="flex items-center gap-2 text-xs text-cream/85">
              and sets reputation to
              <input value={rep} onChange={(e) => setRep(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="as is" aria-label="Reputation to set when accepting" className={cn(input, 'w-20 py-1')} />
            </label>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="felt" loading={busy} onClick={() => void answer(true)}>
                Accept
              </Button>
              <Button size="sm" variant="ruby" loading={busy} onClick={() => void answer(false)}>
                Turn down
              </Button>
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-cream/75">
          Answered {when(a.resolved_at)}
          {a.reply ? `: ${a.reply}` : ' with no reply.'}
        </p>
      )}
    </li>
  );
}

export function AppealsTab({ onOpen }: { onOpen: (userId: string) => void }) {
  const [status, setStatus] = useState<'open' | 'answered'>('open');
  const { data, load } = useLoad<Appeal[]>('admin_appeals', { p_status: status }, 30_000);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['open', 'answered'] as const).map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)} className={cn('rounded-full border px-3 py-1 text-sm capitalize', status === s ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75')}>
            {s}
          </button>
        ))}
        <p className="text-xs text-muted">A player who is suspended, in a timeout or barred from chat can send one appeal, and another 3 days after a refusal.</p>
      </div>
      {!data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : data.length === 0 ? (
        <p className="surface p-5 text-sm text-muted">{status === 'open' ? 'No appeals are waiting.' : 'No appeals have been answered yet.'}</p>
      ) : (
        <ul className="space-y-3">
          {data.map((a) => (
            <AppealRow key={a.id} a={a} onOpen={onOpen} onDone={() => void load()} />
          ))}
        </ul>
      )}
    </div>
  );
}
