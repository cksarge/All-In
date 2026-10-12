import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SectionNav } from '@/components/layout/SectionNav';
import { PlayerLine } from '@/components/progress/bits';
import { Button, ButtonLink } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { TextField } from '@/components/ui/TextField';
import { ChatBox } from '@/components/chat/ChatBox';
import { cn } from '@/components/ui/cn';
import { useChat } from '@/hooks/useChat';
import { QUICK_PHRASES } from '@/lib/blackjack';
import { phraseGroups } from '@/lib/chat';
import { EMBLEMS, type ClubMember, type ClubState, type ClubSummary } from '@/lib/clubs';
import { friendlyError } from '@/lib/errors';
import { formatChips } from '@/lib/format';
import { playSound } from '@/lib/sound';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/authStore';
import { useProgress } from '@/stores/progressStore';
import { CHAT_GAP_MS, useReputation } from '@/stores/reputationStore';
import { toast } from '@/stores/toastStore';

/** /clubs (your club, or the list to join one) and /clubs/:id (any club). */
export default function ClubsPage() {
  const { id } = useParams();
  const [club, setClub] = useState<ClubState | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('club_state', { p_club: id ?? null });
    if (err) setError(friendlyError(err));
    else {
      setError(null);
      setClub((data as ClubState | null) ?? null);
    }
  }, [id]);
  useEffect(() => {
    setClub(undefined);
    void load();
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => window.clearInterval(t);
  }, [load]);

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Couldn't open the club" message={error} onRetry={() => void load()} />
          <div className="flex justify-center pb-6">
            <ButtonLink to="/clubs" variant="outline" size="sm">
              All clubs
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  }
  if (club === undefined) return <FullPageLoader label="Opening the clubhouse…" />;
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      <SectionNav />
      {club ? <ClubView club={club} reload={load} /> : <Browse reload={load} />}
    </div>
  );
}

async function call(fn: string, args: Record<string, unknown>, done?: string): Promise<boolean> {
  const { error } = await supabase.rpc(fn, args);
  if (error) {
    playSound('error');
    toast.error(friendlyError(error));
    return false;
  }
  if (done) toast.success(done);
  void useProgress.getState().fetch();
  return true;
}

function Emblem({ emblem, className }: { emblem: string; className?: string }) {
  return (
    <span className={cn('flex shrink-0 items-center justify-center rounded-2xl border border-gold-500/30 bg-gradient-to-br from-felt-800 to-ink-900', className)} aria-hidden="true">
      {EMBLEMS[emblem] ?? '♠️'}
    </span>
  );
}

