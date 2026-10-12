import { ProfileExtras } from '@/components/progress/ProfileExtras';
import { ReportModal } from '@/components/account/ReportModal';
import { useAccount } from '@/stores/accountStore';
import { SectionNav } from '@/components/layout/SectionNav';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LevelBadge, useTitleName, XpBar } from '@/components/progress/bits';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ChipAmount } from '@/components/ui/ChipAmount';
import { ErrorState, FullPageLoader } from '@/components/ui/States';
import { cn } from '@/components/ui/cn';
import { friendlyError } from '@/lib/errors';
import { ACHIEVEMENT_GROUPS, type Achievement, type Friendship, type Loadout } from '@/lib/progress';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/stores/authStore';
import { useProgress } from '@/stores/progressStore';
import { toast } from '@/stores/toastStore';

interface Profile {
  user_id: string;
  username: string;
  member_since: string;
  xp: number;
  level: number;
  level_xp: number;
  next_level_xp: number | null;
  loadout: Loadout;
  friendship: Friendship;
  balance: number;
  achievements: { key: string; unlocked_at: string }[];
  totals: { rounds: number; won: number; wagered: number; returned: number; biggest_win: number; games: number };
  games: { game_key: string; name: string; rounds: number; won: number; biggest_win: number; net: number }[];
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-ink-950/40 p-3">
      <p className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-ivory">{children}</p>
    </div>
  );
}

