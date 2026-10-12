import { useEffect, useState } from 'react';
import { PlayerLine } from '@/components/progress/bits';
import { ChipAmount } from '@/components/ui/ChipAmount';
import type { ProfileExtras as Extras } from '@/lib/clubs';
import { formatChips } from '@/lib/format';
import { supabase } from '@/lib/supabase';

/** The profile's club, personal records and head-to-head (17_clubs_records.sql). Shows nothing until that file is run. */
/** `onClub` hands the player's club to the page, which shows it in the top card. */
export function ProfileExtras({ username, self, onClub }: { username: string; self: boolean; onClub?: (club: Extras['club']) => void }) {
  const [x, setX] = useState<Extras | null>(null);
  const [trend, setTrend] = useState<number[]>([]);
  const [trophies, setTrophies] = useState<{ kind: string; place: number; count: number }[]>([]);
  useEffect(() => {
    setX(null);
    onClub?.(null);
    void supabase.rpc('profile_extras', { p_username: username }).then(({ data, error }) => {
      if (!error) {
        setX(data as Extras);
        onClub?.((data as Extras).club);
      }
    });
    setTrophies([]);
    void supabase.rpc('trophies_for', { p_username: username }).then(({ data, error }) => {
      if (!error && Array.isArray(data)) setTrophies(data as { kind: string; place: number; count: number }[]);
    });
  }, [username]);
  // Your own balance over your last hundred chip changes (only you can read your ledger).
  useEffect(() => {
    if (!self) return;
    void supabase
      .from('chip_ledger')
      .select('balance_after')
      .order('id', { ascending: false })
      .limit(100)
      .then(({ data }) => setTrend(((data ?? []) as { balance_after: number }[]).map((r) => Number(r.balance_after)).reverse()));
  }, [self, username]);

  if (!x) return null;
  const r = x.records;
  const v = x.versus;
  const met = v ? v.hands_me + v.hands_them + v.tourney_me + v.tourney_them > 0 : false;

  return (
    <>
      {v && (
        <section className="surface mt-5 p-5" aria-labelledby="versus-h">
          <h2 id="versus-h" className="font-display text-xl font-bold text-ivory">
            You against {username}
          </h2>
          {met ? (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Versus label="Poker hands" me={v.hands_me} them={v.hands_them} them_name={username} />
              <Versus label="Sit & Go finishes" me={v.tourney_me} them={v.tourney_them} them_name={username} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">You haven&apos;t met at a poker table or in a Sit &amp; Go yet.</p>
          )}
        </section>
      )}

      {trophies.length > 0 && (
        <section className="surface mt-5 p-5" aria-labelledby="trophies-h">
          <h2 id="trophies-h" className="font-display text-xl font-bold text-ivory">
            Trophies
          </h2>
          <ul className="mt-3 flex flex-wrap gap-2.5">
            {trophies.map((t) => (
              <li key={`${t.kind}-${t.place}`} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-ink-950/40 px-3 py-2">
                <span className="text-2xl" aria-hidden="true">
                  {['🥇', '🥈', '🥉'][t.place - 1]}
                </span>
                <span className="text-sm leading-tight">
                  <span className="block font-semibold text-ivory">
                    {['1st', '2nd', '3rd'][t.place - 1]} × {t.count}
                  </span>
                  <span className="block text-xs text-muted">{{ sng: 'Sit & Go', mtt: 'Main Event', showdown: 'Slot Showdown', freeroll: 'Daily Freeroll' }[t.kind] ?? t.kind}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="surface mt-5 p-5" aria-labelledby="records-h">
        <h2 id="records-h" className="font-display text-xl font-bold text-ivory">
          Personal records
        </h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Record label="Highest balance">
            <ChipAmount value={r.peak_balance} compact iconClassName="h-4 w-4" />
          </Record>
          <Record label="Best win">{r.best_multiple > 0 ? `×${formatChips(Math.floor(Number(r.best_multiple)))} the bet` : '–'}</Record>
          <Record label="Longest winning streak">{r.best_streak > 0 ? `${r.best_streak} rounds` : '–'}</Record>
          <Record label="Favourite game">{r.favourite ? r.favourite.name : '–'}</Record>
          <Record label="Tournaments won">
            {r.tournament_wins} of {r.tournaments}
          </Record>
          <Record label="Poker hands won from others">{formatChips(r.poker_hands_won)}</Record>
          <Record label="Missions finished">{formatChips(r.missions)}</Record>
          <Record label="Season rewards">{formatChips(r.season_rewards)}</Record>
        </dl>
        {r.best_games.length > 0 && (
          <>
            <h3 className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Biggest wins by game</h3>
            <ol className="mt-2 divide-y divide-white/[0.06]">
              {r.best_games.map((g) => (
                <li key={g.name} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-cream/90">{g.name}</span>
                  <ChipAmount value={g.biggest_win} className="shrink-0 font-semibold text-gold-200" iconClassName="h-4 w-4" />
                </li>
              ))}
            </ol>
          </>
        )}
        {self && trend.length > 2 && <Trend points={trend} />}
      </section>

      {x.rivals && x.rivals.length > 0 && (
        <section className="surface mt-5 p-5" aria-labelledby="rivals-h">
          <h2 id="rivals-h" className="font-display text-xl font-bold text-ivory">
            Rivals
          </h2>
          <p className="mt-1 text-sm text-muted">The players you&apos;ve met most at poker tables and in Sit &amp; Gos.</p>
          <ul className="mt-2 divide-y divide-white/[0.06]">
            {x.rivals.map((p) => (
              <li key={p.user_id} className="flex items-center justify-between gap-3 py-2.5">
                <PlayerLine username={p.username} level={p.level} loadout={p.loadout} />
                <span className="shrink-0 text-sm tabular-nums">
                  <span className="font-semibold text-felt-300">{p.won}</span> <span className="text-muted">won ·</span>{' '}
                  <span className="font-semibold text-ruby-300">{p.lost}</span> <span className="text-muted">lost</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function Record({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.07] p-3">
      <dt className="text-[0.65rem] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ivory">{children}</dd>
    </div>
  );
}

function Versus({ label, me, them, them_name }: { label: string; me: number; them: number; them_name: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] p-3 text-center">
      <p className="text-[0.65rem] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-black tabular-nums text-ivory" aria-label={`You ${me}, ${them_name} ${them}`}>
        <span className={me > them ? 'text-felt-300' : undefined}>{me}</span> <span className="text-muted">–</span>{' '}
        <span className={them > me ? 'text-ruby-300' : undefined}>{them}</span>
      </p>
      <p className="text-xs text-muted">you – {them_name}</p>
    </div>
  );
}

/** A small line chart of your balance. */
function Trend({ points }: { points: number[] }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(1, max - min);
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (points.length - 1)) * 300).toFixed(1)},${(56 - ((p - min) / span) * 52).toFixed(1)}`).join(' ');
  return (
    <div className="mt-5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-400">Your balance lately</h3>
      <svg viewBox="0 0 300 60" className="mt-2 h-16 w-full" role="img" aria-label={`Your balance over your last ${points.length} chip changes: from ${formatChips(points[0])} to ${formatChips(points[points.length - 1])}, between ${formatChips(min)} and ${formatChips(max)}`} preserveAspectRatio="none">
        <path d={d} fill="none" stroke="#d4af37" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <p className="flex justify-between text-xs text-muted">
        <span>Low {formatChips(min)}</span>
        <span>Last {points.length} changes · only you see this</span>
        <span>High {formatChips(max)}</span>
      </p>
    </div>
  );
}