/** Not in a club: find one or start one. */
function Browse({ reload }: { reload: () => Promise<void> }) {
  const [list, setList] = useState<ClubSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [emblem, setEmblem] = useState('spade');
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    const { data, error } = await supabase.rpc('clubs_list', { p_query: q });
    if (error) toast.error(friendlyError(error));
    else setList((data ?? []) as ClubSummary[]);
  }, []);
  useEffect(() => {
    void search('');
  }, [search]);

  const run = async (key: string, fn: string, args: Record<string, unknown>, done: string) => {
    setBusy(key);
    const ok = await call(fn, args, done);
    setBusy(null);
    if (ok) {
      playSound('success');
      await reload();
    }
  };

  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">Play on the same side</p>
      <h1 className="font-display text-4xl font-bold text-ivory">Clubs</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        A club is a group of up to 50 players with its own name, tag and weekly standings. You can be in one club at a time.
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="surface p-5" aria-labelledby="find-club-h">
          <h2 id="find-club-h" className="font-display text-xl font-bold text-ivory">
            Find a club
          </h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search(query);
            }}
          >
            <label className="sr-only" htmlFor="club-q">
              Club name or tag
            </label>
            <input id="club-q" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or tag" className="min-w-0 flex-1 rounded-xl border border-white/15 bg-ink-950 px-3 py-2 text-sm text-cream" />
            <Button type="submit" size="sm" variant="outline">
              Search
            </Button>
          </form>
          {!list ? (
            <p className="mt-4 text-sm text-muted">Loading…</p>
          ) : list.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No clubs found. Start the first one.</p>
          ) : (
            <ul className="mt-3 divide-y divide-white/[0.06]">
              {list.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <Emblem emblem={c.emblem} className="h-11 w-11 text-xl" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/clubs/${c.id}`} className="block truncate font-semibold text-ivory hover:underline">
                      {c.name} <span className="ml-1 rounded border border-white/15 px-1.5 py-0.5 text-[0.65rem] font-bold tracking-wider text-cream/80">{c.tag}</span>
                    </Link>
                    <p className="text-xs text-muted">
                      {c.members} member{c.members === 1 ? '' : 's'} · {formatChips(c.week_rounds)} rounds this week · {c.is_open ? 'open to all' : 'invite only'}
                    </p>
                  </div>
                  {c.is_open ? (
                    <Button size="sm" loading={busy === c.id} disabled={c.members >= 50} onClick={() => void run(c.id, 'club_join', { p_club: c.id, p_code: null }, `Welcome to ${c.name}`)}>
                      {c.members >= 50 ? 'Full' : 'Join'}
                    </Button>
                  ) : (
                    <ButtonLink size="sm" variant="ghost" to={`/clubs/${c.id}`}>
                      View
                    </ButtonLink>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            className="mt-4 flex flex-wrap items-end gap-2 border-t border-white/[0.06] pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run('code', 'club_join', { p_club: null, p_code: code.trim() }, 'Welcome to the club');
            }}
          >
            <TextField label="Have an invite code?" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} autoComplete="off" spellCheck={false} className="min-w-0 flex-1" />
            <Button type="submit" variant="outline" loading={busy === 'code'} disabled={code.trim().length !== 6}>
              Join with code
            </Button>
          </form>
        </section>

        <section className="surface self-start p-5" aria-labelledby="new-club-h">
          <h2 id="new-club-h" className="font-display text-xl font-bold text-ivory">
            Start a club
          </h2>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run('create', 'club_create', { p_name: name, p_tag: tag, p_emblem: emblem, p_open: open }, 'Club created');
            }}
          >
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={24} hint="3 to 24 letters, numbers and spaces." autoComplete="off" required />
            <TextField label="Tag" value={tag} onChange={(e) => setTag(e.target.value.toUpperCase())} maxLength={5} hint="2 to 5 letters or numbers." autoComplete="off" spellCheck={false} required />
            <fieldset>
              <legend className="text-sm font-medium text-cream">Emblem</legend>
              <div className="mt-1.5 grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Emblem">
                {Object.entries(EMBLEMS).map(([k, g]) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={emblem === k}
                    aria-label={k}
                    onClick={() => setEmblem(k)}
                    className={cn('flex h-10 items-center justify-center rounded-lg border text-lg transition', emblem === k ? 'border-gold-400 bg-gold-500/15' : 'border-white/10 hover:border-white/25')}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex items-center gap-2 text-sm text-cream/90">
              <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="accent-gold-500" />
              Anyone can join (untick for invite only)
            </label>
            <Button type="submit" loading={busy === 'create'} disabled={name.trim().length < 3 || tag.trim().length < 2}>
              Create club
            </Button>
          </form>
        </section>
      </div>
    </>
  );
}

function ClubView({ club, reload }: { club: ClubState; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const userId = useAuth((s) => s.user?.id);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const member = club.my_role !== null;
  const owner = club.my_role === 'owner';
  const canKick = (m: ClubMember) => m.user_id !== userId && (owner || (club.my_role === 'officer' && m.role === 'member'));

  const run = async (key: string, fn: string, args: Record<string, unknown>, done: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(key);
    const ok = await call(fn, args, done);
    setBusy(null);
    if (ok) await reload();
    return ok;
  };

  return (
    <>
      <header className="surface flex flex-wrap items-center gap-4 p-5">
        <Emblem emblem={club.emblem} className="h-16 w-16 text-3xl" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">Club · {club.is_open ? 'open to all' : 'invite only'}</p>
          <h1 className="flex flex-wrap items-center gap-2 font-display text-3xl font-bold text-ivory">
            {club.name} <span className="rounded border border-white/20 px-2 py-0.5 text-sm font-bold tracking-wider text-cream/85">{club.tag}</span>
          </h1>
          <p className="mt-0.5 text-sm text-muted">
            {club.members} of 50 members · {formatChips(club.week_rounds)} rounds played this week
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!member && !club.my_club && club.is_open && (
            <Button loading={busy === 'join'} disabled={club.members >= 50} onClick={() => void run('join', 'club_join', { p_club: club.id, p_code: null }, `Welcome to ${club.name}`)}>
              {club.members >= 50 ? 'Club is full' : 'Join club'}
            </Button>
          )}
          {member && (
            <Button
              variant="outline"
              size="sm"
              loading={busy === 'leave'}
              onClick={() =>
                void run('leave', 'club_leave', {}, `You left ${club.name}`, club.members === 1 ? 'You are the last member: leaving closes the club. Leave?' : `Leave ${club.name}?`).then((ok) => ok && navigate('/clubs'))
              }
            >
              Leave club
            </Button>
          )}
          <ButtonLink to="/clubs" variant="ghost" size="sm">
            {member ? 'My club' : 'All clubs'}
          </ButtonLink>
        </div>
      </header>

      {!member && !club.is_open && !club.my_club && <p className="mt-3 text-sm text-muted">This club is invite only. Ask a member for its code and enter it on the clubs page.</p>}
      {!member && club.my_club && <p className="mt-3 text-sm text-muted">You are in another club. Leave it first if you want to join this one.</p>}

      {member && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <section className="surface p-5" aria-labelledby="club-invite-h">
            <h2 id="club-invite-h" className="font-display text-lg font-bold text-ivory">
              Bring someone in
            </h2>
            <p className="mt-1 text-sm text-muted">{club.is_open ? 'Anyone can join from the clubs page. The invite code works too.' : 'The invite code is the only way in.'}</p>
            {club.invite_code ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {/* Hidden until asked for, like a password field. */}
                <span className="rounded-lg border border-gold-500/40 px-3 py-1.5 font-mono text-lg tracking-[0.3em] text-gold-200" aria-label={showCode ? `Invite code ${club.invite_code}` : 'Invite code, hidden'}>
                  {showCode ? club.invite_code : '••••••'}
                </span>
                <Button size="sm" variant="ghost" aria-pressed={showCode} onClick={() => setShowCode((v) => !v)}>
                  {showCode ? 'Hide' : 'Show'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(club.invite_code ?? '');
                      toast.success('Invite code copied');
                    } catch {
                      setShowCode(true);
                    }
                  }}
                >
                  Copy
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-sm text-cream/85">Only the owner can see this club&apos;s invite code. Ask them to share it.</p>
            )}
            {owner && (
              <div className="mt-4 border-t border-white/[0.06] pt-3">
                <label className="flex items-center gap-2 text-sm text-cream/90">
                  <input type="checkbox" checked={club.is_open} onChange={(e) => void run('open', 'club_update', { p_open: e.target.checked, p_emblem: null }, e.target.checked ? 'The club is open to all' : 'The club is invite only')} className="accent-gold-500" />
                  Anyone can join
                </label>
                <label className="mt-2 flex items-center gap-2 text-sm text-cream/90">
                  <input
                    type="checkbox"
                    checked={club.code_visible !== false}
                    onChange={(e) => void run('codevis', 'club_update', { p_open: null, p_emblem: null, p_code_visible: e.target.checked }, e.target.checked ? 'Members can see the invite code' : 'Only you can see the invite code')}
                    className="accent-gold-500"
                  />
                  Members can see the invite code
                </label>
                <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Emblem">
                  {Object.entries(EMBLEMS).map(([k, g]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={club.emblem === k}
                      aria-label={k}
                      onClick={() => void run('emblem', 'club_update', { p_open: null, p_emblem: k }, 'Emblem changed')}
                      className={cn('flex h-9 w-9 items-center justify-center rounded-lg border text-base', club.emblem === k ? 'border-gold-400 bg-gold-500/15' : 'border-white/10 hover:border-white/25')}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
          <ClubChat clubId={club.id} members={club.roster} />
        </div>
      )}

      <section className="surface mt-5 p-5" aria-labelledby="roster-h">
        <h2 id="roster-h" className="font-display text-xl font-bold text-ivory">
          Members
        </h2>
        <p className="mt-1 text-sm text-muted">Ordered by rounds played this week (Monday to Sunday, UTC).</p>
        <ul className="mt-2 divide-y divide-white/[0.06]">
          {club.roster.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <PlayerLine username={m.username} level={m.level} loadout={m.loadout} me={m.user_id === userId} />
              </div>
              {m.role !== 'member' && <span className="rounded-full border border-gold-500/40 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-gold-200">{m.role}</span>}
              <span className="text-right text-xs text-muted">
                <span className="block tabular-nums text-cream/85">{formatChips(m.week_rounds)} rounds</span>
                <ChipAmount value={m.week_net} signed className={m.week_net < 0 ? 'text-ruby-300' : 'text-felt-300'} iconClassName="h-3 w-3" />
              </span>
              <div className="flex w-full flex-wrap justify-end gap-1.5 sm:w-auto">
                {member && m.table && m.user_id !== userId && (
                  <ButtonLink size="sm" variant="outline" to={`/table/${m.table.id}`}>
                    Join their table
                  </ButtonLink>
                )}
                {owner && m.user_id !== userId && (
                  <>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run(`role-${m.user_id}`, 'club_set_role', { p_user: m.user_id, p_role: m.role === 'officer' ? 'member' : 'officer' }, m.role === 'officer' ? `${m.username} is a member again` : `${m.username} is now an officer`)}>
                      {m.role === 'officer' ? 'Remove officer' : 'Make officer'}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void run(`own-${m.user_id}`, 'club_set_role', { p_user: m.user_id, p_role: 'owner' }, `${m.username} now owns the club`, `Hand the club over to ${m.username}? You become an officer.`)}>
                      Make owner
                    </Button>
                  </>
                )}
                {canKick(m) && (
                  <Button size="sm" variant="ghost" className="text-ruby-300" disabled={busy !== null} onClick={() => void run(`kick-${m.user_id}`, 'club_kick', { p_user: m.user_id }, `${m.username} was removed`, `Remove ${m.username} from the club?`)}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** Typed chat for the members (kept 3 days), and the quick phrases, which are live and not stored. */
function ClubChat({ clubId, members }: { clubId: string; members: ClubMember[] }) {
  const userId = useAuth((s) => s.user?.id);
  const [lines, setLines] = useState<{ id: number; user_id: string; index: number }[]>([]);
  const channel = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSent = useRef(0);
  const chat = useChat(`club:${clubId}`, true);
  const canQuick = useReputation((s) => s.rep?.can_quick !== false);
  const groups = phraseGroups('club');
  const [tab, setTab] = useState(groups[0].key);
  const names = useRef(new Map<string, string>());
  names.current = new Map(members.map((m) => [m.user_id, m.username]));

  useEffect(() => {
    const ch = supabase
      .channel(`club:${clubId}`, { config: { broadcast: { self: true } } })
      .on('broadcast', { event: 'say' }, ({ payload }) => {
        const p = payload as { user_id?: unknown; index?: unknown };
        // Anyone can reach a broadcast channel: only show known phrases from this club's members.
        if (typeof p.user_id !== 'string' || typeof p.index !== 'number' || p.index < 0 || p.index >= QUICK_PHRASES.length || !names.current.has(p.user_id)) return;
        setLines((l) => [...l.slice(-19), { id: Date.now() + Math.random(), user_id: p.user_id as string, index: p.index as number }]);
      })
      .subscribe();
    channel.current = ch;
    return () => {
      void supabase.removeChannel(ch);
      channel.current = null;
    };
  }, [clubId]);

  const say = (index: number) => {
    if (!userId || !channel.current || !canQuick || Date.now() - lastSent.current < CHAT_GAP_MS) return;
    lastSent.current = Date.now();
    playSound('click');
    void channel.current.send({ type: 'broadcast', event: 'say', payload: { user_id: userId, index } });
  };

  return (
    <section className="surface p-5" aria-labelledby="club-chat-h">
      <h2 id="club-chat-h" className="font-display text-lg font-bold text-ivory">
        Club chat
      </h2>
      <p className="mt-1 text-xs text-muted">For members only. Typed messages are kept for 3 days.</p>
      <ChatBox chat={chat} className="mt-2" listClassName="h-44" />
      <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-muted">Quick phrases</h3>
      <p className="mt-1 text-xs text-muted">{canQuick ? 'Members who have this page open see them. They are not kept.' : 'Quick chat is switched off for you at the moment. Your profile says why.'}</p>
      <ul className="mt-2 h-24 space-y-1 overflow-y-auto rounded-xl bg-ink-950/50 p-2 text-sm" aria-live="polite">
        {lines.length === 0 ? (
          <li className="text-muted">Nothing said yet.</li>
        ) : (
          lines.map((l) => (
            <li key={l.id} className="text-cream/90">
              <span className={cn('font-semibold', l.user_id === userId ? 'text-gold-200' : 'text-ivory')}>{names.current.get(l.user_id)}:</span> {QUICK_PHRASES[l.index]}
            </li>
          ))
        )}
      </ul>
      <div role="tablist" aria-label="Kind of message" className="mt-2 flex flex-wrap gap-1">
        {groups.map((g) => (
          <button
            key={g.key}
            type="button"
            role="tab"
            aria-selected={tab === g.key}
            onClick={() => setTab(g.key)}
            className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition', tab === g.key ? 'border-gold-500/60 bg-gold-500/15 text-gold-200' : 'border-white/10 text-cream/75 hover:border-white/25')}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto overscroll-contain">
        {(groups.find((g) => g.key === tab) ?? groups[0]).items.map((i) => (
          <button key={i} type="button" onClick={() => say(i)} className="rounded-full border border-white/15 px-2.5 py-1 text-left text-xs text-cream/90 hover:border-gold-500/50 hover:text-ivory">
            {QUICK_PHRASES[i]}
          </button>
        ))}
      </div>
    </section>
  );
}