function AchievementTile({ a, unlockedAt, progress }: { a: Achievement; unlockedAt: string | undefined; progress: number | undefined }) {
  const cosmetic = useProgress((s) => s.cosmetics.find((c) => c.key === a.cosmetic_key));
  const done = Boolean(unlockedAt);
  // "Play every game" is a yes/no goal, so a fraction would mean nothing.
  const showProgress = !done && progress !== undefined && a.goal > 1;
  return (
    <li className={cn('rounded-xl border p-3', done ? 'border-gold-500/40 bg-gold-500/[0.07]' : 'border-white/[0.07] bg-ink-950/30')}>
      <div className="flex items-start gap-2.5">
        <span
          className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm', done ? 'bg-gold-500 text-ink-950' : 'bg-white/[0.07] text-subtle')}
          aria-hidden="true"
        >
          {done ? '★' : '☆'}
        </span>
        <div className="min-w-0">
          <p className={cn('text-sm font-semibold', done ? 'text-ivory' : 'text-cream/70')}>
            {a.name}
            <span className="sr-only">{done ? ' (unlocked)' : ' (locked)'}</span>
          </p>
          <p className="text-xs text-muted">{a.description}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[0.7rem] text-subtle">
            {a.reward_chips > 0 && <ChipAmount value={a.reward_chips} iconClassName="h-3 w-3" />}
            {a.reward_xp > 0 && <span>{a.reward_xp} XP</span>}
            {cosmetic && <span className="text-gold-300/90">+ {cosmetic.name}</span>}
          </p>
          {showProgress && (
            <p className="mt-1 text-[0.7rem] tabular-nums text-cream/60">
              {Math.min(progress, a.goal).toLocaleString('en-US')} / {a.goal.toLocaleString('en-US')}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export default function ProfilePage() {
  const { username: param } = useParams();
  const myName = useAuth((s) => s.profile?.username);
  const username = param ?? myName;
  const catalogue = useProgress((s) => s.achievements);
  const fetchCatalogue = useProgress((s) => s.fetchCatalogue);
  const mine = useProgress((s) => s.me);
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = useTitleName(p?.loadout.title);

  const load = useCallback(async () => {
    if (!username) return;
    setError(null);
    const { data, error: err } = await supabase.rpc('get_profile', { p_username: username });
    if (err) setError(friendlyError(err));
    else setP(data as Profile);
  }, [username]);

  useEffect(() => {
    setP(null);
    void fetchCatalogue();
    void load();
  }, [load, fetchCatalogue]);

  const [reportOpen, setReportOpen] = useState(false);
  const blocked = useAccount((s) => Boolean(p && s.account?.blocked.some((b) => b.user_id === p.user_id)));

  if (error) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <div className="surface">
          <ErrorState title="Couldn't open that profile" message={error} onRetry={() => void load()} />
        </div>
      </div>
    );
  }
  if (!p) return <FullPageLoader label="Finding that player…" />;

  const self = p.friendship === 'self';
  const unlocked = new Map(p.achievements.map((a) => [a.key, a.unlocked_at]));
  const winRate = p.totals.rounds > 0 ? Math.round((p.totals.won / p.totals.rounds) * 100) : 0;

  const friend = async (fn: 'friend_request' | 'friend_remove' | 'friend_respond', args: Record<string, unknown>, done: string) => {
    setBusy(true);
    const { error: err } = await supabase.rpc(fn, args);
    setBusy(false);
    if (err) return toast.error(friendlyError(err));
    toast.success(done);
    void load();
    void useProgress.getState().fetch();
  };

  const block = async (on: boolean) => {
    setBusy(true);
    const { error: err } = await supabase.rpc(on ? 'block_player' : 'unblock_player', { p_user: p.user_id });
    setBusy(false);
    if (err) return toast.error(friendlyError(err));
    toast.success(on ? `${p.username} is blocked` : `${p.username} is unblocked`, on ? 'They can no longer add you, and you won\'t see their emotes.' : undefined);
    void useAccount.getState().fetch();
    void load();
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:py-10">
      {self && <SectionNav />}
      {!self && <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} userId={p.user_id} username={p.username} />}
      <section className="surface p-6" aria-label={`${p.username}'s profile`}>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar username={p.username} loadout={p.loadout} size={84} me={self} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold-400">{title || 'Player'}</p>
            <h1 className="flex flex-wrap items-center gap-2 font-display text-3xl font-bold text-ivory">
              {p.username} <LevelBadge level={p.level} className="text-sm" />
            </h1>
            <p className="mt-0.5 text-xs text-muted">
              Playing since {new Date(p.member_since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {self ? null : blocked ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void block(false)}>
                Blocked · Unblock
              </Button>
            ) : p.friendship === 'friends' ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void friend('friend_remove', { p_user: p.user_id }, 'Removed from your friends')}>
                Friends ✓ · Remove
              </Button>
            ) : p.friendship === 'pending_out' ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void friend('friend_remove', { p_user: p.user_id }, 'Request taken back')}>
                Request sent · Take back
              </Button>
            ) : p.friendship === 'pending_in' ? (
              <Button size="sm" disabled={busy} onClick={() => void friend('friend_respond', { p_user: p.user_id, p_accept: true }, `You and ${p.username} are now friends`)}>
                Accept friend request
              </Button>
            ) : (
              <Button size="sm" disabled={busy} onClick={() => void friend('friend_request', { p_username: p.username }, 'Friend request sent')}>
                Add friend
              </Button>
            )}
            {!self && (
              <>
                {!blocked && (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void block(true)}>
                    Block
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setReportOpen(true)}>
                  Report
                </Button>
              </>
            )}
          </div>
        </div>
        <XpBar xp={p.xp} level_xp={p.level_xp} next_level_xp={p.next_level_xp} className="mt-5" />
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Chips">
            <ChipAmount value={p.balance} compact iconClassName="h-5 w-5" />
          </Stat>
          <Stat label="Rounds">{p.totals.rounds.toLocaleString('en-US')}</Stat>
          <Stat label="Rounds won">{winRate}%</Stat>
          <Stat label="Biggest win">
            <ChipAmount value={p.totals.biggest_win} compact iconClassName="h-5 w-5" />
          </Stat>
          <Stat label="Games tried">{p.totals.games}</Stat>
        </div>
      </section>
      <ProfileExtras username={p.username} self={self} />

      <section className="mt-8" aria-labelledby="ach-title">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="ach-title" className="font-display text-2xl font-bold text-ivory">
            Achievements
          </h2>
          <p className="text-sm text-muted">
            {p.achievements.length} of {catalogue.length} unlocked
          </p>
        </div>
        {self && mine && mine.unclaimed_chips > 0 && (
          <p className="mt-2 text-sm text-gold-200">
            You have rewards waiting. <Link to="/lounge" className="font-semibold underline">Collect them in the lounge</Link>.
          </p>
        )}
        {ACHIEVEMENT_GROUPS.map((g) => {
          const list = catalogue.filter((a) => a.category === g.key);
          if (list.length === 0) return null;
          return (
            <div key={g.key} className="mt-5">
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400/90">{g.label}</h3>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((a) => (
                  <AchievementTile key={a.key} a={a} unlockedAt={unlocked.get(a.key)} progress={self ? mine?.metrics[a.metric] : undefined} />
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      {p.games.length > 0 && (
        <section className="mt-8" aria-labelledby="games-played">
          <h2 id="games-played" className="font-display text-2xl font-bold text-ivory">
            Games played
          </h2>
          <div className="surface scrollbar-thin mt-3 overflow-x-auto">
            <table className="w-full min-w-[26rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2.5">Game</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Rounds</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Won</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Biggest win</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {p.games.map((g) => (
                  <tr key={g.game_key}>
                    <th scope="row" className="px-4 py-2 font-medium text-ivory">{g.name}</th>
                    <td className="px-4 py-2 text-right tabular-nums text-cream/85">{g.rounds.toLocaleString('en-US')}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-cream/85">{g.rounds ? Math.round((g.won / g.rounds) * 100) : 0}%</td>
                    <td className="px-4 py-2 text-right">
                      <ChipAmount value={g.biggest_win} compact className="text-cream/85" iconClassName="h-3.5 w-3.5" />
                    </td>
                    <td className="px-4 py-2 text-right">
                      <ChipAmount value={g.net} signed className={g.net >= 0 ? 'text-felt-300' : 'text-ruby-300'} iconClassName="h-3.5 w-3.5" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
