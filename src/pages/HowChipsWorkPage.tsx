import { useEffect, useMemo, useState } from 'react';
import { ChipAmount, PlayChipsBadge } from '@/components/ui/ChipAmount';
import { ChipIcon } from '@/components/ui/ChipIcon';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { TierBadge } from '@/components/ui/TierBadge';
import { friendlyError } from '@/lib/errors';
import { formatChips } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { EconomyConfig, GameRow, StakeTier } from '@/lib/types';

const NOT_ALLOWED = [
  'Paid for, with anything at all',
  'Sold, traded, or given to another player',
  'Exchanged for cash, gift cards, crypto or prizes',
  'Redeemed or converted into anything of value',
];

function intervalHours(pg: string): number {
  // Postgres interval text, e.g. "04:00:00" or "1 day 02:00:00".
  const days = Number(pg.match(/(\d+) day/)?.[1] ?? 0);
  const hms = pg.match(/(\d+):(\d+):(\d+)/);
  return days * 24 + (hms ? Number(hms[1]) + Number(hms[2]) / 60 : 0);
}

export default function HowChipsWorkPage() {
  const [config, setConfig] = useState<EconomyConfig | null>(null);
  const [games, setGames] = useState<Pick<GameRow, 'key' | 'name'>[]>([]);
  const [tiers, setTiers] = useState<StakeTier[]>([]);
  const [game, setGame] = useState('blackjack');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [c, g, t] = await Promise.all([
      supabase.from('economy_config').select('*').maybeSingle(),
      supabase.from('games').select('key, name').order('sort_order'),
      supabase.from('stake_tiers').select('*').order('tier_rank'),
    ]);
    const err = c.error ?? g.error ?? t.error;
    if (err) setError(friendlyError(err));
    else {
      setConfig(c.data as EconomyConfig | null);
      setGames((g.data ?? []) as Pick<GameRow, 'key' | 'name'>[]);
      setTiers((t.data ?? []) as StakeTier[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const gameTiers = useMemo(() => tiers.filter((t) => t.game_key === game), [tiers, game]);
  const isPoker = game.startsWith('poker_');

  const start = config?.starting_chips ?? 10000;
  const base = config?.daily_base ?? 1000;
  const mults = config?.daily_multipliers ?? [1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  const threshold = config?.refill_threshold ?? 1000;
  const refillTo = config?.refill_to ?? 5000;
  const cooldownH = config ? intervalHours(config.refill_cooldown) : 4;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:py-14">
      <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-400">The rules of the house</p>
      <h1 className="mt-2 font-display text-4xl font-bold text-ivory sm:text-5xl">How chips work</h1>

      <div className="mt-6 rounded-2xl border-2 border-gold-500/50 bg-gradient-to-br from-gold-500/15 to-transparent p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <ChipIcon className="mt-1 h-9 w-9" color="gold" />
          <div>
            <p className="font-display text-2xl font-bold text-gold-200">Play chips are just for fun.</p>
            <p className="mt-2 leading-relaxed text-cream/90">
              All In is a free game. There is no gambling, no purchases and no real money, anywhere, ever. Chips have
              no cash value. You can’t pay for them, and you can’t turn them into anything.
            </p>
          </div>
        </div>
      </div>

      <section className="mt-10 grid gap-5 sm:grid-cols-3">
        <div className="surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">When you join</p>
          <ChipAmount value={start} className="mt-2 font-display text-3xl font-bold text-ivory" iconClassName="h-7 w-7" />
          <p className="mt-2 text-sm text-muted">Free starting chips, added automatically when you verify your account.</p>
        </div>
        <div className="surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Every day</p>
          <p className="mt-2 font-display text-3xl font-bold text-ivory">
            Up to {mults[mults.length - 1]}x
          </p>
          <p className="mt-2 text-sm text-muted">
            A free daily bonus of {formatChips(base)} chips, multiplied by your streak.
          </p>
        </div>
        <div className="surface p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Running low</p>
          <ChipAmount value={refillTo} className="mt-2 font-display text-3xl font-bold text-ivory" iconClassName="h-7 w-7" />
          <p className="mt-2 text-sm text-muted">
            Free refill when you’re under {formatChips(threshold)} chips, every {cooldownH} hours.
          </p>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-ivory">The daily streak</h2>
        <p className="mt-2 text-muted">
          Collect your bonus on consecutive days (resets at 00:00 UTC) and the multiplier grows. Miss a day and it starts
          again from day 1.
        </p>
        <div className="scrollbar-thin mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <caption className="sr-only">Daily bonus by streak day</caption>
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="py-2 pr-4 font-semibold">Streak day</th>
                {mults.map((_, i) => (
                  <th scope="col" key={i} className="py-2 pr-3 font-semibold">
                    {i + 1}
                    {i === mults.length - 1 ? '+' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-white/[0.06]">
                <th scope="row" className="py-2.5 pr-4 font-medium text-cream">Multiplier</th>
                {mults.map((m, i) => (
                  <td key={i} className="py-2.5 pr-3 text-gold-300">{m}x</td>
                ))}
              </tr>
              <tr className="border-t border-white/[0.06]">
                <th scope="row" className="py-2.5 pr-4 font-medium text-cream">Chips</th>
                {mults.map((m, i) => (
                  <td key={i} className="py-2.5 pr-3 tabular-nums text-ivory">{formatChips(Math.round(base * m))}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-ivory">Stake levels</h2>
        <p className="mt-2 text-muted">
          Every game has four stake levels. Higher levels have bigger bets and need more chips to sit down, so there’s
          always something to work toward.
        </p>
        {loading ? (
          <LoadingState label="Loading stake levels…" />
        ) : error ? (
          <div className="surface mt-5">
            <ErrorState message={error} onRetry={() => void load()} />
          </div>
        ) : (
          <>
            <label className="mt-5 flex flex-col gap-1.5 text-sm sm:w-72">
              <span className="font-medium text-cream/90">Game</span>
              <select
                value={game}
                onChange={(e) => setGame(e.target.value)}
                className="h-11 rounded-xl border border-white/10 bg-ink-950/60 px-3 text-ivory focus:border-gold-500/70 focus:outline-none"
              >
                {games.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {gameTiers.map((t) => (
                <li key={t.tier} className={`tier-${t.tier} rounded-2xl border p-5`}>
                  <TierBadge tier={t.tier} />
                  <dl className="mt-4 space-y-2 text-sm">
                    <div>
                      <dt className="text-xs uppercase tracking-wider text-cream/60">{isPoker ? 'Blinds' : 'Bets'}</dt>
                      <dd className="font-semibold text-ivory">
                        {isPoker && t.params.small_blind !== undefined
                          ? `${formatChips(t.params.small_blind)} / ${formatChips(t.params.big_blind)}`
                          : `${formatChips(t.min_bet)} – ${formatChips(t.max_bet)}`}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wider text-cream/60">Chips needed to sit</dt>
                      <dd>
                        <ChipAmount value={t.min_bankroll} className="font-semibold text-ivory" iconClassName="h-4 w-4" />
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="mt-12 grid gap-5 sm:grid-cols-2">
        <div className="surface p-6">
          <h2 className="font-display text-xl font-bold text-ivory">Chips can never be…</h2>
          <ul className="mt-4 space-y-2.5">
            {NOT_ALLOWED.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-sm text-cream/85">
                <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-ruby-400" aria-hidden="true">
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="surface p-6">
          <h2 className="font-display text-xl font-bold text-ivory">Fair by design</h2>
          <p className="mt-3 text-sm leading-relaxed text-cream/85">
            Every shuffle, roll and spin happens on our servers, never in your browser. Your balance can only be changed
            by the server, and every single chip movement is recorded in your chip history with a reason.
          </p>
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            Look for the <PlayChipsBadge /> badge next to your balance.
          </p>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-display text-2xl font-bold text-ivory">Questions</h2>
        <div className="mt-4 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.06]">
          {[
            ['Is All In gambling?', 'No. You never wager anything of value. Chips are free, have no cash value and can’t be exchanged for anything.'],
            ['Can I pay for more chips?', 'No. There is nothing to pay for in All In, and there never will be. Chips come only from playing, daily bonuses and free refills.'],
            ['What if I run out?', `Once you’re below ${formatChips(threshold)} chips you can collect a free refill to ${formatChips(refillTo)}, every ${cooldownH} hours. Plus the daily bonus.`],
            ['Can I send chips to a friend?', 'No. Chips stay with the player who earned them, which keeps things fair for everyone.'],
            ['What are cosmetics?', 'Card backs, table felts, avatars and more, all unlocked by leveling up, achievements, streaks and leaderboard finishes. They’re never for sale.'],
          ].map(([q, a]) => (
            <details key={q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none font-semibold text-ivory marker:hidden">
                <span className="flex items-center justify-between gap-4">
                  {q}
                  <span className="text-gold-400 transition group-open:rotate-45" aria-hidden="true">+</span>
                </span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
